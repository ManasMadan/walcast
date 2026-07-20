# Delivery guarantees

This page is precise because vague guarantees are how pipelines corrupt data. The short version:

- **Delivery is at-least-once**, with **deterministic, LSN-derived event ids** — so consumers get exactly-once _processing_ via idempotency.
- **The Kafka sink achieves exactly-once _into the topic_** via transactional writes and a checkpoint record committed in the same transaction.
- **Exactly-once _delivery_ to webhooks, SSE, or gRPC is impossible**, and walcast never claims it.

## Why exactly-once delivery is impossible

Consider a webhook receiver. Walcast POSTs a batch; the receiver processes it and returns 200; walcast records the acknowledgment. Now crash the receiver _between processing and responding_. Walcast sees a failed request. Did the receiver process the batch? Walcast cannot know — the information it needs was destroyed with the response. It has exactly two options:

1. **Don't resend** → if the receiver crashed _before_ processing, the events are lost. At-most-once.
2. **Resend** → if the receiver crashed _after_ processing, the events are duplicated. At-least-once.

There is no third option. This is the Two Generals problem wearing an HTTP costume: two parties over an unreliable channel cannot agree on whether a message was handled using only that channel. Every system that claims "exactly-once delivery" over a request/response transport is describing at-least-once delivery plus deduplication — which is a fine thing to build, so walcast gives you the primitive it requires.

## The primitive: deterministic event ids

Every event's `id` is derived from its position in the WAL:

```
id = "<commit_lsn>:<index-within-transaction>"     e.g. "0/1A2B3C8:0"
```

Nothing about the id involves wall clocks, random bytes, or delivery attempts. A redelivered event — after a consumer crash, a walcast restart, a network partition, anything — carries the **identical** id. That turns exactly-once processing into a local decision at the consumer:

```ts
// Receiver-side idempotency: at-least-once delivery + this = exactly-once processing
for (const event of batch) {
  const inserted = await db.query(
    'INSERT INTO processed_events (id) VALUES ($1) ON CONFLICT DO NOTHING',
    [event.id],
  )
  if (inserted.rowCount === 0) continue // duplicate — already handled
  await handle(event)
}
```

Do the idempotency check and the effect in the same transaction and the loophole closes completely.

Event ids are totally ordered — by commit LSN, then by index within the transaction. `@walcast/plugin-kit` exports `compareEventIds` so "at or below my checkpoint" means the same thing in every sink.

## What "at-least-once" means mechanically

The replication slot's `confirmed_flush_lsn` only advances to acknowledged work:

- **Library mode:** advances to what you `ack()`. Acks are cumulative (acking N acknowledges everything ≤ N), and acking a transaction's last event releases the whole transaction including its commit record.
- **Daemon mode:** advances to the minimum acknowledged LSN across **durable** sinks. Each durable sink has its own checkpoint (stored in a `walcast` schema in your source database); a sink that was ahead when the process died skips what it already delivered on restart.

Crash at any point and the unacknowledged suffix of the stream is replayed from the slot. Nothing below the flushed position is ever replayed by Postgres; nothing above it is ever discarded.

## Kafka: exactly-once into the topic

Kafka transactions allow something stronger than at-least-once — not exactly-once _delivery_ (attempts still repeat) but **exactly-once appearance in the topic**. `@walcast/sink-kafka` (with `eos: true`, the default) does, per batch, inside **one Kafka transaction**:

1. produce every event to its `${topicPrefix}.${schema}.${table}` topic,
2. produce a checkpoint record `{ sinkId → last event id }` to a compacted checkpoint topic,
3. commit.

Walk both crash windows:

**Crash before the transaction commits.** The broker aborts the transaction. None of its records — data or checkpoint — ever become visible to `read_committed` consumers. The walcast engine never got a resolved `deliver()`, so it redelivers the batch; the rerun produces everything again in a fresh transaction. Consumers see exactly one committed copy. **No duplicates, no loss.**

**Crash after the commit but before the engine records its ack.** The engine's checkpoint says the batch is undelivered, so it redelivers. But the committed transaction _included_ the checkpoint record, atomically with the data. On startup the sink reads the compacted checkpoint topic back and learns the last event id it committed; every redelivered event at or below it is filtered out before producing. **No duplicates, no loss.** The atomicity is the crux: data and checkpoint can never disagree, because they commit or abort together.

Two requirements on your side:

- **Consumers must use `isolation.level=read_committed`** (the Java client's default is `read_uncommitted`; kafkajs defaults to read-committed). A read-uncommitted consumer sees aborted transactions and forfeits the guarantee.
- **Leave the `transactional.id` stable** per sink instance (default `walcast-<sinkId>`). This is what _fences zombies_: when a restarted sink initializes the producer with the same transactional id, the broker bumps the producer epoch, and any in-flight transaction from the dead predecessor is aborted and its producer permanently rejected. Without fencing, a paused-but-alive old process could commit stale data after the new one has moved on.

Set `eos: false` and the sink degrades gracefully to an idempotent (but non-transactional) producer — plain at-least-once; consumers dedupe on the event id like any other sink.

## Summary table

| Transport                           | Guarantee                   | Duplicate handling                |
| ----------------------------------- | --------------------------- | --------------------------------- |
| Library mode (your code)            | at-least-once               | you dedupe on `event.id`          |
| `@walcast/sink-webhook`             | at-least-once               | receiver dedupes on `event.id`    |
| `@walcast/sink-grpc`                | at-least-once               | receiver dedupes on `event.id`    |
| `@walcast/sink-kafka` (`eos: true`) | exactly-once into the topic | none needed with `read_committed` |
| `@walcast/sink-sse`                 | best-effort (ephemeral)     | n/a — a missed event is missed    |

One more honest boundary: at-least-once holds _from the slot forward_. If you `walcast teardown` (dropping the slot) or force-drop the slot while events are undelivered, that WAL is released and those events are gone. Durability lives in the slot.
