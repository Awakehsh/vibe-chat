import { describe, expect, test } from "bun:test"
import type { Message } from "@vibechat/protocol"
import { Model } from "../src/model.ts"
import { completions, parseCommand, parsePoll, parseStatus } from "../src/tui/commands.ts"
import { isMention, pollLines, rollLine } from "../src/tui/format.ts"
import { bodyChunks, commandLines, dividerLines, editedLines, gapLines, hasBlockMarkdown, headerLines, isGap, messageLines, reactionLines, textOf, unreadLines, wrap } from "../src/tui/scrollback.ts"
import { colorOf, theme } from "../src/tui/theme.ts"
import { autoStatusText } from "../src/autostatus.ts"

const me = "M".repeat(43)
const bob = "B".repeat(43)

function model(): Model {
  const m = new Model(me)
  m.users.set(bob, { userId: bob, name: "bob", online: true, lastSeenAt: "t" })
  m.users.set(me, { userId: me, name: "小鹿", online: true, lastSeenAt: "t" })
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
  createdAt: "2026-09-16T10:00:00.000Z",
  ...over,
})

const lines = (m: Message, prev?: Message, width = 60) => messageLines(m, { model: model(), selfId: me, selfName: "小鹿", width, prev }).map(textOf)

/** The colour of the rail: the `⏺` or `┊` in the first column of a message. */
const rail = (m: Message, prev?: Message): string => {
  const chunk = messageLines(m, { model: model(), selfId: me, selfName: "小鹿", width: 60, prev })[0]![0]!
  const b = (chunk.fg as unknown as { buffer: Record<number, number> }).buffer
  return `#${[0, 1, 2].map((i) => b[i]!.toString(16).padStart(2, "0")).join("")}`
}

describe("mentions", () => {
  test("a CJK name is closed by the token charset, not an ASCII word boundary", () => {
    expect(isMention(msg({ body: "@小鹿 在吗" }), "小鹿")).toBe(true)
    expect(isMention(msg({ body: "hey @小鹿" }), "小鹿")).toBe(true)
    expect(isMention(msg({ body: "@小鹿鹿 在吗" }), "小鹿")).toBe(false)
    expect(isMention(msg({ body: "hey @bob" }), "bob")).toBe(true)
    expect(isMention(msg({ body: "hey @bobby" }), "bob")).toBe(false)
  })

  test("naming you puts the accent down the whole left edge", () => {
    expect(rail(msg({ body: "@小鹿 看一下" }))).toBe(theme.accent)
    expect(rail(msg({ body: "看一下" }))).toBe(colorOf(bob))
    expect(rail(msg({ authorId: me, body: "@小鹿 自言自语" }))).toBe(theme.self)
  })
})

describe("time gaps and the unread mark", () => {
  test("a gap is ten minutes of silence, not three", () => {
    const first = msg({})
    expect(isGap(first, msg({ createdAt: "2026-09-16T10:04:00.000Z" }))).toBe(false)
    expect(isGap(first, msg({ createdAt: "2026-09-16T10:11:00.000Z" }))).toBe(true)
  })

  test("the clock is centred and the unread rule fills the width", () => {
    const gap = gapLines("2026-09-16T10:00:00.000Z", 40).map(textOf)[0]!
    expect(gap.trim()).toMatch(/^· \d{2}:\d{2} ·$/)
    expect(Bun.stringWidth(gap)).toBeLessThanOrEqual(40)
    expect(gap.startsWith(" ".repeat(10))).toBe(true)
    const one = unreadLines(1, 40).map(textOf)[0]!
    expect(one.startsWith("── 1 new message ─")).toBe(true)
    expect(Bun.stringWidth(one)).toBe(40)
    expect(unreadLines(5, 40).map(textOf)[0]!.startsWith("── 5 new messages ─")).toBe(true)
  })
})

describe("identity colour", () => {
  test("is stable per key and does not follow the name", () => {
    expect(colorOf(bob)).toBe(colorOf(bob))
    expect(colorOf(bob)).not.toBe(colorOf(me))
  })

  test("two keys that picked the same name still differ", () => {
    const twin = "B".repeat(42) + "C"
    expect(colorOf(twin)).not.toBe(colorOf(bob))
  })
})

describe("message lines", () => {
  test("someone else's text carries the name; own text uses the prompt glyph", () => {
    expect(lines(msg({}))).toEqual(["⏺ bob: hello"])
    expect(lines(msg({ authorId: me, body: "on it" }))).toEqual(["> on it"])
  })

  test("a second message from the same person within three minutes drops the name but keeps their gutter", () => {
    const first = msg({})
    const second = msg({ msgId: "m2", seq: 2, body: "still here", createdAt: "2026-09-16T10:01:00.000Z" })
    expect(lines(second, first)).toEqual(["┊      still here"])
    const later = msg({ msgId: "m3", seq: 3, body: "back", createdAt: "2026-09-16T10:09:00.000Z" })
    expect(lines(later, first)).toEqual(["⏺ bob: back"])
  })

  test("wraps long bodies under the author's gutter and counts CJK as two columns", () => {
    const out = lines(msg({ body: "这是一条很长的中文消息用来测试换行是否正确处理全角字符的宽度看看会不会错位" }), undefined, 30)
    expect(out.length).toBeGreaterThan(1)
    expect(out[0]).toMatch(/^⏺ bob: /)
    for (const l of out.slice(1)) expect(l).toMatch(/^┊ {6}\S/)
    for (const l of out) expect(Bun.stringWidth(l)).toBeLessThanOrEqual(30)
  })

  test("system, deleted, edited, reply, attachments and reactions", () => {
    expect(lines(msg({ kind: "system", authorId: "", body: "bob joined" }))).toEqual(["⎿  bob joined"])
    expect(lines(msg({ deletedAt: "t", body: "" }))).toEqual(["⏺ bob: (deleted)"])
    expect(lines(msg({ editedAt: "t" }))).toEqual(["⏺ bob: hello (edited)"])
    expect(lines(msg({ attachments: [{ fileId: "f", name: "a.png", mime: "image/png", size: 2048 }], reactions: { "🔥": [me, bob] } }))).toEqual(["⏺ bob: hello", "┊      📎 a.png (2 KB)", "┊      🔥 2"])
  })

  test("roll and poll render as tool calls", () => {
    expect(lines(msg({ kind: "roll", body: "2d6+1", meta: { notation: "2d6+1", rolls: [3, 4], total: 8 } }))).toEqual(["⏺ Roll(2d6+1) · bob", "  ⎿  [3, 4] + 1 = 8"])
    expect(lines(msg({ kind: "poll", body: "dinner?", meta: { question: "dinner?", options: ["ramen", "pizza"] }, reactions: { "2️⃣": [me] } }))).toEqual([
      '⏺ Poll("dinner?") · bob',
      "  ⎿  1. ramen",
      "     2. pizza  (1)",
      "     /vote <n>",
    ])
  })

  test("event lines, divider, command output and header", () => {
    const m = model()
    expect(reactionLines(m, msg({}), bob, "🔥", 60).map(textOf)).toEqual(['  ⎿  bob 🔥 → "hello"'])
    expect(editedLines(m, msg({ body: "fixed", editedAt: "t" }), 60).map(textOf)).toEqual(['  ⎿  bob edited: "fixed"'])
    expect(editedLines(m, msg({ deletedAt: "t" }), 60).map(textOf)).toEqual(["  ⎿  bob deleted a message"])
    const div = dividerLines("夜聊", "2 members · 1 online", 40).map(textOf)[0]!
    expect(div.startsWith("── #夜聊 · 2 members · 1 online ")).toBe(true)
    expect(Bun.stringWidth(div)).toBeLessThanOrEqual(40)
    expect(commandLines("/help", ["a", "b"], 60).map(textOf)).toEqual(["⏺ /help", "  ⎿  a", "     b"])
    const head = headerLines("0.1.0", "小鹿", "localhost:7788").map(textOf)
    expect(head).toHaveLength(5)
    expect(head[1]).toContain("vibechat v0.1.0")
    expect(head[2]).toContain("小鹿")
  })
})

describe("inline markdown", () => {
  test("bold, italic, code and links keep their text and drop the markers", () => {
    const chunks = bodyChunks("say **hi** to *you* with `code` and [docs](https://x.y)", "#fff", "me")
    expect(textOf(chunks)).toBe("say hi to you with  code  and docs (https://x.y)")
    expect(chunks.find((c) => c.text === "hi")?.attributes).toBeTruthy()
  })
  test("mentions inside bold still highlight", () => {
    expect(textOf(bodyChunks("**@me look**", "#fff", "me"))).toBe("@me look")
  })
  test("block markdown detection", () => {
    expect(hasBlockMarkdown("plain **bold**")).toBe(false)
    expect(hasBlockMarkdown("look:\n```ts\nlet a = 1\n```")).toBe(true)
    expect(hasBlockMarkdown("- a\n- b")).toBe(true)
    expect(hasBlockMarkdown("# title")).toBe(true)
  })
  test("auto status text", () => {
    expect(autoStatusText([])).toBe("")
    expect(autoStatusText(["Claude Code", "Codex"])).toBe("busy with Claude Code + Codex")
  })
})

describe("pure helpers", () => {
  test("wrap", () => {
    expect(wrap("the quick brown fox", 10)).toEqual(["the quick", "brown fox"])
    expect(wrap("abcdefghijkl", 5)).toEqual(["abcde", "fghij", "kl"])
    expect(wrap("a\nb", 5)).toEqual(["a", "b"])
  })
  test("rollLine", () => {
    expect(rollLine({ notation: "2d6+1", rolls: [3, 4], total: 8 })).toBe("[3, 4] + 1 = 8")
    expect(rollLine({ notation: "1d20", rolls: [17], total: 17 })).toBe("17")
  })
  test("pollLines", () => {
    expect(pollLines({ question: "q", options: ["a", "b"] }, { "1️⃣": [me, bob] })).toEqual(["1. a  (2)", "2. b"])
  })
  test("commands", () => {
    expect(parseCommand("/roll 2d6")).toEqual({ name: "roll", rest: "2d6" })
    expect(parseCommand("hello /world")).toBeUndefined()
    expect(completions("/ro").map((c) => c.name)).toEqual(["rooms", "room", "roll"])
    expect(parsePoll("dinner? | ramen | pizza")).toEqual({ question: "dinner?", options: ["ramen", "pizza"] })
    expect(parseStatus("vibing 🎧")).toEqual({ text: "vibing", emoji: "🎧" })
  })
})
