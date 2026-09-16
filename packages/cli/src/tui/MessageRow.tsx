import type { Message, PollMeta, RollMeta, StickerMeta } from "@vibechat/protocol"
import type { Model } from "../model.ts"
import { clip, humanSize, pollLines, reactionLine, rollLine } from "./format.ts"
import { glyph, theme } from "./theme.ts"

export function MessageRow({ model, message, selfId }: { model: Model; message: Message; selfId: string }) {
  const own = message.authorId === selfId
  const name = model.nameOf(message.authorId)
  const pending = message.seq === 0
  const reactions = message.kind === "poll" ? "" : reactionLine(message.reactions)
  const replyTarget = message.replyTo ? model.room(message.roomId)?.messages.find((m) => m.msgId === message.replyTo) : undefined

  if (message.kind === "system") {
    return (
      <box flexDirection="column" marginBottom={1}>
        <text fg={theme.system}>
          {glyph.result}  {message.body}
        </text>
      </box>
    )
  }

  if (message.deletedAt) {
    return (
      <box flexDirection="column" marginBottom={1}>
        <text fg={theme.dim}>
          {own ? glyph.self : glyph.other} {own ? "" : name + ": "}
          <i>(deleted)</i>
        </text>
      </box>
    )
  }

  const head = own ? (
    <span fg={theme.self}>{glyph.self} </span>
  ) : (
    <span>
      <span fg={theme.other}>{glyph.other} </span>
      <span fg={theme.name}>
        <b>{name}</b>
      </span>
      <span fg={theme.dim}>: </span>
    </span>
  )

  let body
  switch (message.kind) {
    case "me":
      body = (
        <text>
          <span fg={theme.accent}>{glyph.me} </span>
          <span fg={theme.name}>
            <b>{name}</b>
          </span>{" "}
          {message.body}
        </text>
      )
      break
    case "roll": {
      const meta = message.meta as RollMeta | undefined
      body = (
        <box flexDirection="column">
          <text>
            <span fg={theme.other}>{glyph.other} </span>
            <span fg={theme.name}>
              <b>Roll</b>
            </span>
            <span fg={theme.dim}>({message.body})</span>
            <span fg={theme.dim}> · {own ? "you" : name}</span>
          </text>
          <text fg={theme.self}>
            {"  "}
            {glyph.result}  {meta ? rollLine(meta) : "rolling…"}
          </text>
        </box>
      )
      break
    }
    case "poll": {
      const meta = message.meta as PollMeta | undefined
      body = (
        <box flexDirection="column">
          <text>
            <span fg={theme.other}>{glyph.other} </span>
            <span fg={theme.name}>
              <b>Poll</b>
            </span>
            <span fg={theme.dim}>("{meta?.question ?? message.body}")</span>
            <span fg={theme.dim}> · {own ? "you" : name}</span>
          </text>
          {(meta ? pollLines(meta, message.reactions) : []).map((line, i) => (
            <text key={i} fg={theme.self}>
              {"  "}
              {i === 0 ? glyph.result : " "}  {line}
            </text>
          ))}
          <text fg={theme.dim}>{"     "}/vote {"<n>"}</text>
        </box>
      )
      break
    }
    case "sticker": {
      const meta = message.meta as StickerMeta | undefined
      body = (
        <box flexDirection="column">
          <text>
            {head}
            <span fg={theme.dim}>sticker</span>
          </text>
          <ascii-font text={meta?.text ?? message.body} font={(meta?.font as "block" | "tiny" | "shade" | "slick") ?? "block"} color={theme.accent} />
        </box>
      )
      break
    }
    default:
      body = (
        <text fg={own ? theme.self : theme.name}>
          {head}
          {message.body}
          {message.editedAt ? <span fg={theme.dim}> (edited)</span> : null}
          {pending ? <span fg={theme.dim}> …</span> : null}
        </text>
      )
  }

  return (
    <box flexDirection="column" marginBottom={1}>
      {replyTarget ? (
        <text fg={theme.dim}>
          {"  "}↩ {model.nameOf(replyTarget.authorId)}: {clip(replyTarget.deletedAt ? "(deleted)" : replyTarget.body, 60)}
        </text>
      ) : null}
      {body}
      {message.attachments.map((a) => (
        <text key={a.fileId} fg={theme.dim}>
          {"  "}📎 {a.name} ({humanSize(a.size)})
        </text>
      ))}
      {reactions ? (
        <text fg={theme.reaction}>
          {"  "}
          {reactions}
        </text>
      ) : null}
    </box>
  )
}
