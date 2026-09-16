import { describe, expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { createRoot } from "@opentui/react"
import { Prompt } from "../src/tui/Prompt.tsx"

async function setup() {
  const t = await createTestRenderer({ width: 80, height: 16 })
  const submitted: string[] = []
  const modes: string[] = []
  createRoot(t.renderer).render(<Prompt active placeholder="type" onSubmit={(x) => submitted.push(x)} onTyping={() => undefined} onMode={(m) => modes.push(m)} />)
  const frame = async () => {
    await t.renderOnce()
    await Bun.sleep(20)
    await t.renderOnce()
    return t.captureCharFrame()
  }
  await frame()
  return { ...t, frame, submitted, modes }
}

describe("Prompt", () => {
  test("typing / opens the menu with the first row selected; ↓ moves; Tab completes", async () => {
    const p = await setup()
    p.mockInput.typeText("/ro")
    let out = await p.frame()
    expect(out).toContain("▶ /rooms")
    expect(out).toContain("  /room <name>")
    p.mockInput.pressArrow("down")
    out = await p.frame()
    expect(out).toContain("▶ /room <name>")
    p.mockInput.pressTab()
    out = await p.frame()
    expect(out).toContain("> /room ")
    expect(out).not.toContain("▶")
    expect(p.modes).toEqual(["menu", "text"])
    p.renderer.destroy()
  })

  test("Enter on a command without arguments runs it; with arguments it completes", async () => {
    const p = await setup()
    p.mockInput.typeText("/hel")
    await p.frame()
    p.mockInput.pressEnter()
    await p.frame()
    await Bun.sleep(30)
    expect(p.submitted).toEqual(["/help"])
    p.mockInput.typeText("/jo")
    await p.frame()
    p.mockInput.pressEnter()
    const out = await p.frame()
    expect(out).toContain("> /join ")
    expect(p.submitted).toEqual(["/help"])
    p.renderer.destroy()
  })

  test("↑ in an empty prompt recalls history; Esc clears the menu", async () => {
    const p = await setup()
    p.mockInput.typeText("first message")
    p.mockInput.pressEnter()
    await p.frame()
    await Bun.sleep(30)
    expect(p.submitted).toEqual(["first message"])
    p.mockInput.pressArrow("up")
    let out = await p.frame()
    expect(out).toContain("> first message")
    p.mockInput.pressArrow("down")
    out = await p.frame()
    expect(out).not.toContain("first message")
    p.mockInput.typeText("/")
    out = await p.frame()
    expect(out).toContain("▶ /help")
    p.mockInput.pressEscape()
    await Bun.sleep(150) // legacy escape-sequence timeout before a lone ESC is delivered
    out = await p.frame()
    expect(out).not.toContain("▶ /help")
    p.renderer.destroy()
  })
})
