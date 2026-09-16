import { formatInvite } from "@vibechat/protocol"
import { UsageError, flagString, type ParsedArgs } from "../args.ts"
import { openClient, resolveHost } from "./shared.ts"

export async function newRoom(args: ParsedArgs): Promise<void> {
  const name = args.positional.join(" ").trim()
  if (!name) throw new UsageError("usage: vibechat new <name> [--host host[:port]] [--emoji 🌙]")
  const client = await openClient(args)
  try {
    const host = resolveHost(client, args)
    const room = await client.createRoom(host, name, flagString(args.flags, "emoji"))
    console.log(`created ${room.emoji ? room.emoji + " " : ""}${room.name}`)
    console.log(`invite: ${formatInvite(host, room.invite!)}`)
  } finally {
    client.close()
  }
}
