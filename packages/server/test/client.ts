import { generateIdentity, importPrivateKey, signAuth, type ClientFrame, type HelloFrame, type IdentityKeys, type ServerFrame } from "@vibechat/protocol"
import type { RunningServer } from "../src/index.ts"

type Frame = ServerFrame & Record<string, any>

/** Minimal protocol client for tests: request/response by id plus an event queue. */
export class TestClient {
  private ws!: WebSocket
  private nextId = 1
  private pending = new Map<string, (f: Frame) => void>()
  private events: Frame[] = []
  private waiters: { pred: (f: Frame) => boolean; resolve: (f: Frame) => void }[] = []
  hello!: HelloFrame
  userId!: string
  session!: string
  closed: Promise<{ code: number; reason: string }>
  private resolveClosed!: (v: { code: number; reason: string }) => void

  constructor(
    readonly server: RunningServer,
    readonly identity: IdentityKeys,
    readonly name: string,
  ) {
    this.userId = identity.publicKey
    this.closed = new Promise((r) => (this.resolveClosed = r))
  }

  static async connect(server: RunningServer, name: string, identity?: IdentityKeys): Promise<TestClient> {
    const c = new TestClient(server, identity ?? (await generateIdentity()), name)
    await c.open()
    await c.auth()
    return c
  }

  async open(): Promise<void> {
    this.ws = new WebSocket(this.server.url.replace("http", "ws") + "/ws")
    this.ws.onmessage = (ev) => this.onFrame(JSON.parse(String(ev.data)) as Frame)
    this.ws.onclose = (ev) => this.resolveClosed({ code: ev.code, reason: ev.reason })
    await new Promise<void>((resolve, reject) => {
      this.ws.onopen = () => resolve()
      this.ws.onerror = (e) => reject(e)
    })
    this.hello = (await this.next((f) => f.t === "hello")) as HelloFrame
  }

  async auth(): Promise<Frame> {
    const key = await importPrivateKey(this.identity.privateKey)
    const sig = await signAuth(key, this.hello.nonce)
    const res = await this.request({ t: "auth", userId: this.userId, name: this.name, sig } as any)
    if (res.t === "ok") this.session = res.session as string
    return res
  }

  private onFrame(f: Frame) {
    if ((f.t === "ok" || f.t === "err") && typeof f.id === "string" && this.pending.has(f.id)) {
      this.pending.get(f.id)!(f)
      this.pending.delete(f.id)
      return
    }
    const i = this.waiters.findIndex((w) => w.pred(f))
    if (i >= 0) {
      const [w] = this.waiters.splice(i, 1)
      w!.resolve(f)
      return
    }
    this.events.push(f)
  }

  /** Send a request frame (id is filled in) and await ok/err. */
  request(frame: Omit<Extract<ClientFrame, { id: string }>, "id"> & { t: string }): Promise<Frame> {
    const id = String(this.nextId++)
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.ws.send(JSON.stringify({ ...frame, id }))
    })
  }

  /** Send a raw frame without waiting. */
  sendRaw(frame: unknown): void {
    this.ws.send(typeof frame === "string" ? frame : JSON.stringify(frame))
  }

  /** Await the next event matching `pred` (already-buffered events are checked first). */
  next(pred: (f: Frame) => boolean, timeoutMs = 2000): Promise<Frame> {
    const i = this.events.findIndex(pred)
    if (i >= 0) return Promise.resolve(this.events.splice(i, 1)[0]!)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.resolve !== resolve)
        reject(new Error(`timed out waiting for event; buffered: ${this.events.map((e) => e.t).join(",") || "none"}`))
      }, timeoutMs)
      this.waiters.push({
        pred,
        resolve: (f) => {
          clearTimeout(timer)
          resolve(f)
        },
      })
    })
  }

  /** Assert that no event matching `pred` arrives within `ms`. */
  async none(pred: (f: Frame) => boolean, ms = 150): Promise<void> {
    await new Promise((r) => setTimeout(r, ms))
    const hit = this.events.find(pred)
    if (hit) throw new Error(`unexpected event ${hit.t}`)
  }

  close(): void {
    this.ws.close()
  }
}

export async function expectOk(p: Promise<Frame>): Promise<Frame> {
  const f = await p
  if (f.t !== "ok") throw new Error(`expected ok, got ${f.t} ${f.code}: ${f.message}`)
  return f
}

export async function expectErr(p: Promise<Frame>, code: string): Promise<Frame> {
  const f = await p
  if (f.t !== "err" || f.code !== code) throw new Error(`expected err ${code}, got ${f.t} ${f.code ?? ""} ${f.message ?? ""}`)
  return f
}
