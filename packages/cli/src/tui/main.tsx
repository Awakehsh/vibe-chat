import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import type { ParsedArgs } from "../args.ts"
import { configDir, loadConfig } from "../config.ts"
import { loadIdentity } from "../identity.ts"
import { App } from "./App.tsx"

/**
 * Row the cursor is on before we take over, i.e. how many rows of the shell's
 * output sit above us. The live region starts right below them, as it would
 * for any command that prints and then waits for input.
 */
async function cursorRow(): Promise<number> {
  const stdin = process.stdin
  if (!stdin.isTTY || !process.stdout.isTTY) return 0
  stdin.setRawMode(true)
  stdin.resume()
  try {
    const reply = await new Promise<string>((resolve) => {
      let buf = ""
      const timer = setTimeout(() => done(""), 250)
      const done = (v: string) => {
        clearTimeout(timer)
        stdin.off("data", onData)
        resolve(v)
      }
      const onData = (d: Buffer) => {
        buf += d.toString("latin1")
        const m = /\x1b\[(\d+);(\d+)R/.exec(buf)
        if (m) done(m[1]!)
      }
      stdin.on("data", onData)
      process.stdout.write("\x1b[6n")
    })
    return reply ? Math.max(0, Number(reply) - 1) : 0
  } finally {
    stdin.setRawMode(false)
    stdin.pause()
  }
}

export async function chat(args: ParsedArgs, version = "0.1.0"): Promise<void> {
  const dir = configDir()
  const [identity, config, preRows] = await Promise.all([loadIdentity(dir), loadConfig(dir), cursorRow()])
  const kitty = args.flags["kitty-keyboard"] === true ? true : (config.kittyKeyboard ?? process.platform !== "win32")
  // Split-footer: the live region (prompt, status) is a footer whose height we
  // manage; everything else is printed into the terminal's own scrollback, so
  // the terminal's scrolling and selection work as they do for any other CLI.
  const renderer = await createCliRenderer({
    useKittyKeyboard: kitty ? {} : null,
    exitOnCtrlC: false,
    targetFps: 30,
    useMouse: false,
    screenMode: "split-footer",
    footerHeight: Math.max(4, process.stdout.rows ?? 24),
    externalOutputMode: "capture-stdout",
  })
  const root = createRoot(renderer)
  await new Promise<void>((resolve) => {
    root.render(
      <App
        identity={identity}
        version={version}
        preRows={preRows}
        insecure={args.flags.insecure === true}
        notifications={args.flags["no-notify"] !== true && config.notifications}
        onExit={resolve}
      />,
    )
  })
  renderer.destroy()
}
