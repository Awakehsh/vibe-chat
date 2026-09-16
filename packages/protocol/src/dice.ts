export interface DiceRoll {
  notation: string
  rolls: number[]
  total: number
}

const RE = /^(\d{1,2})?d(\d{1,4})([+-]\d{1,4})?$/i

/** Parse `NdM[+K]` with N ≤ 20, 2 ≤ M ≤ 1000, |K| ≤ 1000. Returns undefined when invalid. */
export function parseDice(text: string): { count: number; sides: number; modifier: number } | undefined {
  const m = RE.exec(text.trim())
  if (!m) return undefined
  const count = m[1] ? Number(m[1]) : 1
  const sides = Number(m[2])
  const modifier = m[3] ? Number(m[3]) : 0
  if (count < 1 || count > 20 || sides < 2 || sides > 1000 || Math.abs(modifier) > 1000) return undefined
  return { count, sides, modifier }
}

export function rollDice(text: string, random: () => number = cryptoRandom): DiceRoll | undefined {
  const parsed = parseDice(text)
  if (!parsed) return undefined
  const rolls: number[] = []
  for (let i = 0; i < parsed.count; i++) rolls.push(1 + Math.floor(random() * parsed.sides))
  const total = rolls.reduce((a, b) => a + b, 0) + parsed.modifier
  const mod = parsed.modifier === 0 ? "" : parsed.modifier > 0 ? `+${parsed.modifier}` : `${parsed.modifier}`
  return { notation: `${parsed.count}d${parsed.sides}${mod}`, rolls, total }
}

function cryptoRandom(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32
}
