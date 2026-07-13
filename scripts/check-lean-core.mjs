// Lean-core guard, run in CI: the published `walcast` package must stay a
// microkernel. Fails if the core's dependency tree grows beyond `pg` (plus
// the types-only plugin-kit), or if any transport code sneaks into core.
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fail = (msg) => {
  console.error(`lean-core check FAILED: ${msg}`)
  process.exit(1)
}

// 1. Allowed runtime dependencies, exactly.
const ALLOWED_DEPS = new Set(['pg', '@walcast/plugin-kit'])
const pkg = JSON.parse(readFileSync(join(root, 'packages/walcast/package.json'), 'utf8'))
const deps = Object.keys(pkg.dependencies ?? {})
for (const dep of deps) {
  if (!ALLOWED_DEPS.has(dep)) fail(`unexpected runtime dependency '${dep}' in walcast core`)
}
if (Object.keys(pkg.peerDependencies ?? {}).length > 0) {
  fail('core must not declare peerDependencies')
}

// 2. plugin-kit itself must have zero runtime dependencies.
const kit = JSON.parse(readFileSync(join(root, 'packages/plugin-kit/package.json'), 'utf8'))
if (Object.keys(kit.dependencies ?? {}).length > 0) {
  fail(
    `@walcast/plugin-kit must have zero runtime dependencies, has: ${Object.keys(kit.dependencies)}`,
  )
}

// 3. No transport code in core source: nothing may *import* a transport
//    client or a sink package. (Mentions in strings are fine — the friendly
//    zero-sink error deliberately lists the official sinks.)
const FORBIDDEN =
  /(?:from\s+['"]|import\(\s*['"]|require\(\s*['"])(kafkajs|@grpc\/|amqplib|ioredis|nats|@walcast\/sink-)/
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path)
    else if (/\.(ts|js|mjs)$/.test(entry.name)) {
      const src = readFileSync(path, 'utf8')
      const hit = FORBIDDEN.exec(src)
      if (hit) fail(`transport reference '${hit[0]}' in core source: ${path}`)
    }
  }
}
walk(join(root, 'packages/walcast/src'))

// 4. The packed tarball must contain no sink code and stay honest about its
//    contents (dist + package.json + README only, plus the built UI assets).
const packed = JSON.parse(
  execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: join(root, 'packages/walcast'),
    encoding: 'utf8',
  }),
)
const files = packed[0].files.map((f) => f.path)
for (const file of files) {
  if (!/^(dist\/|package\.json$|README\.md$|LICENSE$|CHANGELOG\.md$)/.test(file)) {
    fail(`unexpected file in walcast tarball: ${file}`)
  }
}
if (!files.some((f) => f.startsWith('dist/ui/'))) {
  fail('dashboard assets (dist/ui) missing from the tarball — build apps/ui first')
}

console.log(
  `lean-core check passed: deps=[${deps.join(', ')}], ${files.length} files in tarball, UI bundled, no transport code in core`,
)
