import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import pg from 'pg'
import type { ChangeEvent } from '@/events'
import { parseLsn } from '@/lsn'
import { Walcast } from '@/walcast'

const dsn = inject('dsn')

/** Pull the next `n` events from a changes() iteration, with a hang guard. */
async function take(
  iter: AsyncGenerator<ChangeEvent>,
  n: number,
  timeoutMs = 15_000,
): Promise<ChangeEvent[]> {
  const out: ChangeEvent[] = []
  while (out.length < n) {
    const result = await Promise.race([
      iter.next(),
      new Promise<never>((_, reject) => {
        const t = setTimeout(
          () => reject(new Error(`timed out waiting for ${n} events (got ${out.length})`)),
          timeoutMs,
        )
        t.unref()
      }),
    ])
    if (result.done) throw new Error(`stream ended after ${out.length}/${n} events`)
    out.push(result.value)
  }
  return out
}

describe.skipIf(!dsn)('integration (live Postgres)', () => {
  let db: pg.Client

  beforeAll(async () => {
    db = new pg.Client({ connectionString: dsn })
    await db.connect()
  })

  afterAll(async () => {
    await db.end()
  })

  /** Isolated table + publication + slot per test. */
  async function fixture(name: string, tables?: string[]) {
    await db.query(`DROP TABLE IF EXISTS ${name}`)
    await db.query(`CREATE TABLE ${name} (id serial PRIMARY KEY, label text, meta jsonb)`)
    await db.query(`ALTER TABLE ${name} REPLICA IDENTITY FULL`)
    const tr = new Walcast({
      connection: dsn,
      publication: `pub_${name}`,
      slot: `slot_${name}`,
      tables: tables ?? [name],
      statusIntervalMs: 500,
    })
    await tr.teardown().catch(() => {})
    await tr.setup()
    return tr
  }

  it('setup is idempotent and status reports the slot', async () => {
    const tr = await fixture('t_setup')
    await tr.setup() // second run must be a no-op
    const s = await tr.status()
    expect(s.walLevel).toBe('logical')
    expect(s.publication.exists).toBe(true)
    expect(s.slot.exists).toBe(true)
    expect(s.slot.confirmedFlushLsn).toMatch(/^[0-9A-F]+\/[0-9A-F]+$/i)
    await tr.teardown()
  })

  it('yields insert/update/delete with before/after and deterministic ids', async () => {
    const tr = await fixture('t_ops')
    const iter = tr.changes()

    await db.query(`INSERT INTO t_ops (label, meta) VALUES ('one', '{"k":1}')`)
    await db.query(`UPDATE t_ops SET label = 'uno' WHERE label = 'one'`)
    await db.query(`DELETE FROM t_ops WHERE label = 'uno'`)

    const [ins, upd, del] = await take(iter, 3)

    expect(ins).toMatchObject({
      op: 'insert',
      schema: 'public',
      table: 't_ops',
      before: null,
      after: { id: 1, label: 'one', meta: { k: 1 } },
    })
    expect(upd).toMatchObject({
      op: 'update',
      before: { id: 1, label: 'one' }, // REPLICA IDENTITY FULL
      after: { id: 1, label: 'uno' },
    })
    expect(del).toMatchObject({
      op: 'delete',
      before: { id: 1, label: 'uno' },
      after: null,
    })

    for (const e of [ins, upd, del]) {
      expect(e!.id).toBe(`${e!.commit_lsn}:0`) // single-change transactions
      expect(Date.parse(e!.commit_time)).toBeGreaterThan(Date.now() - 60_000)
    }
    // Three separate transactions => strictly increasing commit LSNs.
    expect(ins!.commit_lsn).not.toBe(upd!.commit_lsn)

    await tr.stop()
    await tr.teardown()
  })

  it('numbers changes within a transaction and shares commit_lsn', async () => {
    const tr = await fixture('t_tx')
    const iter = tr.changes()

    await db.query(
      `BEGIN;
       INSERT INTO t_tx (label) VALUES ('a');
       INSERT INTO t_tx (label) VALUES ('b');
       INSERT INTO t_tx (label) VALUES ('c');
       COMMIT;`,
    )

    const events = await take(iter, 3)
    const commitLsns = new Set(events.map((e) => e.commit_lsn))
    expect(commitLsns.size).toBe(1)
    expect(events.map((e) => e.id)).toEqual([0, 1, 2].map((i) => `${events[0]!.commit_lsn}:${i}`))
    expect(events.map((e) => e.after?.label)).toEqual(['a', 'b', 'c'])

    await tr.stop()
    await tr.teardown()
  })

  it('emits truncate events', async () => {
    const tr = await fixture('t_trunc')
    const iter = tr.changes()

    await db.query(`INSERT INTO t_trunc (label) VALUES ('x')`)
    await db.query(`TRUNCATE t_trunc`)

    const [, trunc] = await take(iter, 2)
    expect(trunc).toMatchObject({ op: 'truncate', table: 't_trunc', before: null, after: null })

    await tr.stop()
    await tr.teardown()
  })

  it('redelivers unacked events with identical ids; acked events are gone', async () => {
    const tr = await fixture('t_redeliver')

    // Round 1: consume without acking.
    const iter1 = tr.changes()
    await db.query(`INSERT INTO t_redeliver (label) VALUES ('r1')`)
    await db.query(`INSERT INTO t_redeliver (label) VALUES ('r2')`)
    const round1 = await take(iter1, 2)
    await tr.stop()

    // Round 2: same events again, byte-identical ids (crash semantics).
    const iter2 = tr.changes()
    const round2 = await take(iter2, 2)
    expect(round2.map((e) => e.id)).toEqual(round1.map((e) => e.id))
    expect(round2.map((e) => e.after?.label)).toEqual(['r1', 'r2'])

    // Ack everything (cumulative: acking the last covers both), then wait
    // for the flushed position to pass the commit — the ack's upgrade to the
    // commit end LSN only lands once the pump has decoded the Commit frame,
    // and stopping before that legally redelivers the transaction.
    tr.ack(round2[1]!)
    expect(tr.pending).toBe(0)
    const past = parseLsn(round2[1]!.commit_lsn)
    for (let i = 0; tr.flushedLsn === null || parseLsn(tr.flushedLsn) <= past; i++) {
      if (i > 100) throw new Error('flushed position never passed the acked commit')
      await new Promise((r) => setTimeout(r, 50))
    }
    await tr.stop()

    // Round 3: only new work is delivered.
    const iter3 = tr.changes()
    await db.query(`INSERT INTO t_redeliver (label) VALUES ('r3')`)
    const round3 = await take(iter3, 1)
    expect(round3[0]!.after?.label).toBe('r3')
    expect(round3[0]!.id).not.toBe(round1[0]!.id)
    await tr.stop()
    await tr.teardown()
  })

  it('advances confirmed_flush past commits when everything is acked', async () => {
    const tr = await fixture('t_flush')
    const iter = tr.changes()

    await db.query(`INSERT INTO t_flush (label) VALUES ('f1')`)
    const [e] = await take(iter, 1)
    tr.ack(e!)

    // Give the commit message + status update a moment to round-trip.
    await new Promise((r) => setTimeout(r, 1_500))
    const s = await tr.status()
    const [hi, lo] = s.slot.confirmedFlushLsn!.split('/')
    const confirmed = (BigInt(`0x${hi}`) << 32n) | BigInt(`0x${lo}`)
    const [chi, clo] = e!.commit_lsn.split('/')
    const commit = (BigInt(`0x${chi}`) << 32n) | BigInt(`0x${clo}`)
    expect(confirmed).toBeGreaterThan(commit)

    await tr.stop()
    await tr.teardown()
  })

  it('interleaved transactions: acking the first-delivered event must not release later-delivered ones', async () => {
    const tr = await fixture('t_interleave')
    const iter = tr.changes()

    // Two overlapping transactions. A writes first (lower change LSN) but
    // commits last, so pgoutput delivers B's transaction before A's.
    const connA = new pg.Client({ connectionString: dsn })
    const connB = new pg.Client({ connectionString: dsn })
    await connA.connect()
    await connB.connect()
    await connA.query('BEGIN')
    await connA.query(`INSERT INTO t_interleave (label) VALUES ('a')`)
    await connB.query('BEGIN')
    await connB.query(`INSERT INTO t_interleave (label) VALUES ('b')`)
    await connB.query('COMMIT')
    await connA.query('COMMIT')
    await connA.end()
    await connB.end()

    const [first, second] = await take(iter, 2)
    expect(first!.after?.label).toBe('b') // commit order, not write order
    expect(second!.after?.label).toBe('a')
    expect(parseLsn(second!.lsn) < parseLsn(first!.commit_lsn)).toBe(true) // the trap

    // Acking B (delivered first) must leave A outstanding even though A's
    // change LSN is lower than B's commit — sweeping by LSN would drop it
    // and let the slot advance past an unprocessed event.
    tr.ack(first!)
    expect(tr.pending).toBe(1)
    tr.ack(second!)
    expect(tr.pending).toBe(0)

    await tr.stop()
    await tr.teardown()
  })

  it('rejects concurrent consumption of the same instance', async () => {
    const tr = await fixture('t_concurrent')
    const iter = tr.changes()
    const first = iter.next() // starts the stream; resolves only on stop
    first.catch(() => {})
    await new Promise((r) => setTimeout(r, 500)) // let the stream attach
    // Starting a second iteration must fail fast.
    await expect(tr.changes().next()).rejects.toThrow(/already being consumed/)
    await tr.stop()
    await tr.teardown()
  })
})
