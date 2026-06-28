import { useCallback, useEffect, useRef, useState } from 'react'
import { api, getToken, setToken, Unauthorized, type Stats } from '@/api'
import { Live } from '@/pages/Live'
import { Overview } from '@/pages/Overview'
import { Setup } from '@/pages/Setup'
import { Sinks } from '@/pages/Sinks'

const PAGES = ['overview', 'sinks', 'live', 'setup'] as const
type Page = (typeof PAGES)[number]

/** events/sec samples derived from eventsTotal deltas between polls. */
export interface RateSample {
  t: number
  rate: number
}

export function App() {
  const [page, setPage] = useState<Page>('overview')
  const [stats, setStats] = useState<Stats | null>(null)
  const [rates, setRates] = useState<RateSample[]>([])
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const prev = useRef<{ t: number; total: number } | null>(null)

  const poll = useCallback(async () => {
    try {
      const s = await api<Stats>('/api/stats')
      setStats(s)
      setAuthed(true)
      setError(null)
      const now = Date.now()
      if (prev.current) {
        const dt = (now - prev.current.t) / 1000
        const rate = Math.max(0, (s.engine.eventsTotal - prev.current.total) / dt)
        setRates((r) => [...r.slice(-59), { t: now, rate }])
      }
      prev.current = { t: now, total: s.engine.eventsTotal }
    } catch (err) {
      if (err instanceof Unauthorized) setAuthed(false)
      else setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void poll()
    const timer = setInterval(() => void poll(), 2000)
    return () => clearInterval(timer)
  }, [poll])

  if (authed === false) return <TokenGate onSubmit={() => void poll()} />

  return (
    <div className="flex min-h-screen">
      <nav className="flex w-44 shrink-0 flex-col border-r border-line bg-basin-2 px-4 py-6">
        <div className="mb-8 flex items-center gap-2">
          <FlowMark />
          <span className="font-mono text-lg font-semibold tracking-tight">walcast</span>
        </div>
        {PAGES.map((p) => (
          <button
            key={p}
            onClick={() => setPage(p)}
            className={`mb-1 rounded px-3 py-2 text-left font-mono text-sm capitalize transition-colors focus-visible:outline focus-visible:outline-flow ${
              page === p ? 'bg-basin text-flow' : 'text-muted hover:text-fg'
            }`}
          >
            {p === 'live' ? 'live inspector' : p}
          </button>
        ))}
        <div className="mt-auto">
          <StreamState stats={stats} error={error} />
        </div>
      </nav>

      <main className="min-w-0 flex-1 px-8 py-6">
        {page === 'overview' && <Overview stats={stats} rates={rates} />}
        {page === 'sinks' && <Sinks stats={stats} refresh={poll} />}
        {page === 'live' && <Live stats={stats} />}
        {page === 'setup' && <Setup stats={stats} />}
      </main>
    </div>
  )
}

function StreamState({ stats, error }: { stats: Stats | null; error: string | null }) {
  const ok = stats?.slot?.active
  return (
    <div className="border-t border-line pt-4">
      <div className="eyebrow mb-1">stream</div>
      <div className="flex items-center gap-2 font-mono text-xs">
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            error ? 'bg-fail' : ok ? 'bg-flow' : 'bg-warn'
          }`}
        />
        {error ? 'unreachable' : ok ? 'replicating' : 'idle'}
      </div>
    </div>
  )
}

function TokenGate({ onSubmit }: { onSubmit: () => void }) {
  const [value, setValue] = useState(getToken())
  return (
    <div className="flex min-h-screen items-center justify-center">
      <form
        className="w-96 rounded-lg border border-line bg-basin p-8"
        onSubmit={(e) => {
          e.preventDefault()
          setToken(value.trim())
          onSubmit()
        }}
      >
        <div className="mb-2 flex items-center gap-2">
          <FlowMark />
          <span className="font-mono text-lg font-semibold">walcast</span>
        </div>
        <p className="mb-4 text-sm text-muted">
          Paste the admin token — the daemon printed it at startup (or you set it via
          <code className="mx-1 font-mono text-fg">WALCAST_AUTH_TOKEN</code>).
        </p>
        <input
          autoFocus
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="admin token"
          className="mb-3 w-full rounded border border-line bg-ink px-3 py-2 font-mono text-sm outline-none focus:border-flow"
        />
        <button
          type="submit"
          className="w-full rounded bg-flow px-3 py-2 font-mono text-sm font-semibold text-ink hover:brightness-110 focus-visible:outline focus-visible:outline-fg"
        >
          Connect
        </button>
      </form>
    </div>
  )
}

function FlowMark() {
  return (
    <svg viewBox="0 0 32 32" className="h-5 w-5" aria-hidden>
      <path d="M2 20 Q10 12 16 16 T30 12" stroke="var(--color-flow)" strokeWidth="3" fill="none" />
      <path
        d="M2 26 Q10 18 16 22 T30 18"
        stroke="var(--color-flow)"
        strokeWidth="3"
        fill="none"
        opacity=".45"
      />
    </svg>
  )
}
