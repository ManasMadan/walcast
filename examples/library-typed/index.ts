// Typed library mode: the generated file narrows events by table name.
import { Walcast } from 'walcast'
import { isChange } from './src/walcast-types.ts'

const tr = new Walcast({
  connection: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres',
  publication: 'example_typed',
  slot: 'example_typed',
  // Restrict the publication to the tables the schema knows about.
  // The table must exist before setup() creates the publication.
  tables: ['users'],
})

await tr.setup()
process.on('SIGINT', () => void tr.stop())

console.log('waiting for changes on users (Ctrl+C to stop)')
for await (const event of tr.changes()) {
  if (isChange(event, 'users')) {
    // event.after is UserRow | null — id is a string (BigInt exceeds
    // Number.MAX_SAFE_INTEGER), metadata is JsonValue, createdAt is
    // Postgres text. Exactly what pgoutput delivers, honestly typed.
    const row = event.after ?? event.before
    console.log(`${event.op} users id=${row?.id} email=${row?.email}`)
  }
  tr.ack(event)
}
