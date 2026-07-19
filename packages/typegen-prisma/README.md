# @walcast/typegen-prisma

Typed [walcast](https://github.com/ManasMadan/walcast) change events from
your Prisma schema. Pure codegen — the generated file has zero runtime
imports.

```bash
npx @walcast/typegen-prisma --schema prisma/schema.prisma --out src/walcast-types.ts
```

```ts
import { Walcast } from 'walcast'
import { isChange } from './walcast-types'

for await (const event of tr.changes()) {
  if (isChange(event, 'users')) {
    event.after?.email // string — typed, narrowed by table
  }
  tr.ack(event)
}
```

Types are honest about what the wire actually carries (pgoutput text
tuples): `BigInt` and `Decimal` map to `string` (no silent precision loss),
`DateTime` to the Postgres text form, lists to Postgres array literals.
`@map`/`@@map` are respected — events carry database names, so the
generated types do too.

Docs: https://walcast.mmadan.in/guide/typed-events

## License

MIT
