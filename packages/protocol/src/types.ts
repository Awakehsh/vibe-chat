export type RoomKind = "group" | "dm"
export type MessageKind = "text" | "me" | "roll" | "poll" | "sticker" | "system"

export interface User {
  userId: string
  name: string
  emoji?: string
  statusText?: string
  statusEmoji?: string
  online: boolean
  lastSeenAt: string
}

export interface Room {
  roomId: string
  kind: RoomKind
  name: string
  emoji?: string
  ownerId: string
  createdAt: string
  lastActivityAt: string
  lastSeq: number
  /** Present for group members only. */
  invite?: string
}

export interface Member {
  roomId: string
  userId: string
  joinedAt: string
  lastReadSeq: number
}

export interface Attachment {
  fileId: string
  name: string
  mime: string
  size: number
  width?: number
  height?: number
}

export interface RollMeta {
  notation: string
  rolls: number[]
  total: number
}

export interface PollMeta {
  question: string
  options: string[]
}

export interface StickerMeta {
  font: string
  text: string
}

export type MessageMeta = RollMeta | PollMeta | StickerMeta | Record<string, unknown>

export interface Message {
  msgId: string
  roomId: string
  seq: number
  authorId: string
  kind: MessageKind
  body: string
  meta?: MessageMeta
  replyTo?: string
  attachments: Attachment[]
  reactions: Record<string, string[]>
  editedAt?: string
  deletedAt?: string
  createdAt: string
  /** Echoed from msg.send so the sender can replace an optimistic copy. Never stored. */
  clientId?: string
}

export type ErrorCode =
  | "invalid"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "too_large"
  | "limit_reached"
  | "internal"
