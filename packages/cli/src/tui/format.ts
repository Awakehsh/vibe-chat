import type { Message, PollMeta, RollMeta } from "@vibechat/protocol"

export const POLL_DIGITS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"]

export function rollLine(meta: RollMeta): string {
  const mod = /([+-]\d+)$/.exec(meta.notation)?.[1]
  const dice = `[${meta.rolls.join(", ")}]`
  return mod ? `${dice} ${mod.startsWith("+") ? "+" : "-"} ${mod.slice(1)} = ${meta.total}` : meta.rolls.length > 1 ? `${dice} = ${meta.total}` : `${meta.total}`
}

export function pollLines(meta: PollMeta, reactions: Record<string, string[]>): string[] {
  return meta.options.map((opt, i) => {
    const d = POLL_DIGITS[i]!
    const n = reactions[d]?.length ?? 0
    return `${i + 1}. ${opt}${n ? `  (${n})` : ""}`
  })
}

export function reactionLine(reactions: Record<string, string[]>): string {
  const parts = Object.entries(reactions)
    .filter(([, users]) => users.length > 0)
    .map(([emoji, users]) => `${emoji} ${users.length}`)
  return parts.join(" · ")
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, " ").trim()
  return one.length > max ? one.slice(0, max - 1) + "…" : one
}

/** `\b` is an ASCII word boundary, so it never closes a CJK name; the token charset does. */
export function isMention(m: Message, name: string): boolean {
  return new RegExp(`@${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_])`, "iu").test(m.body)
}
