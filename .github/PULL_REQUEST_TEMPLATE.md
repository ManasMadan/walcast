## What & why

<!-- What changes, and the problem it solves. Link the issue if there is one. -->

## Tests

<!-- What you ran: `pnpm -r test`? Integration tests (need docker)? -->

- [ ] Changeset added (`pnpm changeset`) — or this is docs/CI only

<details>
<summary>Sink checklist (only if this PR adds a sink to the community list)</summary>

- [ ] Passes `verifySink` from `@walcast/plugin-kit`
- [ ] Durability declared correctly (`durable` vs `ephemeral`)
- [ ] README with a complete config reference
- [ ] Follows semver
- [ ] Keywords include `walcast` and `walcast-sink`

</details>
