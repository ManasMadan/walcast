#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseArgs } from 'node:util'
import { generate, parsePrismaSchema } from '@/index'

const HELP = `@walcast/typegen-prisma — typed walcast events from a Prisma schema

Usage:
  npx @walcast/typegen-prisma --schema prisma/schema.prisma --out src/walcast-types.ts

The generated file is self-contained (no runtime imports). Use it with the
walcast library:

  import { isChange, type WalcastEvent } from './walcast-types'
  for await (const event of tr.changes()) {
    if (isChange(event, 'users')) console.log(event.after?.email) // typed!
  }
`

const { values } = parseArgs({
  options: {
    schema: { type: 'string' },
    out: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
})

if (values.help || !values.schema || !values.out) {
  console.log(HELP)
  process.exit(values.help ? 0 : 1)
}

const source = readFileSync(values.schema, 'utf8')
const output = generate(source)
mkdirSync(dirname(values.out), { recursive: true })
writeFileSync(values.out, output)
const { models, enums } = parsePrismaSchema(source)
console.log(
  `wrote ${values.out}: ${models.length} table type${models.length === 1 ? '' : 's'}` +
    (enums.length ? `, ${enums.length} enum${enums.length === 1 ? '' : 's'}` : ''),
)
