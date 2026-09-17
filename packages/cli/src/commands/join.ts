import type { ParsedArgs } from "../args.ts"
import { RequestError } from "../connection.ts"
import { openClient, parseInviteArg, resolveHost } from "./shared.ts"

export async function join(args: ParsedArgs): Promise<void> {
  const invite = parseInviteArg(args.positional[0])
  const client = await openClient(args)
  try {
    const host = resolveHost(client, args, invite.host)
    try {
      const room = await client.joinRoom(host, invite.token)
      console.log(`joined ${room.emoji ? room.emoji + " " : ""}${room.name} on ${host}`)
    } catch (e) {
      // Running this twice is the common case; being in the room is what was asked for.
      if (e instanceof RequestError && e.code === "conflict") console.log(`already in that room on ${host}`)
      else throw e
    }
  } finally {
    client.close()
  }
}
