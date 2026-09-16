import { Audio } from "@opentui/core"

/**
 * A short two-note chime, generated in memory so there is nothing to ship.
 * Audio is best-effort: any failure (no device, no native library) is silent.
 */
export interface Chime {
  play(): void
  dispose(): void
}

function wav(): Uint8Array {
  const rate = 22050
  const notes: [number, number][] = [
    [880, 0.09],
    [1320, 0.12],
  ]
  const total = Math.round(rate * notes.reduce((n, [, d]) => n + d, 0))
  const data = new Int16Array(total)
  let i = 0
  for (const [freq, dur] of notes) {
    const n = Math.round(rate * dur)
    for (let k = 0; k < n; k++, i++) {
      const env = Math.min(1, k / 200, (n - k) / 400)
      data[i] = Math.round(Math.sin((2 * Math.PI * freq * k) / rate) * 0.35 * env * 32767)
    }
  }
  const buf = new ArrayBuffer(44 + data.byteLength)
  const v = new DataView(buf)
  const str = (o: number, s: string) => [...s].forEach((c, j) => v.setUint8(o + j, c.charCodeAt(0)))
  str(0, "RIFF")
  v.setUint32(4, 36 + data.byteLength, true)
  str(8, "WAVE")
  str(12, "fmt ")
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, "data")
  v.setUint32(40, data.byteLength, true)
  new Uint8Array(buf, 44).set(new Uint8Array(data.buffer))
  return new Uint8Array(buf)
}

export function createChime(): Chime {
  let audio: Audio | undefined
  let sound: ReturnType<Audio["loadSound"]> | undefined
  const init = () => {
    if (audio !== undefined) return
    try {
      audio = Audio.create({ autoStart: true })
      sound = audio.loadSound(wav())
    } catch {
      audio = undefined
    }
  }
  return {
    play() {
      try {
        init()
        if (audio && sound) audio.play(sound, { volume: 0.6 })
      } catch {
        // best-effort
      }
    },
    dispose() {
      try {
        audio?.dispose()
      } catch {
        // ignore
      }
    },
  }
}
