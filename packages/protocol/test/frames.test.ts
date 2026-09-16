import { describe, expect, test } from "bun:test"
import { parseClientFrame } from "../src/index.ts"

const pubkey = "A".repeat(43)

describe("parseClientFrame", () => {
  test("accepts a valid auth frame", () => {
    const r = parseClientFrame(JSON.stringify({ t: "auth", id: "1", userId: pubkey, name: "hu", sig: "abc" }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.frame.t).toBe("auth")
  })

  test("rejects unknown fields", () => {
    const r = parseClientFrame(JSON.stringify({ t: "ping", extra: 1 }))
    expect(r.ok).toBe(false)
  })

  test("rejects unknown type", () => {
    const r = parseClientFrame(JSON.stringify({ t: "nope", id: "1" }))
    expect(r.ok).toBe(false)
  })

  test("rejects non-JSON", () => {
    const r = parseClientFrame("{")
    expect(r).toEqual({ ok: false, message: "frame is not valid JSON" })
  })

  test("trims and bounds names", () => {
    const ok = parseClientFrame(JSON.stringify({ t: "room.create", id: "1", name: "  late night  " }))
    expect(ok.ok && ok.frame.t === "room.create" && ok.frame.name).toBe("late night")
    const long = parseClientFrame(JSON.stringify({ t: "room.create", id: "1", name: "x".repeat(33) }))
    expect(long.ok).toBe(false)
  })

  test("fire-and-forget frames need no id", () => {
    expect(parseClientFrame(JSON.stringify({ t: "typing", roomId: "r1" })).ok).toBe(true)
    expect(parseClientFrame(JSON.stringify({ t: "read.mark", roomId: "r1", seq: 3 })).ok).toBe(true)
    expect(parseClientFrame(JSON.stringify({ t: "ping" })).ok).toBe(true)
  })

  test("requests need an id", () => {
    expect(parseClientFrame(JSON.stringify({ t: "sync", rooms: {} })).ok).toBe(false)
  })
})
