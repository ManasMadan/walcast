// A walcast webhook receiver, stdlib only. The contract:
// - the batch is a JSON array of events, HMAC-SHA256-signed in
//   X-Walcast-Signature (verify against the RAW body, before parsing)
// - respond 2xx ONLY after the batch is durably processed; anything else
//   makes walcast retry with backoff
// - batches can be redelivered; deduplicate on event.id
import { createServer } from 'node:http'
import { verifySignature } from '@walcast/sink-webhook'

const PORT = process.env.PORT ?? '9799'
const SECRET = process.env.WALCAST_SECRET ?? 'change-me'

// Idempotency: remember processed event ids (use your database in real life).
const processed = new Set()

const server = createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/hook') {
    res.writeHead(404).end()
    return
  }
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8')
    const signature = req.headers['x-walcast-signature']
    if (typeof signature !== 'string' || !verifySignature(body, SECRET, signature)) {
      res.writeHead(401).end()
      return
    }
    for (const event of JSON.parse(body)) {
      if (processed.has(event.id)) continue // redelivery — already handled
      console.log(
        `${event.op.padEnd(8)} ${event.schema}.${event.table} ${event.id}`,
        event.after ?? event.before,
      )
      processed.add(event.id)
    }
    res.writeHead(200).end()
  })
})

server.listen(Number(PORT), () => {
  console.log(`webhook receiver listening on :${PORT}, POST /hook`)
})
