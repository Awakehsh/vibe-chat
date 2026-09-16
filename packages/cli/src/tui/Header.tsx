import { useEffect, useState } from "react"
import { Cat, type CatMood } from "./Cat.tsx"
import { theme } from "./theme.ts"

export interface HeaderProps {
  version: string
  /** Bumps whenever someone mentions or reacts to you; the cat smiles for a moment. */
  happyTick?: number
  name: string
  /** Second line, e.g. "#late night · 2 online". */
  where: string
  /** Third line, e.g. "localhost:7788 · 2 rooms · 1 unread elsewhere". */
  detail: string
}

/** Brand block: the cat on the left, three lines of session info on the right. */
export function Header({ version, name, where, detail, happyTick = 0 }: HeaderProps) {
  const [blink, setBlink] = useState(false)
  const [happy, setHappy] = useState(false)
  useEffect(() => {
    if (happyTick === 0) return
    setHappy(true)
    const t = setTimeout(() => setHappy(false), 1800)
    return () => clearTimeout(t)
  }, [happyTick])
  const mood: CatMood = happy ? "happy" : blink ? "blink" : "open"
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
      <Cat mood={mood} />
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
