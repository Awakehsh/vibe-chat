/** Tailscale Funnel integration for `vibechat serve --tunnel`. */

export interface Funnel {
  /** Public host, e.g. `mac.tail1234.ts.net`. */
  host: string
  stop(): Promise<void>
}

async function run(cmd: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  return { code, stdout, stderr }
}

export async function tailscaleAvailable(): Promise<boolean> {
  return Bun.which("tailscale") !== null
}

/** DNS name of this machine on its tailnet, without the trailing dot. */
export async function tailscaleHost(): Promise<string> {
  const r = await run(["tailscale", "status", "--json"])
  if (r.code !== 0) throw new Error(`tailscale status failed: ${r.stderr.trim() || r.stdout.trim()}`)
  const status = JSON.parse(r.stdout) as { Self?: { DNSName?: string } }
  const dns = status.Self?.DNSName?.replace(/\.$/, "")
  if (!dns) throw new Error("tailscale status has no Self.DNSName; is MagicDNS enabled?")
  return dns
}

/**
 * Exposes `localhost:<port>` at https://<host>:443 via `tailscale funnel --bg`.
 * Requires the `funnel` node attribute in the tailnet policy; the CLI prints
 * the fix when it is missing.
 */
export async function startFunnel(port: number): Promise<Funnel> {
  if (!(await tailscaleAvailable())) {
    throw new Error("tailscale is not installed. Install it from https://tailscale.com/download, sign in, then retry.")
  }
  const host = await tailscaleHost()
  const r = await run(["tailscale", "funnel", "--bg", "--https=443", "--yes", `localhost:${port}`])
  if (r.code !== 0) throw new Error(`tailscale funnel failed: ${r.stderr.trim() || r.stdout.trim()}`)
  return {
    host,
    async stop() {
      await run(["tailscale", "funnel", "--https=443", "off"])
    },
  }
}
