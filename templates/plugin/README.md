# walcast-sink-example

A complete, working starter for a community walcast sink. As-is it appends
change events as NDJSON lines to a file — durable, redelivery-tolerant, and
passing the `verifySink` conformance harness. The interesting part is
`src/index.ts`: every obligation of the sink contract is explained in a
comment right where you'd otherwise violate it.

## Using this template

1. **Copy this folder** out of the walcast repo into a repository of your own.
   Community sinks live in their own repos, not in the walcast monorepo.
2. **Rename** it: pick `walcast-sink-<name>` (the `@walcast/*` scope is
   reserved for official packages) and update `name` and `description` in
   `package.json`.
3. Install and check that the starter passes as-is:

   ```bash
   npm install
   npm test
   ```

4. Replace the file-append in `src/index.ts` with your transport. Keep the
   contract comments honest as you go — especially `durability` (only declare
   `'durable'` if a failed `deliver` throws) and redelivery tolerance (the
   same batch can arrive twice with identical `event.id`s).
5. Keep the conformance test. `verifySink` in `test/sink.test.ts` is the
   same harness the official sinks pass in CI; point its `collect` at your
   transport's far end (read the topic back, capture the HTTP requests, ...).
6. **Publish** with `npm publish`. Keep the `"walcast"` and
   `"walcast-sink"` keywords in `package.json` — that's how people find
   sinks on npm — and follow semver.
7. **Get listed**: open a PR against the walcast repo adding your sink to
   the community sinks docs page (checklist in
   [CONTRIBUTING.md](https://github.com/ManasMadan/walcast/blob/main/CONTRIBUTING.md)).

## How users run your sink

Users install your package next to walcast and reference it in their config;
the daemon resolves it from their `node_modules` and calls your default
export — a factory `(config) => Sink` — with the `config` object:

```jsonc
{
  "sinks": [{ "use": "walcast-sink-example", "config": { "path": "./events.ndjson" } }],
}
```

## Layout

```
src/index.ts       the sink — start here
test/sink.test.ts  conformance harness + redelivery test
tsup.config.ts     builds ESM + type declarations into dist/
```
