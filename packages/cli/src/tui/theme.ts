/** Single palette; no themes by design (see docs/decisions.md D7). */
export const theme = {
  accent: "#d97757",
  self: "#c8c8c8",
  other: "#5fafff",
  name: "#ffffff",
  dim: "#6c6c6c",
  system: "#8a8a8a",
  ok: "#5faf5f",
  warn: "#d7af5f",
  error: "#d75f5f",
  border: "#444444",
  borderActive: "#d97757",
  spinner: "#d97757",
  reaction: "#87afaf",
  menuBg: "#2e2e2e",
  code: "#e0e0e0",
  codeBg: "#3a3a3a",
  menuSelected: "#ffffff",
} as const

export const glyph = {
  self: ">",
  other: "⏺",
  result: "⎿",
  spinner: "✻",
  me: "*",
  cont: "┊",
} as const

/**
 * Identity colours. Picked from the user id, which is the public key, so the
 * colour cannot be chosen, survives a rename, and differs between two people
 * who picked the same name.
 */
const userColors = ["#5fafff", "#5fd7af", "#d787d7", "#ffaf5f", "#87d75f", "#ff8787", "#af87ff", "#5fd7d7", "#d7d75f", "#ff87d7"] as const

export function colorOf(userId: string): string {
  let h = 2166136261
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return userColors[(h >>> 0) % userColors.length]!
}
