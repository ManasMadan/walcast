import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { existsSync, createReadStream } from 'node:fs'
import { join, normalize } from 'node:path'
import type { HttpHandler, Logger } from '@walcast/plugin-kit'
import type { SinkEngine } from '@/engine/engine'
import type { Walcast } from '@/walcast'

export interface DaemonServerOptions {
  engine: SinkEngine
  walcast: Walcast
  authToken: string | null
  logger: Logger
  /** Directory of built dashboard assets; /ui 404s when absent. */
  uiDir?: string
}

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(data)
}

/**
 * The daemon's HTTP server — pure control plane plus mount points for
 * plugin routes. `/api` is bearer-token protected; `/healthz` is open;
 * `/plugins/<sinkId>/<path>` dispatches to routes sinks registered at init.
 */
export class DaemonServer {
  readonly server: Server
  private routes = new Map<string, HttpHandler>()
  private startedAt = Date.now()

  constructor(private opts: DaemonServerOptions) {
    this.server = createServer((req, res) => {
      this.handle(req, res).catch((err: unknown) => {
        this.opts.logger.error('request failed', { error: String(err) })
        if (!res.headersSent) json(res, 500, { error: 'internal error' })
        else res.end()
      })
    })
  }

  /** Namespaced under /plugins/<sinkId>; used by the engine's SinkContext. */
  registerRoute = (sinkId: string, path: string, handler: HttpHandler): void => {
    const full = `/plugins/${sinkId}${path === '/' ? '' : path}`
    if (this.routes.has(full)) throw new Error(`route already registered: ${full}`)
    this.routes.set(full, handler)
    this.opts.logger.info('plugin route mounted', { route: full })
  }

  listen(port: number, host: string): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(port, host, () => {
        const addr = this.server.address()
        resolve(typeof addr === 'object' && addr ? addr.port : port)
      })
    })
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => resolve())
      this.server.closeAllConnections?.()
    })
  }

  private authorized(req: IncomingMessage): boolean {
    if (!this.opts.authToken) return true
    const header = req.headers.authorization
    if (header === `Bearer ${this.opts.authToken}`) return true
    // Browser EventSource/asset requests can't set headers; allow ?token=.
    const url = new URL(req.url ?? '/', 'http://local')
    return url.searchParams.get('token') === this.opts.authToken
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://local')
    const path = url.pathname

    if (path === '/healthz') {
      json(res, 200, { ok: true, uptimeMs: Date.now() - this.startedAt })
      return
    }

    // Plugin routes do their own thing (SSE etc.) but still sit behind auth.
    const plugin = this.routes.get(path)
    if (plugin) {
      if (!this.authorized(req)) return json(res, 401, { error: 'unauthorized' })
      await plugin(req, res)
      return
    }

    if (path.startsWith('/api/')) {
      if (!this.authorized(req)) return json(res, 401, { error: 'unauthorized' })
      return this.handleApi(req, res, path)
    }

    if (path === '/') {
      res.writeHead(302, { location: '/ui/' })
      res.end()
      return
    }
    if (path === '/ui' || path.startsWith('/ui/')) {
      return this.serveUi(path, res)
    }

    json(res, 404, { error: 'not found' })
  }

  private async handleApi(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const method = req.method ?? 'GET'

    if (method === 'GET' && path === '/api/stats') {
      const [setup, engine] = await Promise.all([
        this.opts.walcast.status().catch(() => null),
        Promise.resolve(this.opts.engine.stats()),
      ])
      json(res, 200, {
        uptimeMs: Date.now() - this.startedAt,
        engine,
        slot: setup?.slot ?? null,
        publication: setup?.publication ?? null,
        walLevel: setup?.walLevel ?? null,
      })
      return
    }

    if (method === 'GET' && path === '/api/sinks') {
      json(res, 200, { sinks: this.opts.engine.stats().sinks })
      return
    }

    const action = /^\/api\/sinks\/([^/]+)\/(pause|resume)$/.exec(path)
    if (method === 'POST' && action) {
      const [, sinkId, verb] = action
      try {
        if (verb === 'pause') await this.opts.engine.pause(sinkId!)
        else await this.opts.engine.resume(sinkId!)
        json(res, 200, { ok: true })
      } catch (err) {
        json(res, 404, { error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    json(res, 404, { error: 'not found' })
  }

  private serveUi(path: string, res: ServerResponse): void {
    const dir = this.opts.uiDir
    if (!dir || !existsSync(dir)) {
      json(res, 404, {
        error: 'dashboard assets not found (was the package built with the UI?)',
      })
      return
    }
    let rel = path.replace(/^\/ui\/?/, '')
    if (rel === '') rel = 'index.html'
    const file = normalize(join(dir, rel))
    if (!file.startsWith(normalize(dir))) return json(res, 403, { error: 'forbidden' })
    const target = existsSync(file) ? file : join(dir, 'index.html') // SPA fallback
    const ext = target.slice(target.lastIndexOf('.'))
    res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' })
    createReadStream(target).pipe(res)
  }
}
