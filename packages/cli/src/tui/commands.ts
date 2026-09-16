export interface SlashCommand {
  name: string
  args: string
  description: string
}

export const COMMANDS: SlashCommand[] = [
  { name: "help", args: "", description: "list commands and keys" },
  { name: "rooms", args: "", description: "list your rooms" },
  { name: "room", args: "<name>", description: "switch to a room (also Ctrl+K)" },
  { name: "server", args: "[host[:port]]", description: "show or set the default server for /new" },
  { name: "new", args: "<name>", description: "create a group on your default server" },
  { name: "join", args: "<host/TOKEN>", description: "join a group" },
  { name: "invite", args: "", description: "show this room's invite code" },
  { name: "members", args: "", description: "who is in this room" },
  { name: "dm", args: "<name>", description: "open a direct message with a member" },
  { name: "me", args: "<action>", description: "* you <action>" },
  { name: "roll", args: "<NdM[+K]>", description: "roll dice, e.g. 2d6+1" },
  { name: "poll", args: "<question> | <a> | <b>", description: "start a poll" },
  { name: "vote", args: "<n>", description: "vote on the latest poll" },
  { name: "react", args: "<emoji>", description: "react to the latest message from someone else" },
  { name: "status", args: "<text> [emoji]", description: "set your status line" },
  { name: "leave", args: "", description: "leave this room" },
  { name: "quit", args: "", description: "exit (also Ctrl+C twice)" },
]

export interface ParsedCommand {
  name: string
  rest: string
}

/** Returns the command when `text` is `/name ...`, else undefined. */
export function parseCommand(text: string): ParsedCommand | undefined {
  const m = /^\/([a-z]+)(?:\s+([\s\S]*))?$/.exec(text.trim())
  if (!m) return undefined
  return { name: m[1]!, rest: (m[2] ?? "").trim() }
}

/** Commands whose name starts with the partial word after `/` (only while no space typed yet). */
export function completions(text: string): SlashCommand[] {
  const m = /^\/([a-z]*)$/.exec(text)
  if (!m) return []
  return COMMANDS.filter((c) => c.name.startsWith(m[1]!))
}

/** `question | a | b` → poll payload, or an error string. */
export function parsePoll(rest: string): { question: string; options: string[] } | string {
  const parts = rest
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length < 3) return "usage: /poll <question> | <option> | <option> [| more]"
  if (parts.length > 10) return "at most 9 options"
  return { question: parts[0]!, options: parts.slice(1) }
}

/** `text [emoji]` → status; a trailing single-grapheme token that is not a letter is the emoji. */
export function parseStatus(rest: string): { text: string; emoji?: string } {
  const tokens = rest.split(/\s+/).filter(Boolean)
  const last = tokens.at(-1)
  if (last && [...last].length <= 2 && !/^[\p{L}\p{N}\p{P}]+$/u.test(last)) {
    return { text: tokens.slice(0, -1).join(" "), emoji: last }
  }
  return { text: rest }
}
