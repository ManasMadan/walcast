import type { RateSample } from '@/App'
import { formatBytes, type Stats } from '@/api'
import { FlowRail } from '@/components/FlowRail'
import { Sparkline } from '@/components/Sparkline'

/** Retained WAL beyond this is worth a look; the docs explain slot lag. */
const LAG_WARN_BYTES = 256 * 1024 * 1024

export function Overview({ stats, rates }: { stats: Stats | null; rates: RateSample[] }) {
  if (!stats) return <p className="text-sm text-muted">Connecting…</p>

  const lag = stats.slot?.retainedWalBytes ?? null
  const lagWarn = lag !== null && lag > LAG_WARN_BYTES
  const current = rates[rates.length - 1]?.rate ?? 0

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="eyebrow mb-6">overview</h1>

      <FlowRail stats={stats} />

      <div className="mt-4 grid grid-cols-3 gap-4">
        <Meter
          label="slot lag (retained wal)"
          value={formatBytes(lag)}
          tone={lagWarn ? 'warn' : 'ok'}
          note={lagWarn ? 'a paused or slow sink is holding WAL on disk' : 'healthy'}
        />
        <Meter
          label="events delivered"
          value={stats.engine.eventsTotal.toLocaleString()}
          tone="ok"
          note={`across ${stats.engine.sinks.length} sink${stats.engine.sinks.length === 1 ? '' : 's'}`}
        />
        <Meter
          label="events / sec"
          value={current.toFixed(current >= 10 ? 0 : 1)}
          tone="ok"
          note="2s poll window"
        />
      </div>

      <div className="mt-4 rounded-lg border border-line bg-basin p-6">
        <div className="eyebrow mb-3">throughput</div>
        <Sparkline samples={rates} />
      </div>
    </div>
  )
}

function Meter({
  label,
  value,
  note,
  tone,
}: {
  label: string
  value: string
  note: string
  tone: 'ok' | 'warn'
}) {
  return (
    <div className="rounded-lg border border-line bg-basin p-5">
      <div className="eyebrow mb-2">{label}</div>
      <div className={`font-mono text-2xl font-semibold ${tone === 'warn' ? 'text-warn' : ''}`}>
        {value}
      </div>
      <div className={`mt-1 text-xs ${tone === 'warn' ? 'text-warn' : 'text-muted'}`}>{note}</div>
    </div>
  )
}
