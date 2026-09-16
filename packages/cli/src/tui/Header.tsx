import { useEffect, useState } from "react"
import { Cat } from "./Cat.tsx"
import { theme } from "./theme.ts"

export interface HeaderProps {
  version: string
  name: string
  /** Second line, e.g. "#late night · 2 online". */
  where: string
  /** Third line, e.g. "localhost:7788 · 2 rooms · 1 unread elsewhere". */
  detail: string
}

/** Brand block: the cat on the left, three lines of session info on the right. */
export function Header({ version, name, where, detail }: HeaderProps) {
  const [blink, setBlink] = useState(false)
  useEffect(() => {
    let closeTimer: ReturnType<typeof setTimeout> | undefined
    const schedule = () =>
      setTimeout(
        () => {
          setBlink(true)
          closeTimer = setTimeout(() => {
            setBlink(false)
            timer = schedule()
          }, 140)
        },
        3000 + Math.random() * 4000,
      )
    let timer = schedule()
    return () => {
      clearTimeout(timer)
      if (closeTimer) clearTimeout(closeTimer)
    }
  }, [])
  return (
    <box flexDirection="row" height={4} flexShrink={0} paddingLeft={1} marginBottom={1}>
      <Cat blink={blink} />
      <box flexDirection="column" paddingLeft={2} paddingTop={1}>
        <text>
          <span fg={theme.name}>
            <b>vibechat</b>
          </span>
          <span fg={theme.dim}> v{version}</span>
        </text>
        <text fg={theme.self}>
          {name} <span fg={theme.dim}>· {where}</span>
        </text>
        <text fg={theme.dim}>{detail}</text>
      </box>
    </box>
  )
}
