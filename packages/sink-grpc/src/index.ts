import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import grpc from '@grpc/grpc-js'
import protoLoader from '@grpc/proto-loader'
import type { ChangeEvent, Sink, SinkContext, SinkFactory } from '@walcast/plugin-kit'

export interface GrpcSinkConfig {
  /** Your server implementing walcast.v1.WalcastSink, e.g. "localhost:50051". */
  address: string
  /** TLS: false (plaintext, default) or certificate file paths. */
  tls?:
    | false
    | {
        caFile?: string
        certFile?: string
        keyFile?: string
      }
  /** Per-call deadline. Default 30_000 ms. */
  deadlineMs?: number
}

/** Resolved against the package root — the .proto ships inside the package. */
export const PROTO_PATH = fileURLToPath(new URL('../proto/walcast/v1/sink.proto', import.meta.url))

interface WireEvent {
  id: string
  lsn: string
  commit_lsn: string
  commit_time: string
  schema: string
  table: string
  op: string
  before_json: string
  after_json: string
}

interface DeliverAck {
  ok: boolean
  message: string
}

type DeliverFn = (
  req: { events: WireEvent[] },
  callback: (err: grpc.ServiceError | null, ack: DeliverAck) => void,
) => void

/**
 * Durable push to a user-owned gRPC server. walcast is the client; the
 * receiving side implements the published `walcast.v1.WalcastSink`
 * contract (see proto/walcast/v1/sink.proto and examples/grpc-consumer).
 * Any non-OK status or `ok: false` ack throws, so the engine retries with
 * backoff and pauses after max attempts — ordering and redelivery semantics
 * are exactly the webhook sink's, on a different wire.
 */
class GrpcSink implements Sink {
  readonly name = 'grpc'
  readonly durability = 'durable' as const
  private cfg: GrpcSinkConfig
  private client!: grpc.Client & { Deliver: DeliverFn }
  private ctx!: SinkContext

  constructor(config: Record<string, unknown>) {
    if (typeof config.address !== 'string' || !config.address) {
      throw new Error(
        '@walcast/sink-grpc: config.address must be "host:port" of your WalcastSink server',
      )
    }
    this.cfg = config as unknown as GrpcSinkConfig
  }

  async init(ctx: SinkContext): Promise<void> {
    this.ctx = ctx
    const definition = protoLoader.loadSync(PROTO_PATH, {
      keepCase: true,
      longs: String,
      defaults: true,
    })
    const pkg = grpc.loadPackageDefinition(definition) as unknown as {
      walcast: { v1: { WalcastSink: grpc.ServiceClientConstructor } }
    }
    this.client = new pkg.walcast.v1.WalcastSink(
      this.cfg.address,
      this.credentials(),
    ) as unknown as GrpcSink['client']
    ctx.logger.info('grpc sink ready', {
      address: this.cfg.address,
      tls: Boolean(this.cfg.tls),
      resumeLsn: ctx.resumeLsn,
    })
  }

  private credentials(): grpc.ChannelCredentials {
    const tls = this.cfg.tls
    if (!tls) return grpc.credentials.createInsecure()
    return grpc.credentials.createSsl(
      tls.caFile ? readFileSync(tls.caFile) : null,
      tls.keyFile ? readFileSync(tls.keyFile) : null,
      tls.certFile ? readFileSync(tls.certFile) : null,
    )
  }

  async deliver(batch: ChangeEvent[]): Promise<void> {
    const events: WireEvent[] = batch.map((e) => ({
      id: e.id,
      lsn: e.lsn,
      commit_lsn: e.commit_lsn,
      commit_time: e.commit_time,
      schema: e.schema,
      table: e.table,
      op: e.op,
      before_json: e.before ? JSON.stringify(e.before) : '',
      after_json: e.after ? JSON.stringify(e.after) : '',
    }))
    const deadline = new Date(Date.now() + (this.cfg.deadlineMs ?? 30_000))
    const ack = await new Promise<DeliverAck>((resolve, reject) => {
      ;(
        this.client.Deliver as unknown as (
          req: { events: WireEvent[] },
          options: grpc.CallOptions,
          cb: (err: grpc.ServiceError | null, ack: DeliverAck) => void,
        ) => void
      )({ events }, { deadline }, (err, result) => {
        if (err) reject(err)
        else resolve(result)
      })
    })
    if (!ack.ok) {
      throw new Error(`gRPC consumer rejected the batch${ack.message ? `: ${ack.message}` : ''}`)
    }
  }

  async close(): Promise<void> {
    this.client?.close()
    this.ctx?.logger.info('grpc sink closed')
  }
}

const factory: SinkFactory = (config) => new GrpcSink(config)
export default factory
