import type { ScrollBoxRenderable } from "@opentui/core"
import { useEffect, useState, type RefObject } from "react"
import type { Model, RoomState } from "../model.ts"
import { MessageRow } from "./MessageRow.tsx"
import { SPINNER_FRAMES, pickVerb } from "./spinner.ts"
import { glyph, theme } from "./theme.ts"

export function Transcript({
  model,
  room,
  selfId,
  scrollRef,
  version,
}: {
  model: Model
  room: RoomState | undefined
  selfId: string
  scrollRef: RefObject<ScrollBoxRenderable | null>
  version: number
}) {
  const typing = room ? model.typingIn(room.room.roomId) : []
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    if (typing.length === 0) return
    const t = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 120)
    return () => clearInterval(t)
  }, [typing.length])
  void version

  return (
    <scrollbox ref={scrollRef} flexGrow={1} flexShrink={1} minHeight={3} stickyScroll stickyStart="bottom" paddingLeft={1} paddingRight={1} scrollbarOptions={{ visible: false }}>
      {room ? (
        <>
          {room.hasOlder ? <text fg={theme.dim}>{"  "}↑ PageUp for older messages</text> : null}
          {room.messages.map((m) => (
            <MessageRow key={m.msgId} model={model} message={m} selfId={selfId} />
          ))}
          {typing.length > 0 ? (
            <text fg={theme.spinner}>
              {SPINNER_FRAMES[frame]} {pickVerb(typing[0]!)}… <span fg={theme.dim}>({typing.map((id) => model.nameOf(id)).join(", ")})</span>
            </text>
          ) : null}
        </>
      ) : (
        <box flexDirection="column" paddingTop={1}>
          <text fg={theme.accent}>{glyph.spinner} No rooms yet.</text>
          <text> </text>
          <text fg={theme.self}>
            {"  "}/new {"<name>"} <span fg={theme.dim}>create a group</span>
          </text>
          <text fg={theme.self}>
            {"  "}/join {"<host/TOKEN>"} <span fg={theme.dim}>join one</span>
          </text>
        </box>
      )}
    </scrollbox>
  )
}
