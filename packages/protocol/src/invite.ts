const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
export const INVITE_TOKEN_LENGTH = 10
const TOKEN_RE = /^[0-9A-HJKMNP-TV-Z]{10}$/

/** 10 Crockford base32 chars from 50 random bits. */
export function generateInviteToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(INVITE_TOKEN_LENGTH))
  let out = ""
  for (const b of bytes) out += CROCKFORD[b & 31]
  return out
}

export function isInviteToken(text: string): boolean {
  return TOKEN_RE.test(text)
}

export interface ParsedInvite {
  /** `host[:port]`, or undefined when the code carried no host. */
  host?: string
  token: string
}

/**
 * Accepts `host/TOKEN`, `TOKEN`, `https://host/i/TOKEN`, `http://host/i/TOKEN`.
 * Tokens are normalised to uppercase; lowercase `i l o u` are not corrected.
 */
export function parseInvite(text: string): ParsedInvite | undefined {
  const s = text.trim()
  const url = /^https?:\/\/([^/]+)\/i\/([^/?#]+)\/?$/i.exec(s)
  if (url) return check(url[1]!, url[2]!)
  const slash = s.lastIndexOf("/")
  if (slash === -1) return check(undefined, s)
  const host = s.slice(0, slash)
  const token = s.slice(slash + 1)
  if (!host || /[\s/]/.test(host)) return undefined
  return check(host, token)
}

function check(host: string | undefined, rawToken: string): ParsedInvite | undefined {
  const token = rawToken.toUpperCase()
  if (!isInviteToken(token)) return undefined
  return host ? { host, token } : { token }
}

export function formatInvite(host: string | undefined, token: string): string {
  return host ? `${host}/${token}` : token
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"])

function isPrivateHost(hostname: string): boolean {
  if (LOOPBACK.has(hostname)) return true
  if (/^10\./.test(hostname) || /^192\.168\./.test(hostname)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true
  return hostname.endsWith(".local")
}

/** Turn an invite host into the WebSocket URL of its server. */
export function socketUrlForHost(host: string, opts: { insecure?: boolean } = {}): string {
  const m = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(host)
  if (!m) throw new Error(`invalid host: ${host}`)
  const hostname = m[1]!
  const port = m[2]
  const plain = opts.insecure === true || (port !== undefined && port !== "443" && isPrivateHost(hostname)) || (port === undefined && LOOPBACK.has(hostname))
  const scheme = plain ? "ws" : "wss"
  return `${scheme}://${hostname}${port ? `:${port}` : ""}/ws`
}
