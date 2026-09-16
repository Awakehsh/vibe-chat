import { describe, expect, test } from "bun:test"
import { parseDice, rollDice } from "../src/index.ts"

describe("dice", () => {
  test("parses notation", () => {
    expect(parseDice("2d6")).toEqual({ count: 2, sides: 6, modifier: 0 })
    expect(parseDice("d20")).toEqual({ count: 1, sides: 20, modifier: 0 })
    expect(parseDice("3D8-2")).toEqual({ count: 3, sides: 8, modifier: -2 })
    expect(parseDice("21d6")).toBeUndefined()
    expect(parseDice("2d1")).toBeUndefined()
    expect(parseDice("2d1001")).toBeUndefined()
    expect(parseDice("hello")).toBeUndefined()
  })

  test("rolls deterministically with an injected random", () => {
    const r = rollDice("2d6+1", () => 0.5)
    expect(r).toEqual({ notation: "2d6+1", rolls: [4, 4], total: 9 })
  })

  test("rolls stay in range", () => {
    for (let i = 0; i < 200; i++) {
      const r = rollDice("3d6")!
      for (const x of r.rolls) expect(x >= 1 && x <= 6).toBe(true)
      expect(r.total).toBe(r.rolls[0]! + r.rolls[1]! + r.rolls[2]!)
    }
  })
})
