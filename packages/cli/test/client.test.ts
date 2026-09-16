import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startServer, type RunningServer } from "@vibechat/server"
import { Client } from "../src/client.ts"
import { loadConfig } from "../src/config.ts"
import { createIdentity, loadIdentity } from "../src/identity.ts"

let server: RunningServer
let dir: string
let host: string

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "vibechat-cli-"))
  server = await startServer({ port: 0, dataDir: join(dir, "server"), quiet: true })
  host = `127.0.0.1:${server.port}`
})
afterAll(async () => {
  await server.stop()
  rmSync(dir, { recursive: true, force: true })
})

async function client(name: string): Promise<Client> {
  const cfg = join(dir, name)
  const identity = await createIdentity(name, undefined, cfg)
  return new Client({ identity, config: await loadConfig(cfg), configDir: cfg })
}

describe("identity files", () => {
  test("create, load, permissions", async () => {
    const cfg = join(dir, "idtest")
    expect(await loadIdentity(cfg)).toBeUndefined()
    const id = await createIdentity("hu", "🦊", cfg)
    const back = await loadIdentity(cfg)
    expect(back).toEqual(id)
    if (process.platform !== "win32") {
      const mode = (await import("node:fs")).statSync(join(cfg, "identity.json")).mode & 0o777
      expect(mode).toBe(0o600)
    }
  })
})

describe("Client against a real server", () => {
  test("create, join, send, receive, reconnect-resync, persist hosts", async () => {
    const a = await client("alice")
    const b = await client("bob")
    const room = await a.createRoom(host, "late night", "🌙")
    expect(room.invite).toBeString()
    expect(a.config.hosts).toEqual([host])
    expect(a.config.defaultHost).toBe(host)
    expect((await loadConfig(join(dir, "alice"))).hosts).toEqual([host])

    await b.joinRoom(host, room.invite!)
    expect(b.model.titleOf(room.roomId)).toBe("late night")
    expect(b.model.room(room.roomId)!.members.size).toBe(2)

    const received = new Promise<string>((resolve) => b.model.on((e) => e.type === "message" && !e.own && resolve(e.message.body)))
    const sent = await a.send(room.roomId, "hello")
    expect(sent.seq).toBeGreaterThan(0)
    expect(a.model.room(room.roomId)!.messages.every((m) => m.seq > 0)).toBe(true)
    expect(await received).toBe("hello")
    expect(b.model.room(room.roomId)!.unread).toBe(1)
    b.markRead(room.roomId)
    expect(b.model.room(room.roomId)!.unread).toBe(0)

    // bob drops and comes back: the sync cursor makes the resync incremental
    const bConn = b.connections.get(host)!
    const before = bConn.cursors.get(room.roomId)
    await a.send(room.roomId, "while you were away")
    b.close()
    const fresh = new Client({ identity: b.identity, config: b.config, configDir: join(dir, "bob") })
    await fresh.connect(host)
    const msgs = fresh.model.room(room.roomId)!.messages.map((m) => m.body)
    expect(msgs).toContain("while you were away")
    expect(before).toBeGreaterThan(0)

    const roll = await a.send(room.roomId, "2d6", { kind: "roll" })
    expect((roll.meta as { rolls: number[] }).rolls).toHaveLength(2)

    const dm = await a.openDm(room.roomId, b.identity.publicKey)
    expect(dm.kind).toBe("dm")
    expect(a.model.titleOf(dm.roomId)).toBe("bob")
    expect(a.model.room(dm.roomId)!.members.size).toBe(2)
    // the other side learns the DM from a `room` event and hydrates members itself
    await new Promise((r) => setTimeout(r, 200))
    expect(fresh.model.titleOf(dm.roomId)).toBe("alice")
    a.close()
    fresh.close()
  })

  test("room management, profile and upload", async () => {
    const a = await client("owner")
    const b = await client("guest")
    const room = await a.createRoom(host, "managed")
    await b.joinRoom(host, room.invite!)
    await a.renameRoom(room.roomId, "renamed")
    await new Promise((r) => setTimeout(r, 150))
    expect(a.model.room(room.roomId)!.room.name).toBe("renamed")
    const token = await a.resetInvite(room.roomId)
    expect(token).not.toBe(room.invite)
    await a.setProfile({ name: "boss", emoji: "👑" })
    await new Promise((r) => setTimeout(r, 150))
    expect(b.model.nameOf(a.identity.publicKey)).toBe("boss")
    expect((await loadIdentity(join(dir, "owner")))!.name).toBe("boss")
    const png = join(dir, "pic.png")
    await Bun.write(png, new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]))
    const att = await a.upload(room.roomId, png)
    expect(att.mime).toBe("image/png")
    const sent = await a.send(room.roomId, "", { attachments: [att.fileId] })
    expect(sent.attachments[0]!.fileId).toBe(att.fileId)
    const ref = a.fileUrl(room.roomId, att.fileId)!
    expect((await fetch(ref.url, { headers: { authorization: `Bearer ${ref.session}` } })).status).toBe(200)
    await expect(b.kick(room.roomId, a.identity.publicKey)).rejects.toThrow()
    await a.transfer(room.roomId, b.identity.publicKey)
    await b.kick(room.roomId, a.identity.publicKey)
    await new Promise((r) => setTimeout(r, 150))
    expect(a.model.room(room.roomId)).toBeUndefined()
    await b.deleteRoom(room.roomId)
    expect(b.model.room(room.roomId)).toBeUndefined()
    a.close()
    b.close()
  })

  test("send fails cleanly and removes the optimistic copy", async () => {
    const a = await client("amy")
    const room = await a.createRoom(host, "solo")
    await expect(a.send(room.roomId, "   ")).rejects.toThrow("message is empty")
    expect(a.model.room(room.roomId)!.messages.filter((m) => m.seq === 0)).toHaveLength(0)
    a.close()
  })
})
