import { theme } from "./theme.ts"

/**
 * The mascot: a 8×3 pixel cat built from block characters. The face row
 * paints the body colour over an eye-coloured background, so the notches in
 * ▛ and ▜ read as pupils. `blink` closes the eyes for a frame.
 */
export function Cat({ blink = false }: { blink?: boolean }) {
  return (
    <box flexDirection="column" width={9} flexShrink={0}>
      <text fg={theme.cat}> ▟▙   ▟▙</text>
      <text>
        <span fg={theme.cat}> ▐</span>
        <span fg={theme.cat} bg={theme.catEye}>
          {blink ? "█████" : "▛███▜"}
        </span>
        <span fg={theme.cat}>▌</span>
      </text>
      <text fg={theme.cat}> ▝▀▀▀▀▀▘</text>
    </box>
  )
}
