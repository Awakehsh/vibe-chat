import type { InputRenderable } from "@opentui/core"
import { useRef } from "react"
import { Cat } from "./Cat.tsx"
import { theme } from "./theme.ts"

export function Onboarding({ onDone }: { onDone: (name: string) => void }) {
  const input = useRef<InputRenderable>(null)
  const submit = () => {
    const name = (input.current?.value ?? "").trim()
    if (name.length >= 1 && name.length <= 32) onDone(name)
  }
  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingTop={1}>
      <box flexDirection="row" height={3} marginBottom={1}>
        <Cat />
        <box flexDirection="column" paddingLeft={2}>
          <text fg={theme.name}>
            <b>Welcome to vibechat</b>
          </text>
          <text fg={theme.dim}>a chat that looks like work</text>
        </box>
      </box>
      <text fg={theme.self}>What should people call you? <span fg={theme.dim}>(1–32 characters)</span></text>
      <box border borderStyle="rounded" borderColor={theme.borderActive} width={40} height={3} paddingLeft={1}>
        <input ref={input} focused onSubmit={submit} />
      </box>
      <text fg={theme.dim}>Your identity is a keypair stored locally. No account, no e-mail.</text>
    </box>
  )
}
