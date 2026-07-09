---
layout: home

hero:
  name: walcast
  text: Postgres change data capture for Node
  tagline: A hand-written pgoutput decoder speaking the streaming replication protocol directly — an async iterator with explicit acks, and a plugin engine when you want a daemon.
  actions:
    - theme: brand
      text: Quickstart (library)
      link: /guide/quickstart-library
    - theme: alt
      text: Quickstart (daemon)
      link: /guide/quickstart-daemon
    - theme: alt
      text: Why walcast
      link: /guide/why-walcast

features:
  - title: Zero plugins to start
    details: 'import { Walcast } from "walcast" and for-await your database changes. Your code is the sink — no daemon, no broker, no config file.'
  - title: Honest delivery guarantees
    details: At-least-once delivery with deterministic, LSN-derived event ids — exactly-once processing via consumer idempotency. Exactly-once into Kafka via transactional checkpoints. Nothing claimed that cannot hold.
  - title: Everything that transports is a plugin
    details: The core ships zero sinks, like @babel/core ships zero transforms. Webhook, SSE, Kafka, and gRPC sinks are separate packages; yours is a ~50-line default export.
  - title: A real replication client
    details: Speaks START_REPLICATION and pgoutput at the byte level, tracks LSNs as bigints, backpressures Postgres instead of dropping events, and only advances the slot past acknowledged work.
  - title: Operable by design
    details: A tiny daemon with a bearer-token admin API and dashboard, per-sink durable checkpoints in your own database, pause/resume, and slot-lag visibility.
  - title: Typed events from your Prisma schema
    details: '@walcast/typegen-prisma generates self-contained row types that match what pgoutput actually delivers — no runtime imports.'
---

## The whole zero-plugin experience

```ts
import { Walcast } from 'walcast'

const tr = new Walcast({ connection: process.env.DATABASE_URL! })
await tr.setup() // create publication + slot, idempotent

for await (const event of tr.changes()) {
  console.log(event.op, event.table, event.after)
  tr.ack(event) // the slot only advances past what you ack
}
```

## Quick links

- [Why walcast](/guide/why-walcast) — the microkernel philosophy
- [Delivery guarantees](/guide/delivery-guarantees) — the precise semantics, including why exactly-once delivery is impossible and what we do instead
- [Writing a sink](/guide/writing-a-sink) — a working plugin in 15 minutes
- [Event schema](/reference/event-schema) — the exact shape of a change event
- [Production checklist](/guide/production-checklist) — before you point this at a database that matters
