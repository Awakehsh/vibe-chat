export interface ParsedArgs {
  positional: string[]
  flags: Record<string, string | boolean>
}

/** `--key value`, `--key=value`, `--flag`, `-x`. Everything after `--` is positional. */
export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = []
  const flags: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === "--") {
      positional.push(...argv.slice(i + 1))
      break
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=")
      if (eq > 0) {
        flags[a.slice(2, eq)] = a.slice(eq + 1)
        continue
      }
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith("-")) {
        flags[key] = next
        i++
      } else flags[key] = true
      continue
    }
    if (a.startsWith("-") && a.length === 2) {
      flags[a.slice(1)] = true
      continue
    }
    positional.push(a)
  }
  return { positional, flags }
}

export function flagString(flags: ParsedArgs["flags"], key: string): string | undefined {
  const v = flags[key]
  return typeof v === "string" ? v : undefined
}

export function flagNumber(flags: ParsedArgs["flags"], key: string): number | undefined {
  const v = flagString(flags, key)
  if (v === undefined) return undefined
  const n = Number(v)
  if (!Number.isFinite(n)) throw new UsageError(`--${key} must be a number`)
  return n
}

export class UsageError extends Error {}
