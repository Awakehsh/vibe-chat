import { describe, expect, test } from "bun:test"
import type { Message, SyncResult } from "@vibechat/protocol"
import { Model, mergeMessages } from "../src/model.ts"

const me = "M".repeat(43)
const bob = "B".repeat(43)
const msg = (seq: number, authorId = bob, extra: Partial<Message> = {}): Message => ({
  msgId: `m${seq}`,
  roomId: "r1",
  seq,
  authorId,
  kind: "text",
  body: `b${seq}`,
  attachments: [],
  reactions: {},
  createdAt: new Date(seq * 1000).toISOString(),
  ...extra,
})
const sync = (over: Partial<SyncResult> = {}): SyncResult => ({
  rooms: [{ roomId: "r1", kind: "group", name: "late night", ownerId: me, createdAt: "t", lastActivityAt: "t", lastSeq: 3, invite: "7K3MQ0VZ2P" }],
  members: { r1: [{ roomId: "r1", userId: me, joinedAt: "t", lastReadSeq: 1 }, { roomId: "r1", userId: bob, joinedAt: "t", lastReadSeq: 3 }] },
  users: [
    { userId: me, name: "hu", online: true, lastSeenAt: "t" },
    { userId: bob, name: "bob", online: true, lastSeenAt: "t" },
  ],
  messages: { r1: [msg(2), msg(3)] },
  truncated: [],
  unread: { r1: 2 },
  ...over,
})

describe("a hidden author", () => {
  test("does not light the room up", () => {
    const m = new Model(me)
    m.applySync("h", sync({ unread: { r1: 0 } }))
    m.apply("h", { t: "msg", message: msg(4) })
    expect(m.room("r1")!.unread).toBe(1)

    m.isHidden = (id) => id === bob
    m.apply("h", { t: "msg", message: msg(5) })
    expect(m.room("r1")!.unread).toBe(1)

    // Your own messages never counted, and neither does anyone still visible.
    const ana = "A".repeat(43)
    m.apply("h", { t: "msg", message: msg(6, ana) })
    expect(m.room("r1")!.unread).toBe(2)
  })
})

describe("Model", () => {
  test("sync populates rooms, users, unread and hasOlder", () => {
    const m = new Model(me)
    const events: string[] = []
    m.on((e) => events.push(e.type))
    m.applySync("h", sync())
    const r = m.room("r1")!
    expect(r.host).toBe("h")
    expect(r.unread).toBe(2)
    expect(r.hasOlder).toBe(true)
    expect(m.titleOf("r1")).toBe("late night")
    expect(m.nameOf(bob)).toBe("bob")
    expect(m.nameOf("X".repeat(43))).toBe("XXXXXX")
    expect(events).toEqual(["room-added", "change", "change"])
  })

  test("re-sync merges and drops rooms the server no longer lists", () => {
    const m = new Model(me)
    m.applySync("h", sync())
    m.applySync("h", sync({ messages: { r1: [msg(4)] }, unread: { r1: 3 } }))
    expect(m.room("r1")!.messages.map((x) => x.seq)).toEqual([2, 3, 4])
    m.applySync("h", sync({ rooms: [], members: {}, messages: {}, unread: {} }))
    expect(m.room("r1")).toBeUndefined()
  })

  test("incoming message bumps unread unless own; optimistic copy is replaced", () => {
    const m = new Model(me)
    m.applySync("h", sync())
    m.addOptimistic("r1", msg(0, me, { msgId: "local:1", clientId: "c1", body: "hi" }))
    expect(m.room("r1")!.messages.at(-1)!.seq).toBe(0)
    m.apply("h", { t: "msg", message: msg(4, me, { clientId: "c1", body: "hi" }) })
    const r = m.room("r1")!
    expect(r.messages.map((x) => x.seq)).toEqual([2, 3, 4])
    expect(r.unread).toBe(2)
    m.apply("h", { t: "msg", message: msg(5) })
    expect(r.unread).toBe(3)
    expect(r.room.lastSeq).toBe(5)
    expect(m.markRead("r1")).toBe(5)
    expect(r.unread).toBe(0)
    expect(m.markRead("r1")).toBeUndefined()
  })

  test("reactions, edits, typing and presence update in place", () => {
    const m = new Model(me)
    m.applySync("h", sync())
    m.apply("h", { t: "reaction", msgId: "m2", roomId: "r1", userId: bob, emoji: "🔥", on: true })
    expect(m.room("r1")!.messages[0]!.reactions).toEqual({ "🔥": [bob] })
    m.apply("h", { t: "reaction", msgId: "m2", roomId: "r1", userId: bob, emoji: "🔥", on: false })
    expect(m.room("r1")!.messages[0]!.reactions).toEqual({})
    m.apply("h", { t: "msg.updated", message: msg(2, bob, { body: "edited", editedAt: "t" }) })
    expect(m.room("r1")!.messages[0]!.body).toBe("edited")
    m.apply("h", { t: "typing", roomId: "r1", userId: bob })
    expect(m.typingIn("r1")).toEqual([bob])
    expect(m.typingIn("r1", Date.now() + 10_000)).toEqual([])
    m.apply("h", { t: "presence", user: { userId: bob, name: "bobby", online: false, lastSeenAt: "t" } })
    expect(m.nameOf(bob)).toBe("bobby")
  })

  test("dm title is the other member; findRoom matches by title prefix", () => {
    const m = new Model(me)
    m.applySync(
      "h",
      sync({
        rooms: [{ roomId: "d1", kind: "dm", name: "dm", ownerId: me, createdAt: "t", lastActivityAt: "t", lastSeq: 0 }],
        members: { d1: [{ roomId: "d1", userId: me, joinedAt: "t", lastReadSeq: 0 }, { roomId: "d1", userId: bob, joinedAt: "t", lastReadSeq: 0 }] },
        messages: {},
        unread: {},
      }),
    )
    expect(m.titleOf("d1")).toBe("bob")
    expect(m.findRoom("#bo")?.room.roomId).toBe("d1")
    expect(m.findRoom("nope")).toBeUndefined()
  })

  test("room.removed and room events", () => {
    const m = new Model(me)
    const removed: string[] = []
    m.on((e) => e.type === "room-removed" && removed.push(e.reason))
    m.applySync("h", sync())
    m.apply("h", { t: "room", room: { roomId: "r2", kind: "group", name: "new", ownerId: me, createdAt: "t", lastActivityAt: "t", lastSeq: 0 } })
    expect(m.room("r2")).toBeDefined()
    m.apply("h", { t: "room.removed", roomId: "r1", reason: "kicked" })
    expect(m.room("r1")).toBeUndefined()
    expect(removed).toEqual(["kicked"])
  })
})

describe("mergeMessages", () => {
  test("dedupes by id, sorts by seq, keeps unconfirmed optimistic entries last", () => {
    const out = mergeMessages([msg(3), msg(0, me, { msgId: "l1", clientId: "a" }), msg(0, me, { msgId: "l2", clientId: "b" })], [msg(1), msg(3), msg(4, me, { clientId: "a" })])
    expect(out.map((m) => m.msgId)).toEqual(["m1", "m3", "m4", "l2"])
  })
})
