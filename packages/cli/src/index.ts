#!/usr/bin/env bun
import { ConnectionError, RequestError } from "./connection.ts"
import { UsageError, parseArgs } from "./args.ts"

const VERSION = "0.6.1"

const HELP = `vibechat ${VERSION} — terminal chat that looks like work

usage:
  vibechat                          open the chat
  vibechat new <name>               create a group and print its invite
  vibechat join <host/TOKEN>        join a group
  vibechat send --room <name> <text> post a message (or pipe stdin)
  vibechat serve [--port N] [--data-dir DIR] [--tunnel]
                                    run a server; --tunnel exposes it with Tailscale Funnel
  vibechat id [export|import <file>] show or move your identity
  vibechat update                   replace this binary with the latest release

options:
  --host <host[:port]>   server for new/join when the invite has no host
  --name <name>          name to use when creating your identity
  --insecure             use ws:// for hosts that would default to wss://
  --kitty-keyboard       enable the Kitty keyboard protocol (off by default on Windows)
  --no-notify            disable desktop notifications for this session
  -h, --help             this text
  -v, --version          print the version
`

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv)
  if (args.flags.h || args.flags.help) return console.log(HELP)
  if (args.flags.v || args.flags.version) return console.log(VERSION)
  const [command, ...rest] = args.positional
  const sub = { ...args, positional: rest }
  switch (command) {
    case undefined:
    case "chat":
      return (await import("./tui/main.tsx")).chat(sub, VERSION)
    case "serve":
      return (await import("./commands/serve.ts")).serve(sub)
    case "new":
      return (await import("./commands/new.ts")).newRoom(sub)
    case "join":
      return (await import("./commands/join.ts")).join(sub)
    case "send":
      return (await import("./commands/send.ts")).send(sub)
    case "id":
      return (await import("./commands/id.ts")).id(sub)
    case "update":
      return (await import("./commands/update.ts")).update(sub, VERSION)
    default:
      throw new UsageError(`unknown command "${command}"\n\n${HELP}`)
  }
}

main(process.argv.slice(2)).then(
  () => process.exit(0),
  (e: unknown) => {
    if (e instanceof UsageError) {
      console.error(e.message)
      process.exit(2)
    }
    if (e instanceof RequestError) {
      console.error(`server said ${e.code}: ${e.message}`)
      process.exit(1)
    }
    if (e instanceof ConnectionError) {
      console.error(e.message)
      process.exit(1)
    }
    console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
    process.exit(1)
  },
)
