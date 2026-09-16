import type { Database } from "bun:sqlite"
import { generateInviteToken, type Attachment, type Member, type Message, type MessageKind, type Room, type RoomKind, type User } from "@vibechat/protocol"

export interface UserRow {
  user_id: string
  name: string
  emoji: string | null
  status_text: string | null
  status_emoji: string | null
  created_at: string
  last_seen_at: string
}

export interface RoomRow {
  room_id: string
  kind: RoomKind
  name: string
  emoji: string | null
  owner_id: string
  invite_token: string | null
  created_at: string
  last_activity_at: string
  last_seq: number
}

export interface MemberRow {
  room_id: string
  user_id: string
  joined_at: string
  last_read_seq: number
}

export interface MessageRow {
  msg_id: string
  room_id: string
  seq: number
  author_id: string
  kind: MessageKind
  body: string
  meta: string | null
  reply_to: string | null
  attachments: string
  edited_at: string | null
  deleted_at: string | null
  created_at: string
}

export interface FileRow {
  file_id: string
  room_id: string
  uploader_id: string
  name: string
  mime: string
  size: number
  width: number | null
  height: number | null
  attached: number
  created_at: string
}

const now = () => new Date().toISOString()

export class Store {
  constructor(private readonly db: Database) {}

  // ---------- users ----------

  upsertUser(userId: string, name: string, emoji: string | undefined): UserRow {
    const t = now()
    this.db.run(
      `INSERT INTO users (user_id, name, emoji, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET name = excluded.name, emoji = excluded.emoji, last_seen_at = excluded.last_seen_at`,
      [userId, name, emoji ?? null, t, t],
    )
    return this.getUser(userId)!
  }

  getUser(userId: string): UserRow | undefined {
    return this.db.query<UserRow, [string]>("SELECT * FROM users WHERE user_id = ?").get(userId) ?? undefined
  }

  getUsers(ids: Iterable<string>): UserRow[] {
    const list = [...new Set(ids)]
    if (list.length === 0) return []
    const placeholders = list.map(() => "?").join(",")
    return this.db.query<UserRow, string[]>(`SELECT * FROM users WHERE user_id IN (${placeholders})`).all(...list)
  }

  setProfile(userId: string, patch: { name?: string; emoji?: string }): UserRow {
    if (patch.name !== undefined) this.db.run("UPDATE users SET name = ? WHERE user_id = ?", [patch.name, userId])
    if (patch.emoji !== undefined) this.db.run("UPDATE users SET emoji = ? WHERE user_id = ?", [patch.emoji || null, userId])
    return this.getUser(userId)!
  }

  setStatus(userId: string, patch: { statusText?: string; statusEmoji?: string }): UserRow {
    if (patch.statusText !== undefined) this.db.run("UPDATE users SET status_text = ? WHERE user_id = ?", [patch.statusText || null, userId])
    if (patch.statusEmoji !== undefined) this.db.run("UPDATE users SET status_emoji = ? WHERE user_id = ?", [patch.statusEmoji || null, userId])
    return this.getUser(userId)!
  }

  touchLastSeen(userId: string): void {
    this.db.run("UPDATE users SET last_seen_at = ? WHERE user_id = ?", [now(), userId])
  }

  // ---------- rooms ----------

  createRoom(input: { kind: RoomKind; name: string; emoji?: string; ownerId: string }): RoomRow {
    const roomId = Bun.randomUUIDv7()
    const t = now()
    const token = input.kind === "group" ? generateInviteToken() : null
    this.db.run(
      "INSERT INTO rooms (room_id, kind, name, emoji, owner_id, invite_token, created_at, last_activity_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [roomId, input.kind, input.name, input.emoji ?? null, input.ownerId, token, t, t],
    )
    return this.getRoom(roomId)!
  }

  getRoom(roomId: string): RoomRow | undefined {
    return this.db.query<RoomRow, [string]>("SELECT * FROM rooms WHERE room_id = ?").get(roomId) ?? undefined
  }

  getRoomByInvite(token: string): RoomRow | undefined {
    return this.db.query<RoomRow, [string]>("SELECT * FROM rooms WHERE invite_token = ?").get(token) ?? undefined
  }

  listRoomsForUser(userId: string): RoomRow[] {
    return this.db
      .query<RoomRow, [string]>("SELECT r.* FROM rooms r JOIN members m ON m.room_id = r.room_id WHERE m.user_id = ? ORDER BY r.last_activity_at DESC")
      .all(userId)
  }

  countOwnedRooms(userId: string): number {
    return this.db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM rooms WHERE owner_id = ? AND kind = 'group'").get(userId)!.n
  }

  updateRoom(roomId: string, patch: { name?: string; emoji?: string }): RoomRow {
    if (patch.name !== undefined) this.db.run("UPDATE rooms SET name = ? WHERE room_id = ?", [patch.name, roomId])
    if (patch.emoji !== undefined) this.db.run("UPDATE rooms SET emoji = ? WHERE room_id = ?", [patch.emoji || null, roomId])
    return this.getRoom(roomId)!
  }

  setOwner(roomId: string, userId: string): RoomRow {
    this.db.run("UPDATE rooms SET owner_id = ? WHERE room_id = ?", [userId, roomId])
    return this.getRoom(roomId)!
  }

  resetInvite(roomId: string): RoomRow {
    this.db.run("UPDATE rooms SET invite_token = ? WHERE room_id = ?", [generateInviteToken(), roomId])
    return this.getRoom(roomId)!
  }

  /** Deletes the room and everything under it. Returns file ids whose bytes the caller must remove. */
  deleteRoom(roomId: string): string[] {
    const files = this.db.query<{ file_id: string }, [string]>("SELECT file_id FROM files WHERE room_id = ?").all(roomId).map((f) => f.file_id)
    this.db.run("DELETE FROM rooms WHERE room_id = ?", [roomId])
    return files
  }

  // ---------- members ----------

  addMember(roomId: string, userId: string): MemberRow {
    this.db.run("INSERT INTO members (room_id, user_id, joined_at) VALUES (?, ?, ?)", [roomId, userId, now()])
    return this.getMember(roomId, userId)!
  }

  removeMember(roomId: string, userId: string): void {
    this.db.run("DELETE FROM members WHERE room_id = ? AND user_id = ?", [roomId, userId])
  }

  getMember(roomId: string, userId: string): MemberRow | undefined {
    return this.db.query<MemberRow, [string, string]>("SELECT * FROM members WHERE room_id = ? AND user_id = ?").get(roomId, userId) ?? undefined
  }

  isMember(roomId: string, userId: string): boolean {
    return this.getMember(roomId, userId) !== undefined
  }

  listMembers(roomId: string): MemberRow[] {
    return this.db.query<MemberRow, [string]>("SELECT * FROM members WHERE room_id = ? ORDER BY joined_at").all(roomId)
  }

  listMemberIds(roomId: string): string[] {
    return this.listMembers(roomId).map((m) => m.user_id)
  }

  countMembers(roomId: string): number {
    return this.db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM members WHERE room_id = ?").get(roomId)!.n
  }

  /** Moves the read cursor forward only. Returns false when nothing changed. */
  setLastRead(roomId: string, userId: string, seq: number): boolean {
    const r = this.db.run("UPDATE members SET last_read_seq = ? WHERE room_id = ? AND user_id = ? AND last_read_seq < ?", [seq, roomId, userId, seq])
    return r.changes > 0
  }

  sharesGroup(a: string, b: string): boolean {
    const row = this.db
      .query<{ n: number }, [string, string]>(
        `SELECT COUNT(*) AS n FROM members ma JOIN members mb ON ma.room_id = mb.room_id
         JOIN rooms r ON r.room_id = ma.room_id
         WHERE ma.user_id = ? AND mb.user_id = ? AND r.kind = 'group'`,
      )
      .get(a, b)
    return (row?.n ?? 0) > 0
  }

  findDm(a: string, b: string): RoomRow | undefined {
    return (
      this.db
        .query<RoomRow, [string, string]>(
          `SELECT r.* FROM rooms r JOIN members ma ON ma.room_id = r.room_id JOIN members mb ON mb.room_id = r.room_id
           WHERE r.kind = 'dm' AND ma.user_id = ? AND mb.user_id = ?`,
        )
        .get(a, b) ?? undefined
    )
  }

  // ---------- messages ----------

  insertMessage(input: {
    roomId: string
    authorId: string
    kind: MessageKind
    body: string
    meta?: Record<string, unknown> | undefined
    replyTo?: string | undefined
    attachments?: Attachment[] | undefined
  }): MessageRow {
    const msgId = Bun.randomUUIDv7()
    const t = now()
    return this.db.transaction(() => {
      const room = this.getRoom(input.roomId)
      if (!room) throw new Error("room vanished")
      const seq = room.last_seq + 1
      this.db.run("UPDATE rooms SET last_seq = ?, last_activity_at = ? WHERE room_id = ?", [seq, t, input.roomId])
      this.db.run(
        `INSERT INTO messages (msg_id, room_id, seq, author_id, kind, body, meta, reply_to, attachments, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          msgId,
          input.roomId,
          seq,
          input.authorId,
          input.kind,
          input.body,
          input.meta ? JSON.stringify(input.meta) : null,
          input.replyTo ?? null,
          JSON.stringify(input.attachments ?? []),
          t,
        ],
      )
      return this.getMessage(msgId)!
    })()
  }

  getMessage(msgId: string): MessageRow | undefined {
    return this.db.query<MessageRow, [string]>("SELECT * FROM messages WHERE msg_id = ?").get(msgId) ?? undefined
  }

  /** Ascending by seq, seq > afterSeq, at most `limit`. */
  listMessagesAfter(roomId: string, afterSeq: number, limit: number): MessageRow[] {
    return this.db
      .query<MessageRow, [string, number, number]>("SELECT * FROM messages WHERE room_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?")
      .all(roomId, afterSeq, limit)
  }

  /** Ascending by seq, seq < beforeSeq, the `limit` newest of those. */
  listMessagesBefore(roomId: string, beforeSeq: number, limit: number): MessageRow[] {
    return this.db
      .query<MessageRow, [string, number, number]>(
        "SELECT * FROM (SELECT * FROM messages WHERE room_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?) ORDER BY seq ASC",
      )
      .all(roomId, beforeSeq, limit)
  }

  editMessage(msgId: string, body: string): MessageRow {
    this.db.run("UPDATE messages SET body = ?, edited_at = ? WHERE msg_id = ?", [body, now(), msgId])
    return this.getMessage(msgId)!
  }

  deleteMessage(msgId: string): MessageRow {
    this.db.run("UPDATE messages SET body = '', attachments = '[]', meta = NULL, deleted_at = ? WHERE msg_id = ?", [now(), msgId])
    return this.getMessage(msgId)!
  }

  // ---------- reactions ----------

  /** Returns true when the reaction state changed. */
  setReaction(msgId: string, userId: string, emoji: string, on: boolean): boolean {
    const r = on
      ? this.db.run("INSERT OR IGNORE INTO reactions (msg_id, user_id, emoji) VALUES (?, ?, ?)", [msgId, userId, emoji])
      : this.db.run("DELETE FROM reactions WHERE msg_id = ? AND user_id = ? AND emoji = ?", [msgId, userId, emoji])
    return r.changes > 0
  }

  reactionsFor(msgIds: string[]): Map<string, Record<string, string[]>> {
    const out = new Map<string, Record<string, string[]>>()
    if (msgIds.length === 0) return out
    const placeholders = msgIds.map(() => "?").join(",")
    const rows = this.db
      .query<{ msg_id: string; user_id: string; emoji: string }, string[]>(`SELECT msg_id, user_id, emoji FROM reactions WHERE msg_id IN (${placeholders}) ORDER BY rowid`)
      .all(...msgIds)
    for (const r of rows) {
      const byEmoji = out.get(r.msg_id) ?? {}
      ;(byEmoji[r.emoji] ??= []).push(r.user_id)
      out.set(r.msg_id, byEmoji)
    }
    return out
  }

  // ---------- files ----------

  insertFile(input: { roomId: string; uploaderId: string; name: string; mime: string; size: number }): FileRow {
    const fileId = Bun.randomUUIDv7()
    this.db.run("INSERT INTO files (file_id, room_id, uploader_id, name, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [
      fileId,
      input.roomId,
      input.uploaderId,
      input.name,
      input.mime,
      input.size,
      now(),
    ])
    return this.getFile(fileId)!
  }

  getFile(fileId: string): FileRow | undefined {
    return this.db.query<FileRow, [string]>("SELECT * FROM files WHERE file_id = ?").get(fileId) ?? undefined
  }

  /** The subset of `fileIds` that this user uploaded to this room and has not attached yet. */
  attachableFiles(roomId: string, userId: string, fileIds: string[]): FileRow[] {
    if (fileIds.length === 0) return []
    const placeholders = fileIds.map(() => "?").join(",")
    return this.db
      .query<FileRow, string[]>(`SELECT * FROM files WHERE room_id = ? AND uploader_id = ? AND attached = 0 AND file_id IN (${placeholders})`)
      .all(roomId, userId, ...fileIds)
  }

  markAttached(fileIds: string[]): void {
    for (const id of fileIds) this.db.run("UPDATE files SET attached = 1 WHERE file_id = ?", [id])
  }

  roomStorageBytes(roomId: string): number {
    return this.db.query<{ n: number }, [string]>("SELECT COALESCE(SUM(size), 0) AS n FROM files WHERE room_id = ?").get(roomId)!.n
  }

  // ---------- sweep ----------

  /** Groups with no activity and no member seen for `days`. Returns what was deleted. */
  sweepInactiveGroups(days: number): { roomIds: string[]; fileIds: string[] } {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
    const rooms = this.db
      .query<{ room_id: string }, [string, string]>(
        `SELECT r.room_id FROM rooms r WHERE r.kind = 'group' AND r.last_activity_at < ?
         AND NOT EXISTS (SELECT 1 FROM members m JOIN users u ON u.user_id = m.user_id WHERE m.room_id = r.room_id AND u.last_seen_at >= ?)`,
      )
      .all(cutoff, cutoff)
      .map((r) => r.room_id)
    const fileIds: string[] = []
    for (const id of rooms) fileIds.push(...this.deleteRoom(id))
    return { roomIds: rooms, fileIds }
  }

  // ---------- hydration ----------

  toUser(row: UserRow, online: boolean): User {
    const u: User = { userId: row.user_id, name: row.name, online, lastSeenAt: row.last_seen_at }
    if (row.emoji) u.emoji = row.emoji
    if (row.status_text) u.statusText = row.status_text
    if (row.status_emoji) u.statusEmoji = row.status_emoji
    return u
  }

  toRoom(row: RoomRow, opts: { includeInvite: boolean }): Room {
    const r: Room = {
      roomId: row.room_id,
      kind: row.kind,
      name: row.name,
      ownerId: row.owner_id,
      createdAt: row.created_at,
      lastActivityAt: row.last_activity_at,
      lastSeq: row.last_seq,
    }
    if (row.emoji) r.emoji = row.emoji
    if (opts.includeInvite && row.invite_token) r.invite = row.invite_token
    return r
  }

  toMember(row: MemberRow): Member {
    return { roomId: row.room_id, userId: row.user_id, joinedAt: row.joined_at, lastReadSeq: row.last_read_seq }
  }

  toMessages(rows: MessageRow[]): Message[] {
    const reactions = this.reactionsFor(rows.map((r) => r.msg_id))
    return rows.map((row) => {
      const m: Message = {
        msgId: row.msg_id,
        roomId: row.room_id,
        seq: row.seq,
        authorId: row.author_id,
        kind: row.kind,
        body: row.body,
        attachments: JSON.parse(row.attachments) as Attachment[],
        reactions: reactions.get(row.msg_id) ?? {},
        createdAt: row.created_at,
      }
      if (row.meta) m.meta = JSON.parse(row.meta) as Record<string, unknown>
      if (row.reply_to) m.replyTo = row.reply_to
      if (row.edited_at) m.editedAt = row.edited_at
      if (row.deleted_at) m.deletedAt = row.deleted_at
      return m
    })
  }

  toMessage(row: MessageRow): Message {
    return this.toMessages([row])[0]!
  }
}
