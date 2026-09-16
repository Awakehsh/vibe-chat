/**
 * Prints a Scoop manifest for a release.
 *   bun scripts/scoop-manifest.ts <version> <checksums.txt>
 */
const [version, checksumsPath] = process.argv.slice(2)
if (!version || !checksumsPath) {
  console.error("usage: bun scripts/scoop-manifest.ts <version> <checksums.txt>")
  process.exit(2)
}
let sha = "MISSING"
for (const line of (await Bun.file(checksumsPath).text()).split("\n")) {
  const m = /^([0-9a-f]{64})\s+\*?vibechat-windows-x64\.exe$/.exec(line.trim())
  if (m) sha = m[1]!
}
console.log(
  JSON.stringify(
    {
      version,
      description: "Terminal chat that looks like an AI coding agent session",
      homepage: "https://github.com/Awakehsh/vibe-chat",
      license: "MIT",
      architecture: {
        "64bit": {
          url: `https://github.com/Awakehsh/vibe-chat/releases/download/v${version}/vibechat-windows-x64.exe#/vibechat.exe`,
          hash: sha,
        },
      },
      bin: "vibechat.exe",
      checkver: { github: "https://github.com/Awakehsh/vibe-chat" },
      autoupdate: {
        architecture: {
          "64bit": { url: "https://github.com/Awakehsh/vibe-chat/releases/download/v$version/vibechat-windows-x64.exe#/vibechat.exe" },
        },
        hash: { url: "https://github.com/Awakehsh/vibe-chat/releases/download/v$version/checksums.txt" },
      },
    },
    null,
    2,
  ),
)
