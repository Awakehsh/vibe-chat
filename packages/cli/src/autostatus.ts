/**
 * Opt-in: while an AI coding CLI is running on this machine, your status
 * says so. Detection is a process list scan every 30 seconds.
 */
const AGENTS: [pattern: RegExp, label: string][] = [
  [/(^|\/)claude$/, "Claude Code"],
  [/(^|\/)codex$/, "Codex"],
  [/(^|\/)gemini$/, "Gemini CLI"],
  [/(^|\/)opencode$/, "OpenCode"],
  [/(^|\/)cursor-agent$/, "Cursor"],
  [/(^|\/)aider$/, "Aider"],
  [/(^|\/)copilot$/, "Copilot"],
  [/(^|\/)kimi$/, "Kimi"],
]

export async function runningAgents(): Promise<string[]> {
  const cmd = process.platform === "win32" ? ["tasklist", "/fo", "csv", "/nh"] : ["ps", "-axo", "comm="]
  try {
    const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore" })
    const out = await new Response(p.stdout).text()
    await p.exited
    const names = new Set<string>()
    for (const raw of out.split("\n")) {
      const line = process.platform === "win32" ? raw.split(",")[0]?.replace(/"/g, "").replace(/\.exe$/i, "") ?? "" : raw.trim()
      for (const [re, label] of AGENTS) if (re.test(line)) names.add(label)
    }
    return [...names]
  } catch {
    return []
  }
}

export const AUTO_STATUS_EMOJI = "🤖"

export function autoStatusText(agents: string[]): string {
  return agents.length ? `busy with ${agents.join(" + ")}` : ""
}
