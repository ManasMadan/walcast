# Examples

One example per concept. Each is a self-contained package: `cd` in, read its README, `npm start`. In this repo they resolve walcast packages via the workspace; copied out, `npm install` the same names from npm.

| Example                                | What it teaches                                                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [library-basic](./library-basic)       | Library mode with zero plugins: `changes()` + `ack()`, at-least-once semantics.                       |
| [library-typed](./library-typed)       | Typed events from a Prisma schema with `@walcast/typegen-prisma` and `isChange()` narrowing.         |
| [webhook-receiver](./webhook-receiver) | Receiving `@walcast/sink-webhook` batches: signature verification, dedupe on `event.id`, 2xx-as-ack. |
| [kafka-consumer](./kafka-consumer)     | Consuming `@walcast/sink-kafka` topics with read_committed isolation — why that gives exactly-once.  |
| [grpc-consumer](./grpc-consumer)       | A gRPC server implementing the `walcast.v1.WalcastSink` contract for `@walcast/sink-grpc`.         |
| [daemon-config](./daemon-config)       | A fully annotated `walcast.config.json` running webhook, SSE, Kafka, and gRPC sinks together.        |

Most examples need a Postgres with logical replication:

```sh
docker run -d --name walcast-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16-alpine -c wal_level=logical
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
```
