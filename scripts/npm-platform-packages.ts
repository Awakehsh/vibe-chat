/**
 * Builds the per-platform npm packages from compiled binaries.
 *
 *   bun scripts/npm-platform-packages.ts <version> <binaries-dir> <out-dir>
 *
 * <binaries-dir> holds vibechat-<target>[.exe] as produced by the release
 * workflow. Writes <out-dir>/vibe-chat-<target>/ for each binary found and
 * stamps the version into packages/npm/vibe-chat/package.json.
 */
import { chmodSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"

const [version, binDir, outDir] = process.argv.slice(2)
if (!version || !binDir || !outDir) {
  console.error("usage: bun scripts/npm-platform-packages.ts <version> <binaries-dir> <out-dir>")
  process.exit(2)
}

const targets: { name: string; file: string; os: string; cpu: string }[] = [
  { name: "vibe-chat-darwin-arm64", file: "vibechat-darwin-arm64", os: "darwin", cpu: "arm64" },
  { name: "vibe-chat-darwin-x64", file: "vibechat-darwin-x64", os: "darwin", cpu: "x64" },
  { name: "vibe-chat-linux-x64", file: "vibechat-linux-x64", os: "linux", cpu: "x64" },
  { name: "vibe-chat-linux-arm64", file: "vibechat-linux-arm64", os: "linux", cpu: "arm64" },
  { name: "vibe-chat-windows-x64", file: "vibechat-windows-x64.exe", os: "win32", cpu: "x64" },
]

const built: string[] = []
for (const t of targets) {
  const src = join(binDir, t.file)
  if (!existsSync(src)) {
    console.warn(`skip ${t.name}: ${src} not found`)
    continue
  }
  const dir = join(outDir, t.name, "bin")
  mkdirSync(dir, { recursive: true })
  const dest = join(dir, t.os === "win32" ? "vibechat.exe" : "vibechat")
  await Bun.write(dest, Bun.file(src))
  if (t.os !== "win32") chmodSync(dest, 0o755)
  await Bun.write(
    join(outDir, t.name, "package.json"),
    JSON.stringify(
      {
        name: t.name,
        version,
        description: `vibechat binary for ${t.os} ${t.cpu}`,
        license: "MIT",
        repository: { type: "git", url: "https://github.com/Awakehsh/vibe-chat" },
        os: [t.os],
        cpu: [t.cpu],
        files: ["bin"],
      },
      null,
      2,
    ) + "\n",
  )
  built.push(t.name)
}

const mainPath = join(import.meta.dir, "..", "packages", "npm", "vibe-chat", "package.json")
const main = await Bun.file(mainPath).json()
main.version = version
main.optionalDependencies = Object.fromEntries(targets.map((t) => [t.name, version]))
await Bun.write(mainPath, JSON.stringify(main, null, 2) + "\n")
console.log(`built ${built.length} platform package(s): ${built.join(", ")}; main package stamped ${version}`)
