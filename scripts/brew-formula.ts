/**
 * Prints a Homebrew formula for a release.
 *   bun scripts/brew-formula.ts <version> <checksums.txt>
 * checksums.txt lines: "<sha256>  <asset-name>" (sha256sum format).
 */
const [version, checksumsPath] = process.argv.slice(2)
if (!version || !checksumsPath) {
  console.error("usage: bun scripts/brew-formula.ts <version> <checksums.txt>")
  process.exit(2)
}
const sums = new Map<string, string>()
for (const line of (await Bun.file(checksumsPath).text()).split("\n")) {
  const m = /^([0-9a-f]{64})\s+\*?(\S+)$/.exec(line.trim())
  if (m) sums.set(m[2]!, m[1]!)
}
const base = `https://github.com/Awakehsh/vibe-chat/releases/download/v${version}`
const sha = (a: string) => sums.get(a) ?? "MISSING"
console.log(`class Vibechat < Formula
  desc "Terminal chat that looks like an AI coding agent session"
  homepage "https://github.com/Awakehsh/vibe-chat"
  version "${version}"
  license "MIT"

  on_macos do
    on_arm do
      url "${base}/vibechat-darwin-arm64"
      sha256 "${sha("vibechat-darwin-arm64")}"
    end
    on_intel do
      url "${base}/vibechat-darwin-x64"
      sha256 "${sha("vibechat-darwin-x64")}"
    end
  end

  on_linux do
    on_arm do
      url "${base}/vibechat-linux-arm64"
      sha256 "${sha("vibechat-linux-arm64")}"
    end
    on_intel do
      url "${base}/vibechat-linux-x64"
      sha256 "${sha("vibechat-linux-x64")}"
    end
  end

  def install
    bin.install Dir["vibechat-*"].first => "vibechat"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/vibechat --version")
  end
end`)
