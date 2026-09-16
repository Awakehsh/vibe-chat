import { describe, expect, test } from "bun:test"
import { formatInvite, generateInviteToken, isInviteToken, parseInvite, socketUrlForHost } from "../src/index.ts"

describe("invite tokens", () => {
  test("generated tokens are valid and vary", () => {
    const a = generateInviteToken()
    const b = generateInviteToken()
    expect(isInviteToken(a)).toBe(true)
    expect(a).not.toBe(b)
  })

  test("parses every accepted form", () => {
    expect(parseInvite("7K3MQ0VZ2P")).toEqual({ token: "7K3MQ0VZ2P" })
    expect(parseInvite("chat.example.com/7K3MQ0VZ2P")).toEqual({ host: "chat.example.com", token: "7K3MQ0VZ2P" })
    expect(parseInvite("localhost:7788/7k3mq0vz2p")).toEqual({ host: "localhost:7788", token: "7K3MQ0VZ2P" })
    expect(parseInvite("https://chat.example.com/i/7K3MQ0VZ2P")).toEqual({ host: "chat.example.com", token: "7K3MQ0VZ2P" })
    expect(parseInvite("  http://localhost:7788/i/7K3MQ0VZ2P/  ")).toEqual({ host: "localhost:7788", token: "7K3MQ0VZ2P" })
  })

  test("rejects malformed codes", () => {
    expect(parseInvite("")).toBeUndefined()
    expect(parseInvite("7K3MQ0VZ2")).toBeUndefined()
    expect(parseInvite("7K3MQ0VZ2PI")).toBeUndefined()
    expect(parseInvite("/7K3MQ0VZ2P")).toBeUndefined()
    expect(parseInvite("a b/7K3MQ0VZ2P")).toBeUndefined()
    expect(parseInvite("host/7K3MQ0VZ2P/x")).toBeUndefined()
  })

  test("formats", () => {
    expect(formatInvite("h", "T")).toBe("h/T")
    expect(formatInvite(undefined, "T")).toBe("T")
  })

  test("socket URL scheme selection", () => {
    expect(socketUrlForHost("localhost:7788")).toBe("ws://localhost:7788/ws")
    expect(socketUrlForHost("localhost")).toBe("ws://localhost/ws")
    expect(socketUrlForHost("192.168.1.5:7788")).toBe("ws://192.168.1.5:7788/ws")
    expect(socketUrlForHost("chat.example.com")).toBe("wss://chat.example.com/ws")
    expect(socketUrlForHost("chat.example.com:8443")).toBe("wss://chat.example.com:8443/ws")
    expect(socketUrlForHost("mac.tail1234.ts.net")).toBe("wss://mac.tail1234.ts.net/ws")
    expect(socketUrlForHost("chat.example.com", { insecure: true })).toBe("ws://chat.example.com/ws")
  })
})
