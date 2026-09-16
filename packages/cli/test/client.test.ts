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
    a.close()
    fresh.close()
  })

  test("send fails cleanly and removes the optimistic copy", async () => {
    const a = await client("amy")
    const room = await a.createRoom(host, "solo")
    await expect(a.send(room.roomId, "   ")).rejects.toThrow("message is empty")
    expect(a.model.room(room.roomId)!.messages.filter((m) => m.seq === 0)).toHaveLength(0)
    a.close()
  })
})
