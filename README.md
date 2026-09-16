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

Then `bun run dev:cli` opens the chat. Inside it, `/help` lists everything.
The ones you will use most:

| In the chat | |
|---|---|
| `/server host:port` · `/new name` · `/join host/TOKEN` | pick a server, create or join a group |
| `Ctrl+K` · `/room name` · `/dm name` | switch rooms, open a direct message |
| `/reply` · `/edit` · `/delete` · `/react [emoji]` | pick a recent message and act on it |
| `/upload path` · `/sticker text` · `/roll 2d6` · `/poll q \| a \| b` · `/vote n` · `/me action` | images, big letters, dice, polls |
| `/name` · `/emoji` · `/status text 🎧` · `/status auto` | who you are; `auto` follows your AI coding CLI |
| `/invite [reset]` · `/members` · `/history` · `/kick` · `/transfer` · `/rename` · `/destroy yes` | room management (owner) |

Messages support inline markdown (`**bold**`, `*italic*`, `` `code` ``, links)
and fenced code blocks with syntax highlighting. Images display inline in
terminals that support the kitty or sixel graphics protocols and fall back
to block characters elsewhere.

## Install

Any one of these puts a `vibechat` command on your PATH. No Bun or Node
runtime is needed at run time; the npm package is a launcher around the
same binary.

```bash
curl -fsSL https://raw.githubusercontent.com/Awakehsh/vibe-chat/main/install.sh | sh   # macOS / Linux
brew install awakehsh/tap/vibechat        # Homebrew (macOS / Linux)
npm install -g vibe-chat                  # any OS with npm, or run once with: npx vibe-chat
```

Windows, in PowerShell:

```powershell
irm https://raw.githubusercontent.com/Awakehsh/vibe-chat/main/install.ps1 | iex   # downloads and adds to PATH
scoop bucket add awakehsh https://github.com/Awakehsh/scoop-bucket; scoop install vibechat
```

Or download `vibechat-<os>-<arch>` from the [releases](../../releases) page
and put it on your PATH. On macOS a downloaded binary may need
`xattr -d com.apple.quarantine vibechat` once.

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

### Free: your own Mac, reachable from anywhere

`vibechat serve --tunnel` publishes the server at a stable
`https://<machine>.<tailnet>.ts.net` through Tailscale Funnel. It works with
the Homebrew Tailscale daemon running as your user (no root, no VPN
profile):

```bash
brew install tailscale
D="$HOME/Library/Application Support/tailscaled"; mkdir -p "$D"
tailscaled --tun=userspace-networking --statedir="$D" --socket="$D/tailscaled.sock" &
tailscale --socket="$D/tailscaled.sock" up        # open the printed link and sign in
TAILSCALE_SOCKET="$D/tailscaled.sock" vibechat serve --tunnel
```

The first `--tunnel` prints a link to enable Funnel on your tailnet (one
click). To keep both running across reboots, install them as LaunchAgents;
`docs/mac-launchagents.md` has the two plist files.

See [docs/architecture.md](docs/architecture.md) for how the pieces fit and
[docs/decisions.md](docs/decisions.md) for why they are shaped this way.

## License

MIT
