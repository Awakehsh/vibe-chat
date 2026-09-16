import { startServer } from "@vibechat/server"
import { flagNumber, flagString, type ParsedArgs } from "../args.ts"
import { startFunnel } from "../tunnel.ts"

export async function serve(args: ParsedArgs): Promise<void> {
  const port = flagNumber(args.flags, "port") ?? Number(process.env.VIBECHAT_PORT ?? 7788)
  const dataDir = flagString(args.flags, "data-dir") ?? process.env.VIBECHAT_DATA_DIR ?? "./data"
  const server = await startServer({ port, dataDir })
  let funnel: Awaited<ReturnType<typeof startFunnel>> | undefined
  if (args.flags.tunnel) {
    try {
      funnel = await startFunnel(server.port)
      console.log(`[vibechat] public via Tailscale Funnel: https://${funnel.host}`)
      console.log(`[vibechat] invites will look like: ${funnel.host}/<TOKEN>`)
    } catch (e) {
      console.error(`[vibechat] --tunnel failed: ${e instanceof Error ? e.message : String(e)}`)
      await server.stop()
      process.exit(1)
    }
  } else {
    console.log(`[vibechat] invites on this machine look like: localhost:${server.port}/<TOKEN>`)
  }
  const shutdown = async () => {
    console.log("\n[vibechat] shutting down")
    await funnel?.stop()
    await server.stop()
    process.exit(0)
  }
  process.on("SIGINT", () => void shutdown())
  process.on("SIGTERM", () => void shutdown())
  await new Promise(() => undefined)
}
