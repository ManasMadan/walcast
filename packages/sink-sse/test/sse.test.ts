import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import {
  makeMockContext,
  makeTestEvents,
  verifySink,
  type ChangeEvent,
  type MockSinkContext,
} from '@walcast/plugin-kit'
import factory from '@/index'

/** Serve the sink's registered routes like the daemon would. */
async function mount(ctx: MockSinkContext): Promise<{ server: Server; base: string }> {
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://local').pathname
    const handler = ctx.routes.get(path)
    if (handler) void handler(req, res)
    else res.writeHead(404).end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  // SSE connections are held open; kill them so close() can complete.
  cleanups.push(() => {
    server.closeAllConnections()
    return new Promise((r) => server.close(r))
  })
  return { server, base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}` }
}

/** Minimal SSE client: collects `event: change` frames into an array. */
function sseClient(url: string): {
  events: ChangeEvent[]
  close: () => void
  ready: Promise<void>
} {
  const events: ChangeEvent[] = []
  const controller = new AbortController()
  let markReady!: () => void
  const ready = new Promise<void>((r) => (markReady = r))
  void (async () => {
    const res = await fetch(url, { signal: controller.signal })
    markReady()
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value as Uint8Array, { stream: true })
      let sep
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)
        const data = frame
          .split('\n')
          .filter((l) => l.startsWith('data: '))
          .map((l) => l.slice(6))
          .join('\n')
        if (data) events.push(JSON.parse(data) as ChangeEvent)
      }
    }
  })().catch(() => {})
  return { events, close: () => controller.abort(), ready }
}

const cleanups: Array<() => void | Promise<unknown>> = []
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn()
})

describe('@walcast/sink-sse', () => {
  it('passes the conformance harness with a live SSE client attached', async () => {
    let client!: ReturnType<typeof sseClient>
    await verifySink(factory, {
      afterInit: async (ctx) => {
        const { base } = await mount(ctx)
        client = sseClient(`${base}/events`)
        cleanups.push(() => client.close())
        await client.ready
      },
      collect: async () => {
        await new Promise((r) => setTimeout(r, 300)) // let frames flush
        return client.events
      },
    })
  })

  it('filters by ?tables= and ignores events for other tables', async () => {
    const sink = factory({})
    const ctx = makeMockContext()
    await sink.init(ctx)
    const { base } = await mount(ctx)
    cleanups.push(() => sink.close())

    const filtered = sseClient(`${base}/events?tables=conformance`)
    const excluded = sseClient(`${base}/events?tables=other_table`)
    cleanups.push(filtered.close, excluded.close)
    await Promise.all([filtered.ready, excluded.ready])

    await sink.deliver(makeTestEvents(4)) // all on table "conformance"
    await new Promise((r) => setTimeout(r, 300))

    expect(filtered.events).toHaveLength(4)
    expect(excluded.events).toHaveLength(0)
  })

  it('delivers nothing (and does not fail) with zero clients', async () => {
    const sink = factory({})
    await sink.init(makeMockContext())
    await expect(sink.deliver(makeTestEvents(3))).resolves.toBeUndefined()
    await sink.close()
  })

  it('sends heartbeat comments to keep intermediaries from closing the stream', async () => {
    const sink = factory({ heartbeatMs: 100 })
    const ctx = makeMockContext()
    await sink.init(ctx)
    const { base } = await mount(ctx)
    cleanups.push(() => sink.close())

    const res = await fetch(`${base}/events`)
    const reader = res.body!.getReader()
    let raw = ''
    const decoder = new TextDecoder()
    const until = Date.now() + 2_000
    while (!raw.includes(': heartbeat') && Date.now() < until) {
      const { value } = await reader.read()
      raw += decoder.decode(value as Uint8Array, { stream: true })
    }
    await reader.cancel()
    expect(raw).toContain(': heartbeat')
  })
})
