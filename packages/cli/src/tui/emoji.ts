/**
 * The emoji you can reach by typing `:name`. A short, hand-picked list rather
 * than the whole of Unicode: a menu you scroll past is not a menu.
 */
export interface Emoji {
  char: string
  name: string
  /** Other things people type for it. */
  also?: string[]
}

export const EMOJI: Emoji[] = [
  { char: "😀", name: "grin" },
  { char: "😄", name: "smile" },
  { char: "😂", name: "joy", also: ["lol"] },
  { char: "🤣", name: "rofl" },
  { char: "🙂", name: "slight_smile" },
  { char: "😉", name: "wink" },
  { char: "😊", name: "blush" },
  { char: "😍", name: "heart_eyes" },
  { char: "😘", name: "kiss" },
  { char: "😎", name: "sunglasses", also: ["cool"] },
  { char: "🤔", name: "thinking", also: ["hmm"] },
  { char: "🙃", name: "upside_down" },
  { char: "😅", name: "sweat_smile" },
  { char: "😭", name: "sob", also: ["cry"] },
  { char: "😢", name: "tear" },
  { char: "😤", name: "huff" },
  { char: "😡", name: "rage", also: ["angry"] },
  { char: "🥺", name: "pleading" },
  { char: "😱", name: "scream" },
  { char: "😴", name: "sleep" },
  { char: "🤯", name: "mind_blown" },
  { char: "🥳", name: "party_face" },
  { char: "😬", name: "grimace" },
  { char: "🙄", name: "eyeroll" },
  { char: "😐", name: "neutral" },
  { char: "🫠", name: "melting" },
  { char: "👍", name: "thumbsup", also: ["+1", "ok", "good"] },
  { char: "👎", name: "thumbsdown", also: ["-1"] },
  { char: "👌", name: "ok_hand" },
  { char: "👏", name: "clap" },
  { char: "🙏", name: "pray", also: ["thanks", "please"] },
  { char: "🙌", name: "raised_hands" },
  { char: "🤝", name: "handshake" },
  { char: "💪", name: "muscle" },
  { char: "👀", name: "eyes", also: ["look"] },
  { char: "🫡", name: "salute" },
  { char: "🤷", name: "shrug" },
  { char: "🤦", name: "facepalm" },
  { char: "❤️", name: "heart", also: ["love"] },
  { char: "💔", name: "broken_heart" },
  { char: "🔥", name: "fire", also: ["lit"] },
  { char: "✨", name: "sparkles" },
  { char: "🎉", name: "tada", also: ["party", "celebrate"] },
  { char: "🎊", name: "confetti" },
  { char: "💯", name: "100" },
  { char: "⚡", name: "zap" },
  { char: "💡", name: "bulb", also: ["idea"] },
  { char: "🚀", name: "rocket", also: ["ship"] },
  { char: "🐛", name: "bug" },
  { char: "🔧", name: "wrench", also: ["fix"] },
  { char: "🔨", name: "hammer" },
  { char: "⚙️", name: "gear" },
  { char: "📦", name: "package" },
  { char: "🧪", name: "test" },
  { char: "✅", name: "check", also: ["done", "green"] },
  { char: "❌", name: "x", also: ["fail", "no"] },
  { char: "⚠️", name: "warning" },
  { char: "🚨", name: "siren", also: ["alert"] },
  { char: "🛑", name: "stop" },
  { char: "⏰", name: "alarm" },
  { char: "⏳", name: "hourglass", also: ["wait"] },
  { char: "📈", name: "chart_up" },
  { char: "📉", name: "chart_down" },
  { char: "💸", name: "money" },
  { char: "☕", name: "coffee" },
  { char: "🍺", name: "beer" },
  { char: "🍜", name: "ramen" },
  { char: "🍕", name: "pizza" },
  { char: "🍰", name: "cake" },
  { char: "🌙", name: "moon", also: ["night"] },
  { char: "☀️", name: "sun" },
  { char: "🌧️", name: "rain" },
  { char: "🐱", name: "cat" },
  { char: "🐶", name: "dog" },
  { char: "🦊", name: "fox" },
  { char: "🐙", name: "octopus" },
  { char: "🐮", name: "cow", also: ["niuma"] },
  { char: "👻", name: "ghost" },
  { char: "💀", name: "skull", also: ["dead"] },
  { char: "🤖", name: "robot", also: ["bot", "ai"] },
  { char: "👋", name: "wave", also: ["hi", "bye"] },
  { char: "🫶", name: "heart_hands" },
  { char: "🎯", name: "target" },
  { char: "🧠", name: "brain" },
  { char: "💤", name: "zzz" },
  { char: "🕐", name: "clock" },
  { char: "📌", name: "pin" },
  { char: "🔗", name: "link" },
  { char: "📝", name: "memo", also: ["note"] },
  { char: "🗑️", name: "trash" },
]

/** The `:name` being typed at the end of the draft, if there is one. */
export function typedShortcode(text: string): string | undefined {
  const m = /(?:^|\s):([a-z0-9_+-]*)$/i.exec(text)
  return m ? m[1]! : undefined
}

/** Emoji whose name or alias starts with the query; an empty query lists the first of them. */
export function emojiMatches(query: string): Emoji[] {
  const q = query.toLowerCase()
  if (!q) return EMOJI
  const starts = EMOJI.filter((e) => e.name.startsWith(q) || e.also?.some((a) => a.startsWith(q)))
  const rest = EMOJI.filter((e) => !starts.includes(e) && (e.name.includes(q) || e.also?.some((a) => a.includes(q))))
  return [...starts, ...rest]
}
