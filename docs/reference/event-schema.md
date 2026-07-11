# Event schema

Every consumer — library loop, webhook receiver, Kafka topic, gRPC server — sees the same `ChangeEvent` shape. The type lives in `@walcast/plugin-kit` and is re-exported by `walcast`.

```ts
interface ChangeEvent<Row extends Record<string, unknown> = Record<string, unknown>> {
  /** `${commit_lsn}:${index-within-transaction}`, e.g. `0/1A2B3C8:0`. */
  id: string
  /** WAL position of this individual change. */
  lsn: string
  /** Commit LSN of the containing transaction; events are ordered by it. */
  commit_lsn: string
  /** Transaction commit time (ISO 8601). */
  commit_time: string
  schema: string
  table: string
  op: 'insert' | 'update' | 'delete' | 'truncate'
  /** Previous row image; null unless REPLICA IDENTITY provides it. */
  before: Row | null
  /** New row image; null for delete/truncate. */
  after: Row | null
}
```

As JSON:

```jsonc
{
  "id": "0/1A2B3C8:0",
  "lsn": "0/1A2B3C4",
  "commit_lsn": "0/1A2B3C8",
  "commit_time": "2026-07-19T12:00:00.000Z",
  "schema": "public",
  "table": "users",
  "op": "insert",
  "before": null,
  "after": { "id": 7, "email": "a@b.c" },
}
```

## `id` — deterministic by construction

The id is the commit LSN of the containing transaction plus the change's zero-based index within that transaction:

```
0/1A2B3C8:0     first change of the transaction that committed at 0/1A2B3C8
0/1A2B3C8:1     second change of the same transaction
```

Both components come from the WAL itself — no clocks, no randomness, no delivery state. Since walcast is at-least-once, the same event can be delivered more than once; because the id is derived this way, **every redelivery carries the identical id**. That is the entire basis for exactly-once processing: consumers deduplicate on `id` and duplicates become no-ops. See [Delivery guarantees](/guide/delivery-guarantees).

Ids are totally ordered — by commit LSN (as a 64-bit integer, not lexicographically!), then index. Use `compareEventIds` from `@walcast/plugin-kit` rather than comparing strings.

## Field notes

- **`lsn` vs `commit_lsn`** — `lsn` is where this individual change sits in the WAL; `commit_lsn` is where its transaction committed. Events stream in commit order, so `commit_lsn` is non-decreasing; within a transaction, `lsn` increases with each change. Both are Postgres text LSNs (`X/Y` hex).
- **`commit_time`** — the transaction's commit timestamp from the WAL, as an ISO 8601 string. All events of one transaction share it.
- **`before`** — `null` for inserts. For updates and deletes it depends on the table's `REPLICA IDENTITY`: `FULL` gives the full old row; the default gives `null` for updates and key columns only for deletes.
- **`after`** — the new row image; `null` for deletes and truncates.
- **`op: "truncate"`** — one event per truncated table, `before` and `after` both `null`.

## Column values

Row objects map column name → value, decoded conservatively from pgoutput's text tuples:

| Postgres type                                                 | JS value                                                                                  |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `bool`                                                        | `boolean`                                                                                 |
| `int2`, `int4`, `oid`                                         | `number`                                                                                  |
| `float4`, `float8`                                            | `number`                                                                                  |
| `json`, `jsonb`                                               | parsed value                                                                              |
| `int8`, `numeric`                                             | **`string`** — may exceed `Number`'s safe range                                           |
| everything else (timestamps, uuid, arrays, enums, bytea, ...) | `string` in Postgres text form                                                            |
| `NULL`                                                        | `null`                                                                                    |
| unchanged TOAST column                                        | the `UNCHANGED_TOAST` sentinel string — see the [FAQ](/guide/faq#what-is-unchanged-toast) |

For typed rows generated from a Prisma schema, see [Typed events](/guide/typed-events).
