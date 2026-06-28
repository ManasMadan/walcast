export interface SinkStats {
  id: string
  name: string
  durability: 'durable' | 'ephemeral'
  status: 'running' | 'paused'
  lastError: string | null
  queueDepth: number
  deliveredCount: number
  droppedCount: number
  ackedLsn: string | null
}

export interface Stats {
  uptimeMs: number
  engine: {
    eventsTotal: number
    flushedLsn: string | null
    sinks: SinkStats[]
  }
  slot: {
    exists: boolean
    active: boolean
    restartLsn: string | null
    confirmedFlushLsn: string | null
    retainedWalBytes: number | null
  } | null
  publication: { exists: boolean; allTables: boolean | null } | null
  walLevel: string | null
}

export interface ChangeEvent {
  id: string
  lsn: string
  commit_lsn: string
  commit_time: string
  schema: string
  table: string
  op: 'insert' | 'update' | 'delete' | 'truncate'
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
}

const KEY = 'walcast.token'

export function getToken(): string {
  const fromUrl = new URLSearchParams(location.search).get('token')
  if (fromUrl) {
    localStorage.setItem(KEY, fromUrl)
    history.replaceState(null, '', location.pathname) // keep it out of the URL bar
    return fromUrl
  }
  return localStorage.getItem(KEY) ?? ''
}

export function setToken(token: string): void {
  localStorage.setItem(KEY, token)
}

export class Unauthorized extends Error {}

export async function api<T>(path: string): Promise<T> {
  const res = await fetch(path, {
    headers: { authorization: `Bearer ${getToken()}` },
  })
  if (res.status === 401) throw new Unauthorized('unauthorized')
  if (!res.ok) throw new Error(`${path} responded ${res.status}`)
  return res.json() as Promise<T>
}

export async function post(path: string): Promise<void> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { authorization: `Bearer ${getToken()}` },
  })
  if (res.status === 401) throw new Unauthorized('unauthorized')
  if (!res.ok) throw new Error(`${path} responded ${res.status}`)
}

export function formatBytes(n: number | null): string {
  if (n === null) return '—'
  if (n < 1024) return `${n} B`
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(1)} ${units[i]}`
}

export function parseLsn(text: string | null): bigint | null {
  if (!text) return null
  const m = /^([0-9A-Fa-f]+)\/([0-9A-Fa-f]+)$/.exec(text)
  if (!m) return null
  return (BigInt(`0x${m[1]}`) << 32n) | BigInt(`0x${m[2]}`)
}
