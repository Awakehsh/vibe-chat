# vibechat

A terminal chat for you and your friends that looks like an AI coding agent
session. Nobody walking past your screen will know.

- **Feels like a chat app**: groups, DMs inside groups, replies, reactions,
  images, typing indicators, desktop notifications.
- **Looks like work**: single-column transcript, a `>` prompt, spinner verbs,
  slash commands. The visual language of agentic coding CLIs, end to end.
- **No accounts**: your identity is a keypair generated on first run.
- **Self-hostable**: one binary, one SQLite file. Run it on a laptop behind
  Tailscale Funnel or on any VPS. Invite codes carry the server address, so
  a client can be in groups on several servers at once.

Status: pre-alpha. The wire protocol is documented in [docs/protocol.md](docs/protocol.md)
and is expected to change until v0.1.

## Quick start

Requires [Bun](https://bun.sh) 1.4.1+ during development. Release binaries
will not need it.

```bash
bun install

# terminal 1: run a server on :7788 with data in ./data
bun run dev:server

# terminal 2: create a group and get an invite code
bun run dev:cli -- new "late night" --host localhost:7788

# terminal 3 (a friend): join with the invite code
bun run dev:cli -- join localhost:7788/XXXXXXXXXX
```

Then `bun run dev:cli` opens the chat. Inside it, `/help` lists commands;
`/server`, `/new` and `/join` do the same as the subcommands.

## Commands

| Command | What it does |
|---|---|
| `vibechat` | open the chat UI |
| `vibechat new <name>` | create a group, print its invite code |
| `vibechat join <invite>` | join a group |
| `vibechat send --room <name> <text>` | post a message from a script or hook |
| `vibechat serve [--port N] [--data-dir DIR] [--tunnel]` | run a server; `--tunnel` exposes it via Tailscale Funnel |
| `vibechat id` | show your identity and export it for another machine |

## Self-hosting

`vibechat serve` stores everything in `<data-dir>/vibe.db` and `<data-dir>/files/`.
Moving a server to another machine is copying that directory.

See [docs/architecture.md](docs/architecture.md) for how the pieces fit and
[docs/decisions.md](docs/decisions.md) for why they are shaped this way.

## License

MIT
