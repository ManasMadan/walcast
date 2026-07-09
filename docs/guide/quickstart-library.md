# Quickstart: library mode

Library mode is the zero-plugin experience: your own code is the sink. No daemon, no config file, no sink packages.

## Prerequisites

- Postgres with `wal_level = logical` (needs a restart to change; `setup()` checks and tells you if it isn't)
- A role with the `REPLICATION` attribute (or superuser)
- Node 20+

```bash
npm install walcast
```

## Consume changes

```ts
import { Walcast } from 'walcast'

const tr = new Walcast({ connection: process.env.DATABASE_URL! })
await tr.setup() // create publication + slot if missing — idempotent, never drops

for await (const event of tr.changes()) {
  console.log(event.op, event.table, event.after)
  tr.ack(event) // the slot only advances past what you ack
}
```

`setup()` creates a publication named `walcast` (`FOR ALL TABLES` by default) and a logical replication slot named `walcast` using the `pgoutput` plugin. Both names, and a table allowlist, are configurable:

```ts
const tr = new Walcast({
  connection: process.env.DATABASE_URL!,
  publication: 'orders_feed',
  slot: 'orders_feed',
  tables: ['orders', 'order_items'], // restricts the publication when setup() creates it
})
```

## Acknowledge what you've processed

`ack()` is what makes delivery at-least-once instead of at-most-once. The slot's flushed position only advances to what you ack, so anything unacked at a crash is redelivered on restart — with **identical, deterministic event ids** (`commit_lsn:index`), which is what makes consumer-side idempotency possible.

Acks are **cumulative**, like a Kafka offset commit: acking event N acknowledges everything at or before N. Acking a transaction's last event releases the whole transaction, commit record included. If you process events out of order, only ack the frontier you have _contiguously_ completed.

```ts
for await (const event of tr.changes()) {
  await writeToMyStore(event) // make it durable first
  tr.ack(event) // then acknowledge
}
```

Ack before processing and you've built at-most-once. Process before acking and you've built at-least-once — the right default. See [Delivery guarantees](/guide/delivery-guarantees).

## Get `before` images: REPLICA IDENTITY FULL

By default, Postgres puts only the new row in the WAL for updates, and only the replica identity (usually the primary key) for deletes. If you want the full previous row image in `event.before`:

```sql
ALTER TABLE users REPLICA IDENTITY FULL;
```

Without it, `before` is `null` on updates and contains only key columns on deletes. This is a per-table Postgres setting, not a walcast option, and it has a WAL-volume cost — enable it on the tables where you need it.

## Stopping and error handling

```ts
const ac = new AbortController()
process.on('SIGINT', () => ac.abort())

try {
  for await (const event of tr.changes({ signal: ac.signal })) {
    await handle(event)
    tr.ack(event)
  }
} catch (err) {
  // Connection failure. The library does NOT reconnect for you —
  // it surfaces errors; at-least-once makes restarting always safe.
}
```

`changes()` ends when you call `tr.stop()` or abort the signal, and throws on connection failure. One instance supports one active iteration — a replication slot allows exactly one consumer.

Useful introspection while running:

- `tr.pending` — events yielded but not yet acked
- `tr.flushedLsn` — the flushed LSN currently reported to Postgres
- `await tr.status()` — publication/slot state including retained-WAL bytes

## When you're done for good

An abandoned replication slot retains WAL forever and **will fill your disk**. If you stop using walcast:

```bash
npx walcast teardown
```

Next: [Concepts](/guide/concepts) for what's actually happening on the wire, or [typed events](/guide/typed-events) if you use Prisma.
