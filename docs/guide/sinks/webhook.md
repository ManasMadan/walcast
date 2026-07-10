# Webhook sink

`@walcast/sink-webhook` — durable HTTP POST delivery, optionally HMAC-signed.

```bash
npm install @walcast/sink-webhook
```

```json
{
  "sinks": [
    {
      "use": "@walcast/sink-webhook",
      "config": {
        "url": "https://example.com/hooks/walcast",
        "secret": "your-hmac-secret"
      }
    }
  ]
}
```

## Config

| Key         | Type                     | Default  | Description                                                                       |
| ----------- | ------------------------ | -------- | --------------------------------------------------------------------------------- |
| `url`       | `string`                 | required | Endpoint receiving `POST` batches (a JSON array of events). Must be `http(s)://`. |
| `secret`    | `string`                 | —        | HMAC-SHA256 secret. When set, the signature travels in `X-Walcast-Signature`.    |
| `headers`   | `Record<string, string>` | —        | Extra request headers, e.g. an `Authorization` header for your receiver.          |
| `timeoutMs` | `number`                 | `30000`  | Per-request timeout. A timeout counts as a failed attempt.                        |

## Semantics

Durable. The sink itself is deliberately nothing but transport — serialize, sign, POST, insist on a 2xx. Everything else is the engine's contract:

- Batches arrive in strict commit order.
- A non-2xx response or timeout throws; the engine retries with exponential backoff + jitter, and pauses the sink after `maxAttempts` (default 10) — never skips, never advances the checkpoint.
- Delivery is **at-least-once**: your receiver can see the same batch twice. Deduplicate on `event.id`, which is identical across redeliveries. See [Delivery guarantees](/guide/delivery-guarantees).

## The request

```
POST <url>
content-type: application/json
user-agent: walcast-webhook
x-walcast-batch-size: 3
x-walcast-first-id: 0/1A2B3C8:0
x-walcast-last-id: 0/1A2B4F0:1
x-walcast-signature: sha256=<hex hmac of the raw body>   (when secret is set)

[ { "id": "0/1A2B3C8:0", "op": "insert", ... }, ... ]
```

The body is a JSON array of [change events](/reference/event-schema).

## Verifying signatures

The signature is `sha256=` + hex HMAC-SHA256 of the **raw body bytes**. Use a constant-time compare. The package exports helpers for receivers:

```ts
import { verifySignature } from '@walcast/sink-webhook'

app.post('/hooks/walcast', (req, res) => {
  const ok = verifySignature(
    req.rawBody,
    process.env.WALCAST_SECRET!,
    req.headers['x-walcast-signature'],
  )
  if (!ok) return res.status(401).end()

  for (const event of req.body) {
    // dedupe on event.id, then process
  }
  res.status(200).end() // 2xx only after the batch is durably processed
})
```

Return 2xx **only after** the batch is durably processed. A 2xx before processing turns your pipeline into at-most-once.
