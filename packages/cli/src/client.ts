import { rollDice, type Attachment, type ClientRequestOf, type Member, type Message, type MessageKind, type Room, type SyncResult, type User } from "@vibechat/protocol"
import { forgetHost, loadConfig, rememberHost, saveConfig, type Config } from "./config.ts"
import { saveIdentity } from "./identity.ts"
import { Connection, RequestError, type ConnectionState } from "./connection.ts"
import type { Identity } from "./identity.ts"
import { Model } from "./model.ts"

export interface ClientOptions {
  identity: Identity
  config: Config
  configDir?: string
  insecure?: boolean
}

/**
 * The user's whole chat world: one Connection per host, merged into one Model.
 * Owns config persistence for hosts and exposes the operations the UI and
 * the subcommands need.
 */
export class Client {
  readonly model: Model
  readonly connections = new Map<string, Connection>()
  private stateListeners = new Set<(host: string, state: ConnectionState, detail?: string) => void>()
  config: Config

  constructor(private readonly opts: ClientOptions) {
    this.model = new Model(opts.identity.publicKey)
    this.config = opts.config
  }

  get identity(): Identity {
    return this.opts.identity
  }

  onState(fn: (host: string, state: ConnectionState, detail?: string) => void): () => void {
    this.stateListeners.add(fn)
    return () => this.stateListeners.delete(fn)
  }

  /** Connects to every configured host. Hosts that fail are reported, not fatal. */
  async connectAll(): Promise<{ host: string; error: string }[]> {
    const failures: { host: string; error: string }[] = []
    await Promise.all(
      this.config.hosts.map(async (host) => {
        try {
          await this.connect(host)
        } catch (e) {
          failures.push({ host, error: e instanceof Error ? e.message : String(e) })
        }
      }),
    )
    return failures
  }

  /** Connects to one host (idempotent) and returns its first sync. */
  async connect(host: string): Promise<SyncResult> {
    const existing = this.connections.get(host)
    if (existing) {
      return new Promise((resolve) => {
        if (existing.state === "online") resolve({ rooms: [], members: {}, users: [], messages: {}, truncated: [], unread: {} })
        else existing.on("synced", resolve)
      })
    }
    const opts: { insecure?: boolean } = {}
    if (this.opts.insecure) opts.insecure = true
    const conn = new Connection(host, this.opts.identity, opts)
    this.connections.set(host, conn)
    conn.on("synced", (sync) => this.model.applySync(host, sync))
    conn.on("event", (ev) => {
      if (ev.t === "msg") conn.advance(ev.message.roomId, ev.message.seq)
      if (ev.t === "room.removed") conn.forget(ev.roomId)
      this.model.apply(host, ev)
      // A `room` event carries no members; a room we did not know yet needs them for its title and presence.
      if (ev.t === "room" && this.model.room(ev.room.roomId)?.members.size === 0) void this.hydrateMembers(ev.room.roomId)
    })
    conn.on("state", (s, d) => {
      for (const fn of this.stateListeners) fn(host, s, d)
    })
    try {
      return await conn.connect()
    } catch (e) {
      this.connections.delete(host)
      throw e
    }
  }

  private conn(roomId: string): Connection {
    const r = this.model.room(roomId)
    const c = r && this.connections.get(r.host)
    if (!c) throw new RequestError("not_found", "unknown room")
    return c
  }

  private async persistHost(host: string): Promise<void> {
    this.config = rememberHost(this.config, host)
    await saveConfig(this.config, this.opts.configDir)
  }

  /** Sets the server `/new` and host-less invites use; connects to it to validate. */
  async setDefaultHost(host: string): Promise<void> {
    await this.connect(host)
    this.config = { ...rememberHost(this.config, host), defaultHost: host }
    await saveConfig(this.config, this.opts.configDir)
  }

  async createRoom(host: string, name: string, emoji?: string): Promise<Room> {
    const sync = await this.connect(host)
    void sync
    const conn = this.connections.get(host)!
    const req: ClientRequestOf<"room.create"> = { t: "room.create", name }
    if (emoji) req.emoji = emoji
    const res = await conn.request(req)
    const room = res.room as Room
    conn.advance(room.roomId, room.lastSeq)
    this.model.addRoom(host, room, [{ roomId: room.roomId, userId: this.identity.publicKey, joinedAt: room.createdAt, lastReadSeq: 0 }], [], [])
    await this.persistHost(host)
    return room
  }

  async joinRoom(host: string, token: string): Promise<Room> {
    await this.connect(host)
    const conn = this.connections.get(host)!
    const res = await conn.request({ t: "room.join", invite: token })
    const room = res.room as Room
    conn.advance(room.roomId, room.lastSeq)
    this.model.addRoom(host, room, res.members as never, res.users as never, res.messages as never)
    await this.persistHost(host)
    return room
  }

  async leaveRoom(roomId: string): Promise<void> {
    await this.conn(roomId).request({ t: "room.leave", roomId })
  }

  async kick(roomId: string, userId: string): Promise<void> {
    await this.conn(roomId).request({ t: "room.kick", roomId, userId })
  }

  async transfer(roomId: string, userId: string): Promise<void> {
    await this.conn(roomId).request({ t: "room.transfer", roomId, userId })
  }

  async renameRoom(roomId: string, name: string, emoji?: string): Promise<void> {
    const req: ClientRequestOf<"room.update"> = { t: "room.update", roomId, name }
    if (emoji !== undefined) req.emoji = emoji
    await this.conn(roomId).request(req)
  }

  async resetInvite(roomId: string): Promise<string> {
    const res = await this.conn(roomId).request({ t: "room.invite.reset", roomId })
    return (res.room as Room).invite ?? ""
  }

  async deleteRoom(roomId: string): Promise<void> {
    const host = this.model.room(roomId)?.host
    await this.conn(roomId).request({ t: "room.delete", roomId })
    if (host) await this.pruneHost(host)
  }

  /** Changes name and/or emoji on every server and in the identity file. */
  async setProfile(patch: { name?: string; emoji?: string }): Promise<void> {
    const req: ClientRequestOf<"profile.set"> = { t: "profile.set" }
    if (patch.name !== undefined) req.name = patch.name
    if (patch.emoji !== undefined) req.emoji = patch.emoji
    await Promise.all([...this.connections.values()].filter((c) => c.state === "online").map((c) => c.request(req)))
    if (patch.name !== undefined) this.opts.identity.name = patch.name
    if (patch.emoji !== undefined) {
      if (patch.emoji) this.opts.identity.emoji = patch.emoji
      else delete this.opts.identity.emoji
    }
    await saveIdentity(this.opts.identity, this.opts.configDir)
  }

  /** Uploads a local file to a room and returns the attachment id for msg.send. */
  async upload(roomId: string, path: string): Promise<Attachment> {
    const file = Bun.file(path)
    if (!(await file.exists())) throw new RequestError("not_found", `no such file: ${path}`)
    const limit = this.conn(roomId).hello?.limits.fileBytes ?? 2 * 1024 * 1024
    if (file.size > limit) throw new RequestError("too_large", `file is ${Math.round(file.size / 1024)} KB; the limit is ${Math.round(limit / 1024)} KB`)
    const name = path.split(/[\\/]/).pop() ?? "file"
    const res = await this.conn(roomId).request({ t: "file.upload", roomId, name, mime: file.type || "application/octet-stream", dataB64: Buffer.from(await file.arrayBuffer()).toString("base64") })
    return res.attachment as Attachment
  }

  /** HTTP base URL and bearer token for downloading a room's files. */
  fileUrl(roomId: string, fileId: string): { url: string; session: string } | undefined {
    const r = this.model.room(roomId)
    const c = r && this.connections.get(r.host)
    if (!c?.session) return undefined
    return { url: c.url.replace(/^ws/, "http").replace(/\/ws$/, `/files/${fileId}`), session: c.session }
  }

  async openDm(roomId: string, userId: string): Promise<Room> {
    const host = this.model.room(roomId)!.host
    const res = await this.conn(roomId).request({ t: "dm.open", userId })
    const dm = res.room as Room
    if (!this.model.room(dm.roomId)) this.model.addRoom(host, dm, [], [], [])
    await this.hydrateMembers(dm.roomId)
    return dm
  }

  private async hydrateMembers(roomId: string): Promise<void> {
    try {
      const res = await this.conn(roomId).request({ t: "room.members", roomId })
      this.model.setMembers(roomId, res.members as Member[], res.users as User[])
    } catch {
      // the room may already be gone; the next sync repairs it
    }
  }

  /** Sends a message with an optimistic local copy. Resolves to the confirmed message. */
  async send(roomId: string, body: string, opts: { kind?: Exclude<MessageKind, "system">; meta?: Record<string, unknown>; replyTo?: string; attachments?: string[] } = {}): Promise<Message> {
    const conn = this.conn(roomId)
    const clientId = Bun.randomUUIDv7()
    const kind = opts.kind ?? "text"
    const optimistic: Message = {
      msgId: `local:${clientId}`,
      roomId,
      seq: 0,
      authorId: this.identity.publicKey,
      kind,
      body: kind === "roll" ? (rollDice(body)?.notation ?? body) : body,
      attachments: [],
      reactions: {},
      createdAt: new Date().toISOString(),
      clientId,
    }
    if (opts.meta) optimistic.meta = opts.meta
    if (opts.replyTo) optimistic.replyTo = opts.replyTo
    this.model.addOptimistic(roomId, optimistic)
    const req: ClientRequestOf<"msg.send"> = { t: "msg.send", roomId, body, clientId }
    if (opts.kind) req.kind = opts.kind
    if (opts.meta) req.meta = opts.meta
    if (opts.replyTo) req.replyTo = opts.replyTo
    if (opts.attachments) req.attachments = opts.attachments
    try {
      const res = await conn.request(req)
      const message = res.message as Message
      conn.advance(roomId, message.seq)
      return message
    } catch (e) {
      this.model.removeOptimistic(roomId, clientId)
      throw e
    }
  }

  async edit(roomId: string, msgId: string, body: string): Promise<void> {
    await this.conn(roomId).request({ t: "msg.edit", msgId, body })
  }

  async remove(roomId: string, msgId: string): Promise<void> {
    await this.conn(roomId).request({ t: "msg.delete", msgId })
  }

  async react(roomId: string, msgId: string, emoji: string, on: boolean): Promise<void> {
    await this.conn(roomId).request({ t: "msg.react", msgId, emoji, on })
  }

  /** Loads older messages into the model and returns them (ascending). */
  async loadOlder(roomId: string, limit = 50): Promise<Message[]> {
    const r = this.model.room(roomId)
    if (!r || !r.hasOlder) return []
    const oldest = r.messages.find((m) => m.seq > 0)?.seq
    const req: ClientRequestOf<"msg.history"> = { t: "msg.history", roomId, limit }
    if (oldest !== undefined) req.beforeSeq = oldest
    const res = await this.conn(roomId).request(req)
    const older = res.messages as Message[]
    this.model.prependHistory(roomId, older, res.hasMore as boolean)
    return older
  }

  async setStatus(statusText: string, statusEmoji?: string): Promise<void> {
    const req: ClientRequestOf<"presence.set"> = { t: "presence.set", statusText }
    if (statusEmoji !== undefined) req.statusEmoji = statusEmoji
    await Promise.all([...this.connections.values()].filter((c) => c.state === "online").map((c) => c.request(req)))
  }

  typing(roomId: string): void {
    const r = this.model.room(roomId)
    const c = r && this.connections.get(r.host)
    c?.sendRaw({ t: "typing", roomId })
  }

  /** Marks the room read locally and on the server when something changed. */
  markRead(roomId: string): void {
    const seq = this.model.markRead(roomId)
    if (seq === undefined) return
    const r = this.model.room(roomId)
    const c = r && this.connections.get(r.host)
    c?.sendRaw({ t: "read.mark", roomId, seq })
  }

  /** Drops a host from config when it has no rooms left (after leave/delete). */
  async pruneHost(host: string): Promise<void> {
    if ([...this.model.rooms.values()].some((r) => r.host === host)) return
    this.connections.get(host)?.close()
    this.connections.delete(host)
    this.config = forgetHost(this.config, host)
    await saveConfig(this.config, this.opts.configDir)
  }

  close(): void {
    for (const c of this.connections.values()) c.close()
    this.connections.clear()
  }
}

export async function loadClient(identity: Identity, configDir?: string, insecure?: boolean): Promise<Client> {
  const config = await loadConfig(configDir)
  const opts: ClientOptions = { identity, config }
  if (configDir) opts.configDir = configDir
  if (insecure) opts.insecure = insecure
  return new Client(opts)
}
