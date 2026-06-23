import { readFile } from 'node:fs/promises'

export interface SinkConfigEntry {
  /** Package to import — e.g. `@walcast/sink-webhook` — or a local path. */
  use: string
  /** Instance id; defaults to the package name. Must be unique. */
  name?: string
  config?: Record<string, unknown>
}

export interface DaemonConfig {
  /** Validated by serve() after the sink check — the zero-sink onboarding error outranks it. */
  db: string | null
  publication: string
  slot: string
  server: {
    port: number
    host: string
    /** Bearer token for /api and /ui. Generated per-start when unset. */
    authToken: string | null
  }
  engine: {
    batchSize: number
    lingerMs: number
    maxAttempts: number
    queueDepth: number
  }
  sinks: SinkConfigEntry[]
}

/**
 * Configuration file (walcast.config.json), with environment overrides:
 * DATABASE_URL/WALCAST_DB, WALCAST_PORT, WALCAST_AUTH_TOKEN,
 * WALCAST_PUBLICATION, WALCAST_SLOT. Env wins over file.
 */
export async function loadConfig(
  path = 'walcast.config.json',
  env: NodeJS.ProcessEnv = process.env,
): Promise<DaemonConfig> {
  let file: Partial<{
    db: string
    publication: string
    slot: string
    server: Partial<DaemonConfig['server']>
    engine: Partial<DaemonConfig['engine']>
    sinks: SinkConfigEntry[]
  }> = {}
  try {
    file = JSON.parse(await readFile(path, 'utf8')) as typeof file
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`failed to read ${path}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return {
    db: env.WALCAST_DB ?? env.DATABASE_URL ?? file.db ?? null,
    publication: env.WALCAST_PUBLICATION ?? file.publication ?? 'walcast',
    slot: env.WALCAST_SLOT ?? file.slot ?? 'walcast',
    server: {
      port: env.WALCAST_PORT ? Number(env.WALCAST_PORT) : (file.server?.port ?? 7717),
      host: file.server?.host ?? '127.0.0.1',
      authToken: env.WALCAST_AUTH_TOKEN ?? file.server?.authToken ?? null,
    },
    engine: {
      batchSize: file.engine?.batchSize ?? 100,
      lingerMs: file.engine?.lingerMs ?? 25,
      maxAttempts: file.engine?.maxAttempts ?? 10,
      queueDepth: file.engine?.queueDepth ?? 1_000,
    },
    sinks: file.sinks ?? [],
  }
}

/** The zero-sink startup error doubles as onboarding. */
export const NO_SINKS_ERROR = `walcast daemon needs at least one sink plugin — the core transports nothing by itself.

Install one and add it to walcast.config.json:

  npm install @walcast/sink-webhook     HTTP POST delivery (HMAC-signed, durable)
  npm install @walcast/sink-sse         live Server-Sent Events endpoint (ephemeral)
  npm install @walcast/sink-kafka       Kafka, exactly-once into the topic (durable)
  npm install @walcast/sink-grpc        push batches to your gRPC server (durable)

Example config:

  {
    "sinks": [
      {
        "use": "@walcast/sink-webhook",
        "config": { "url": "https://example.com/hooks/walcast", "secret": "..." }
      }
    ]
  }

Writing your own transport is a ~50-line plugin: https://github.com/ManasMadan/walcast/tree/master/templates/plugin

(If you just want events in your own code, you don't need the daemon at all:
  import { Walcast } from 'walcast'  — your code is the sink.)`
