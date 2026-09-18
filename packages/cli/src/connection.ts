import {
  HEARTBEAT_INTERVAL_MS,
  PROTOCOL_VERSION,
  importPrivateKey,
  signAuth,
  socketUrlForHost,
  type ClientFrame,
  type ClientRequestBody,
  type ClientRequestOf,
  type ErrFrame,
  type HelloFrame,
  type OkFrame,
  type ServerEvent,
  type SyncResult,
} from "@vibechat/protocol"
import type { Identity } from "./identity.ts"

export type ConnectionState = "connecting" | "syncing" | "online" | "offline" | "closed"

export interface ConnectionEvents {
  state: (state: ConnectionState, detail?: string) => void
  synced: (result: SyncResult) => void
  event: (event: ServerEvent) => void
}

type Reply = (OkFrame & Record<string, unknown>) | ErrFrame

/** The link to a server went away. A network failure is reported as one line, not a stack. */
export class ConnectionError extends Error {
  constructor(
    readonly host: string,
    reason: string,
  ) {
    super(reason ? `${host}: ${reason}` : `could not reach ${host}`)
  }
}

export class RequestError extends Error {
  constructor(
    readonly code: ErrFrame["code"],
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message)
  }
}

/**
 * One authenticated WebSocket to one server. Reconnects with backoff and
 * re-syncs from the last seq it saw per room. Emits typed events; keeps no
 * room state itself beyond the seq cursors.
 */
export class Connection {
  readonly url: string
  private ws?: WebSocket
  private nextId = 1
  private pending = new Map<string, { resolve: (r: Reply) => void; reject: (e: Error) => void }>()
  private listeners: { [K in keyof ConnectionEvents]: Set<ConnectionEvents[K]> } = { state: new Set(), synced: new Set(), event: new Set() }
  private heartbeat: ReturnType<typeof setInterval> | undefined
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private attempts = 0
  private stopped = false
  private everSynced = false
  readonly cursors = new Map<string, number>()
  state: ConnectionState = "offline"
  session?: string
  hello?: HelloFrame

  constructor(
    readonly host: string,
    private readonly identity: Identity,
    opts: { insecure?: boolean; via?: string } = {},
  ) {
    // `host` stays the name rooms are filed under; `via` is only where to dial it.
    this.url = socketUrlForHost(opts.via ?? host, opts)
  }

  on<K extends keyof ConnectionEvents>(name: K, fn: ConnectionEvents[K]): () => void {
    this.listeners[name].add(fn)
    return () => this.listeners[name].delete(fn)
  }

  private emit<K extends keyof ConnectionEvents>(name: K, ...args: Parameters<ConnectionEvents[K]>): void {
    for (const fn of this.listeners[name]) (fn as (...a: unknown[]) => void)(...args)
  }

  private setState(state: ConnectionState, detail?: string): void {
    this.state = state
    this.emit("state", state, detail)
  }

  /** Connects and resolves after the first successful sync. Later reconnects are automatic. */
  connect(): Promise<SyncResult> {
    this.stopped = false
    return new Promise((resolve, reject) => {
      const offSynced = this.on("synced", (r) => {
        offSynced()
        offState()
        resolve(r)
      })
      const offState = this.on("state", (s, detail) => {
        if (s === "closed") {
          offSynced()
          offState()
          reject(new ConnectionError(this.host, detail ?? ""))
        }
      })
      this.open()
    })
  }

  private open(): void {
    this.setState("connecting")
    const ws = new WebSocket(this.url)
    this.ws = ws
    ws.onopen = () => {
      this.attempts = 0
    }
    ws.onmessage = (ev) => void this.onFrame(String(ev.data))
    ws.onerror = () => undefined
    ws.onclose = (ev) => this.onClose(ev.code, ev.reason)
  }

  private async onFrame(text: string): Promise<void> {
    let frame: Reply | HelloFrame | ServerEvent
    try {
      frame = JSON.parse(text)
    } catch {
      return
    }
    if (frame.t === "hello") return this.onHello(frame)
    if (frame.t === "ok" || (frame.t === "err" && frame.id !== undefined)) {
      const p = this.pending.get(frame.id!)
      if (p) {
        this.pending.delete(frame.id!)
        p.resolve(frame as Reply)
      }
      return
    }
    this.emit("event", frame as ServerEvent)
  }

  private async onHello(hello: HelloFrame): Promise<void> {
    if (hello.protocol !== PROTOCOL_VERSION) {
      this.fail(`server speaks protocol ${hello.protocol}, this client speaks ${PROTOCOL_VERSION}; upgrade one of them`)
      return
    }
    this.hello = hello
    try {
      const key = await importPrivateKey(this.identity.privateKey)
      const auth: ClientRequestOf<"auth"> = { t: "auth", userId: this.identity.publicKey, name: this.identity.name, sig: await signAuth(key, hello.nonce) }
      if (this.identity.emoji) auth.emoji = this.identity.emoji
      const res = await this.request(auth)
      this.session = res.session as string
      this.setState("syncing")
      const sync = (await this.request({ t: "sync", rooms: Object.fromEntries(this.cursors) })) as unknown as SyncResult
      for (const room of sync.rooms) this.cursors.set(room.roomId, room.lastSeq)
      this.everSynced = true
      this.setState("online")
      this.emit("synced", sync)
      this.heartbeat = setInterval(() => this.sendRaw({ t: "ping" }), HEARTBEAT_INTERVAL_MS)
    } catch (e) {
      if (e instanceof RequestError && e.code === "unauthorized") this.fail(`server rejected this identity: ${e.message}`)
      // other failures: the socket will close and reconnect
    }
  }

  private fail(reason: string): void {
    this.stopped = true
    this.ws?.close()
    this.setState("closed", reason)
  }

  private onClose(code: number, reason: string): void {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = undefined
    for (const p of this.pending.values()) p.reject(new ConnectionError(this.host, reason || `closed (${code})`))
    this.pending.clear()
    if (this.stopped || this.state === "closed") {
      if (this.state !== "closed") this.setState("closed", reason || `closed (${code})`)
      return
    }
    // Never reached the first sync: fail fast so the caller can report it. Reconnects only after that.
    if (!this.everSynced) {
      this.stopped = true
      this.setState("closed", reason || `could not connect to ${this.host}`)
      return
    }
    this.setState("offline", reason || `closed (${code})`)
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.attempts++, 5))
    this.reconnectTimer = setTimeout(() => this.open(), delay)
  }

  /** Send a request and await its ok payload; rejects with RequestError on err. */
  async request(frame: ClientRequestBody): Promise<OkFrame & Record<string, unknown>> {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new RequestError("internal", "not connected")
    const id = String(this.nextId++)
    const reply = await new Promise<Reply>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ ...frame, id }))
    })
    if (reply.t === "err") throw new RequestError(reply.code, reply.message, reply.retryAfterMs)
    return reply
  }

  /** Fire-and-forget frames (typing, read.mark, ping). Dropped when offline. */
  sendRaw(frame: Extract<ClientFrame, { t: "typing" | "read.mark" | "ping" }>): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(frame))
  }

  /** Track the newest seq seen for a room so a reconnect resumes from there. */
  advance(roomId: string, seq: number): void {
    if ((this.cursors.get(roomId) ?? 0) < seq) this.cursors.set(roomId, seq)
  }

  forget(roomId: string): void {
    this.cursors.delete(roomId)
  }

  close(): void {
    this.stopped = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.ws?.close()
    if (this.state !== "closed") this.setState("closed", "closed by client")
  }
}
