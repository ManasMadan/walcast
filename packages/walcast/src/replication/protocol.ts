import { nowPgTime, readLsn, writeLsn, type Lsn } from '@/lsn'

/**
 * The three copy-both payloads of the streaming replication protocol.
 * https://www.postgresql.org/docs/current/protocol-replication.html
 */

export interface XLogData {
  tag: 'XLogData'
  /** WAL position of the start of this payload. */
  walStart: Lsn
  /** Current end of WAL on the server. */
  walEnd: Lsn
  /** Server clock at send time (µs since 2000-01-01). */
  sendTime: bigint
  /** The pgoutput message bytes. */
  payload: Buffer
}

export interface PrimaryKeepalive {
  tag: 'PrimaryKeepalive'
  walEnd: Lsn
  sendTime: bigint
  /** Server demands an immediate standby status update. */
  replyRequested: boolean
}

export type ReplicationMessage = XLogData | PrimaryKeepalive

/** Parse one CopyData payload from the walsender. */
export function parseReplicationMessage(buf: Buffer): ReplicationMessage {
  const tag = buf.readUInt8(0)
  if (tag === 0x77) {
    // 'w' XLogData
    return {
      tag: 'XLogData',
      walStart: readLsn(buf, 1),
      walEnd: readLsn(buf, 9),
      sendTime: buf.readBigInt64BE(17),
      payload: buf.subarray(25),
    }
  }
  if (tag === 0x6b) {
    // 'k' Primary keepalive
    return {
      tag: 'PrimaryKeepalive',
      walEnd: readLsn(buf, 1),
      sendTime: buf.readBigInt64BE(9),
      replyRequested: buf.readUInt8(17) !== 0,
    }
  }
  throw new Error(`replication: unknown copy-data tag 0x${tag.toString(16)}`)
}

/**
 * Build a Standby status update ('r'). `flushed` is the position we
 * guarantee is durably processed — Postgres may discard WAL up to here,
 * so it must only ever come from acknowledged work.
 */
export function buildStandbyStatusUpdate(
  written: Lsn,
  flushed: Lsn,
  applied: Lsn,
  replyRequested = false,
): Buffer {
  const buf = Buffer.alloc(34)
  buf.writeUInt8(0x72, 0) // 'r'
  writeLsn(buf, written, 1)
  writeLsn(buf, flushed, 9)
  writeLsn(buf, applied, 17)
  buf.writeBigInt64BE(nowPgTime(), 25)
  buf.writeUInt8(replyRequested ? 1 : 0, 33)
  return buf
}
