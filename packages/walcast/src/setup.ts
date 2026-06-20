import pg from 'pg'

export interface SetupOptions {
  connection: string | pg.ClientConfig
  publication: string
  slot: string
  /** Restrict the publication to these tables; default is FOR ALL TABLES. */
  tables?: string[]
}

export interface SetupStatus {
  walLevel: string
  publication: { exists: boolean; allTables: boolean | null }
  slot: {
    exists: boolean
    active: boolean
    restartLsn: string | null
    confirmedFlushLsn: string | null
    /** Bytes of WAL the server must retain for this slot. The disk-growth risk. */
    retainedWalBytes: number | null
  }
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

async function withClient<T>(
  connection: string | pg.ClientConfig,
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const config = typeof connection === 'string' ? { connectionString: connection } : connection
  const client = new pg.Client(config)
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

/**
 * Create the publication and the logical replication slot if they do not
 * exist. Idempotent; never drops or replaces anything. Requires wal_level =
 * logical and a role with REPLICATION (or superuser).
 */
export async function ensureSetup(opts: SetupOptions): Promise<void> {
  await withClient(opts.connection, async (client) => {
    const { rows: wal } = await client.query(`SHOW wal_level`)
    if (wal[0]?.wal_level !== 'logical') {
      throw new Error(
        `wal_level is '${wal[0]?.wal_level}', logical replication needs 'logical'. ` +
          `Set wal_level = logical in postgresql.conf and restart Postgres.`,
      )
    }

    const { rowCount: hasPub } = await client.query(
      `SELECT 1 FROM pg_publication WHERE pubname = $1`,
      [opts.publication],
    )
    if (!hasPub) {
      const target = opts.tables?.length
        ? `FOR TABLE ${opts.tables.map(quoteIdent).join(', ')}`
        : `FOR ALL TABLES`
      await client.query(`CREATE PUBLICATION ${quoteIdent(opts.publication)} ${target}`)
    }

    const { rowCount: hasSlot } = await client.query(
      `SELECT 1 FROM pg_replication_slots WHERE slot_name = $1`,
      [opts.slot],
    )
    if (!hasSlot) {
      await client.query(`SELECT pg_create_logical_replication_slot($1, 'pgoutput')`, [opts.slot])
    }
  })
}

/** Inspect publication, slot, and retained-WAL lag without changing anything. */
export async function inspectSetup(opts: SetupOptions): Promise<SetupStatus> {
  return withClient(opts.connection, async (client) => {
    const { rows: wal } = await client.query(`SHOW wal_level`)
    const { rows: pubs } = await client.query(
      `SELECT puballtables FROM pg_publication WHERE pubname = $1`,
      [opts.publication],
    )
    const { rows: slots } = await client.query(
      `SELECT active, restart_lsn, confirmed_flush_lsn,
              pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn) AS retained_wal_bytes
       FROM pg_replication_slots WHERE slot_name = $1`,
      [opts.slot],
    )
    const slot = slots[0]
    return {
      walLevel: wal[0]?.wal_level ?? 'unknown',
      publication: {
        exists: pubs.length > 0,
        allTables: pubs.length > 0 ? Boolean(pubs[0].puballtables) : null,
      },
      slot: {
        exists: Boolean(slot),
        active: slot ? Boolean(slot.active) : false,
        restartLsn: slot?.restart_lsn ?? null,
        confirmedFlushLsn: slot?.confirmed_flush_lsn ?? null,
        retainedWalBytes: slot ? Number(slot.retained_wal_bytes) : null,
      },
    }
  })
}

/**
 * Drop the slot and publication. Destructive and never called automatically —
 * only from `walcast teardown` after explicit confirmation. Dropping the
 * slot releases retained WAL; any undelivered changes are gone for good.
 */
export async function teardown(opts: SetupOptions): Promise<void> {
  await withClient(opts.connection, async (client) => {
    const { rowCount: hasSlot } = await client.query(
      `SELECT 1 FROM pg_replication_slots WHERE slot_name = $1`,
      [opts.slot],
    )
    if (hasSlot) await client.query(`SELECT pg_drop_replication_slot($1)`, [opts.slot])
    await client.query(`DROP PUBLICATION IF EXISTS ${quoteIdent(opts.publication)}`)
  })
}
