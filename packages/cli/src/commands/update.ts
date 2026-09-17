import { chmod, realpath, rename, unlink } from "node:fs/promises"
import { dirname, join } from "node:path"
import { UsageError, type ParsedArgs } from "../args.ts"

const REPO = "Awakehsh/vibe-chat"

/** The release asset built for the machine this is running on. Its names are the ones release.yml builds. */
export function assetName(): string {
  const arch = process.arch === "arm64" ? "arm64" : "x64"
  if (process.platform === "darwin") return `vibechat-darwin-${arch}`
  if (process.platform === "linux") return `vibechat-linux-${arch}`
  if (process.platform === "win32") return "vibechat-windows-x64.exe"
  throw new UsageError(`no vibechat build for ${process.platform}`)
}

/** The command that owns this binary, when a package manager installed it. */
export function ownedBy(path: string): string | undefined {
  if (path.includes("/Cellar/")) return "brew upgrade vibechat"
  if (/[\\/]scoop[\\/]apps[\\/]/i.test(path)) return "scoop update vibechat"
  return undefined
}

async function latestTag(): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: "application/vnd.github+json" } })
  if (!res.ok) throw new UsageError(`could not reach the release list (${res.status})`)
  const tag = ((await res.json()) as { tag_name?: string }).tag_name
  if (!tag) throw new UsageError("the release list carried no tag")
  return tag
}

/** `vibechat update` replaces this binary with the latest release built for this machine. */
export async function update(args: ParsedArgs, version: string): Promise<void> {
  const exe = await realpath(process.execPath)
  const owner = ownedBy(exe)
  if (owner) throw new UsageError(`${exe} was installed by a package manager; update it with:\n\n  ${owner}\n`)

  const tag = await latestTag()
  if (tag === `v${version}`) return console.log(`already on ${tag}`)
  console.log(`${version} -> ${tag.replace(/^v/, "")}`)

  const url = `https://github.com/${REPO}/releases/download/${tag}/${assetName()}`
  const res = await fetch(url)
  if (!res.ok) throw new UsageError(`could not download ${url} (${res.status})`)
  // Writing a new file and renaming it keeps the running copy intact, and on Apple
  // silicon leaves the signature valid; overwriting in place invalidates it.
  const tmp = join(dirname(exe), `.vibechat-${tag}.tmp`)
  await Bun.write(tmp, res)
  await chmod(tmp, 0o755)

  if (process.platform === "win32") {
    // A running .exe cannot be replaced, but it can be renamed out of the way.
    const old = `${exe}.old`
    await unlink(old).catch(() => undefined)
    await rename(exe, old)
    await rename(tmp, exe)
    console.log(`updated ${exe}\nthe copy you are running is now ${old}; it can be deleted once you close this window`)
    return
  }
  await rename(tmp, exe)
  console.log(`updated ${exe}`)
}
