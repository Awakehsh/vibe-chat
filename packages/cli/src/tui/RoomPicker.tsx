import type { SelectOption } from "@opentui/core"
import type { Model } from "../model.ts"
import { theme } from "./theme.ts"

export function RoomPicker({ model, onPick, onClose }: { model: Model; onPick: (roomId: string) => void; onClose: () => void }) {
  const options: SelectOption[] = model.roomList().map((r) => {
    const online = [...r.members.keys()].filter((id) => model.user(id)?.online).length
    const unread = r.unread > 0 ? ` · ${r.unread} unread` : ""
    return {
      name: `${r.room.emoji ? r.room.emoji + " " : ""}${model.titleOf(r.room.roomId)}`,
      description: `${r.room.kind === "dm" ? "dm" : `${r.members.size} members, ${online} online`}${unread} · ${r.host}`,
      value: r.room.roomId,
    }
  })
  void onClose
  return (
    <box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={3} paddingLeft={1} paddingRight={1}>
      <text fg={theme.accent}>Switch room <span fg={theme.dim}>(Enter to pick, Esc to close)</span></text>
      <select
        options={options}
        focused
        showDescription
        flexGrow={1}
        onSelect={(_i, opt) => opt && onPick(String(opt.value))}
        selectedTextColor={theme.accent}
        descriptionColor={theme.dim}
      />
    </box>
  )
}
