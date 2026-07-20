# Typed events from a Prisma schema

`@walcast/typegen-prisma` generates TypeScript row types for your walcast events from a Prisma schema. Pure text-in, text-out codegen: no Prisma runtime, no walcast runtime — the generated file is self-contained, with zero imports.

```bash
npx @walcast/typegen-prisma --schema prisma/schema.prisma --out src/walcast-types.ts
```

Output: `wrote src/walcast-types.ts: 4 table types, 1 enum`. Re-run whenever the schema changes (a `postinstall` or generate script is the usual home).

## Using the generated types

```ts
import { Walcast } from 'walcast'
import { isChange } from './walcast-types'

const tr = new Walcast({ connection: process.env.DATABASE_URL! })

for await (const event of tr.changes()) {
  if (isChange(event, 'users')) {
    // event is now WalcastEvent<'users'>:
    event.after?.email // string
    event.after?.created_at // string — Postgres text timestamp
    event.before // UserRow | null
  }
  tr.ack(event)
}
```

`isChange(event, table)` is a type-guard that narrows on `event.table`. The generated file also exports:

- `<Model>Row` — one interface per model (optional fields become `| null`)
- `WalcastTables` — table name → row type map (respecting `@@map`)
- `WalcastEvent<T>` — a `ChangeEvent` narrowed to table `T`
- One union type per Prisma `enum`

## What maps to what — and why

Types are honest about what pgoutput actually delivers: text-format tuples, [decoded conservatively](/guide/concepts#pgoutput-framing). The generated types describe the events as they arrive, not as Prisma's client would hydrate them.

| Prisma type    | Generated TS type | Why                                                                                                                                           |
| -------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `String`       | `string`          |                                                                                                                                               |
| `Boolean`      | `boolean`         | decoded from `t`/`f`                                                                                                                          |
| `Int`          | `number`          | `int2`/`int4` fit safely                                                                                                                      |
| `Float`        | `number`          | `float4`/`float8`                                                                                                                             |
| `BigInt`       | `string`          | `int8` can exceed `Number.MAX_SAFE_INTEGER`; walcast refuses to corrupt big ids silently                                                      |
| `Decimal`      | `string`          | `numeric` loses precision as a float                                                                                                          |
| `DateTime`     | `string`          | Postgres text form, e.g. `"2026-07-19 12:00:00+00"` — parse it yourself (`new Date(...)`) when you're sure of the column's timezone semantics |
| `Json`         | `JsonValue`       | `json`/`jsonb` are parsed by the decoder                                                                                                      |
| `Bytes`        | `string`          | Postgres hex text form                                                                                                                        |
| any `T[]` list | `string`          | Postgres arrays arrive as array literal text like `"{a,b}"` — not decoded                                                                     |
| enums          | union of literals |                                                                                                                                               |

Also respected: `@map` (column names as they appear in events), `@@map` (table names), optional fields (`?` → `\| null`), and relation fields are skipped (they aren't columns).

## Limits

The parser is a regex pass over the schema file, not the Prisma engine. It covers models, enums, scalars, lists, optionals, and map attributes; exotic schema features (composite types, multi-file schemas, views) are not handled. Unknown scalars fall back to `string` — which, given text-format tuples, is also the truthful default.
