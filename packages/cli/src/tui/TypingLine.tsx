import { useEffect, useState } from "react"
import { SPINNER_FRAMES, pickVerb } from "./spinner.ts"
import { theme } from "./theme.ts"

/** `✻ Vibing… (bob)` while someone in the room is typing, in the shape of a busy agent. */
export function TypingLine({ names, seed }: { names: string[]; seed: string }) {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 120)
    return () => clearInterval(t)
  }, [])
  return (
    <text fg={theme.spinner}>
      {SPINNER_FRAMES[frame]} {pickVerb(seed)}… <span fg={theme.dim}>({names.join(", ")})</span>
    </text>
  )
}
