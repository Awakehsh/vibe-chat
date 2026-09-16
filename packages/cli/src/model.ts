import { TYPING_TTL_MS, type Member, type Message, type Room, type ServerEvent, type SyncResult, type User } from "@vibechat/protocol"

export interface RoomState {
  host: string
  room: Room
  members: Map<string, Member>
  /** Ascending by seq. May have a gap below `oldestLoadedSeq` when history is partial. */
  messages: Message[]
  unread: number
  hasOlder: boolean
  typing: Map<string, number>
}

export type ModelEvent =
  | { type: "message"; roomId: string; message: Message; own: boolean }
  | { type: "room-added"; roomId: string }
  | { type: "room-removed"; roomId: string; reason: string }
  | { type: "change" }

/** In-memory view of every server the client is on. Pure state; no I/O. */
export class Model {
  readonly rooms = new Map<string, RoomState>()
  readonly users = new Map<string, User>()
  private listeners = new Set<(e: ModelEvent) => void>()

  constructor(readonly selfId: string) {}

  on(fn: (e: ModelEvent) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(e: ModelEvent): void {
    for (const fn of this.listeners) fn(e)
    if (e.type !== "change") for (const fn of this.listeners) fn({ type: "change" })
  }

  room(roomId: string): RoomState | undefined {
    return this.rooms.get(roomId)
  }

  user(userId: string): User | undefined {
    return this.users.get(userId)
  }

  /** Display name for a user id; falls back to a short fingerprint. */
  nameOf(userId: string): string {
    if (userId === "") return "system"
    return this.users.get(userId)?.name ?? userId.slice(0, 6)
  }

  /** Human name of a room: group name, or the other person's name for a DM. */
  titleOf(roomId: string): string {
    const r = this.rooms.get(roomId)
    if (!r) return roomId
    if (r.room.kind === "dm") {
      const other = [...r.members.keys()].find((id) => id !== this.selfId)
      return other ? this.nameOf(other) : "dm"
    }
    return r.room.name
  }

  /** Rooms ordered by last activity, newest first. */
  roomList(): RoomState[] {
    return [...this.rooms.values()].sort((a, b) => b.room.lastActivityAt.localeCompare(a.room.lastActivityAt))
  }

  findRoom(query: string): RoomState | undefined {
    const q = query.trim().toLowerCase().replace(/^#/, "")
    if (this.rooms.has(q)) return this.rooms.get(q)
    return this.roomList().find((r) => this.titleOf(r.room.roomId).toLowerCase() === q) ?? this.roomList().find((r) => this.titleOf(r.room.roomId).toLowerCase().startsWith(q))
  }

  /** Users currently typing in a room (expired entries removed). */
  typingIn(roomId: string, now = Date.now()): string[] {
    const r = this.rooms.get(roomId)
    if (!r) return []
    for (const [id, at] of r.typing) if (now - at > TYPING_TTL_MS) r.typing.delete(id)
    return [...r.typing.keys()]
  }

  applySync(host: string, sync: SyncResult): void {
    for (const u of sync.users) this.users.set(u.userId, u)
    const seen = new Set<string>()
    for (const room of sync.rooms) {
      seen.add(room.roomId)
      const existing = this.rooms.get(room.roomId)
      const incoming = sync.messages[room.roomId] ?? []
      const truncated = sync.truncated.includes(room.roomId)
      const members = new Map((sync.members[room.roomId] ?? []).map((m) => [m.userId, m]))
      if (existing) {
        existing.room = room
        existing.members = members
        existing.messages = truncated ? incoming : mergeMessages(existing.messages, incoming)
        existing.hasOlder = truncated ? true : existing.hasOlder
        existing.unread = sync.unread[room.roomId] ?? 0
      } else {
        this.rooms.set(room.roomId, {
          host,
          room,
          members,
          messages: incoming,
          unread: sync.unread[room.roomId] ?? 0,
          hasOlder: truncated || (incoming[0]?.seq ?? 1) > 1,
          typing: new Map(),
        })
        this.emit({ type: "room-added", roomId: room.roomId })
      }
    }
    for (const [id, r] of this.rooms) {
      if (r.host === host && !seen.has(id)) {
        this.rooms.delete(id)
        this.emit({ type: "room-removed", roomId: id, reason: "gone" })
      }
    }
    this.emit({ type: "change" })
  }

  /** Adds a room the client just created or joined. */
  addRoom(host: string, room: Room, members: Member[], users: User[], messages: Message[]): void {
    for (const u of users) this.users.set(u.userId, u)
    const existing = this.rooms.get(room.roomId)
    if (existing) {
      // A `room` event for this room may have arrived before the request's reply.
      existing.room = room
      if (members.length > 0) existing.members = new Map(members.map((m) => [m.userId, m]))
      existing.messages = mergeMessages(existing.messages, messages)
      existing.hasOlder = (existing.messages[0]?.seq ?? 1) > 1
      this.emit({ type: "change" })
      return
    }
    this.rooms.set(room.roomId, {
      host,
      room,
      members: new Map(members.map((m) => [m.userId, m])),
      messages,
      unread: 0,
      hasOlder: (messages[0]?.seq ?? 1) > 1,
      typing: new Map(),
    })
    this.emit({ type: "room-added", roomId: room.roomId })
  }

  prependHistory(roomId: string, messages: Message[], hasMore: boolean): void {
    const r = this.rooms.get(roomId)
    if (!r) return
    r.messages = mergeMessages(r.messages, messages)
    r.hasOlder = hasMore
    this.emit({ type: "change" })
  }

  markRead(roomId: string): number | undefined {
    const r = this.rooms.get(roomId)
    if (!r) return undefined
    const last = r.messages.at(-1)?.seq ?? r.room.lastSeq
    const me = r.members.get(this.selfId)
    if (me && me.lastReadSeq >= last && r.unread === 0) return undefined
    if (me) me.lastReadSeq = last
    r.unread = 0
    this.emit({ type: "change" })
    return last
  }

  apply(host: string, ev: ServerEvent): void {
    switch (ev.t) {
      case "msg": {
        const r = this.rooms.get(ev.message.roomId)
        if (!r) return
        const idx = ev.message.clientId ? r.messages.findIndex((m) => m.clientId === ev.message.clientId && m.seq === 0) : -1
        if (idx >= 0) r.messages[idx] = ev.message
        else if (!r.messages.some((m) => m.msgId === ev.message.msgId)) r.messages = mergeMessages(r.messages, [ev.message])
        r.room.lastSeq = Math.max(r.room.lastSeq, ev.message.seq)
        r.room.lastActivityAt = ev.message.createdAt
        r.typing.delete(ev.message.authorId)
        const own = ev.message.authorId === this.selfId
        if (!own) r.unread += 1
        this.emit({ type: "message", roomId: r.room.roomId, message: ev.message, own })
        return
      }
      case "msg.updated": {
        const r = this.rooms.get(ev.message.roomId)
        if (!r) return
        const idx = r.messages.findIndex((m) => m.msgId === ev.message.msgId)
        if (idx >= 0) r.messages[idx] = ev.message
        this.emit({ type: "change" })
        return
      }
      case "reaction": {
        const r = this.rooms.get(ev.roomId)
        const m = r?.messages.find((x) => x.msgId === ev.msgId)
        if (!m) return
        const list = m.reactions[ev.emoji] ?? []
        const next = ev.on ? (list.includes(ev.userId) ? list : [...list, ev.userId]) : list.filter((u) => u !== ev.userId)
        if (next.length === 0) delete m.reactions[ev.emoji]
        else m.reactions[ev.emoji] = next
        this.emit({ type: "change" })
        return
      }
      case "typing": {
        const r = this.rooms.get(ev.roomId)
        if (!r || ev.userId === this.selfId) return
        r.typing.set(ev.userId, Date.now())
        this.emit({ type: "change" })
        return
      }
      case "read": {
        const m = this.rooms.get(ev.roomId)?.members.get(ev.userId)
        if (m && m.lastReadSeq < ev.seq) m.lastReadSeq = ev.seq
        this.emit({ type: "change" })
        return
      }
      case "presence": {
        this.users.set(ev.user.userId, ev.user)
        this.emit({ type: "change" })
        return
      }
      case "room": {
        const existing = this.rooms.get(ev.room.roomId)
        if (existing) {
          existing.room = ev.room
          this.emit({ type: "change" })
        } else {
          this.rooms.set(ev.room.roomId, { host, room: ev.room, members: new Map(), messages: [], unread: 0, hasOlder: ev.room.lastSeq > 0, typing: new Map() })
          this.emit({ type: "room-added", roomId: ev.room.roomId })
        }
        return
      }
      case "room.member": {
        const r = this.rooms.get(ev.roomId)
        if (!r) return
        this.users.set(ev.user.userId, ev.user)
        if (ev.event === "joined") r.members.set(ev.member.userId, ev.member)
        else r.members.delete(ev.member.userId)
        this.emit({ type: "change" })
        return
      }
      case "room.removed": {
        if (this.rooms.delete(ev.roomId)) this.emit({ type: "room-removed", roomId: ev.roomId, reason: ev.reason })
        return
      }
      case "pong":
        return
    }
  }

  /** Inserts an unconfirmed message (seq 0) that `msg` with the same clientId will replace. */
  addOptimistic(roomId: string, message: Message): void {
    const r = this.rooms.get(roomId)
    if (!r) return
    r.messages.push(message)
    this.emit({ type: "change" })
  }

  removeOptimistic(roomId: string, clientId: string): void {
    const r = this.rooms.get(roomId)
    if (!r) return
    r.messages = r.messages.filter((m) => !(m.seq === 0 && m.clientId === clientId))
    this.emit({ type: "change" })
  }
}

/** Union of two seq-ascending lists, deduplicated by msgId; optimistic (seq 0) entries stay last. */
export function mergeMessages(a: Message[], b: Message[]): Message[] {
  const byId = new Map<string, Message>()
  const optimistic: Message[] = []
  for (const m of [...a, ...b]) {
    if (m.seq === 0) optimistic.push(m)
    else byId.set(m.msgId, m)
  }
  const merged = [...byId.values()].sort((x, y) => x.seq - y.seq)
  const confirmedIds = new Set(merged.map((m) => m.clientId).filter(Boolean))
  return [...merged, ...optimistic.filter((m) => !confirmedIds.has(m.clientId))]
}
