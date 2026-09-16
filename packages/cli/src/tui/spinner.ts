export const SPINNER_FRAMES = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"]

/** Verbs shown while someone is typing, in the style of a busy agent. */
export const VERBS = [
  "Vibing",
  "Pondering",
  "Refactoring",
  "Compiling",
  "Grepping",
  "Linting",
  "Brewing",
  "Cogitating",
  "Shipping",
  "Bisecting",
  "Rebasing",
  "Speculating",
  "Manifesting",
  "Deliberating",
  "Percolating",
  "Optimizing",
]

export function pickVerb(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return VERBS[h % VERBS.length]!
}
