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
  menuSelected: "#ffffff",
} as const

export const glyph = {
  self: ">",
  other: "⏺",
  result: "⎿",
  spinner: "✻",
  me: "*",
} as const
