import { describe, expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { createRoot } from "@opentui/react"
import type { Message } from "@vibechat/protocol"
import { Model } from "../src/model.ts"
import { MessageRow } from "../src/tui/MessageRow.tsx"
import { completions, parseCommand, parsePoll, parseStatus } from "../src/tui/commands.ts"
import { pollLines, rollLine } from "../src/tui/format.ts"

const me = "M".repeat(43)
const bob = "B".repeat(43)

function model(): Model {
  const m = new Model(me)
  m.users.set(bob, { userId: bob, name: "bob", online: true, lastSeenAt: "t" })
  return m
}

const msg = (over: Partial<Message>): Message => ({
  msgId: "m1",
  roomId: "r1",
  seq: 1,
  authorId: bob,
  kind: "text",
  body: "hello",
  attachments: [],
  reactions: {},
  createdAt: "t",
  ...over,
})

async function render(node: React.ReactNode, width = 60): Promise<string> {
  const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({ width, height: 12 })
  createRoot(renderer).render(node)
  await renderOnce()
  await Bun.sleep(30)
  await renderOnce()
  const out = captureCharFrame()
  renderer.destroy()
  return out
    .split("\n")
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .join("\n")
}

describe("MessageRow", () => {
  test("someone else's text", async () => {
    const out = await render(<MessageRow model={model()} message={msg({})} selfId={me} />)
    expect(out).toBe("⏺ bob: hello")
  })

  test("own text uses the prompt glyph", async () => {
    const out = await render(<MessageRow model={model()} message={msg({ authorId: me, body: "on it" })} selfId={me} />)
    expect(out).toBe("> on it")
  })

  test("system, deleted, edited, reply and reactions", async () => {
    const m = model()
    const sys = await render(<MessageRow model={m} message={msg({ kind: "system", authorId: "", body: "bob joined" })} selfId={me} />)
    expect(sys).toBe("⎿  bob joined")
    const del = await render(<MessageRow model={m} message={msg({ deletedAt: "t", body: "" })} selfId={me} />)
    expect(del).toBe("⏺ bob: (deleted)")
    const edited = await render(<MessageRow model={m} message={msg({ editedAt: "t", reactions: { "🔥": [me, bob] } })} selfId={me} />)
    expect(edited).toBe("⏺ bob: hello (edited)\n  🔥 2")
  })

  test("roll and poll render as tool calls", async () => {
    const roll = await render(<MessageRow model={model()} message={msg({ kind: "roll", body: "2d6+1", meta: { notation: "2d6+1", rolls: [3, 4], total: 8 } })} selfId={me} />)
    expect(roll).toBe("⏺ Roll(2d6+1) · bob\n  ⎿  [3, 4] + 1 = 8")
    const poll = await render(
      <MessageRow model={model()} message={msg({ kind: "poll", body: "dinner?", meta: { question: "dinner?", options: ["ramen", "pizza"] }, reactions: { "2️⃣": [me] } })} selfId={me} />,
    )
    expect(poll).toBe('⏺ Poll("dinner?") · bob\n  ⎿  1. ramen\n     2. pizza  (1)\n     /vote <n>')
  })
})

describe("pure helpers", () => {
  test("rollLine", () => {
    expect(rollLine({ notation: "2d6+1", rolls: [3, 4], total: 8 })).toBe("[3, 4] + 1 = 8")
    expect(rollLine({ notation: "1d20", rolls: [17], total: 17 })).toBe("17")
    expect(rollLine({ notation: "3d6-2", rolls: [1, 2, 3], total: 4 })).toBe("[1, 2, 3] - 2 = 4")
  })
  test("pollLines", () => {
    expect(pollLines({ question: "q", options: ["a", "b"] }, { "1️⃣": [me, bob] })).toEqual(["1. a  (2)", "2. b"])
  })
  test("commands", () => {
    expect(parseCommand("/roll 2d6")).toEqual({ name: "roll", rest: "2d6" })
    expect(parseCommand("/help")).toEqual({ name: "help", rest: "" })
    expect(parseCommand("hello /world")).toBeUndefined()
    expect(completions("/ro").map((c) => c.name)).toEqual(["rooms", "room", "roll"])
    expect(completions("/roll 2d6")).toEqual([])
    expect(parsePoll("dinner? | ramen | pizza")).toEqual({ question: "dinner?", options: ["ramen", "pizza"] })
    expect(typeof parsePoll("dinner? | ramen")).toBe("string")
    expect(parseStatus("vibing 🎧")).toEqual({ text: "vibing", emoji: "🎧" })
    expect(parseStatus("deep work")).toEqual({ text: "deep work" })
  })
})
