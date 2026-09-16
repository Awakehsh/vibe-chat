import type { ParsedArgs } from "../args.ts"
import { openClient, parseInviteArg, resolveHost } from "./shared.ts"

export async function join(args: ParsedArgs): Promise<void> {
  const invite = parseInviteArg(args.positional[0])
  const client = await openClient(args)
  try {
    const host = resolveHost(client, args, invite.host)
    const room = await client.joinRoom(host, invite.token)
    console.log(`joined ${room.emoji ? room.emoji + " " : ""}${room.name} on ${host}`)
  } finally {
    client.close()
  }
}
