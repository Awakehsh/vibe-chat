import type { TextareaRenderable } from "@opentui/core"
import { forwardRef, useImperativeHandle, useRef, useState } from "react"
import { completions } from "./commands.ts"
import { glyph, theme } from "./theme.ts"

export interface PromptHandle {
  focus(): void
  setText(text: string): void
}

/**
 * Enter sends, Shift+Enter (and Ctrl+J) insert a newline. Submit is
 * deferred two event-loop ticks so an input method's pending composition
 * lands in the buffer before we read it (see docs/decisions.md D10).
 */
export const Prompt = forwardRef<PromptHandle, { onSubmit: (text: string) => void; onTyping: () => void; placeholder: string; active: boolean }>(function Prompt(
  { onSubmit, onTyping, placeholder, active },
  ref,
) {
  const area = useRef<TextareaRenderable>(null)
  const [draft, setDraft] = useState("")
  useImperativeHandle(ref, () => ({
    focus: () => area.current?.focus(),
    setText: (text) => {
      area.current?.setText(text)
      area.current?.gotoBufferEnd()
      setDraft(text)
    },
  }))
  const menu = completions(draft)

  const submit = () => {
    setTimeout(() => {
      setTimeout(() => {
        const text = area.current?.plainText ?? ""
        if (!text.trim()) return
        area.current?.clear()
        setDraft("")
        onSubmit(text)
      }, 0)
    }, 0)
  }

  return (
    <box flexDirection="column" flexShrink={0}>
      {menu.length > 0 ? (
        <box flexDirection="column" paddingLeft={2} flexShrink={0}>
          {menu.slice(0, 8).map((c) => (
            <text key={c.name}>
              <span fg={theme.accent}>/{c.name}</span> <span fg={theme.dim}>{c.args}</span>
              {"  "}
              <span fg={theme.dim}>{c.description}</span>
            </text>
          ))}
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
            { name: "tab", action: "submit" },
          ]}
          onSubmit={submit}
          onContentChange={() => {
            const text = area.current?.plainText ?? ""
            setDraft(text)
            if (text.length > 0 && !text.startsWith("/")) onTyping()
          }}
        />
      </box>
    </box>
  )
})
