/**
 * Byte-level builders for pgoutput (proto v1) messages, mirroring what the
 * walsender emits. Tests construct wire bytes with these and assert the
 * decoder recovers the structured form.
 */

class Writer {
  private parts: Buffer[] = []

  uint8(v: number) {
    const b = Buffer.alloc(1)
    b.writeUInt8(v)
    this.parts.push(b)
    return this
  }
  char(c: string) {
    return this.uint8(c.charCodeAt(0))
  }
  uint16(v: number) {
    const b = Buffer.alloc(2)
    b.writeUInt16BE(v)
    this.parts.push(b)
    return this
  }
  uint32(v: number) {
    const b = Buffer.alloc(4)
    b.writeUInt32BE(v)
    this.parts.push(b)
    return this
  }
  int32(v: number) {
    const b = Buffer.alloc(4)
    b.writeInt32BE(v)
    this.parts.push(b)
    return this
  }
  uint64(v: bigint) {
    const b = Buffer.alloc(8)
    b.writeBigUInt64BE(v)
    this.parts.push(b)
    return this
  }
  int64(v: bigint) {
    const b = Buffer.alloc(8)
    b.writeBigInt64BE(v)
    this.parts.push(b)
    return this
  }
  cstring(s: string) {
    this.parts.push(Buffer.from(s, 'utf8'), Buffer.from([0]))
    return this
  }
  raw(b: Buffer) {
    this.parts.push(b)
    return this
  }
  build(): Buffer {
    return Buffer.concat(this.parts)
  }
}

export type FixtureColumn = { name: string; typeOid: number; key?: boolean; typeMod?: number }

/** null | unchanged-toast | text value */
export type FixtureValue = string | null | { toast: true }

export function begin(commitLsn: bigint, commitTimeUs: bigint, xid: number): Buffer {
  return new Writer().char('B').uint64(commitLsn).int64(commitTimeUs).uint32(xid).build()
}

export function commit(commitLsn: bigint, endLsn: bigint, commitTimeUs: bigint): Buffer {
  return new Writer()
    .char('C')
    .uint8(0)
    .uint64(commitLsn)
    .uint64(endLsn)
    .int64(commitTimeUs)
    .build()
}

export function origin(commitLsn: bigint, name: string): Buffer {
  return new Writer().char('O').uint64(commitLsn).cstring(name).build()
}

export function relation(
  id: number,
  schema: string,
  name: string,
  replicaIdentity: 'd' | 'n' | 'f' | 'i',
  columns: FixtureColumn[],
): Buffer {
  const w = new Writer()
    .char('R')
    .uint32(id)
    .cstring(schema)
    .cstring(name)
    .char(replicaIdentity)
    .uint16(columns.length)
  for (const col of columns) {
    w.uint8(col.key ? 1 : 0)
      .cstring(col.name)
      .uint32(col.typeOid)
      .int32(col.typeMod ?? -1)
  }
  return w.build()
}

export function typeMessage(typeOid: number, schema: string, name: string): Buffer {
  return new Writer().char('Y').uint32(typeOid).cstring(schema).cstring(name).build()
}

function tuple(w: Writer, values: FixtureValue[]): void {
  w.uint16(values.length)
  for (const v of values) {
    if (v === null) w.char('n')
    else if (typeof v === 'object') w.char('u')
    else {
      const bytes = Buffer.from(v, 'utf8')
      w.char('t').int32(bytes.length).raw(bytes)
    }
  }
}

export function insert(relationId: number, values: FixtureValue[]): Buffer {
  const w = new Writer().char('I').uint32(relationId).char('N')
  tuple(w, values)
  return w.build()
}

export function update(
  relationId: number,
  newValues: FixtureValue[],
  old?: { kind: 'K' | 'O'; values: FixtureValue[] },
): Buffer {
  const w = new Writer().char('U').uint32(relationId)
  if (old) {
    w.char(old.kind)
    tuple(w, old.values)
  }
  w.char('N')
  tuple(w, newValues)
  return w.build()
}

export function deleteMsg(relationId: number, kind: 'K' | 'O', values: FixtureValue[]): Buffer {
  const w = new Writer().char('D').uint32(relationId).char(kind)
  tuple(w, values)
  return w.build()
}

export function truncate(
  relationIds: number[],
  opts: { cascade?: boolean; restartIdentity?: boolean } = {},
): Buffer {
  const w = new Writer()
    .char('T')
    .uint32(relationIds.length)
    .uint8((opts.cascade ? 1 : 0) | (opts.restartIdentity ? 2 : 0))
  for (const id of relationIds) w.uint32(id)
  return w.build()
}

/** Wrap a pgoutput message in an XLogData ('w') copy-data frame. */
export function xlogData(
  walStart: bigint,
  walEnd: bigint,
  sendTimeUs: bigint,
  payload: Buffer,
): Buffer {
  return new Writer()
    .char('w')
    .uint64(walStart)
    .uint64(walEnd)
    .int64(sendTimeUs)
    .raw(payload)
    .build()
}

/** Primary keepalive ('k') copy-data frame. */
export function keepalive(walEnd: bigint, sendTimeUs: bigint, replyRequested: boolean): Buffer {
  return new Writer()
    .char('k')
    .uint64(walEnd)
    .int64(sendTimeUs)
    .uint8(replyRequested ? 1 : 0)
    .build()
}
