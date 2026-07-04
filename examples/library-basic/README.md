# library-basic

The zero-plugin experience: `import { Walcast } from 'walcast'`, iterate `changes()`, and your own code is the sink. No daemon, no config file.

Delivery is at-least-once. The replication slot's flushed position only advances to what you `ack()`, so if your process crashes mid-work, everything you hadn't acked is redelivered on restart. Redelivered events carry the identical deterministic `event.id` (commit LSN + index within the transaction), which is what makes consumer-side deduplication possible.

Ack an event only after you've durably processed it (written it to your database, forwarded it, etc.). Acks are cumulative, like a Kafka offset commit: acking event N also acknowledges everything before it, so processing must stay in order — which is exactly the order `changes()` yields.

## Prerequisites

A Postgres with logical replication enabled (`wal_level=logical`):

```sh
docker run -d --name walcast-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16-alpine -c wal_level=logical
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
```

## Run

```sh
npm start
```

Then, from psql or anywhere else, change some data:

```sql
CREATE TABLE items (id serial PRIMARY KEY, name text);
INSERT INTO items (name) VALUES ('hello');
```

Every committed change prints. Ctrl+C stops cleanly.
