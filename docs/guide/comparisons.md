# Comparisons

Honest ones. Each of these tools is good at what it's for; the question is what you're building.

|                        | walcast                                | Debezium                               | Supabase Realtime                    | Sequin                                  | walstream                  |
| ---------------------- | -------------------------------------- | -------------------------------------- | ------------------------------------ | --------------------------------------- | -------------------------- |
| Runtime                | Node library or tiny daemon            | JVM + Kafka Connect cluster            | Elixir service (managed w/ Supabase) | daemon + Postgres state                 | Rust daemon                |
| Embeddable in your app | yes — async iterator                   | no                                     | no                                   | no                                      | no                         |
| Kafka required         | no (optional sink)                     | effectively yes¹                       | no                                   | no                                      | no                         |
| Delivery guarantee     | at-least-once; exactly-once into Kafka | at-least-once                          | best-effort                          | at-least-once                           | at-least-once              |
| Transports             | plugin per transport; open contract    | Kafka (+ many source connectors)       | WebSockets to browsers               | HTTP, Kafka, SQS, Redis, ... (built-in) | gRPC only                  |
| Custom transport       | ~50-line plugin + conformance harness  | write a Kafka Connect connector (Java) | no                                   | no plugin system                        | no plugin system           |
| Slot handling          | persistent slot, explicit teardown     | persistent slot                        | managed                              | persistent slot                         | temporary slots by default |
| Per-sink checkpoints   | yes, in your database                  | Kafka offsets                          | n/a                                  | yes                                     | n/a                        |
| Dashboard / admin API  | included                               | via Kafka Connect / third-party        | Supabase dashboard                   | yes                                     | no                         |
| Sources                | Postgres only                          | many databases                         | Postgres (Supabase)                  | Postgres only                           | Postgres only              |

¹ Debezium Server can target other brokers, but the ecosystem, tooling, and operational lore assume Kafka Connect.

## Debezium

The battle-tested heavyweight. If you're already operating Kafka Connect, need connectors for MySQL/MongoDB/Oracle/SQL Server alongside Postgres, or need years of production hardening at very large scale — use Debezium; it has seen failure modes walcast hasn't. What you pay: a JVM, a Kafka cluster, Connect workers, and connector configuration as an operational discipline. Walcast's trade: no JVM, Kafka optional (it's just one sink), embeddable in a Node process, a single small daemon when you want one, dashboard included.

## Supabase Realtime

A different job. Realtime pushes changes over WebSockets to browsers — presence, live UIs, multiplayer cursors — and it's managed and excellent at that. It is best-effort by design: a disconnected client misses events, and there's no acknowledged, resumable stream. Use it for live interfaces; use walcast (or anything slot-checkpointed) when a missed event is a bug. Walcast's SSE sink covers the "live tail to a browser" case with the same honest best-effort semantics; its durable sinks cover what Realtime doesn't attempt.

## Sequin

The closest product-shaped cousin: Postgres-native CDC, at-least-once, HTTP delivery, good operational story. The philosophical difference: Sequin is a product with built-in destinations; walcast is **embeddable-library-first with an open plugin contract**. If your events should land in your own Node code, walcast is an `import` — no daemon at all. If your destination isn't on a built-in list, a walcast sink is a ~50-line package against a published interface with a conformance harness, not a feature request. If you want a batteries-included hosted-feeling product with more destinations out of the box today, Sequin is further along that road.

## walstream (msavela/walstream)

A lean Rust daemon that streams WAL over gRPC — if your consumers speak gRPC and you want a single static binary, it's simpler than walcast. Differences that matter: walstream is gRPC-only (walcast: pick-your-transport plugins), uses temporary slots by default (nothing retained across restarts — an ephemeral tail unless you configure otherwise; walcast: persistent slot with durable per-sink checkpoints as the default posture), and has no plugin system, admin API, or dashboard. Walcast also gives you library mode, which a standalone daemon can't.

## When _not_ to use walcast

- You need CDC from databases other than Postgres → Debezium.
- You need battle-tested behavior at very large scale, today → Debezium.
- You want managed, browser-native live queries and don't need durability → Supabase Realtime.
- You want a hosted product with many built-in destinations and zero code → Sequin.
- Your stack isn't Node and never will be → walstream (Rust/gRPC) or Debezium.
