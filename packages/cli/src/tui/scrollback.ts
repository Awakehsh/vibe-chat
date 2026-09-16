/**
 * Everything that is printed into the terminal's own scrollback: messages,
 * the welcome header, room dividers and command output. Once printed, a
 * line is never redrawn, the same way an agent CLI's transcript works.
 * Later changes (reactions, edits, deletions) are printed as new lines.
 */
import { BoxRenderable, StyledText, TextRenderable, bg, bold, fg, stringToStyledText, type CliRenderer, type TextChunk } from "@opentui/core"
import type { Message, PollMeta, RollMeta } from "@vibechat/protocol"
import type { Model } from "../model.ts"
import { CAT_FRAMES } from "./Cat.tsx"
import { clip, humanSize, pollLines, reactionLine, rollLine } from "./format.ts"
import { spriteCells } from "./Sprite.tsx"
import { glyph, theme } from "./theme.ts"

export type Line = TextChunk[]

/** Same author, same kind, within this window: the name is shown once. */
const RUN_WINDOW_MS = 3 * 60 * 1000
const INDENT = "  "

const plain = (s: string): TextChunk[] => stringToStyledText(s).chunks
const col = (color: string, s: string): TextChunk => fg(color)(s)
const colb = (color: string, s: string): TextChunk => fg(color)(bold(s))

export function textOf(line: Line): string {
  return line.map((c) => c.text).join("")
}

export function displayWidth(s: string): number {
  return Bun.stringWidth(s)
}

/** Word wrap that counts CJK as two columns and hard-breaks words longer than the width. */
export function wrap(text: string, max: number): string[] {
  const out: string[] = []
  const limit = Math.max(1, max)
  for (const para of text.split("\n")) {
    let line = ""
    let lineW = 0
    let lastSpace = -1
    for (const ch of Array.from(para)) {
      const w = displayWidth(ch)
      if (lineW + w > limit) {
        if (lastSpace > 0 && ch !== " ") {
          out.push(line.slice(0, lastSpace).trimEnd())
          line = line.slice(lastSpace + 1) + ch
        } else {
          out.push(line)
          line = ch === " " ? "" : ch
        }
        lineW = displayWidth(line)
        lastSpace = line.lastIndexOf(" ")
        continue
      }
      line += ch
      lineW += w
      if (ch === " ") lastSpace = line.length - 1
    }
    out.push(line)
  }
  return out
}

const MENTION = /(@[\p{L}\p{N}_]+)/u

/** Body text with @mentions highlighted; `color` is the base colour. */
function bodyChunks(text: string, color: string, selfName: string): TextChunk[] {
  return text.split(MENTION).filter(Boolean).map((part) => {
    if (part.startsWith("@")) {
      const me = part.slice(1).toLowerCase() === selfName.toLowerCase()
      return me ? colb(theme.accent, part) : colb(theme.name, part)
    }
    return col(color, part)
  })
}

/** Wrap a body under a prefix; continuation lines are indented. */
function bodyLines(prefix: Line, prefixWidth: number, body: string, width: number, color: string, selfName: string): Line[] {
  const wrapped = wrap(body, width - Math.max(prefixWidth, INDENT.length))
  return wrapped.map((text, i) => (i === 0 ? [...prefix, ...bodyChunks(text, color, selfName)] : [...plain(INDENT), ...bodyChunks(text, color, selfName)]))
}

export interface MessageContext {
  model: Model
  selfId: string
  selfName: string
  width: number
  /** The message printed just before this one, for run grouping. */
  prev?: Message | undefined
}

function sameRun(prev: Message | undefined, m: Message): boolean {
  if (!prev || m.kind !== "text" || prev.kind !== "text") return false
  if (prev.authorId !== m.authorId || m.replyTo || prev.deletedAt) return false
  return new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < RUN_WINDOW_MS
}

export function messageLines(m: Message, ctx: MessageContext): Line[] {
  const { model, selfId, selfName, width } = ctx
  const own = m.authorId === selfId
  const name = model.nameOf(m.authorId)
  const lines: Line[] = []

  if (m.kind === "system") return [[col(theme.system, `${glyph.result}  ${m.body}`)]]

  if (m.replyTo) {
    const target = model.room(m.roomId)?.messages.find((x) => x.msgId === m.replyTo)
    if (target) lines.push([col(theme.dim, `${INDENT}↩ ${model.nameOf(target.authorId)}: ${clip(target.deletedAt ? "(deleted)" : target.body, Math.max(10, width - 12))}`)])
  }

  if (m.deletedAt) {
    lines.push(own ? [col(theme.dim, `${glyph.self} (deleted)`)] : [col(theme.other, `${glyph.other} `), colb(theme.dim, name), col(theme.dim, ": (deleted)")])
    return lines
  }

  const suffix = m.editedAt ? " (edited)" : ""
  switch (m.kind) {
    case "me":
      lines.push(...bodyLines([col(theme.accent, `${glyph.me} `), colb(theme.name, name), plain(" ")[0]!], 3 + displayWidth(name), m.body + suffix, width, theme.self, selfName))
      break
    case "roll": {
      const meta = m.meta as RollMeta | undefined
      lines.push([col(theme.other, `${glyph.other} `), colb(theme.name, "Roll"), col(theme.dim, `(${m.body}) · ${own ? "you" : name}`)])
      lines.push([col(theme.self, `${INDENT}${glyph.result}  ${meta ? rollLine(meta) : "rolling…"}`)])
      break
    }
    case "poll": {
      const meta = m.meta as PollMeta | undefined
      lines.push([col(theme.other, `${glyph.other} `), colb(theme.name, "Poll"), col(theme.dim, `("${meta?.question ?? m.body}") · ${own ? "you" : name}`)])
      const opts = meta ? pollLines(meta, m.reactions) : []
      opts.forEach((o, i) => lines.push([col(theme.self, `${INDENT}${i === 0 ? glyph.result : " "}  ${o}`)]))
      lines.push([col(theme.dim, `${INDENT}   /vote <n>`)])
      break
    }
    case "sticker": {
      const text = (m.meta as { text?: string } | undefined)?.text ?? m.body
      lines.push([...authorPrefix(own, name), colb(theme.accent, text), col(theme.dim, " (sticker)")])
      break
    }
    default: {
      if (own) lines.push(...bodyLines([col(theme.self, `${glyph.self} `)], 2, m.body + suffix, width, theme.self, selfName))
      else if (sameRun(ctx.prev, m)) lines.push(...bodyLines(plain(INDENT), 2, m.body + suffix, width, theme.name, selfName))
      else lines.push(...bodyLines(authorPrefix(false, name), 4 + displayWidth(name), m.body + suffix, width, theme.name, selfName))
    }
  }

  for (const a of m.attachments) lines.push([col(theme.dim, `${INDENT}📎 ${a.name} (${humanSize(a.size)})`)])
  if (m.kind !== "poll") {
    const r = reactionLine(m.reactions)
    if (r) lines.push([col(theme.reaction, `${INDENT}${r}`)])
  }
  return lines
}

function authorPrefix(own: boolean, name: string): Line {
  return own ? [col(theme.self, `${glyph.self} `)] : [col(theme.other, `${glyph.other} `), colb(theme.name, name), col(theme.dim, ": ")]
}

export function reactionLines(model: Model, target: Message, userId: string, emoji: string, width: number): Line[] {
  return [[col(theme.dim, `${INDENT}${glyph.result}  ${model.nameOf(userId)} ${emoji} → "${clip(target.body || target.kind, Math.max(10, width - 20))}"`)]]
}

export function editedLines(model: Model, m: Message, width: number): Line[] {
  if (m.deletedAt) return [[col(theme.dim, `${INDENT}${glyph.result}  ${model.nameOf(m.authorId)} deleted a message`)]]
  return [[col(theme.dim, `${INDENT}${glyph.result}  ${model.nameOf(m.authorId)} edited: "${clip(m.body, Math.max(10, width - 24))}"`)]]
}

export function dividerLines(title: string, detail: string, width: number): Line[] {
  const label = ` #${title} · ${detail} `
  const rule = "─".repeat(Math.max(0, width - displayWidth(label) - 3))
  return [[col(theme.dim, "── "), colb(theme.name, `#${title}`), col(theme.dim, ` · ${detail} ${rule}`)]]
}

/** Command output in the shape of a tool call: `⏺ /help` then `⎿` lines. */
export function commandLines(command: string, output: string[], width: number): Line[] {
  const lines: Line[] = [[col(theme.other, `${glyph.other} `), colb(theme.name, command)]]
  output.forEach((o, i) => {
    for (const w of wrap(o, width - 5)) lines.push([col(theme.self, `${INDENT}${i === 0 && w === wrap(o, width - 5)[0] ? glyph.result : " "}  ${w}`)])
  })
  return lines
}

export function headerLines(version: string, name: string, detail: string): Line[] {
  const cells = spriteCells(CAT_FRAMES.open)
  const text: Line[] = [
    [],
    [colb(theme.name, "vibechat"), col(theme.dim, ` v${version}`)],
    [col(theme.self, name), col(theme.dim, " · a chat that looks like work")],
    [col(theme.dim, detail)],
  ]
  const lines: Line[] = cells.map((row, i) => {
    const sprite: TextChunk[] = row.map((c) => {
      if (c.bg) return bg(c.bg)(fg(c.fg ?? c.bg)(c.ch))
      if (c.fg) return col(c.fg, c.ch)
      return plain(c.ch)[0]!
    })
    return [...plain(" "), ...sprite, ...plain("   "), ...(text[i] ?? [])]
  })
  lines.push([])
  return lines
}

let seq = 0

/** Prints lines into the scrollback above the live region. Returns how many rows were used. */
export function commit(renderer: CliRenderer, lines: Line[]): number {
  if (lines.length === 0) return 0
  renderer.writeToScrollback((ctx) => {
    const root = new BoxRenderable(ctx.renderContext, {
      id: `sb-${seq++}`,
      position: "absolute",
      left: 0,
      top: 0,
      width: ctx.width,
      height: lines.length,
      backgroundColor: "transparent",
    })
    lines.forEach((line, i) => {
      root.add(
        new TextRenderable(ctx.renderContext, {
          id: `sb-${seq++}`,
          position: "absolute",
          left: 0,
          top: i,
          width: ctx.width,
          height: 1,
          wrapMode: "none",
          content: line.length ? new StyledText(line) : " ",
        }),
      )
    })
    return { root, width: ctx.width, height: lines.length, trailingNewline: true }
  })
  return lines.length
}
