import type { Server } from "bun"
import { join } from "node:path"
import {
  HEARTBEAT_TIMEOUT_MS,
  NONCE_TTL_MS,
  PROTOCOL_VERSION,
  SESSION_GRACE_MS,
  parseClientFrame,
  randomNonce,
  verifyAuth,
  type ClientFrame,
  type ErrFrame,
  type HelloFrame,
} from "@vibechat/protocol"
import { resolveConfig, type ServerConfig } from "./config.ts"
import { openDatabase } from "./db.ts"
import { ProtoError } from "./errors.ts"
import { handleFireAndForget, handleRequest } from "./handlers.ts"
import { Hub, type Conn, type Socket } from "./hub.ts"
import { TokenBucket } from "./ratelimit.ts"
import { Store } from "./store.ts"

export interface RunningServer {
  port: number
  hostname: string
  /** Base URL for HTTP, e.g. http://127.0.0.1:7788 */
  url: string
  hub: Hub
  /** Runs the inactive-room sweep now; returns what was deleted. */
  sweep(): Promise<{ roomIds: string[]; fileIds: string[] }>
  stop(): Promise<void>
}

interface Session {
  userId: string
  expiresAt: number
}

const FIRE_AND_FORGET = new Set(["typing", "read.mark", "ping"])

export async function startServer(partial: Partial<ServerConfig> = {}): Promise<RunningServer> {
  const config = resolveConfig(partial)
  const db = openDatabase(config.dataDir)
  const store = new Store(db)
  const filesDir = join(config.dataDir, "files")
  const sessions = new Map<string, Session>()
  let server!: Server<Conn>
  const hub = new Hub(store, config.limits, filesDir, (topic, data) => server.publish(topic, data))
  const log = config.quiet ? () => undefined : (...a: unknown[]) => console.log("[vibechat]", ...a)

  const sessionUser = (token: string | undefined): string | undefined => {
    if (!token) return undefined
    const s = sessions.get(token)
    if (!s || s.expiresAt < Date.now()) return undefined
    return s.userId
  }

  const sendErr = (ws: Socket, id: string | undefined, code: ErrFrame["code"], message: string, retryAfterMs?: number) => {
    const frame: ErrFrame = { t: "err", code, message }
    if (id !== undefined) frame.id = id
    if (retryAfterMs !== undefined) frame.retryAfterMs = retryAfterMs
    ws.send(JSON.stringify(frame))
  }

  const extractId = (text: string): string | undefined => {
    try {
      const v = JSON.parse(text) as { id?: unknown }
      return typeof v.id === "string" ? v.id : undefined
    } catch {
      return undefined
    }
  }

  async function onAuth(ws: Socket, conn: Conn, frame: Extract<ClientFrame, { t: "auth" }>): Promise<void> {
    if (conn.userId) return sendErr(ws, frame.id, "conflict", "already authenticated")
    const fail = (message: string) => {
      sendErr(ws, frame.id, "unauthorized", message)
      ws.close(4401, "unauthorized")
    }
    if (Date.now() - conn.nonceAt > NONCE_TTL_MS) return fail("nonce expired")
    if (frame.name.length > config.limits.nameChars) return sendErr(ws, frame.id, "too_large", "name too long")
    if (!(await verifyAuth(frame.userId, conn.nonce, frame.sig))) return fail("bad signature")
    conn.nonce = ""
    const row = store.upsertUser(frame.userId, frame.name, frame.emoji)
    conn.userId = frame.userId
    conn.session = randomNonce()
    sessions.set(conn.session, { userId: frame.userId, expiresAt: Number.POSITIVE_INFINITY })
    const first = hub.register(frame.userId, ws)
    ws.send(JSON.stringify({ t: "ok", id: frame.id, session: conn.session, user: hub.userView(row), serverTime: new Date().toISOString() }))
    if (first) hub.broadcastPresence(frame.userId)
  }

  async function onMessage(ws: Socket, raw: string | Buffer): Promise<void> {
    const conn = ws.data
    if (typeof raw !== "string") {
      ws.close(1003, "text frames only")
      return
    }
    const parsed = parseClientFrame(raw)
    if (!parsed.ok) return sendErr(ws, extractId(raw), "invalid", parsed.message)
    const frame = parsed.frame

    if (!conn.userId) {
      if (frame.t === "auth") return onAuth(ws, conn, frame)
      sendErr(ws, "id" in frame ? frame.id : undefined, "unauthorized", "authenticate first")
      ws.close(4401, "unauthorized")
      return
    }

    if (FIRE_AND_FORGET.has(frame.t)) {
      handleFireAndForget(hub, ws, conn, frame as Extract<ClientFrame, { t: "typing" | "read.mark" | "ping" }>)
      return
    }

    const id = (frame as { id: string }).id
    const bucket = frame.t === "msg.send" ? conn.buckets.send : frame.t === "file.upload" ? conn.buckets.upload : conn.buckets.requests
    const wait = conn.buckets.requests.take() || (bucket === conn.buckets.requests ? 0 : bucket.take())
    if (wait > 0) return sendErr(ws, id, "rate_limited", "slow down", wait)

    try {
      const result = await handleRequest(hub, ws, conn, frame)
      ws.send(JSON.stringify({ t: "ok", id, ...result }))
    } catch (e) {
      if (e instanceof ProtoError) return sendErr(ws, id, e.code, e.message, e.retryAfterMs)
      log("handler error", frame.t, e)
      sendErr(ws, id, "internal", "internal error")
    }
  }

  function onClose(ws: Socket): void {
    const conn = ws.data
    if (conn.session) {
      const s = sessions.get(conn.session)
      if (s) s.expiresAt = Date.now() + SESSION_GRACE_MS
    }
    if (conn.userId) {
      const last = hub.unregister(conn.userId, ws)
      if (last) {
        store.touchLastSeen(conn.userId)
        hub.broadcastPresence(conn.userId)
      }
    }
  }

  async function serveFile(req: Request, fileId: string): Promise<Response> {
    const auth = req.headers.get("authorization") ?? ""
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : undefined
    const userId = sessionUser(token)
    if (!userId) return new Response("unauthorized", { status: 401 })
    const file = store.getFile(fileId)
    if (!file || !store.isMember(file.room_id, userId)) return new Response("not found", { status: 404 })
    const f = Bun.file(join(filesDir, file.file_id))
    if (!(await f.exists())) return new Response("not found", { status: 404 })
    return new Response(f, {
      headers: {
        "content-type": file.mime,
        "content-length": String(file.size),
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        "cache-control": "private, max-age=31536000, immutable",
      },
    })
  }

  server = Bun.serve<Conn>({
    port: config.port,
    hostname: config.hostname,
    async fetch(req, srv) {
      const url = new URL(req.url)
      if (url.pathname === "/ws") {
        const conn: Conn = {
          id: Bun.randomUUIDv7(),
          nonce: randomNonce(),
          nonceAt: Date.now(),
          buckets: {
            requests: new TokenBucket(60, 10_000),
            send: new TokenBucket(10, 10_000),
            upload: new TokenBucket(5, 60_000),
          },
          typingAt: new Map(),
        }
        if (srv.upgrade(req, { data: conn })) return undefined
        return new Response("websocket upgrade failed", { status: 426 })
      }
      if (url.pathname === "/") {
        return Response.json({ name: config.name, version: config.version, protocol: PROTOCOL_VERSION })
      }
      if (url.pathname.startsWith("/i/")) {
        const token = url.pathname.slice(3).replace(/\/$/, "")
        const host = req.headers.get("host") ?? url.host
        return new Response(`vibechat invite\n\n  vibechat join ${host}/${token}\n\nInstall: https://github.com/vibe-chat/vibe-chat\n`, {
          headers: { "content-type": "text/plain; charset=utf-8" },
        })
      }
      if (url.pathname.startsWith("/files/")) {
        return serveFile(req, url.pathname.slice(7))
      }
      return new Response("not found", { status: 404 })
    },
    websocket: {
      maxPayloadLength: config.limits.frameBytes,
      idleTimeout: Math.ceil(HEARTBEAT_TIMEOUT_MS / 1000),
      perMessageDeflate: false,
      open(ws) {
        const hello: HelloFrame = {
          t: "hello",
          protocol: PROTOCOL_VERSION,
          server: { name: config.name, version: config.version },
          nonce: ws.data.nonce,
          limits: config.limits,
        }
        ws.send(JSON.stringify(hello))
      },
      message(ws, raw) {
        void onMessage(ws, raw)
      },
      close(ws) {
        onClose(ws)
      },
    },
  })

  const sweep = async () => {
    const result = store.sweepInactiveGroups(config.limits.inactiveRoomDays)
    for (const id of result.fileIds) await Bun.file(join(filesDir, id)).delete?.().catch(() => undefined)
    if (result.roomIds.length > 0) log(`swept ${result.roomIds.length} inactive room(s)`)
    return result
  }
  const sweepTimer = setInterval(() => void sweep(), 24 * 60 * 60 * 1000)
  const sessionTimer = setInterval(() => {
    const t = Date.now()
    for (const [k, s] of sessions) if (s.expiresAt < t) sessions.delete(k)
  }, 60_000)
  sweepTimer.unref()
  sessionTimer.unref()

  const hostname = server.hostname ?? config.hostname
  const url = `http://${hostname === "0.0.0.0" ? "127.0.0.1" : hostname}:${server.port}`
  log(`listening on ${url}  data: ${config.dataDir}`)

  return {
    port: server.port!,
    hostname,
    url,
    hub,
    sweep,
    async stop() {
      clearInterval(sweepTimer)
      clearInterval(sessionTimer)
      await server.stop(true)
      db.close()
    },
  }
}
