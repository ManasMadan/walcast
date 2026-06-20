import { describe, expect, it } from 'vitest'
import { buildStandbyStatusUpdate, parseReplicationMessage } from '@/replication/protocol'
import * as fx from './fixtures'

describe('streaming replication protocol', () => {
  it('parses XLogData frames', () => {
    const payload = Buffer.from('hello')
    const msg = parseReplicationMessage(fx.xlogData(100n, 200n, 42n, payload))
    expect(msg).toMatchObject({ tag: 'XLogData', walStart: 100n, walEnd: 200n, sendTime: 42n })
    expect(msg.tag === 'XLogData' && msg.payload.equals(payload)).toBe(true)
  })

  it('parses primary keepalives, including reply-requested', () => {
    expect(parseReplicationMessage(fx.keepalive(300n, 7n, true))).toEqual({
      tag: 'PrimaryKeepalive',
      walEnd: 300n,
      sendTime: 7n,
      replyRequested: true,
    })
    expect(parseReplicationMessage(fx.keepalive(300n, 7n, false))).toMatchObject({
      replyRequested: false,
    })
  })

  it('rejects unknown frame tags', () => {
    expect(() => parseReplicationMessage(Buffer.from([0x5a]))).toThrow(/unknown copy-data tag/)
  })

  it('builds a well-formed standby status update', () => {
    const buf = buildStandbyStatusUpdate(10n, 20n, 30n, true)
    expect(buf.length).toBe(34)
    expect(String.fromCharCode(buf.readUInt8(0))).toBe('r')
    expect(buf.readBigUInt64BE(1)).toBe(10n) // written
    expect(buf.readBigUInt64BE(9)).toBe(20n) // flushed
    expect(buf.readBigUInt64BE(17)).toBe(30n) // applied
    expect(buf.readUInt8(33)).toBe(1) // reply requested
    // Client time is µs since 2000-01-01, so it must land near "now".
    const us = buf.readBigInt64BE(25)
    const asDate = Number(us / 1000n) + 946_684_800_000
    expect(Math.abs(asDate - Date.now())).toBeLessThan(5_000)
  })
})
