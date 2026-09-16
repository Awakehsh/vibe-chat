import type { KeyEvent, TextareaRenderable } from "@opentui/core"
import { forwardRef, useImperativeHandle, useRef, useState } from "react"
import { COMMANDS, completions, type SlashCommand } from "./commands.ts"
import { glyph, theme } from "./theme.ts"

export interface PromptHandle {
  focus(): void
  setText(text: string): void
}

const MENU_ROWS = 8
const HISTORY_MAX = 50
const NAME_COL = Math.max(...COMMANDS.map((c) => `/${c.name} ${c.args}`.trimEnd().length)) + 2

export type PromptMode = "text" | "menu" | "history"

/**
 * Enter sends, Shift+Enter (and Ctrl+J) insert a newline. Submit is
 * deferred two event-loop ticks so an input method's pending composition
 * lands in the buffer before we read it (see docs/decisions.md D10).
 *
 * Typing `/` opens the command menu: ↑/↓ move, Tab completes, Enter runs a
 * command that takes no arguments or completes one that does. ↑ in an empty
 * prompt recalls what you sent before.
 */
export const Prompt = forwardRef<
  PromptHandle,
  { onSubmit: (text: string) => void; onTyping: () => void; onMode?: (mode: PromptMode) => void; placeholder: string; active: boolean }
>(function Prompt({ onSubmit, onTyping, onMode, placeholder, active }, ref) {
  const area = useRef<TextareaRenderable>(null)
  const [draft, setDraft] = useState("")
  const [selected, setSelected] = useState(0)
  const history = useRef<string[]>([])
  const histPos = useRef<number | null>(null)
  const menu = completions(draft)
  const sel = Math.min(selected, Math.max(0, menu.length - 1))

  const setText = (text: string) => {
    area.current?.setText(text)
    area.current?.gotoBufferEnd()
    setDraft(text)
  }
  useImperativeHandle(ref, () => ({ focus: () => area.current?.focus(), setText }))

  const mode: PromptMode = menu.length > 0 ? "menu" : histPos.current !== null ? "history" : "text"
  const lastMode = useRef<PromptMode>("text")
  if (lastMode.current !== mode) {
    lastMode.current = mode
    onMode?.(mode)
  }

  const complete = (cmd: SlashCommand) => {
    setText(cmd.args ? `/${cmd.name} ` : `/${cmd.name}`)
    setSelected(0)
  }

  const submit = () => {
    setTimeout(() => {
      setTimeout(() => {
        const text = area.current?.plainText ?? ""
        if (!text.trim()) return
        area.current?.clear()
        setDraft("")
        setSelected(0)
        histPos.current = null
        const h = history.current
        if (h[h.length - 1] !== text) h.push(text)
        if (h.length > HISTORY_MAX) h.shift()
        onSubmit(text)
      }, 0)
    }, 0)
  }

  const onKeyDown = (key: KeyEvent) => {
    if (menu.length > 0) {
      if (key.name === "up" || key.name === "down") {
        key.preventDefault()
        setSelected((sel + (key.name === "up" ? menu.length - 1 : 1)) % menu.length)
        return
      }
      if (key.name === "tab") {
        key.preventDefault()
        complete(menu[sel]!)
        return
      }
      if (key.name === "return" && !key.shift) {
        const cmd = menu[sel]!
        if (cmd.args) {
          key.preventDefault()
          complete(cmd)
          return
        }
        if (draft !== `/${cmd.name}`) {
          key.preventDefault()
          setText(`/${cmd.name}`)
          submit()
        }
        return
      }
      if (key.name === "escape") {
        key.preventDefault()
        setText("")
        return
      }
    }
    const h = history.current
    const empty = (area.current?.plainText ?? "") === ""
    if (key.name === "up" && !key.shift && h.length > 0 && (empty || histPos.current !== null)) {
      key.preventDefault()
      const next = histPos.current === null ? h.length - 1 : Math.max(0, histPos.current - 1)
      histPos.current = next
      setText(h[next]!)
      return
    }
    if (key.name === "down" && histPos.current !== null) {
      key.preventDefault()
      const next = histPos.current + 1
      if (next >= h.length) {
        histPos.current = null
        setText("")
      } else {
        histPos.current = next
        setText(h[next]!)
      }
    }
  }

  const start = Math.max(0, Math.min(sel - Math.floor(MENU_ROWS / 2), menu.length - MENU_ROWS))
  const visible = menu.slice(start, start + MENU_ROWS)

  return (
    <box flexDirection="column" flexShrink={0}>
      {visible.length > 0 ? (
        <box flexDirection="column" paddingLeft={1} flexShrink={0}>
          {visible.map((c, i) => {
            const isSel = start + i === sel
            const label = `/${c.name} ${c.args}`.trimEnd().padEnd(NAME_COL)
            return (
              <text key={c.name} bg={isSel ? theme.menuBg : "transparent"}>
                <span fg={isSel ? theme.accent : theme.dim}>{isSel ? "▶ " : "  "}</span>
                <span fg={isSel ? theme.menuSelected : theme.accent}>{label}</span>
                <span fg={isSel ? theme.self : theme.dim}>{c.description}</span>
              </text>
            )
          })}
        </box>
      ) : null}
      <box border borderStyle="rounded" borderColor={active ? theme.borderActive : theme.border} flexDirection="row" paddingLeft={1} paddingRight={1} minHeight={3}>
        <text fg={theme.accent}>{glyph.self} </text>
        <textarea
          ref={area}
          focused={active}
          flexGrow={1}
          minHeight={1}
          maxHeight={6}
          placeholder={placeholder}
          placeholderColor={theme.dim}
          keyBindings={[
            { name: "return", action: "submit" },
            { name: "return", shift: true, action: "newline" },
            { name: "j", ctrl: true, action: "newline" },
          ]}
          onSubmit={submit}
          onKeyDown={onKeyDown}
          onContentChange={() => {
            const text = area.current?.plainText ?? ""
            if (text !== draft) {
              setDraft(text)
              if (histPos.current !== null && (text === "" || text !== history.current[histPos.current])) histPos.current = null
            }
            if (text.length > 0 && !text.startsWith("/")) onTyping()
          }}
        />
      </box>
    </box>
  )
})
