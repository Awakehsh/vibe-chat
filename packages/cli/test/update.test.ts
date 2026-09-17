import { describe, expect, test } from "bun:test"
import { assetName, ownedBy } from "../src/commands/update.ts"

describe("self update", () => {
  test("asks for the asset the release workflow actually builds", async () => {
    const workflow = await Bun.file(`${import.meta.dir}/../../../.github/workflows/release.yml`).text()
    expect(workflow).toContain(`name: ${assetName()}`)
  })

  test("refuses to replace a binary a package manager owns", () => {
    expect(ownedBy("/opt/homebrew/Cellar/vibechat/0.4.1/bin/vibechat")).toBe("brew upgrade vibechat")
    expect(ownedBy("C:\\Users\\me\\scoop\\apps\\vibechat\\current\\vibechat.exe")).toBe("scoop update vibechat")
    expect(ownedBy("/Users/me/.local/bin/vibechat")).toBeUndefined()
    expect(ownedBy("C:\\Users\\me\\AppData\\Local\\vibechat\\bin\\vibechat.exe")).toBeUndefined()
  })
})
