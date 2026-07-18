# @walcast/sink-kafka

Kafka delivery for [walcast](https://github.com/ManasMadan/walcast) with
**exactly-once semantics into the topic**: each batch and its checkpoint
are committed in one Kafka transaction; consumers read with
`isolation.level=read_committed`.

```bash
npm install walcast @walcast/sink-kafka
```

```jsonc
// walcast.config.json
{
  "sinks": [
    {
      "use": "@walcast/sink-kafka",
      "config": {
        "brokers": ["localhost:9092"],
        "topicPrefix": "walcast", // topics: walcast.<schema>.<table>
        "keyColumns": { "public.orders": ["id"] }, // message keys; default: event id
        "eos": true, // false = plain idempotent producer
      },
    },
  ],
}
```

Why this is exactly-once (both crash windows):

1. **Crash before commit** — the transaction aborts, nothing becomes
   visible, the engine redelivers. No duplicates.
2. **Crash after commit, before the engine ack** — the engine redelivers,
   but the committed transaction included a `{sinkId → last event id}`
   record in the compacted `__walcast_checkpoints` topic; on startup the
   sink reads it back and skips everything at or below it. No duplicates.

A fixed `transactional.id` fences zombie producers after a crash. Message
headers carry `id`, `lsn`, `commit_lsn`, and `op`. With `eos: false` the
sink degrades to at-least-once — deduplicate on `event.id`.

Docs: https://walcast.mmadan.in/guide/sinks/kafka

## License

MIT
