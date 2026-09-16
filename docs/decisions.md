# Decisions

Short records of choices that are not obvious from the code. Newest last.
When a decision changes, add a new entry that supersedes the old one.

## D1 — Bun + TypeScript everywhere, OpenTUI for the terminal UI (2026-09)

One language and runtime for server and client. `Bun.serve` has WebSockets
and `bun:sqlite` built in; `bun build --compile` ships a single binary per
platform. OpenTUI was chosen over the alternatives because it is the only
terminal UI library that ships a scroll box, a multi-line text area,
markdown and code rendering, image display and real-cursor placement out
of the box, all of which a chat needs on day one.

## D2 — Identity is a local Ed25519 keypair; no accounts (2026-09)

Zero-friction onboarding and no password or e-mail handling on the server.
The public key is the user id. Moving to another machine is copying or
re-importing the key. Multi-device sync of the key is out of scope.

## D3 — Invite codes carry the server address; no federation (2026-09)

A client can be in groups on several servers at once because each invite
says where its room lives. Servers never talk to each other. This gives
self-hosters and the hosted server the same client experience without a
federation protocol.

## D4 — Groups with in-group DMs; no channels, no lobby, no global handles (2026-09)

The social model is "join a group, then talk to people in it". A DM can only
be opened with someone who shares a group. No public directory means no
spam surface and no name squatting.

## D5 — TLS only in v0; the server stores plaintext (2026-09)

Search, previews, unread counts and future bots all need the server to read
messages. The messages table reserves a `ciphertext` column so an
end-to-end mode can be added without a migration. The README states the
trust model plainly: don't trust the host, run your own.

## D6 — Hosted server keeps history with hard limits (2026-09)

Persistent history is part of the product. Abuse is bounded by per-room
member, size and storage limits and by deleting groups nobody has opened in
180 days. All limits are configuration.

## D7 — The UI mimics agentic coding CLIs, single column (2026-09)

A sidebar would give the game away. Own messages render as `> text`, others
as `⏺ name: text`, typing as a spinner with verbs, dice and polls as tool-call
blocks. Themes and visual effects are out because they break the disguise.

## D8 — Windows is best-effort in v0 (2026-09)

Binaries are built and English chat must work in Windows Terminal. The
Kitty keyboard protocol is off by default on Windows because terminal
support there is new and CJK input methods interact badly with it. CJK IME
issues are tracked but do not block releases.

## D9 — AI participation is a pipe, not a feature, in v0 (2026-09)

`vibechat send` lets any script or agent post into a group. Richer
integration (an agent that reads the room) comes after the human chat is
solid.

## D10 — Enter sends, Shift+Enter inserts a newline; submit is deferred (2026-09)

Chat convention over editor convention. Submit runs two event-loop ticks
after the key so that an input method's pending composition is committed
before the text is read. This costs ~1 ms and avoids losing the last CJK
character on some terminals.
