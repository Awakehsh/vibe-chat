import { mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export interface Config {
  /** Host used when an invite has no host and for `new`. */
  defaultHost?: string
  /** Every server the user has rooms on. */
  hosts: string[]
  /** Overrides the platform default for the Kitty keyboard protocol. */
  kittyKeyboard?: boolean
  /** Desktop notifications for messages in rooms you are not looking at. */
  notifications: boolean
  /** A short sound when you are mentioned. */
  sounds: boolean
  /** Set your status automatically while an AI coding CLI is running on this machine. */
  autoStatus: boolean
  /** Fetch a new release in the background when one exists. */
  autoUpdate: boolean
  /** When the release list was last asked, so it is asked at most daily. */
  lastUpdateCheck?: string
  /** Rooms that make no sound and raise no notification. */
  mutedRooms: string[]
  /** User ids whose messages are not shown. */
  blocked: string[]
  /** Where to dial a host, when it is not where its name points. */
  hostAliases?: Record<string, string>
}

const DEFAULT_CONFIG: Config = { hosts: [], notifications: true, sounds: true, autoStatus: false, autoUpdate: true, mutedRooms: [], blocked: [] }

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.VIBECHAT_HOME) return env.VIBECHAT_HOME
  if (process.platform === "win32" && env.APPDATA) return join(env.APPDATA, "vibechat")
  return join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "vibechat")
}

export async function loadConfig(dir: string = configDir()): Promise<Config> {
  const f = Bun.file(join(dir, "config.json"))
  if (!(await f.exists())) return { ...DEFAULT_CONFIG }
  const raw = (await f.json()) as Partial<Config>
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [])
  return { ...DEFAULT_CONFIG, ...raw, hosts: list(raw.hosts), mutedRooms: list(raw.mutedRooms), blocked: list(raw.blocked) }
}

export async function saveConfig(config: Config, dir: string = configDir()): Promise<void> {
  mkdirSync(dir, { recursive: true })
  await Bun.write(join(dir, "config.json"), JSON.stringify(config, null, 2) + "\n")
}

/** Records a host the user now has rooms on; the first one becomes the default. */
export function rememberHost(config: Config, host: string): Config {
  const hosts = config.hosts.includes(host) ? config.hosts : [...config.hosts, host]
  return { ...config, hosts, defaultHost: config.defaultHost ?? host }
}

export function forgetHost(config: Config, host: string): Config {
  const hosts = config.hosts.filter((h) => h !== host)
  const next: Config = { ...config, hosts }
  if (config.defaultHost === host) {
    if (hosts[0]) next.defaultHost = hosts[0]
    else delete next.defaultHost
  }
  return next
}
