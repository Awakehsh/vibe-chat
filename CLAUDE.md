# vibe-chat

Terminal chat that mimics the look of agentic coding CLIs. Bun + TypeScript
monorepo. Read `CONTRIBUTING.md` for layout, rules and commit format; this
file adds what an agent needs to work here without asking.

## Commands

```bash
bun install                    # once
bun run typecheck              # all packages
bun test                       # all packages (server tests start real servers on random ports)
bun test packages/server       # one package
bun run dev:server             # server on :7788, data in ./data
bun run dev:cli -- <args>      # the vibechat CLI from source
```

## Where things are

- Wire protocol: `docs/protocol.md` is the contract; `packages/protocol/src`
  is its executable form. Change both together.
- Server: `packages/server/src/server.ts` (transport), `handlers.ts` (frame
  dispatch), `store.ts` (SQLite queries), `db.ts` (schema + migrations).
- CLI: `packages/cli/src/index.ts` (commands), `client.ts` (WebSocket
  client with reconnect + sync), `tui/` (OpenTUI React UI).
- Decisions and their reasons: `docs/decisions.md`. Add an entry when a
  decision changes; do not rewrite history.

## Conventions that are easy to miss

- IDs are `Bun.randomUUIDv7()`. Per-room `seq` is the ordering key, not time.
- User id is the base64url Ed25519 public key. There is no other user id.
- Every inbound frame is validated with the `protocol` schemas before any
  logic runs. Do not add ad-hoc checks downstream.
- Limits are advertised in the `hello` frame and enforced server-side. Add a
  limit in `protocol/src/limits.ts`, the doc, and the enforcement in the
  same commit.
- The TUI keeps Enter = send, Shift+Enter = newline. Submit is deferred two
  ticks so IME composition can flush first; keep that when touching the prompt.
- Kitty keyboard protocol is off on Windows by default (`--kitty-keyboard`
  turns it on). Do not enable it unconditionally.
- Public docs and commits describe this project on its own terms. Do not
  name other products' source or design documents.

## Verification before calling something done

- `bun run typecheck` and `bun test` pass, with output shown.
- Server behaviour: exercised through a real WebSocket in a test.
- CLI behaviour: exercised by running the command, not only by unit tests.
