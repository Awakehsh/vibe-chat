import type { MessageKind } from "@vibechat/protocol"
import { UsageError, flagString, type ParsedArgs } from "../args.ts"
import { openClient } from "./shared.ts"

/** `vibechat send --room <name|id> <text...>`; reads stdin when no text is given. */
export async function send(args: ParsedArgs): Promise<void> {
  const roomQuery = flagString(args.flags, "room")
  if (!roomQuery) throw new UsageError("usage: vibechat send --room <name|id> [--kind text|me|roll] <text> (or pipe text on stdin)")
  let body = args.positional.join(" ")
  if (!body) body = (await Bun.stdin.text()).replace(/\n$/, "")
  if (!body.trim()) throw new UsageError("nothing to send")
  const kind = (flagString(args.flags, "kind") ?? "text") as Exclude<MessageKind, "system">
  if (!["text", "me", "roll"].includes(kind)) throw new UsageError("--kind must be text, me or roll")
  const client = await openClient(args)
  try {
    const failures = await client.connectAll()
    const room = client.model.findRoom(roomQuery)
    if (!room) {
      const known = client.model.roomList().map((r) => client.model.titleOf(r.room.roomId))
      const hint = failures.length ? ` (${failures.map((f) => `${f.host}: ${f.error}`).join("; ")})` : ""
      throw new UsageError(`no room matches "${roomQuery}"; known: ${known.join(", ") || "none"}${hint}`)
    }
    const msg = await client.send(room.room.roomId, body, { kind })
    console.log(`sent #${msg.seq} to ${client.model.titleOf(room.room.roomId)}`)
  } finally {
    client.close()
  }
}
