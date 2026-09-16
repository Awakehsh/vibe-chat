/**
 * Pixel sprites for the terminal. A sprite is a list of equally long strings;
 * each character is one pixel and maps to a colour, `.` is transparent. Two
 * pixel rows share one terminal row: the top pixel is drawn as ▀ in the
 * foreground colour and the bottom pixel as the cell background, so every
 * pixel is exactly half a cell in any monospace font.
 */
export type Palette = Record<string, string>

export interface SpriteFrame {
  rows: string[]
  palette: Palette
}

interface Cell {
  ch: string
  fg?: string
  bg?: string
}

export function spriteCells(frame: SpriteFrame): Cell[][] {
  const { rows, palette } = frame
  const out: Cell[][] = []
  for (let r = 0; r < rows.length; r += 2) {
    const top = rows[r]!
    const bottom = rows[r + 1] ?? ""
    const line: Cell[] = []
    for (let c = 0; c < top.length; c++) {
      const t = top[c] === "." ? undefined : palette[top[c]!]
      const b = !bottom[c] || bottom[c] === "." ? undefined : palette[bottom[c]!]
      if (!t && !b) line.push({ ch: " " })
      else if (t && !b) line.push({ ch: "▀", fg: t })
      else if (!t && b) line.push({ ch: "▄", fg: b })
      else line.push({ ch: "▀", fg: t!, bg: b! })
    }
    out.push(line)
  }
  return out
}

export function spriteWidth(frame: SpriteFrame): number {
  return frame.rows[0]?.length ?? 0
}

export function spriteHeight(frame: SpriteFrame): number {
  return Math.ceil(frame.rows.length / 2)
}

/** Closes every eye: in each column, a vertical run of eye pixels keeps only its bottom pixel. */
export function closeEyes(frame: SpriteFrame, eyeKeys: string, fill: string): SpriteFrame {
  const g = frame.rows.map((r) => r.split(""))
  const w = g[0]?.length ?? 0
  for (let c = 0; c < w; c++) {
    let r = 0
    while (r < g.length) {
      if (eyeKeys.includes(g[r]![c]!)) {
        let end = r
        while (end + 1 < g.length && eyeKeys.includes(g[end + 1]![c]!)) end++
        for (let k = r; k < end; k++) g[k]![c] = fill
        g[end]![c] = "e"
        r = end + 1
      } else r++
    }
  }
  return { rows: g.map((r) => r.join("")), palette: frame.palette }
}

export function Sprite({ frame }: { frame: SpriteFrame }) {
  const cells = spriteCells(frame)
  return (
    <box flexDirection="column" width={spriteWidth(frame)} height={spriteHeight(frame)} flexShrink={0}>
      {cells.map((line, i) => (
        <text key={i}>
          {line.map((cell, j) =>
            cell.bg ? (
              <span key={j} fg={cell.fg ?? cell.bg} bg={cell.bg}>
                {cell.ch}
              </span>
            ) : cell.fg ? (
              <span key={j} fg={cell.fg}>
                {cell.ch}
              </span>
            ) : (
              <span key={j}>{cell.ch}</span>
            ),
          )}
        </text>
      ))}
    </box>
  )
}
