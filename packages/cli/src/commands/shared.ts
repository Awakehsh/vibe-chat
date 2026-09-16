import { parseInvite } from "@vibechat/protocol"
import { UsageError, flagString, type ParsedArgs } from "../args.ts"
import { loadClient, type Client } from "../client.ts"
import { configDir } from "../config.ts"
import { createIdentity, loadIdentity, type Identity } from "../identity.ts"

/** Identity for non-interactive commands: existing, or created from --name / $USER. */
export async function requireIdentity(args: ParsedArgs): Promise<Identity> {
  const dir = configDir()
  const existing = await loadIdentity(dir)
  if (existing) return existing
  const name = flagString(args.flags, "name") ?? process.env.USER ?? process.env.USERNAME
  if (!name) throw new UsageError("no identity yet; pass --name <name> to create one")
  const id = await createIdentity(name, undefined, dir)
  console.error(`created identity "${name}" in ${dir}`)
  return id
}

export async function openClient(args: ParsedArgs): Promise<Client> {
  const identity = await requireIdentity(args)
  return loadClient(identity, configDir(), args.flags.insecure === true)
}

/** Host for a command: --host, or the invite's host, or the configured default. */
export function resolveHost(client: Client, args: ParsedArgs, inviteHost?: string): string {
  const host = flagString(args.flags, "host") ?? inviteHost ?? process.env.VIBECHAT_HOST ?? client.config.defaultHost
  if (!host) throw new UsageError("no server known yet; pass --host <host[:port]> or join a room with a full invite (host/TOKEN)")
  return host
}

export function parseInviteArg(text: string | undefined): { host?: string; token: string } {
  if (!text) throw new UsageError("missing invite code")
  const parsed = parseInvite(text)
  if (!parsed) throw new UsageError(`"${text}" is not an invite code (expected host/TOKEN or TOKEN)`)
  return parsed
}
