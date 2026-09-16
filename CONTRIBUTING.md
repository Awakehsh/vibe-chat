# Contributing

## Setup

```bash
bun install
bun run typecheck
bun test
```

## Layout

| Package | Purpose |
|---|---|
| `packages/protocol` | wire protocol: frame schemas, limits, invite codes, identity signing. No I/O. |
| `packages/server` | relay server: `Bun.serve` WebSocket + SQLite. |
| `packages/cli` | the `vibechat` binary: commands and the terminal UI. |

`protocol` has no dependencies on the other two. `server` and `cli` depend on
`protocol` and never on each other.

## Rules

- **Protocol changes** touch `packages/protocol` and `docs/protocol.md` in the
  same commit, with a test.
- **Server changes** come with a test that talks to a real `Bun.serve`
  instance over a real WebSocket. No mocked sockets.
- **Validation lives at the wire boundary.** The server validates every
  inbound frame with the schemas in `protocol`. Inside a process, typed values
  are trusted.
- **No fallbacks without an evidenced trigger.** If a code path exists to
  handle a case, the commit says what produces that case.
- Keep dependencies few. Prefer Bun built-ins (`Bun.serve`, `bun:sqlite`,
  WebCrypto) over packages.
- Public docs, code comments, commit messages and identifiers are in English.

## Commits

Conventional Commits, English, imperative mood:

```
feat(server): reject messages over the room size limit

Why: the limit was advertised in hello but never enforced.
Impact: clients sending >4 KiB now get `too_large` instead of a silent store.
Verification: bun test packages/server (new test: message-size-limit)
```

- `feat`, `fix`, `refactor`, `perf` and `security` commits carry a body with
  **why**, **impact** and **verification**.
- `docs`, `chore`, `test`, `ci` commits may be a single line.
- Scope is the package name (`protocol`, `server`, `cli`) or `repo`.
- Describe the change on its own terms. Do not reference other products,
  their source code or their design documents in commit messages.
- Never bypass hooks or checks (`--no-verify`, `@ts-ignore`,
  `eslint-disable`, skipped tests). Fix the cause or say why in the PR.

## Pull requests

Title follows the commit format. Body: what changed, why, how to test.
