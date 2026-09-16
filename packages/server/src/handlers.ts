import { unlink } from "node:fs/promises"
import { join } from "node:path"
import { rollDice, type Attachment, type ClientFrame, type ClientFrameOf, type Message, type MessageKind, type Room } from "@vibechat/protocol"
import { conflict, forbidden, invalid, limitReached, notFound, tooLarge } from "./errors.ts"
import type { Conn, Hub, Socket } from "./hub.ts"
import { roomTopic } from "./hub.ts"
import type { RoomRow } from "./store.ts"

type Req<T extends ClientFrame["t"]> = ClientFrameOf<T>
type Result = Record<string, unknown>

const utf8Bytes = (s: string) => new TextEncoder().encode(s).byteLength

export async function handleRequest(hub: Hub, ws: Socket, conn: Conn, frame: ClientFrame): Promise<Result> {
  const userId = conn.userId!
  const { store, limits } = hub

  const memberRoom = (roomId: string): RoomRow => {
    const room = store.getRoom(roomId)
    if (!room || !store.isMember(roomId, userId)) throw notFound("room not found")
    return room
  }
  const ownedRoom = (roomId: string): RoomRow => {
    const room = memberRoom(roomId)
    if (room.owner_id !== userId) throw forbidden("only the owner can do that")
    return room
  }
  const roomView = (room: RoomRow): Room => store.toRoom(room, { includeInvite: room.kind === "group" })
  const systemMessage = (room: RoomRow, body: string, meta: Record<string, unknown>) => {
    const msg = store.toMessage(store.insertMessage({ roomId: room.room_id, authorId: "", kind: "system", body, meta }))
    hub.publishRoom(room.room_id, { t: "msg", message: msg })
  }

  switch (frame.t) {
    case "sync":
      return sync(hub, ws, userId, frame)

    case "profile.set": {
      if (frame.name !== undefined && frame.name.length > limits.nameChars) throw tooLarge("name too long")
      const patch: { name?: string; emoji?: string } = {}
      if (frame.name !== undefined) patch.name = frame.name
      if (frame.emoji !== undefined) patch.emoji = frame.emoji
      const row = store.setProfile(userId, patch)
      hub.broadcastPresence(userId)
      return { user: hub.userView(row) }
    }

    case "presence.set": {
      if (frame.statusText !== undefined && frame.statusText.length > limits.statusChars) throw tooLarge("status too long")
      const patch: { statusText?: string; statusEmoji?: string } = {}
      if (frame.statusText !== undefined) patch.statusText = frame.statusText
      if (frame.statusEmoji !== undefined) patch.statusEmoji = frame.statusEmoji
      const row = store.setStatus(userId, patch)
      hub.broadcastPresence(userId)
      return { user: hub.userView(row) }
    }

    case "room.create": {
      if (frame.name.length > limits.nameChars) throw tooLarge("name too long")
      if (store.countOwnedRooms(userId) >= limits.roomsPerUser) throw limitReached("too many rooms")
      const input: Parameters<typeof store.createRoom>[0] = { kind: "group", name: frame.name, ownerId: userId }
      if (frame.emoji) input.emoji = frame.emoji
      const room = store.createRoom(input)
      store.addMember(room.room_id, userId)
      hub.subscribeUser(userId, room.room_id)
      const view = roomView(room)
      hub.sendToUser(userId, { t: "room", room: view })
      return { room: view }
    }

    case "room.join": {
      const room = store.getRoomByInvite(frame.invite.toUpperCase())
      if (!room || room.kind !== "group") throw notFound("invite not found")
      if (store.isMember(room.room_id, userId)) throw conflict("already a member")
      if (store.countMembers(room.room_id) >= limits.roomMembers) throw limitReached("room is full")
      const member = store.addMember(room.room_id, userId)
      const user = hub.userView(store.getUser(userId)!)
      hub.publishRoom(room.room_id, { t: "room.member", roomId: room.room_id, member: store.toMember(member), user, event: "joined" })
      systemMessage(room, `${user.name} joined`, { event: "join", userId })
      hub.subscribeUser(userId, room.room_id)
      const fresh = store.getRoom(room.room_id)!
      const view = roomView(fresh)
      hub.sendToUser(userId, { t: "room", room: view })
      const members = store.listMembers(room.room_id)
      return {
        room: view,
        members: members.map((m) => store.toMember(m)),
        users: hub.usersView(members.map((m) => m.user_id)),
        messages: store.toMessages(store.listMessagesBefore(room.room_id, fresh.last_seq + 1, limits.syncMessages)),
      }
    }

    case "room.leave": {
      const room = memberRoom(frame.roomId)
      if (room.kind === "dm") throw forbidden("direct messages cannot be left")
      if (room.owner_id === userId) throw forbidden("transfer ownership or delete the room first")
      const member = store.getMember(room.room_id, userId)!
      store.removeMember(room.room_id, userId)
      hub.unsubscribeUser(userId, room.room_id)
      const user = hub.userView(store.getUser(userId)!)
      hub.publishRoom(room.room_id, { t: "room.member", roomId: room.room_id, member: store.toMember(member), user, event: "left" })
      systemMessage(room, `${user.name} left`, { event: "leave", userId })
      hub.sendToUser(userId, { t: "room.removed", roomId: room.room_id, reason: "left" })
      return {}
    }

    case "room.update": {
      const room = ownedRoom(frame.roomId)
      if (frame.name !== undefined && frame.name.length > limits.nameChars) throw tooLarge("name too long")
      const patch: { name?: string; emoji?: string } = {}
      if (frame.name !== undefined) patch.name = frame.name
      if (frame.emoji !== undefined) patch.emoji = frame.emoji
      const view = roomView(store.updateRoom(room.room_id, patch))
      hub.publishRoom(room.room_id, { t: "room", room: view })
      return { room: view }
    }

    case "room.kick": {
      const room = ownedRoom(frame.roomId)
      if (frame.userId === userId) throw forbidden("the owner cannot be kicked")
      const member = store.getMember(room.room_id, frame.userId)
      if (!member) throw notFound("not a member")
      store.removeMember(room.room_id, frame.userId)
      hub.unsubscribeUser(frame.userId, room.room_id)
      const user = hub.userView(store.getUser(frame.userId)!)
      hub.publishRoom(room.room_id, { t: "room.member", roomId: room.room_id, member: store.toMember(member), user, event: "kicked" })
      systemMessage(room, `${user.name} was removed`, { event: "kick", userId: frame.userId })
      hub.sendToUser(frame.userId, { t: "room.removed", roomId: room.room_id, reason: "kicked" })
      return {}
    }

    case "room.transfer": {
      const room = ownedRoom(frame.roomId)
      if (!store.isMember(room.room_id, frame.userId)) throw notFound("not a member")
      const view = roomView(store.setOwner(room.room_id, frame.userId))
      hub.publishRoom(room.room_id, { t: "room", room: view })
      return { room: view }
    }

    case "room.delete": {
      const room = memberRoom(frame.roomId)
      if (room.kind === "group" && room.owner_id !== userId) throw forbidden("only the owner can delete the room")
      const memberIds = store.listMemberIds(room.room_id)
      const fileIds = store.deleteRoom(room.room_id)
      for (const id of memberIds) {
        hub.unsubscribeUser(id, room.room_id)
        hub.sendToUser(id, { t: "room.removed", roomId: room.room_id, reason: "deleted" })
      }
      await Promise.all(fileIds.map((id) => unlink(join(hub.filesDir, id)).catch(() => undefined)))
      return {}
    }

    case "room.invite.reset": {
      const room = ownedRoom(frame.roomId)
      if (room.kind !== "group") throw forbidden("direct messages have no invite")
      const view = roomView(store.resetInvite(room.room_id))
      hub.publishRoom(room.room_id, { t: "room", room: view })
      return { room: view }
    }

    case "room.members": {
      const room = memberRoom(frame.roomId)
      const members = store.listMembers(room.room_id)
      return { members: members.map((m) => store.toMember(m)), users: hub.usersView(members.map((m) => m.user_id)) }
    }

    case "dm.open": {
      if (frame.userId === userId) throw invalid("cannot open a direct message with yourself")
      if (!store.getUser(frame.userId)) throw notFound("user not found")
      if (!store.sharesGroup(userId, frame.userId)) throw forbidden("you do not share a group with that user")
      const existing = store.findDm(userId, frame.userId)
      if (existing) return { room: roomView(existing) }
      const room = store.createRoom({ kind: "dm", name: "dm", ownerId: userId })
      store.addMember(room.room_id, userId)
      store.addMember(room.room_id, frame.userId)
      const view = roomView(room)
      for (const id of [userId, frame.userId]) {
        hub.subscribeUser(id, room.room_id)
        hub.sendToUser(id, { t: "room", room: view })
      }
      return { room: view }
    }

    case "msg.send":
      return sendMessage(hub, ws, userId, frame, memberRoom)

    case "msg.edit": {
      const msg = store.getMessage(frame.msgId)
      if (!msg || !store.isMember(msg.room_id, userId)) throw notFound("message not found")
      if (msg.author_id !== userId) throw forbidden("only the author can edit")
      if (msg.kind === "system" || msg.deleted_at) throw forbidden("message cannot be edited")
      if (utf8Bytes(frame.body) > limits.messageBytes) throw tooLarge("message too long")
      if (frame.body.trim().length === 0) throw invalid("message is empty")
      const view = store.toMessage(store.editMessage(msg.msg_id, frame.body))
      hub.publishRoom(msg.room_id, { t: "msg.updated", message: view })
      return { message: view }
    }

    case "msg.delete": {
      const msg = store.getMessage(frame.msgId)
      if (!msg || !store.isMember(msg.room_id, userId)) throw notFound("message not found")
      const room = store.getRoom(msg.room_id)!
      if (msg.author_id !== userId && room.owner_id !== userId) throw forbidden("only the author or the owner can delete")
      if (msg.kind === "system") throw forbidden("message cannot be deleted")
      if (msg.deleted_at) throw conflict("already deleted")
      const attachments = JSON.parse(msg.attachments) as Attachment[]
      const view = store.toMessage(store.deleteMessage(msg.msg_id))
      hub.publishRoom(msg.room_id, { t: "msg.updated", message: view })
      await Promise.all(attachments.map((a) => unlink(join(hub.filesDir, a.fileId)).catch(() => undefined)))
      return { message: view }
    }

    case "msg.react": {
      const msg = store.getMessage(frame.msgId)
      if (!msg || !store.isMember(msg.room_id, userId)) throw notFound("message not found")
      if (msg.deleted_at) throw forbidden("message was deleted")
      if (store.setReaction(msg.msg_id, userId, frame.emoji, frame.on)) {
        hub.publishRoom(msg.room_id, { t: "reaction", msgId: msg.msg_id, roomId: msg.room_id, userId, emoji: frame.emoji, on: frame.on })
      }
      return {}
    }

    case "msg.history": {
      const room = memberRoom(frame.roomId)
      const limit = Math.min(frame.limit ?? 50, limits.historyPage)
      const before = frame.beforeSeq ?? room.last_seq + 1
      const rows = store.listMessagesBefore(room.room_id, before, limit + 1)
      const hasMore = rows.length > limit
      return { messages: store.toMessages(hasMore ? rows.slice(1) : rows), hasMore }
    }

    case "file.upload": {
      const room = memberRoom(frame.roomId)
      let bytes: Buffer
      try {
        bytes = Buffer.from(frame.dataB64, "base64")
      } catch {
        throw invalid("dataB64 is not base64")
      }
      if (bytes.byteLength === 0) throw invalid("file is empty")
      if (bytes.byteLength > limits.fileBytes) throw tooLarge("file too large")
      if (store.roomStorageBytes(room.room_id) + bytes.byteLength > limits.roomStorageBytes) throw limitReached("room storage is full")
      const row = store.insertFile({ roomId: room.room_id, uploaderId: userId, name: frame.name, mime: frame.mime, size: bytes.byteLength })
      await Bun.write(join(hub.filesDir, row.file_id), bytes)
      const attachment: Attachment = { fileId: row.file_id, name: row.name, mime: row.mime, size: row.size }
      return { attachment }
    }

    case "auth":
      throw conflict("already authenticated")

    case "typing":
    case "read.mark":
    case "ping":
      throw invalid("not a request")
  }
}

export function handleFireAndForget(hub: Hub, ws: Socket, conn: Conn, frame: Req<"typing"> | Req<"read.mark"> | Req<"ping">): void {
  const userId = conn.userId!
  switch (frame.t) {
    case "ping":
      hub.send(ws, { t: "pong" })
      return
    case "typing": {
      if (!hub.store.isMember(frame.roomId, userId)) return
      const last = conn.typingAt.get(frame.roomId) ?? 0
      const nowMs = Date.now()
      if (nowMs - last < 2000) return
      conn.typingAt.set(frame.roomId, nowMs)
      hub.publishRoom(frame.roomId, { t: "typing", roomId: frame.roomId, userId }, ws)
      return
    }
    case "read.mark": {
      if (!hub.store.isMember(frame.roomId, userId)) return
      if (hub.store.setLastRead(frame.roomId, userId, frame.seq)) {
        hub.publishRoom(frame.roomId, { t: "read", roomId: frame.roomId, userId, seq: frame.seq })
      }
      return
    }
  }
}

function sync(hub: Hub, ws: Socket, userId: string, frame: Req<"sync">): Result {
  const { store, limits } = hub
  const rooms = store.listRoomsForUser(userId)
  const members: Record<string, unknown[]> = {}
  const messages: Record<string, Message[]> = {}
  const truncated: string[] = []
  const unread: Record<string, number> = {}
  const userIds = new Set<string>()
  for (const room of rooms) {
    const list = store.listMembers(room.room_id)
    members[room.room_id] = list.map((m) => store.toMember(m))
    for (const m of list) userIds.add(m.user_id)
    const lastSeq = frame.rooms[room.room_id] ?? 0
    const rows = store.listMessagesAfter(room.room_id, lastSeq, limits.syncMessages + 1)
    if (rows.length > limits.syncMessages) {
      truncated.push(room.room_id)
      rows.length = limits.syncMessages
    }
    messages[room.room_id] = store.toMessages(rows)
    const me = list.find((m) => m.user_id === userId)!
    unread[room.room_id] = Math.max(0, room.last_seq - me.last_read_seq)
    ws.subscribe(roomTopic(room.room_id))
  }
  return {
    rooms: rooms.map((r) => store.toRoom(r, { includeInvite: r.kind === "group" })),
    members,
    users: hub.usersView(userIds),
    messages,
    truncated,
    unread,
  }
}

function sendMessage(hub: Hub, ws: Socket, userId: string, frame: Req<"msg.send">, memberRoom: (roomId: string) => RoomRow): Result {
  const { store, limits } = hub
  const room = memberRoom(frame.roomId)
  if (utf8Bytes(frame.body) > limits.messageBytes) throw tooLarge("message too long")
  const kind: MessageKind = frame.kind ?? "text"
  let body = frame.body
  let meta: Record<string, unknown> | undefined

  switch (kind) {
    case "roll": {
      const roll = rollDice(body)
      if (!roll) throw invalid("dice notation must be NdM[+K], N ≤ 20, M ≤ 1000")
      body = roll.notation
      meta = { ...roll }
      break
    }
    case "poll": {
      const options = frame.meta?.options
      if (!Array.isArray(options) || options.length < 2 || options.length > 9 || !options.every((o) => typeof o === "string" && o.trim().length > 0 && o.length <= 64)) {
        throw invalid("poll needs 2 to 9 options of up to 64 characters")
      }
      if (body.trim().length === 0) throw invalid("poll question is empty")
      meta = { question: body, options: options.map((o) => (o as string).trim()) }
      break
    }
    case "sticker": {
      const text = frame.meta?.text
      const font = frame.meta?.font ?? "block"
      if (typeof text !== "string" || text.trim().length === 0 || text.length > 32) throw invalid("sticker text must be 1 to 32 characters")
      if (typeof font !== "string" || font.length > 16) throw invalid("sticker font is invalid")
      meta = { text, font }
      break
    }
    default:
      if (body.trim().length === 0 && !(frame.attachments && frame.attachments.length > 0)) throw invalid("message is empty")
  }

  if (frame.replyTo) {
    const target = store.getMessage(frame.replyTo)
    if (!target || target.room_id !== room.room_id) throw invalid("replyTo must be a message in the same room")
  }

  let attachments: Attachment[] = []
  if (frame.attachments && frame.attachments.length > 0) {
    const files = store.attachableFiles(room.room_id, userId, frame.attachments)
    if (files.length !== new Set(frame.attachments).size) throw invalid("attachments must be your own unattached uploads to this room")
    store.markAttached(files.map((f) => f.file_id))
    attachments = files.map((f) => {
      const a: Attachment = { fileId: f.file_id, name: f.name, mime: f.mime, size: f.size }
      if (f.width) a.width = f.width
      if (f.height) a.height = f.height
      return a
    })
  }

  const row = store.insertMessage({ roomId: room.room_id, authorId: userId, kind, body, meta, replyTo: frame.replyTo, attachments })
  const message = store.toMessage(row)
  hub.publishRoom(room.room_id, { t: "msg", message }, ws)
  const own: Message = frame.clientId ? { ...message, clientId: frame.clientId } : message
  hub.send(ws, { t: "msg", message: own })
  return { message: own }
}
