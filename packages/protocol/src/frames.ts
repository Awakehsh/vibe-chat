import { z } from "zod"
import type { ErrorCode, Member, Message, Room, User } from "./types.ts"
import type { Limits } from "./limits.ts"

// ---------- client → server ----------

const id = z.string().min(1).max(64)
const uuid = z.string().min(1).max(64)
const roomId = uuid
const msgId = uuid
const userId = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "userId must be a base64url Ed25519 public key")
const b64url = z.string().regex(/^[A-Za-z0-9_-]+$/)
const name = z.string().trim().min(1).max(32)
const emoji = z.string().min(1).max(16)
const seq = z.number().int().min(0)
const messageKind = z.enum(["text", "me", "roll", "poll", "sticker"])
const meta = z.record(z.string(), z.unknown())

export const clientFrameSchema = z.discriminatedUnion("t", [
  z.strictObject({ t: z.literal("auth"), id, userId, name, emoji: emoji.optional(), sig: b64url }),
  z.strictObject({ t: z.literal("sync"), id, rooms: z.record(roomId, seq) }),
  z.strictObject({ t: z.literal("profile.set"), id, name: name.optional(), emoji: emoji.or(z.literal("")).optional() }),
  z.strictObject({
    t: z.literal("presence.set"),
    id,
    statusText: z.string().max(64).optional(),
    statusEmoji: emoji.or(z.literal("")).optional(),
  }),
  z.strictObject({ t: z.literal("room.create"), id, name, emoji: emoji.optional() }),
  z.strictObject({ t: z.literal("room.join"), id, invite: z.string().min(1).max(128) }),
  z.strictObject({ t: z.literal("room.leave"), id, roomId }),
  z.strictObject({ t: z.literal("room.update"), id, roomId, name: name.optional(), emoji: emoji.or(z.literal("")).optional() }),
  z.strictObject({ t: z.literal("room.kick"), id, roomId, userId }),
  z.strictObject({ t: z.literal("room.transfer"), id, roomId, userId }),
  z.strictObject({ t: z.literal("room.delete"), id, roomId }),
  z.strictObject({ t: z.literal("room.invite.reset"), id, roomId }),
  z.strictObject({ t: z.literal("room.members"), id, roomId }),
  z.strictObject({ t: z.literal("dm.open"), id, userId }),
  z.strictObject({
    t: z.literal("msg.send"),
    id,
    roomId,
    body: z.string(),
    kind: messageKind.optional(),
    meta: meta.optional(),
    replyTo: msgId.optional(),
    attachments: z.array(uuid).max(10).optional(),
    clientId: z.string().max(64).optional(),
  }),
  z.strictObject({ t: z.literal("msg.edit"), id, msgId, body: z.string() }),
  z.strictObject({ t: z.literal("msg.delete"), id, msgId }),
  z.strictObject({ t: z.literal("msg.react"), id, msgId, emoji, on: z.boolean() }),
  z.strictObject({
    t: z.literal("msg.history"),
    id,
    roomId,
    beforeSeq: seq.optional(),
    limit: z.number().int().min(1).max(1000).optional(),
  }),
  z.strictObject({
    t: z.literal("file.upload"),
    id,
    roomId,
    name: z.string().min(1).max(255),
    mime: z.string().min(1).max(128),
    dataB64: z.string().min(1),
  }),
  // fire-and-forget
  z.strictObject({ t: z.literal("typing"), roomId }),
  z.strictObject({ t: z.literal("read.mark"), roomId, seq }),
  z.strictObject({ t: z.literal("ping") }),
])

export type ClientFrame = z.infer<typeof clientFrameSchema>
export type ClientRequest = Exclude<ClientFrame, { t: "typing" | "read.mark" | "ping" }>
export type ClientFrameOf<T extends ClientFrame["t"]> = Extract<ClientFrame, { t: T }>

/** Parse raw JSON text into a client frame, or return the failure. */
export function parseClientFrame(text: string): { ok: true; frame: ClientFrame } | { ok: false; message: string } {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, message: "frame is not valid JSON" }
  }
  const result = clientFrameSchema.safeParse(json)
  if (!result.success) {
    const issue = result.error.issues[0]
    const path = issue?.path.length ? ` at ${issue.path.join(".")}` : ""
    return { ok: false, message: `${issue?.message ?? "invalid frame"}${path}` }
  }
  return { ok: true, frame: result.data }
}

// ---------- server → client ----------

export interface HelloFrame {
  t: "hello"
  protocol: number
  server: { name: string; version: string }
  nonce: string
  limits: Limits
}

export interface OkFrame {
  t: "ok"
  id: string
  [key: string]: unknown
}

export interface ErrFrame {
  t: "err"
  id?: string
  code: ErrorCode
  message: string
  retryAfterMs?: number
}

export interface SyncResult {
  rooms: Room[]
  members: Record<string, Member[]>
  users: User[]
  messages: Record<string, Message[]>
  truncated: string[]
  unread: Record<string, number>
}

export interface AuthResult {
  session: string
  user: User
  serverTime: string
}

export interface JoinResult {
  room: Room
  members: Member[]
  users: User[]
  messages: Message[]
}

export interface HistoryResult {
  messages: Message[]
  hasMore: boolean
}

export type ServerEvent =
  | { t: "msg"; message: Message }
  | { t: "msg.updated"; message: Message }
  | { t: "reaction"; msgId: string; roomId: string; userId: string; emoji: string; on: boolean }
  | { t: "typing"; roomId: string; userId: string }
  | { t: "read"; roomId: string; userId: string; seq: number }
  | { t: "presence"; user: User }
  | { t: "room"; room: Room }
  | { t: "room.member"; roomId: string; member: Member; user: User; event: "joined" | "left" | "kicked" }
  | { t: "room.removed"; roomId: string; reason: "left" | "kicked" | "deleted" }
  | { t: "pong" }

export type ServerFrame = HelloFrame | OkFrame | ErrFrame | ServerEvent

