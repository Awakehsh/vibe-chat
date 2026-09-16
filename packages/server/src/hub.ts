import type { ServerWebSocket } from "bun"
import type { Limits, ServerFrame, User } from "@vibechat/protocol"
import type { Store, UserRow } from "./store.ts"
import type { TokenBucket } from "./ratelimit.ts"

/** Per-connection state; lives in `ws.data`. */
export interface Conn {
  id: string
  userId?: string
  session?: string
  nonce: string
  nonceAt: number
  buckets: { requests: TokenBucket; send: TokenBucket; upload: TokenBucket }
  typingAt: Map<string, number>
}

export type Socket = ServerWebSocket<Conn>

export const roomTopic = (roomId: string) => `room:${roomId}`

/**
 * Everything a handler needs that is not the store: fan-out, presence and
 * the socket registry. One instance per server.
 */
export class Hub {
  private readonly socketsByUser = new Map<string, Set<Socket>>()

  constructor(
    readonly store: Store,
    readonly limits: Limits,
    readonly filesDir: string,
    private readonly publishRaw: (topic: string, data: string) => void,
  ) {}

  send(ws: Socket, frame: ServerFrame | Record<string, unknown>): void {
    ws.send(JSON.stringify(frame))
  }

  /** Every subscriber of the room, optionally excluding one socket. */
  publishRoom(roomId: string, frame: ServerFrame, exclude?: Socket): void {
    const data = JSON.stringify(frame)
    if (exclude) exclude.publish(roomTopic(roomId), data)
    else this.publishRaw(roomTopic(roomId), data)
  }

  sendToUser(userId: string, frame: ServerFrame): void {
    const data = JSON.stringify(frame)
    for (const ws of this.socketsByUser.get(userId) ?? []) ws.send(data)
  }

  subscribeUser(userId: string, roomId: string): void {
    for (const ws of this.socketsByUser.get(userId) ?? []) ws.subscribe(roomTopic(roomId))
  }

  unsubscribeUser(userId: string, roomId: string): void {
    for (const ws of this.socketsByUser.get(userId) ?? []) ws.unsubscribe(roomTopic(roomId))
  }

  /** Returns true when this is the user's first live socket. */
  register(userId: string, ws: Socket): boolean {
    let set = this.socketsByUser.get(userId)
    if (!set) {
      set = new Set()
      this.socketsByUser.set(userId, set)
    }
    set.add(ws)
    return set.size === 1
  }

  /** Returns true when this was the user's last live socket. */
  unregister(userId: string, ws: Socket): boolean {
    const set = this.socketsByUser.get(userId)
    if (!set) return false
    set.delete(ws)
    if (set.size === 0) {
      this.socketsByUser.delete(userId)
      return true
    }
    return false
  }

  isOnline(userId: string): boolean {
    return this.socketsByUser.has(userId)
  }

  userView(row: UserRow): User {
    return this.store.toUser(row, this.isOnline(row.user_id))
  }

  usersView(ids: Iterable<string>): User[] {
    return this.store.getUsers(ids).map((r) => this.userView(r))
  }

  /** Tell every room the user is in about their current presence/profile. */
  broadcastPresence(userId: string): void {
    const row = this.store.getUser(userId)
    if (!row) return
    const frame: ServerFrame = { t: "presence", user: this.userView(row) }
    for (const room of this.store.listRoomsForUser(userId)) this.publishRoom(room.room_id, frame)
  }
}
