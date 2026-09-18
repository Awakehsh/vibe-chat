import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { generateIdentity, isInviteToken } from "@vibechat/protocol"
import { startServer, type RunningServer } from "../src/index.ts"
import { TestClient, expectErr, expectOk } from "./client.ts"

let server: RunningServer
let dir: string

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "vibechat-test-"))
  server = await startServer({ port: 0, dataDir: dir, quiet: true, limits: { roomMembers: 3, fileBytes: 1024, roomStorageBytes: 1536, messageBytes: 64 } as any })
})

afterAll(async () => {
  await server.stop()
  rmSync(dir, { recursive: true, force: true })
})

describe("handshake", () => {
  test("hello then auth", async () => {
    const c = await TestClient.connect(server, "hu")
    expect(c.hello.protocol).toBe(0)
    expect(c.hello.limits.roomMembers).toBe(3)
    expect(c.session).toBeString()
    c.close()
  })

  test("bad signature is unauthorized and closes 4401", async () => {
    const c = new TestClient(server, await generateIdentity(), "x")
    await c.open()
    const res = await c.request({ t: "auth", userId: c.userId, name: "x", sig: "AAAA" } as any)
    expect(res.t).toBe("err")
    expect(res.code).toBe("unauthorized")
    expect((await c.closed).code).toBe(4401)
  })

  test("any frame before auth is unauthorized", async () => {
    const c = new TestClient(server, await generateIdentity(), "x")
    await c.open()
    await expectErr(c.request({ t: "sync", rooms: {} } as any), "unauthorized")
    expect((await c.closed).code).toBe(4401)
  })

  test("malformed frames get invalid with the id echoed", async () => {
    const c = await TestClient.connect(server, "hu")
    c.sendRaw('{"t":"room.create","id":"zz"}')
    const err = await c.next((f) => f.t === "err")
    expect(err.id).toBe("zz")
    expect(err.code).toBe("invalid")
    c.sendRaw("{not json")
    const err2 = await c.next((f) => f.t === "err")
    expect(err2.code).toBe("invalid")
    c.close()
  })

  test("http info and invite landing", async () => {
    const info = await (await fetch(server.url + "/")).json()
    expect(info).toEqual({ name: "vibechat", version: "0.9.0", protocol: 0 })
    const res = await fetch(server.url + "/i/7K3MQ0VZ2P")
    expect(res.headers.get("content-type")).toContain("text/html")
    const page = await res.text()
    expect(page).toContain("vibechat join")
    expect(page).toContain("/7K3MQ0VZ2P")
  })

  test("the invite page carries one line per system that installs and joins", async () => {
    const page = await (await fetch(server.url + "/i/7k3mq0vz2p")).text()
    const host = new URL(server.url).host
    // A lowercase token in the link still names the room the uppercase one does.
    expect(page).toContain(`sh -s -- ${host}/7K3MQ0VZ2P`)
    expect(page).toContain(`$env:VIBECHAT_JOIN='${host}/7K3MQ0VZ2P'`)
    expect(page).toContain("/install.sh")
    expect(page).toContain("/install.ps1")
    expect(page).not.toContain("github.com/vibe-chat/vibe-chat")
  })

  test("the installers are served by the server the invite points at", async () => {
    const sh = await fetch(server.url + "/install.sh")
    expect(sh.headers.get("content-type")).toContain("text/plain")
    expect(await sh.text()).toContain("VIBECHAT_INSTALL_DIR")
    expect(await (await fetch(server.url + "/install.ps1")).text()).toContain("VIBECHAT_JOIN")
  })
})

describe("rooms and messages", () => {
  let a: TestClient
  let b: TestClient
  let roomId: string
  let invite: string

  beforeAll(async () => {
    a = await TestClient.connect(server, "alice")
    b = await TestClient.connect(server, "bob")
  })
  afterAll(() => {
    a.close()
    b.close()
  })

  test("create room returns an invite token", async () => {
    const res = await expectOk(a.request({ t: "room.create", name: "late night", emoji: "🌙" } as any))
    roomId = res.room.roomId
    invite = res.room.invite
    expect(isInviteToken(invite)).toBe(true)
    expect(res.room.ownerId).toBe(a.userId)
    expect(res.room.kind).toBe("group")
  })

  test("join by invite; both sides see membership and a system message", async () => {
    await expectOk(a.request({ t: "sync", rooms: {} } as any))
    const res = await expectOk(b.request({ t: "room.join", invite: invite.toLowerCase() } as any))
    expect(res.room.roomId).toBe(roomId)
    expect(res.members).toHaveLength(2)
    expect(res.users.map((u: any) => u.name).sort()).toEqual(["alice", "bob"])
    expect(res.messages.at(-1).kind).toBe("system")
    const ev = await a.next((f) => f.t === "room.member")
    expect(ev.event).toBe("joined")
    expect(ev.user.userId).toBe(b.userId)
    const sys = await a.next((f) => f.t === "msg")
    expect(sys.message.kind).toBe("system")
    expect(sys.message.body).toBe("bob joined")
    await expectErr(b.request({ t: "room.join", invite } as any), "conflict")
    await expectErr(b.request({ t: "room.join", invite: "0000000000" } as any), "not_found")
  })

  test("messages fan out with increasing seq and clientId echo", async () => {
    await expectOk(b.request({ t: "sync", rooms: { [roomId]: 0 } } as any))
    const sent = await expectOk(a.request({ t: "msg.send", roomId, body: "hello **bob**", clientId: "c1" } as any))
    expect(sent.message.clientId).toBe("c1")
    const own = await a.next((f) => f.t === "msg" && f.message.body === "hello **bob**")
    expect(own.message.clientId).toBe("c1")
    const got = await b.next((f) => f.t === "msg" && f.message.body === "hello **bob**")
    expect(got.message.clientId).toBeUndefined()
    expect(got.message.seq).toBe(sent.message.seq)
    const second = await expectOk(b.request({ t: "msg.send", roomId, body: "hi" } as any))
    expect(second.message.seq).toBe(sent.message.seq + 1)
    await a.next((f) => f.t === "msg" && f.message.body === "hi")
  })

  test("sync returns missed messages and unread counts", async () => {
    const c = await TestClient.connect(server, "bob", b.identity)
    const res = await expectOk(c.request({ t: "sync", rooms: { [roomId]: 1 } } as any))
    expect(res.rooms.map((r: any) => r.roomId)).toContain(roomId)
    expect(res.messages[roomId].every((m: any) => m.seq > 1)).toBe(true)
    expect(res.unread[roomId]).toBe(res.rooms.find((r: any) => r.roomId === roomId).lastSeq)
    expect(res.users.find((u: any) => u.userId === a.userId).online).toBe(true)
    c.sendRaw({ t: "read.mark", roomId, seq: 2 })
    const read = await a.next((f) => f.t === "read")
    expect(read.userId).toBe(b.userId)
    expect(read.seq).toBe(2)
    c.close()
  })

  test("edit and delete respect authorship; owner may delete", async () => {
    const m = await expectOk(b.request({ t: "msg.send", roomId, body: "typo" } as any))
    await a.next((f) => f.t === "msg" && f.message.msgId === m.message.msgId)
    await expectErr(a.request({ t: "msg.edit", msgId: m.message.msgId, body: "x" } as any), "forbidden")
    const edited = await expectOk(b.request({ t: "msg.edit", msgId: m.message.msgId, body: "fixed" } as any))
    expect(edited.message.editedAt).toBeString()
    const upd = await a.next((f) => f.t === "msg.updated" && f.message.msgId === m.message.msgId)
    expect(upd.message.body).toBe("fixed")
    const del = await expectOk(a.request({ t: "msg.delete", msgId: m.message.msgId } as any))
    expect(del.message.deletedAt).toBeString()
    expect(del.message.body).toBe("")
    await expectErr(b.request({ t: "msg.edit", msgId: m.message.msgId, body: "again" } as any), "forbidden")
  })

  test("reactions toggle and broadcast once", async () => {
    const m = await expectOk(a.request({ t: "msg.send", roomId, body: "react to me" } as any))
    await b.next((f) => f.t === "msg" && f.message.msgId === m.message.msgId)
    await expectOk(b.request({ t: "msg.react", msgId: m.message.msgId, emoji: "🔥", on: true } as any))
    const r = await a.next((f) => f.t === "reaction")
    expect(r).toMatchObject({ msgId: m.message.msgId, userId: b.userId, emoji: "🔥", on: true })
    await expectOk(b.request({ t: "msg.react", msgId: m.message.msgId, emoji: "🔥", on: true } as any))
    await a.none((f) => f.t === "reaction")
    const hist = await expectOk(a.request({ t: "msg.history", roomId, limit: 1 } as any))
    expect(hist.messages[0].reactions).toEqual({ "🔥": [b.userId] })
  })

  test("history pages backwards", async () => {
    const all = await expectOk(a.request({ t: "msg.history", roomId, limit: 200 } as any))
    const total = all.messages.length
    expect(all.hasMore).toBe(false)
    const page = await expectOk(a.request({ t: "msg.history", roomId, limit: 2 } as any))
    expect(page.messages).toHaveLength(2)
    expect(page.hasMore).toBe(true)
    const older = await expectOk(a.request({ t: "msg.history", roomId, beforeSeq: page.messages[0].seq, limit: 200 } as any))
    expect(older.messages.length + 2).toBe(total)
  })

  test("roll and poll kinds are validated and enriched", async () => {
    const roll = await expectOk(a.request({ t: "msg.send", roomId, body: "2d6+1", kind: "roll" } as any))
    expect(roll.message.meta.rolls).toHaveLength(2)
    expect(roll.message.meta.total).toBeGreaterThanOrEqual(3)
    await expectErr(a.request({ t: "msg.send", roomId, body: "99d99", kind: "roll" } as any), "invalid")
    await expectErr(a.request({ t: "msg.send", roomId, body: "dinner?", kind: "poll", meta: { options: ["a"] } } as any), "invalid")
    const poll = await expectOk(a.request({ t: "msg.send", roomId, body: "dinner?", kind: "poll", meta: { options: ["ramen", "pizza"] } } as any))
    expect(poll.message.meta).toEqual({ question: "dinner?", options: ["ramen", "pizza"] })
    await b.next((f) => f.t === "msg" && f.message.kind === "poll")
  })

  test("size and content limits", async () => {
    await expectErr(a.request({ t: "msg.send", roomId, body: "x".repeat(65) } as any), "too_large")
    await expectErr(a.request({ t: "msg.send", roomId, body: "   " } as any), "invalid")
    await expectErr(a.request({ t: "msg.send", roomId, body: "x", replyTo: "nope" } as any), "invalid")
  })

  test("typing is throttled and excludes the sender", async () => {
    a.sendRaw({ t: "typing", roomId })
    a.sendRaw({ t: "typing", roomId })
    const t = await b.next((f) => f.t === "typing")
    expect(t.userId).toBe(a.userId)
    await b.none((f) => f.t === "typing")
    await a.none((f) => f.t === "typing")
  })

  test("room is full at the member limit", async () => {
    const c = await TestClient.connect(server, "carol")
    await expectOk(c.request({ t: "room.join", invite } as any))
    const d = await TestClient.connect(server, "dave")
    await expectErr(d.request({ t: "room.join", invite } as any), "limit_reached")
    await expectOk(a.request({ t: "room.kick", roomId, userId: c.userId } as any))
    const removed = await c.next((f) => f.t === "room.removed")
    expect(removed.reason).toBe("kicked")
    await expectErr(c.request({ t: "msg.send", roomId, body: "still here?" } as any), "not_found")
    c.close()
    d.close()
  })

  test("owner permissions: update, invite reset, transfer, leave", async () => {
    await expectErr(b.request({ t: "room.update", roomId, name: "nope" } as any), "forbidden")
    const upd = await expectOk(a.request({ t: "room.update", roomId, name: "renamed" } as any))
    expect(upd.room.name).toBe("renamed")
    const reset = await expectOk(a.request({ t: "room.invite.reset", roomId } as any))
    expect(reset.room.invite).not.toBe(invite)
    invite = reset.room.invite
    await expectErr(a.request({ t: "room.leave", roomId } as any), "forbidden")
    await expectOk(a.request({ t: "room.transfer", roomId, userId: b.userId } as any))
    await expectOk(a.request({ t: "room.leave", roomId } as any))
    const gone = await a.next((f) => f.t === "room.removed")
    expect(gone.reason).toBe("left")
    const ev = await b.next((f) => f.t === "room.member" && f.event === "left")
    expect(ev.user.userId).toBe(a.userId)
  })

  test("dm requires a shared group", async () => {
    const e = await TestClient.connect(server, "eve")
    await expectErr(e.request({ t: "dm.open", userId: b.userId } as any), "forbidden")
    await expectOk(e.request({ t: "room.join", invite } as any))
    const dm = await expectOk(e.request({ t: "dm.open", userId: b.userId } as any))
    expect(dm.room.kind).toBe("dm")
    expect(dm.room.invite).toBeUndefined()
    const seen = await b.next((f) => f.t === "room" && f.room.kind === "dm")
    expect(seen.room.roomId).toBe(dm.room.roomId)
    const again = await expectOk(e.request({ t: "dm.open", userId: b.userId } as any))
    expect(again.room.roomId).toBe(dm.room.roomId)
    await expectOk(e.request({ t: "msg.send", roomId: dm.room.roomId, body: "psst" } as any))
    const got = await b.next((f) => f.t === "msg" && f.message.body === "psst")
    expect(got.message.roomId).toBe(dm.room.roomId)
    await expectErr(e.request({ t: "room.leave", roomId: dm.room.roomId } as any), "forbidden")
    e.close()
  })

  test("delete room removes everyone", async () => {
    const res = await expectOk(b.request({ t: "room.create", name: "temp" } as any))
    const c = await TestClient.connect(server, "carol")
    await expectOk(c.request({ t: "room.join", invite: res.room.invite } as any))
    await expectOk(b.request({ t: "room.delete", roomId: res.room.roomId } as any))
    const gone = await c.next((f) => f.t === "room.removed")
    expect(gone.reason).toBe("deleted")
    await expectErr(c.request({ t: "msg.history", roomId: res.room.roomId } as any), "not_found")
    c.close()
  })
})

describe("files", () => {
  test("upload, attach, download with session; limits enforced", async () => {
    const a = await TestClient.connect(server, "alice")
    const b = await TestClient.connect(server, "bob")
    const room = (await expectOk(a.request({ t: "room.create", name: "pics" } as any))).room
    await expectOk(b.request({ t: "room.join", invite: room.invite } as any))
    const data = Buffer.alloc(512, 1).toString("base64")
    const up = await expectOk(a.request({ t: "file.upload", roomId: room.roomId, name: "a.bin", mime: "application/octet-stream", dataB64: data } as any))
    expect(up.attachment.size).toBe(512)
    await expectErr(b.request({ t: "msg.send", roomId: room.roomId, body: "", attachments: [up.attachment.fileId] } as any), "invalid")
    const msg = await expectOk(a.request({ t: "msg.send", roomId: room.roomId, body: "", attachments: [up.attachment.fileId] } as any))
    expect(msg.message.attachments[0].fileId).toBe(up.attachment.fileId)
    await expectErr(a.request({ t: "msg.send", roomId: room.roomId, body: "", attachments: [up.attachment.fileId] } as any), "invalid")

    const url = `${server.url}/files/${up.attachment.fileId}`
    expect((await fetch(url)).status).toBe(401)
    const okRes = await fetch(url, { headers: { authorization: `Bearer ${b.session}` } })
    expect(okRes.status).toBe(200)
    expect((await okRes.arrayBuffer()).byteLength).toBe(512)
    const stranger = await TestClient.connect(server, "zed")
    expect((await fetch(url, { headers: { authorization: `Bearer ${stranger.session}` } })).status).toBe(404)

    await expectErr(a.request({ t: "file.upload", roomId: room.roomId, name: "big", mime: "x/y", dataB64: Buffer.alloc(1025, 1).toString("base64") } as any), "too_large")
    await expectOk(a.request({ t: "file.upload", roomId: room.roomId, name: "b", mime: "x/y", dataB64: Buffer.alloc(1000, 1).toString("base64") } as any))
    await expectErr(a.request({ t: "file.upload", roomId: room.roomId, name: "c", mime: "x/y", dataB64: Buffer.alloc(100, 1).toString("base64") } as any), "limit_reached")
    a.close()
    b.close()
    stranger.close()
  })
})

describe("presence and rate limits", () => {
  test("offline is broadcast when the last socket closes", async () => {
    const a = await TestClient.connect(server, "alice")
    const b = await TestClient.connect(server, "bob")
    const room = (await expectOk(a.request({ t: "room.create", name: "p" } as any))).room
    await expectOk(b.request({ t: "room.join", invite: room.invite } as any))
    await expectOk(a.request({ t: "sync", rooms: {} } as any))
    const b2 = await TestClient.connect(server, "bob", b.identity)
    b.close()
    await a.none((f) => f.t === "presence" && f.user.userId === b.userId && f.user.online === false)
    b2.close()
    const off = await a.next((f) => f.t === "presence" && f.user.userId === b.userId && f.user.online === false)
    expect(off.user.name).toBe("bob")
    a.close()
  })

  test("status changes are broadcast", async () => {
    const a = await TestClient.connect(server, "alice")
    const b = await TestClient.connect(server, "bob")
    const room = (await expectOk(a.request({ t: "room.create", name: "s" } as any))).room
    await expectOk(b.request({ t: "room.join", invite: room.invite } as any))
    await expectOk(a.request({ t: "sync", rooms: {} } as any))
    await expectOk(b.request({ t: "presence.set", statusText: "vibing", statusEmoji: "🎧" } as any))
    const p = await a.next((f) => f.t === "presence" && f.user.userId === b.userId && f.user.statusText === "vibing")
    expect(p.user.statusEmoji).toBe("🎧")
    a.close()
    b.close()
  })

  test("message bucket limits bursts", async () => {
    const a = await TestClient.connect(server, "alice")
    const room = (await expectOk(a.request({ t: "room.create", name: "r" } as any))).room
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => a.request({ t: "msg.send", roomId: room.roomId, body: `m${i}` } as any)))
    const limited = results.filter((r) => r.t === "err" && r.code === "rate_limited")
    expect(limited.length).toBe(2)
    expect(limited[0]!.retryAfterMs).toBeGreaterThan(0)
    a.close()
  })

  test("ping gets pong", async () => {
    const a = await TestClient.connect(server, "alice")
    a.sendRaw({ t: "ping" })
    await a.next((f) => f.t === "pong")
    a.close()
  })
})
