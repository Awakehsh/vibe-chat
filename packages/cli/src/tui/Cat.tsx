import { Sprite, closeEyes, type SpriteFrame } from "./Sprite.tsx"

/**
 * The mascot: a kitten head, 13 columns by 4 rows. Left ear a pixel higher
 * and right eye a pixel lower than their partners, which reads as a head
 * tilt; blush on both cheeks; a white muzzle with a pink nose.
 *
 * Pixel legend: f fur, w white, n pink (inner ear, nose), r blush, e eye,
 * h eye shine, . transparent.
 */
export const CAT_PALETTE = {
  f: "#d8b58a",
  w: "#f6f1ea",
  n: "#e07d95",
  r: "#f2a1ad",
  e: "#2a1c14",
  h: "#ffffff",
} as const

const OPEN: SpriteFrame = {
  palette: CAT_PALETTE,
  rows: [
    ".ff..........",
    ".fnf.....ff..",
    ".ffff....fnf.",
    ".fffffffffff.",
    ".fheffffffff.",
    ".feeffffheff.",
    ".rffwnnweerf.",
    "..ffwwwwfff..",
  ],
}

/** Eyes drawn as ^ ^: shown for a moment when someone mentions or reacts to you. */
const HAPPY: SpriteFrame = {
  palette: CAT_PALETTE,
  rows: [
    ".ff..........",
    ".fnf.....ff..",
    ".ffff....fnf.",
    ".fffffffffff.",
    ".ffeffffffff.",
    ".fefefffeeff.",
    ".rffwnnwfefr.",
    "..ffwwwwfff..",
  ],
}

const BLINK = closeEyes(OPEN, "eh", "f")

export type CatMood = "open" | "blink" | "happy"

export const CAT_FRAMES: Record<CatMood, SpriteFrame> = { open: OPEN, blink: BLINK, happy: HAPPY }

export function Cat({ mood = "open" }: { mood?: CatMood }) {
  return <Sprite frame={CAT_FRAMES[mood]} />
}
