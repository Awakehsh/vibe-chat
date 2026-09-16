import { fingerprint } from "@vibechat/protocol"
import { UsageError, type ParsedArgs } from "../args.ts"
import { configDir } from "../config.ts"
import { identityPath, loadIdentity, saveIdentity, type Identity } from "../identity.ts"
import { requireIdentity } from "./shared.ts"

/** `vibechat id` shows the identity; `id export` prints it as JSON; `id import <file>` replaces it. */
export async function id(args: ParsedArgs): Promise<void> {
  const sub = args.positional[0]
  if (sub === "import") {
    const file = args.positional[1]
    if (!file) throw new UsageError("usage: vibechat id import <identity.json>")
    const raw = (await Bun.file(file).json()) as Partial<Identity>
    if (typeof raw.publicKey !== "string" || typeof raw.privateKey !== "string" || typeof raw.name !== "string") {
      throw new UsageError(`${file} is not an identity export`)
    }
    const existing = await loadIdentity(configDir())
    if (existing && args.flags.force !== true) throw new UsageError(`an identity already exists at ${identityPath()}; pass --force to replace it`)
    const identity: Identity = { publicKey: raw.publicKey, privateKey: raw.privateKey, name: raw.name }
    if (raw.emoji) identity.emoji = raw.emoji
    await saveIdentity(identity, configDir())
    console.log(`imported identity "${identity.name}" (${fingerprint(identity.publicKey)})`)
    return
  }
  const identity = await requireIdentity(args)
  if (sub === "export") {
    console.log(JSON.stringify(identity, null, 2))
    return
  }
  if (sub !== undefined) throw new UsageError("usage: vibechat id [export | import <file>]")
  console.log(`name:        ${identity.emoji ? identity.emoji + " " : ""}${identity.name}`)
  console.log(`user id:     ${identity.publicKey}`)
  console.log(`fingerprint: ${fingerprint(identity.publicKey)}`)
  console.log(`stored at:   ${identityPath()}`)
  console.log(`\nTo use this identity on another machine: vibechat id export > identity.json, then vibechat id import identity.json there.`)
}
