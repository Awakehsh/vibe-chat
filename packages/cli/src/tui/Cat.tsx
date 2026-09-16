import { theme } from "./theme.ts"

/**
 * The mascot: a fluffy kitten in a pink knit hat with antler tips, head
 * tilted to the right. Four rows of block characters. The face row paints
 * fur over an eye-coloured background so the notches in ▙ and ▟ read as two
 * big pupils close together; `blink` closes them for a frame. Each row is
 * shifted one column further right than the one below it, which is the tilt.
 */
export function Cat({ blink = false }: { blink?: boolean }) {
  return (
    <box flexDirection="column" width={11} flexShrink={0}>
      <text>
        {"    "}
        <span fg={theme.catAntler}>▘▝ ▘▝</span>
      </text>
      <text>
        {"   "}
        <span fg={theme.catHat}>▟█████▙</span>
      </text>
      <text>
        {"  "}
        <span fg={theme.catFur}>▐</span>
        <span fg={theme.catFur} bg={theme.catEye}>
          {blink ? "█████" : "█▙█▟█"}
        </span>
        <span fg={theme.catFur}>▌</span>
      </text>
      <text>
        {" "}
        <span fg={theme.catFur}>▝</span>
        <span fg={theme.catWhite}>▀▀▀▀▀</span>
        <span fg={theme.catFur}>▘</span>
      </text>
    </box>
  )
}
