import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import type { ParsedArgs } from "../args.ts"
import { configDir, loadConfig } from "../config.ts"
import { loadIdentity } from "../identity.ts"
import { App } from "./App.tsx"

export async function chat(args: ParsedArgs, version = "0.1.0"): Promise<void> {
  const dir = configDir()
  const [identity, config] = await Promise.all([loadIdentity(dir), loadConfig(dir)])
  const kitty = args.flags["kitty-keyboard"] === true ? true : (config.kittyKeyboard ?? process.platform !== "win32")
  const renderer = await createCliRenderer({
    useKittyKeyboard: kitty ? {} : null,
    exitOnCtrlC: false,
    targetFps: 30,
    useMouse: true,
  })
  const root = createRoot(renderer)
  await new Promise<void>((resolve) => {
    root.render(
      <App
        identity={identity}
        version={version}
        insecure={args.flags.insecure === true}
        notifications={args.flags["no-notify"] !== true && config.notifications}
        onExit={resolve}
      />,
    )
  })
  renderer.destroy()
}
