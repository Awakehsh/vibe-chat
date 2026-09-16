# Wire protocol v0

This document is the contract between `vibechat` clients and servers.
`packages/protocol` is its executable form; the two change together.

Status: v0, unstable until the first tagged release.

## 1. Transport

- One WebSocket per client at `/ws`. Text frames only, each frame is one JSON
  object. Binary frames are closed with code `1003`.
- Every object has a string field `t` (the frame type).
- **Requests** (client → server) carry a string `id`, unique per connection.
  The server answers each request exactly once with `ok` or `err` carrying
  the same `id`. Some client frames are fire-and-forget and carry no `id`
  (`typing`, `read.mark`, `ping`).
- **Events** (server → client) carry no `id`.
- Frames larger than `limits.frameBytes` are rejected with `too_large` and
  the connection is closed with code `1009`.
- Heartbeat: the client sends `ping` at least every 30 s; the server replies
  `pong`. The server closes a connection that has been silent for 90 s.
- HTTP endpoints next to the socket:
  - `GET /` → `{ "name", "version", "protocol" }`.
  - `GET /i/<token>` → plain-text page describing how to join.
  - `GET /files/<fileId>` → file bytes. Requires
    `Authorization: Bearer <session>` from an authenticated connection and
    membership of the file's room.

## 2. Identity and authentication

- A user **is** an Ed25519 keypair. `userId` is the base64url encoding
  (no padding, 43 chars) of the 32-byte raw public key. There is no other
  user identifier.
- On connect the server sends `hello`. The client must answer with `auth`
  before anything else; any other frame first is answered with
  `err unauthorized` and the socket is closed with code `4401`.
- Signature: `sig = base64url(sign(privateKey, utf8("vibechat-auth-v0:" + nonce)))`.
  The nonce is single-use and expires 60 s after `hello`.
- A user may hold several connections (several terminals). Presence is
  "online" while at least one connection is authenticated.

```
S→C  { "t":"hello", "protocol":0, "server":{"name":"vibechat","version":"0.1.0"},
       "nonce":"<base64url 32 bytes>", "limits":{ ... see §7 } }
C→S  { "t":"auth", "id":"1", "userId":"<b64url pubkey>", "name":"hu", "emoji":"🦊", "sig":"<b64url>" }
S→C  { "t":"ok", "id":"1", "session":"<opaque>", "user":{...User}, "serverTime":"2026-09-16T10:00:00.000Z" }
```

`session` is a bearer token for the HTTP endpoints; it is valid for the life
of the connection plus 60 s.

## 3. Data types

All timestamps are ISO 8601 UTC strings. All ids other than `userId` are
UUIDv7 strings.

```ts
User      { userId, name, emoji?, statusText?, statusEmoji?, online: boolean, lastSeenAt }
Room      { roomId, kind: "group" | "dm", name, emoji?, ownerId, createdAt, lastActivityAt,
            lastSeq: number, invite?: string /* group members only */ }
Member    { roomId, userId, joinedAt, lastReadSeq: number }
Message   { msgId, roomId, seq: number, authorId, kind, body, meta?, replyTo?,
            attachments: Attachment[], reactions: { [emoji]: userId[] },
            editedAt?, deletedAt?, createdAt }
Attachment{ fileId, name, mime, size: number, width?, height? }
```

- `seq` is a per-room counter starting at 1, assigned by the server, strictly
  increasing, with no gaps. It is the ordering and sync key. `createdAt` is
  informational.
- `kind` ∈ `text | me | roll | poll | sticker | system`. `system` messages
  are authored by the server (`authorId` is the empty string) for joins,
  leaves, kicks and renames. `meta` carries kind-specific data:
  - `roll`: `{ "notation":"2d6", "rolls":[3,4], "total":7 }` (server computes)
  - `poll`: `{ "question":"…", "options":["A","B"] }` votes are reactions
    `1️⃣`, `2️⃣`, … on the message
  - `sticker`: `{ "font":"block", "text":"GG" }`
- A deleted message keeps its row: `body` becomes `""`, `attachments` becomes
  `[]`, `deletedAt` is set. Clients render a placeholder.
- DM rooms have `kind: "dm"`, exactly two members, no owner semantics
  (`ownerId` is the creator), no invite, and cannot be left; they are hidden
  when either side "leaves".

## 4. Requests

Every request may fail with `invalid` (schema) or `rate_limited`. Listed
errors are in addition to those. Result fields are the payload of `ok`.

| `t` | params | result | errors |
|---|---|---|---|
| `auth` | `userId, name, emoji?, sig` | `session, user, serverTime` | `unauthorized` |
| `sync` | `rooms: { [roomId]: lastSeq }` | see §5 | |
| `profile.set` | `name?, emoji?` | `user` | |
| `presence.set` | `statusText?, statusEmoji?` (empty string clears) | `user` | |
| `room.create` | `name, emoji?` | `room` (with `invite`) | `limit_reached` |
| `room.join` | `invite` (token only; host is resolved client-side) | `room, members, messages` (last `limits.syncMessages`) | `not_found`, `limit_reached` (room full), `conflict` (already a member) |
| `room.leave` | `roomId` | `{}` | `not_found`, `forbidden` (owner must transfer or delete first) |
| `room.update` | `roomId, name?, emoji?` | `room` | `forbidden` |
| `room.kick` | `roomId, userId` | `{}` | `forbidden`, `not_found` |
| `room.transfer` | `roomId, userId` | `room` | `forbidden`, `not_found` |
| `room.delete` | `roomId` | `{}` | `forbidden` |
| `room.invite.reset` | `roomId` | `room` (new `invite`) | `forbidden` |
| `room.members` | `roomId` | `members: Member[], users: User[]` | `not_found` |
| `dm.open` | `userId` | `room` | `forbidden` (no shared group), `not_found` |
| `msg.send` | `roomId, body, kind?, meta?, replyTo?, attachments?: fileId[], clientId?` | `message` | `not_found`, `too_large`, `forbidden` |
| `msg.edit` | `msgId, body` | `message` | `forbidden`, `not_found` |
| `msg.delete` | `msgId` | `message` | `forbidden`, `not_found` |
| `msg.react` | `msgId, emoji, on: boolean` | `{}` | `not_found` |
| `msg.history` | `roomId, beforeSeq?, limit?` (≤ `limits.historyPage`) | `messages` (ascending by `seq`), `hasMore` | `not_found` |
| `file.upload` | `roomId, name, mime, dataB64` | `attachment` | `too_large`, `limit_reached` (room storage), `not_found` |

Fire-and-forget (no `id`, no reply, silently dropped on error):

| `t` | params |
|---|---|
| `typing` | `roomId` — at most one per 2 s per room |
| `read.mark` | `roomId, seq` — must not go backwards |
| `ping` | |

Authorisation rules:

- Only members can read, send, react, upload and mark read in a room.
- Only the owner can `room.update`, `room.kick`, `room.transfer`,
  `room.delete`, `room.invite.reset`. Kicking the owner is `forbidden`.
- Only the author can `msg.edit` and `msg.delete` a message; the room owner
  can `msg.delete` any message. `system` messages cannot be edited or deleted.
- `dm.open` requires the two users to share at least one group at that
  moment. Opening an existing DM returns it.
- `room.join` on a `dm` invite is `not_found` (DMs have no invite).

Server-side effects of `msg.send`:

- `kind: "roll"` — the server parses `body` as dice notation (`NdM[+K]`,
  N ≤ 20, M ≤ 1000) and fills `meta`. Invalid notation is `invalid`.
- `kind: "poll"` — `meta.options` has 2..9 entries; the server reacts on the
  author's behalf is **not** done; voting is a normal `msg.react`.
- `replyTo` must reference a message in the same room, else `invalid`.
- `attachments` must reference files uploaded to the same room by the same
  user and not yet attached, else `invalid`.
- `clientId` (≤ 64 chars) is echoed on the resulting `message` so the client
  can replace its optimistic copy. It is not stored.

## 5. Sync

Sent once after `auth`. The client passes the highest `seq` it has for each
room it knows; unknown rooms are omitted.

```
C→S  { "t":"sync", "id":"2", "rooms": { "<roomId>": 120, "<roomId2>": 0 } }
S→C  { "t":"ok", "id":"2",
       "rooms": Room[],                       // every room the user is in
       "members": { [roomId]: Member[] },
       "users": User[],                       // every user appearing above, with presence
       "messages": { [roomId]: Message[] },   // seq > lastSeq, ascending, at most limits.syncMessages each
       "truncated": roomId[],                 // rooms where more than syncMessages were missed; use msg.history
       "unread": { [roomId]: number } }       // lastSeq - lastReadSeq
```

Rooms the client knew but is no longer in are simply absent; the client
drops them. After `sync` the connection is subscribed to all rooms listed
and starts receiving events.

## 6. Events

| `t` | payload | when |
|---|---|---|
| `msg` | `message` | a new message in a subscribed room, including the sender's own |
| `msg.updated` | `message` | edit or delete |
| `reaction` | `msgId, roomId, userId, emoji, on` | reaction toggled |
| `typing` | `roomId, userId` | someone is typing; clients expire it after 5 s |
| `read` | `roomId, userId, seq` | someone's read cursor moved |
| `presence` | `user` | online/offline/status change of a user who shares a room |
| `room` | `room` | created, updated, transferred, invite reset, or joined via another connection |
| `room.member` | `roomId, member, user, event: "joined" \| "left" \| "kicked"` | membership change |
| `room.removed` | `roomId, reason: "left" \| "kicked" \| "deleted"` | the receiving user is no longer in the room |
| `pong` | | reply to `ping` |
| `err` | `code, message` (no `id`) | a fire-and-forget frame was rejected for a reason the client should know (only `too_large`) |

Ordering guarantee: events for one room are delivered in `seq` order on one
connection. There is no cross-room ordering.

## 7. Limits

Advertised in `hello.limits` so clients can validate before sending. The
server enforces all of them. Defaults for the hosted server; self-hosters
change them in the server config.

| key | default | enforced by |
|---|---|---|
| `frameBytes` | 3 145 728 | transport |
| `messageBytes` | 4 096 (UTF-8 bytes of `body`) | `msg.send`, `msg.edit` |
| `fileBytes` | 2 097 152 | `file.upload` |
| `roomStorageBytes` | 209 715 200 | `file.upload` |
| `roomMembers` | 50 | `room.join` |
| `roomsPerUser` | 100 (owned) | `room.create` |
| `nameChars` | 32 | `auth`, `profile.set`, `room.*` |
| `statusChars` | 64 | `presence.set` |
| `historyPage` | 200 | `msg.history` |
| `syncMessages` | 200 | `sync`, `room.join` |
| `inactiveRoomDays` | 180 | nightly sweep deletes groups nobody has opened in this long |

Rate limits are per connection, token bucket, and answered with
`err rate_limited` carrying `retryAfterMs`:

| bucket | rate |
|---|---|
| requests | 60 per 10 s |
| `msg.send` | 10 per 10 s |
| `file.upload` | 5 per minute |
| `typing` | 1 per 2 s per room (excess silently dropped) |

## 8. Errors

```
{ "t":"err", "id":"<request id>", "code":"<code>", "message":"human readable", "retryAfterMs"?: number }
```

| code | meaning |
|---|---|
| `invalid` | frame failed schema validation or a documented semantic rule |
| `unauthorized` | not authenticated, bad signature, expired nonce |
| `forbidden` | authenticated but not allowed (not a member, not owner, not author) |
| `not_found` | room, message, user, file or invite does not exist for this user |
| `conflict` | already in that state (already a member, DM already open) |
| `rate_limited` | see §7 |
| `too_large` | frame, body or file over its limit |
| `limit_reached` | a count or storage limit (`roomMembers`, `roomsPerUser`, `roomStorageBytes`) |
| `internal` | server bug; the connection stays open |

## 9. Invite codes

```
<host>[:port]/<token>       e.g.  chat.example.com/7K3MQ0VZ2P   or   localhost:7788/7K3MQ0VZ2P
<token>                     host omitted → the client's default server
https://<host>/i/<token>    the shareable link form; same meaning
```

- `token` is 10 characters of Crockford base32 (uppercase, no `I L O U`),
  from 50 random bits. It identifies **and** authorises: anyone with the
  token can join until the owner resets it.
- The client turns `host` into a socket URL: `ws://` for `localhost`,
  `127.0.0.1`, `[::1]` and any host with an explicit non-443 port that is a
  private address; `wss://` otherwise. `--insecure` forces `ws://`.
- `room.join` sends only the token; the host has already selected the server.

## 10. Versioning

`hello.protocol` is an integer. Adding optional fields, new event types or
new request types does not change it. Removing or changing the meaning of
anything does. A client that receives an unknown `protocol` closes the
connection and tells the user to upgrade.
