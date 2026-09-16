import type { ParsedArgs } from "../args.ts"

export async function chat(_args: ParsedArgs): Promise<void> {
  throw new Error("the chat UI is not wired up yet")
}
