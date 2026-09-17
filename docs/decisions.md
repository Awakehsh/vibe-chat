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

## D11 — Transcript lives in the terminal's scrollback; only the prompt is live (2026-09)

Supersedes the scroll-box transcript. Messages, the welcome header, room
dividers and command output are printed into the terminal's own scrollback
and never redrawn; the live region is a footer holding the typing line, the
prompt and the status line. At startup the footer is sized so it sits right
below whatever is on screen, and it shrinks as lines are printed until the
screen is full, after which it stays at the bottom. This is how agent CLIs
behave, it keeps the terminal's scrolling and text selection working, and
the conversation stays on screen after you quit. Changes to printed
messages (reactions, edits, deletions) are printed as new lines. The mouse
is not captured so wheel scrolling reaches the terminal.

## D12 — Names are shown once per run (2026-09)

A message from someone else starts `⏺ name: `; the next messages from the
same person within three minutes are indented without the name, like
continued paragraphs of one answer. Your own messages always start with `>`.
Mentions of you are highlighted in the accent colour. No timestamps.

## D13 — Acting on a message goes through a picker, not a cursor (2026-09)

Printed lines cannot be highlighted, so `/reply`, `/edit`, `/delete` and
`/react` open a list of the last twelve messages in the live region; picking
one puts the prompt into that mode (the status line says what you are
replying to or editing; Esc cancels). Your identity is changed the same
way: `/name`, `/emoji`, `/status`. There is no settings screen.

## D14 — Rich content is rendered once into scrollback (2026-09)

Fenced code, lists and headings render through the markdown component,
`/sticker` through the block font, and image attachments through the image
component (kitty or sixel where supported, block characters elsewhere), each
committed to scrollback as a block whose height is measured after layout.
Inline markdown in ordinary lines is styled by the line builder.

## D15 — Identity is a colour derived from the key, carried in a gutter (2026-09)

D12 kept a run readable by dropping the repeated name, but a wrapped line or
a run several screens back then carried no author at all, and every name was
printed in the same white. Both channels are now used: the `⏺` and the name
take a colour derived from the user id, which is the public key, and every
line after the first repeats `┊` in that colour, padded to the column where
the body starts. Attachment and reaction lines sit in the same gutter.

The colour cannot be chosen, survives a rename, and differs between two
people who picked the same name, so it is a weak identity signal rather than
decoration. It is a second channel, never the only one: the name is still
printed at the head of every run, so the transcript reads the same without
colour. This does not reopen D7 — there is still one palette and no themes.

## D16 — Three marks between messages, none of them a timestamp (2026-09)

D12 rules out per-message timestamps, but a transcript with no clock at all
loses two things: where the conversation stopped, and where you stopped
reading. Both are printed as a line of their own, so a message never pays for
them.

A silence of ten minutes or more prints the local clock, centred and dim, in
24-hour form: the transcript reads as a log, and the width stays fixed. The
read watermark prints an accent rule naming how many messages arrived since,
and it restarts the run, so the first message under it shows its author
again. A boundary on the very first replayed line prints nothing, because the
room divider already sits above it.

The third mark is on the message itself: one that names you takes the accent
down its whole left edge — the `⏺` and every `┊` under it — while the name
keeps the author's own colour from D15. The highlight on the `@name` alone
was invisible while scrolling; a coloured edge is not.

## D17 — Your own messages carry your name too (2026-09)

D12 gave your own messages `>` and no name, mirroring the prompt of an agent
CLI. In a room with other people that reads as a second identity nobody can
name, and in a room on your own it is the only thing on screen, so the
transcript looks empty of authors either way. Every message now goes through
the same author prefix, yours included, and your own runs group like anyone
else's.

`>` keeps its one job: it marks the prompt you type into, and no longer
doubles as an author. Your name stays in the quiet grey while other people
keep the colour from D15, so the asymmetry that matters — what you already
know you said, against what someone else just said — survives.

## D18 — A failed send is appended, never taken back (2026-09)

D11 makes a printed line permanent, so the optimistic copy of a message that
the server then refuses cannot be unprinted. Removing it from the model, which
is what used to happen, left the line on screen looking sent. The failure is
now printed under it instead, and what never got through is kept in order
until `/retry` drains it, so nothing typed while the link was down is lost.

This is the shape every later change of a message already had — a reaction, an
edit, a deletion all print as new lines — and it is why there is no pending or
sending state: a mark that has to be revised cannot exist here.
