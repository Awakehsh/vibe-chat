import type { SelectOption } from "@opentui/core"
import type { Message } from "@vibechat/protocol"
import type { Model } from "../model.ts"
import { clip } from "./format.ts"
import { theme } from "./theme.ts"

/** Recent messages as a list, newest first, for reply / edit / delete / react / save. */
export function MessagePicker({ model, messages, title, onPick }: { model: Model; messages: Message[]; title: string; onPick: (m: Message) => void }) {
  const options: SelectOption[] = [...messages].reverse().map((m) => ({
    name: `${model.nameOf(m.authorId)}: ${clip(m.body || m.attachments.map((a) => a.name).join(", ") || `(${m.kind})`, 60)}`,
    description: "",
    value: m.msgId,
  }))
  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1}>
      <text fg={theme.accent}>
        {title} <span fg={theme.dim}>(↑↓ · Enter pick · Esc cancel)</span>
      </text>
      <select options={options} focused flexGrow={1} onSelect={(_i, opt) => opt && onPick(messages.find((m) => m.msgId === opt.value)!)} selectedTextColor={theme.accent} descriptionColor={theme.dim} />
    </box>
  )
}
