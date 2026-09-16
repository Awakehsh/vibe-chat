import { theme } from "./theme.ts"

export function StatusLine({ left, right, notice }: { left: string; right: string; notice?: string | undefined }) {
  return (
    <box flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2} height={1} flexShrink={0}>
      <text fg={notice ? theme.warn : theme.dim}>{notice ?? left}</text>
      <text fg={theme.dim}>{right}</text>
    </box>
  )
}
