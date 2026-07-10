# Write a sink in 15 minutes

Everything that transports events is a plugin, so writing one is meant to be small. A sink is a package whose default export is a factory `(config) => Sink`. This page builds a complete, working NDJSON file sink and runs it through the conformance harness.

```bash
npm install @walcast/plugin-kit   # types + harness; nothing at runtime
```

## The Sink interface

```ts
import type { Sink, SinkContext, ChangeEvent } from '@walcast/plugin-kit'

interface Sink {
  readonly name: string
  readonly durability: 'durable' | 'ephemeral'
  init(ctx: SinkContext): Promise<void> // once, before any delivery
  deliver(batch: ChangeEvent[]): Promise<void> // one ordered batch; throw = failure
  close(): Promise<void> // flush and release; called on shutdown
}
```

## The contract

The engine calls `deliver` with batches of events in strict commit order. What happens around that call depends on your declared durability:

**Durable** (`durability: 'durable'`):

- The engine **never advances your checkpoint** (nor, transitively, the replication slot) until `deliver` resolves.
- A rejected `deliver` is **retried** with exponential backoff and jitter. After `maxAttempts` the sink is **paused** — never skipped, never advanced — resumable from the API/UI.
- The same batch **may be delivered more than once** (crash recovery; retry after a partially-applied failure). Event ids are stable across redelivery: be idempotent or tolerate duplicates.
- A full queue backpressures the whole pipeline up to Postgres. Your slowness holds the slot — that's the durability deal.

**Ephemeral** (`durability: 'ephemeral'`):

- Best-effort. Failures are logged, not retried — once `init` succeeded, delivery problems should be handled locally (log, don't throw).
- You are excluded from the slot's min-LSN computation and can never hold WAL back. A full queue drops events.

Rule of thumb: if a missed event is a bug, you're durable. If a missed event costs a screen refresh, you're ephemeral.

## SinkContext: what `init` receives

```ts
interface SinkContext {
  config: Record<string, unknown> // your entry's "config" object from walcast.config.json
  logger: Logger // structured logger, tagged with your sink id
  sinkId: string // instance id (config "name", defaults to package name)
  resumeLsn: string | null // durable sinks: last acked LSN, null on first run —
  // a crash-recovery redelivery may still replay the tail
  http: {
    // Mount an inbound HTTP route on the daemon's server, namespaced under
    // /plugins/<sinkId>/ and behind the daemon's bearer auth. How transports
    // that need an endpoint (like SSE) get one without running a server.
    registerRoute(path: string, handler: HttpHandler): void
  }
}
```

## A complete NDJSON file sink

Appends every event as one JSON line to a file. Durable: the batch counts as delivered only once the bytes are fsync'd.

```ts
// index.ts — the whole plugin
import { open, type FileHandle } from 'node:fs/promises'
import type { ChangeEvent, Sink, SinkContext, SinkFactory } from '@walcast/plugin-kit'

class NdjsonSink implements Sink {
  readonly name = 'ndjson-file'
  readonly durability = 'durable' as const
  private path: string
  private handle!: FileHandle
  private lastId: string | null = null

  constructor(config: Record<string, unknown>) {
    if (typeof config.path !== 'string' || !config.path) {
      throw new Error('ndjson-file sink: config.path is required')
    }
    this.path = config.path
  }

  async init(ctx: SinkContext): Promise<void> {
    this.handle = await open(this.path, 'a')
    ctx.logger.info('ndjson sink ready', { path: this.path, resumeLsn: ctx.resumeLsn })
  }

  async deliver(batch: ChangeEvent[]): Promise<void> {
    // Redelivery tolerance: after a crash the engine may replay a batch we
    // already wrote. Ids are stable and ordered — skip what we've seen.
    const fresh = this.lastId ? batch.filter((e) => e.id > this.lastId!) : batch
    if (fresh.length === 0) return

    const lines = fresh.map((e) => JSON.stringify(e)).join('\n') + '\n'
    await this.handle.write(lines)
    await this.handle.sync() // durable means durable — resolve only after fsync
    this.lastId = fresh[fresh.length - 1]!.id
  }

  async close(): Promise<void> {
    await this.handle?.close().catch(() => {})
  }
}

const factory: SinkFactory = (config) => new NdjsonSink(config)
export default factory
```

::: warning String comparison of ids is a simplification
`e.id > this.lastId` compares strings, which breaks when hex LSN lengths differ. Real sinks should use `compareEventIds` from `@walcast/plugin-kit` — the shared total order over event ids (by commit LSN as bigint, then index).
:::

Notes on the shape:

- **Construction is synchronous and side-effect-free** — validate config in the constructor, do I/O in `init`. This is what makes sinks trivially testable.
- Throwing from `deliver` is the entire failure API. Don't retry internally (except transport-internal races the engine can't see); the engine owns backoff and pausing.

Use it before publishing anything — `use` accepts a local path:

```json
{ "sinks": [{ "use": "./ndjson-sink.js", "config": { "path": "./changes.ndjson" } }] }
```

## Verify it with the conformance harness

`@walcast/plugin-kit` ships `verifySink` — the same harness every official sink passes in CI. It checks metadata sanity, init/route behavior, ordered delivery, redelivery tolerance, ephemeral failure-swallowing, and idempotent close.

```ts
// test/conformance.test.ts
import { readFile, rm } from 'node:fs/promises'
import { test } from 'vitest'
import { verifySink, type ChangeEvent } from '@walcast/plugin-kit'
import factory from '../src/index'

test('conforms to the sink contract', async () => {
  const path = './test-output.ndjson'
  await verifySink(factory, {
    config: { path },
    before: async () => rm(path, { force: true }),
    after: async () => rm(path, { force: true }),
    // How the harness observes what actually crossed the transport:
    collect: async () => {
      const text = await readFile(path, 'utf8')
      return text
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as ChangeEvent)
    },
    // Our sink dedupes redeliveries itself, so the file must hold exactly one copy:
    expectDedupe: true,
  })
})
```

Without `collect`, the harness can only check local behavior; with it, it asserts every generated event crossed the transport in order — and with `expectDedupe: true`, exactly once. Harness helpers `makeTestEvents` (a deterministic walcast-shaped workload) and `makeMockContext` (a `SinkContext` double capturing logs and routes) are exported for your own tests too.

## Publishing checklist

- [ ] Default export is the factory `(config) => Sink`; construction validates config and does no I/O.
- [ ] `durability` is honest — durable means `deliver` resolves only after the data is safe.
- [ ] Redelivery of an identical batch is tolerated (dedupe on `event.id` / `compareEventIds`, or be naturally idempotent).
- [ ] `verifySink` passes in CI, with a `collect` that reads the real transport back.
- [ ] `close()` is idempotent and flushes.
- [ ] `@walcast/plugin-kit` is a dependency; nothing from the `walcast` core is imported.
- [ ] README documents your config keys and semantics (durable/ephemeral, what a duplicate looks like downstream).
- [ ] Then [get it listed](/guide/community-sinks).
