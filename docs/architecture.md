# Architecture

```
┌───────────────┐  WebSocket /ws   ┌──────────────────────┐
│ vibechat (TUI)│◄────────────────►│ vibechat serve        │
│ packages/cli  │  HTTP /files     │ packages/server       │
└───────────────┘                  │  Bun.serve + bun:sqlite│
        ▲                          └──────────┬───────────┘
        │ shared types, schemas, limits        │ <data-dir>/vibe.db
        └────────────── packages/protocol ─────┘ <data-dir>/files/
```

## Packages

**protocol** — pure TypeScript. Frame schemas (zod), the `Limits` type and
defaults, invite-code encode/parse, Ed25519 helpers over WebCrypto, dice
notation. No I/O, no Bun-only APIs except `crypto.subtle`. Both other
packages import it; it imports nothing from them.

**server** — one process, one SQLite file. `server.ts` owns `Bun.serve`,
the WebSocket lifecycle (hello → auth → sync → events), heartbeats and
per-connection rate buckets. `handlers.ts` maps request frames to store
calls and decides what to broadcast. `store.ts` is every SQL statement,
prepared once. `db.ts` creates the schema and runs migrations. Room fan-out
uses Bun's built-in pub/sub: each connection subscribes to `room:<id>` after
`sync`, and handlers `publish` events to that topic.

**cli** — the `vibechat` binary. `index.ts` parses the command line and
dispatches. `identity.ts` and `config.ts` manage `~/.config/vibechat/`.
`client.ts` is a reconnecting WebSocket client that performs the handshake,
runs `sync`, keeps an in-memory model (rooms, members, users, messages by
room) and emits typed events to the UI. `tui/` is an OpenTUI React app that
renders that model. `commands/` are the non-UI subcommands (`serve` embeds
the server package; `new`, `join`, `send`, `id` are thin clients).

## Data model (SQLite)

```
users     (user_id PK, name, emoji, status_text, status_emoji, created_at, last_seen_at)
rooms     (room_id PK, kind, name, emoji, owner_id, invite_token UNIQUE, created_at, last_activity_at, last_seq)
members   (room_id, user_id, joined_at, last_read_seq, PK(room_id, user_id))
messages  (msg_id PK, room_id, seq, author_id, kind, body, meta, reply_to, attachments,
           edited_at, deleted_at, created_at, ciphertext, UNIQUE(room_id, seq))
reactions (msg_id, user_id, emoji, PK(msg_id, user_id, emoji))
files     (file_id PK, room_id, uploader_id, name, mime, size, width, height, attached, created_at)
meta      (key PK, value)         -- schema_version
```

`ciphertext` is reserved for a future end-to-end mode and is always NULL in
v0. `messages.seq` is assigned inside the same transaction that increments
`rooms.last_seq`, which is what makes it gap-free.

Files live on disk as `<data-dir>/files/<file_id>`; the row holds metadata.
Moving a server is copying `<data-dir>`.

## Process model

- Server: single Bun process. SQLite in WAL mode. One nightly sweep deletes
  groups inactive for `inactiveRoomDays` and orphaned files.
- Client: single Bun process per terminal. Several terminals per user are
  fine; each is its own connection and the server merges presence.
- No message queue, no cache, no second store. When that becomes a problem,
  the protocol's `seq`-based sync lets a client resume against any replica
  that has the same SQLite file.

## Exposure

`vibechat serve --tunnel` runs `tailscale funnel --bg --https=443 localhost:<port>`
and reads the machine's DNS name from `tailscale status --json` to print the
public invite base. Without Tailscale it prints the install hint and exits.
Nothing in the server depends on the tunnel; any TLS-terminating reverse
proxy works.
