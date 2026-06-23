import pg from 'pg'

export interface SinkCheckpoint {
  sinkId: string
  /** Commit LSN of the last fully delivered event (text form). */
  ackedLsn: string | null
  /** Full event id (`lsn:index`) — lets the engine skip mid-transaction. */
  ackedEventId: string | null
  status: 'running' | 'paused'
  lastError: string | null
  updatedAt: Date
}

/**
 * Per-sink delivery checkpoints, persisted in a `walcast` schema inside the
 * source database itself. Keeping them next to the data means a restore of
 * the database restores consistent checkpoints, and the daemon needs no
 * extra infrastructure. Ephemeral sinks never write here.
 */
export class CheckpointStore {
  private pool: pg.Pool

  constructor(connection: string | pg.ClientConfig) {
    const config = typeof connection === 'string' ? { connectionString: connection } : connection
    this.pool = new pg.Pool({ ...config, max: 3 })
  }

  async ensure(): Promise<void> {
    await this.pool.query(`CREATE SCHEMA IF NOT EXISTS walcast`)
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS walcast.sinks (
        sink_id        text PRIMARY KEY,
        acked_lsn      text,
        acked_event_id text,
        status         text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'paused')),
        last_error     text,
        updated_at     timestamptz NOT NULL DEFAULT now()
      )
    `)
  }

  async register(sinkId: string): Promise<SinkCheckpoint> {
    const { rows } = await this.pool.query(
      `INSERT INTO walcast.sinks (sink_id) VALUES ($1)
       ON CONFLICT (sink_id) DO UPDATE SET sink_id = EXCLUDED.sink_id
       RETURNING *`,
      [sinkId],
    )
    return toCheckpoint(rows[0] as Record<string, unknown>)
  }

  async ack(sinkId: string, ackedLsn: string, ackedEventId: string): Promise<void> {
    await this.pool.query(
      `UPDATE walcast.sinks
       SET acked_lsn = $2, acked_event_id = $3, last_error = NULL, updated_at = now()
       WHERE sink_id = $1`,
      [sinkId, ackedLsn, ackedEventId],
    )
  }

  async setStatus(sinkId: string, status: 'running' | 'paused', lastError?: string): Promise<void> {
    await this.pool.query(
      `UPDATE walcast.sinks
       SET status = $2, last_error = $3, updated_at = now()
       WHERE sink_id = $1`,
      [sinkId, status, lastError ?? null],
    )
  }

  async list(): Promise<SinkCheckpoint[]> {
    const { rows } = await this.pool.query(`SELECT * FROM walcast.sinks ORDER BY sink_id`)
    return rows.map(toCheckpoint)
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

function toCheckpoint(row: Record<string, unknown>): SinkCheckpoint {
  return {
    sinkId: row.sink_id as string,
    ackedLsn: (row.acked_lsn as string | null) ?? null,
    ackedEventId: (row.acked_event_id as string | null) ?? null,
    status: row.status as 'running' | 'paused',
    lastError: (row.last_error as string | null) ?? null,
    updatedAt: row.updated_at as Date,
  }
}
