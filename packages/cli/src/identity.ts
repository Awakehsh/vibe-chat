import { chmodSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { generateIdentity, type IdentityKeys } from "@vibechat/protocol"
import { configDir } from "./config.ts"

export interface Identity extends IdentityKeys {
  name: string
  emoji?: string
}

export function identityPath(dir: string = configDir()): string {
  return join(dir, "identity.json")
}

export async function loadIdentity(dir: string = configDir()): Promise<Identity | undefined> {
  const f = Bun.file(identityPath(dir))
  if (!(await f.exists())) return undefined
  const raw = (await f.json()) as Partial<Identity>
  if (typeof raw.publicKey !== "string" || typeof raw.privateKey !== "string" || typeof raw.name !== "string") {
    throw new Error(`${identityPath(dir)} is not a valid identity file`)
  }
  const id: Identity = { publicKey: raw.publicKey, privateKey: raw.privateKey, name: raw.name }
  if (raw.emoji) id.emoji = raw.emoji
  return id
}

export async function saveIdentity(identity: Identity, dir: string = configDir()): Promise<void> {
  mkdirSync(dir, { recursive: true })
  const path = identityPath(dir)
  await Bun.write(path, JSON.stringify(identity, null, 2) + "\n")
  if (process.platform !== "win32") chmodSync(path, 0o600)
}

export async function createIdentity(name: string, emoji: string | undefined, dir: string = configDir()): Promise<Identity> {
  const keys = await generateIdentity()
  const identity: Identity = { ...keys, name }
  if (emoji) identity.emoji = emoji
  await saveIdentity(identity, dir)
  return identity
}
