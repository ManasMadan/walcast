/**
 * Log Sequence Numbers identify byte positions in the Postgres WAL.
 * Textually they look like `16/B374D848` (two hex halves); on the wire
 * they are unsigned 64-bit integers. We use `bigint` internally and the
 * text form at every user-facing boundary.
 */
export type Lsn = bigint

export const LSN_ZERO: Lsn = 0n

export function parseLsn(text: string): Lsn {
  const m = /^([0-9A-Fa-f]{1,8})\/([0-9A-Fa-f]{1,8})$/.exec(text)
  if (!m) throw new Error(`invalid LSN: ${JSON.stringify(text)}`)
  return (BigInt(`0x${m[1]}`) << 32n) | BigInt(`0x${m[2]}`)
}

export function formatLsn(lsn: Lsn): string {
  const high = (lsn >> 32n) & 0xffffffffn
  const low = lsn & 0xffffffffn
  return `${high.toString(16).toUpperCase()}/${low.toString(16).toUpperCase()}`
}

export function readLsn(buf: Buffer, offset: number): Lsn {
  return buf.readBigUInt64BE(offset)
}

export function writeLsn(buf: Buffer, lsn: Lsn, offset: number): void {
  buf.writeBigUInt64BE(lsn, offset)
}

/** Microseconds between the Unix epoch and the Postgres epoch (2000-01-01). */
export const PG_EPOCH_US = 946_684_800_000_000n

/** Convert a Postgres timestamp (µs since 2000-01-01) to a JS Date. */
export function pgTimeToDate(us: bigint): Date {
  return new Date(Number((us + PG_EPOCH_US) / 1000n))
}

/** Current time as a Postgres timestamp (µs since 2000-01-01). */
export function nowPgTime(): bigint {
  return BigInt(Date.now()) * 1000n - PG_EPOCH_US
}
