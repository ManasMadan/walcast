# @walcast/plugin-kit

The [walcast](https://github.com/ManasMadan/walcast) sink contract: the
`Sink` and `SinkContext` types, the `ChangeEvent` schema, and `verifySink` —
the conformance harness every sink passes in CI, official or community.

```bash
npm install -D @walcast/plugin-kit
```

A sink is a package whose default export is a factory:

```ts
import type { Sink, SinkFactory } from '@walcast/plugin-kit'

const factory: SinkFactory = (config) => ({
  name: 'my-sink',
  durability: 'durable', // engine retries + checkpoints; 'ephemeral' = best-effort
  async init(ctx) {},
  async deliver(batch) {}, // throw => the engine retries with backoff
  async close() {},
})
export default factory
```

Prove it conforms:

```ts
import { verifySink } from '@walcast/plugin-kit'

await verifySink(factory, { config: {...}, collect: () => readMyTransportBack() })
```

Start from the [plugin template](https://github.com/ManasMadan/walcast/tree/master/templates/plugin)
or the [15-minute tutorial](https://walcast.mmadan.in/guide/writing-a-sink).

## License

MIT
