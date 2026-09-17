import { DEFAULT_LIMITS, type Limits } from "@vibechat/protocol"

export interface ServerConfig {
  /** 0 picks a free port (tests). */
  port: number
  hostname: string
  dataDir: string
  limits: Limits
  name: string
  version: string
  /** Suppress startup and sweep logs. */
  quiet: boolean
}

export function resolveConfig(partial: Partial<ServerConfig> = {}): ServerConfig {
  return {
    port: partial.port ?? 7788,
    hostname: partial.hostname ?? "0.0.0.0",
    dataDir: partial.dataDir ?? "./data",
    limits: { ...DEFAULT_LIMITS, ...(partial.limits ?? {}) },
    name: partial.name ?? "vibechat",
    version: partial.version ?? "0.4.0",
    quiet: partial.quiet ?? false,
  }
}
