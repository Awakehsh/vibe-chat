import { describe, expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { createRoot } from "@opentui/react"
import { CAT_FRAMES } from "../src/tui/Cat.tsx"
import { Sprite, closeEyes, spriteCells, spriteHeight, spriteWidth } from "../src/tui/Sprite.tsx"

describe("Sprite", () => {
  test("maps pixel pairs to half blocks", () => {
    const cells = spriteCells({ rows: ["ab.", ".b."], palette: { a: "#111", b: "#222" } })
    expect(cells).toEqual([[{ ch: "▀", fg: "#111" }, { ch: "▀", fg: "#222", bg: "#222" }, { ch: " " }]])
  })

  test("odd row counts leave the last bottom pixel empty", () => {
    const cells = spriteCells({ rows: ["a"], palette: { a: "#111" } })
    expect(cells).toEqual([[{ ch: "▀", fg: "#111" }]])
  })

  test("closeEyes keeps only the bottom pixel of each eye column", () => {
    const f = closeEyes({ rows: ["fhef", "feef"], palette: {} }, "eh", "f")
    expect(f.rows).toEqual(["ffff", "feef"])
  })

  test("cat frames are rectangular, 13 by 4, and differ only in the eye area", () => {
    for (const frame of Object.values(CAT_FRAMES)) {
      expect(new Set(frame.rows.map((r) => r.length)).size).toBe(1)
      expect(spriteWidth(frame)).toBe(13)
      expect(spriteHeight(frame)).toBe(4)
    }
    expect(CAT_FRAMES.open.rows.slice(0, 4)).toEqual(CAT_FRAMES.happy.rows.slice(0, 4))
    expect(CAT_FRAMES.blink.rows).not.toEqual(CAT_FRAMES.open.rows)
  })

  test("renders the cat as four rows of block characters", async () => {
    const t = await createTestRenderer({ width: 20, height: 6 })
    createRoot(t.renderer).render(<Sprite frame={CAT_FRAMES.open} />)
    await t.renderOnce()
    await Bun.sleep(30)
    await t.renderOnce()
    const lines = t.captureCharFrame().split("\n").map((l) => l.trimEnd()).filter(Boolean)
    expect(lines).toHaveLength(4)
    expect(lines[0]).toBe(" ▀▀▄     ▄▄")
    for (const l of lines) expect(l).toMatch(/^[ ▀▄]+$/)
    t.renderer.destroy()
  })
})
