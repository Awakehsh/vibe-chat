/** Limits advertised in `hello` and enforced by the server. See docs/protocol.md §7. */
export interface Limits {
  frameBytes: number
  messageBytes: number
  fileBytes: number
  roomStorageBytes: number
  roomMembers: number
  roomsPerUser: number
  nameChars: number
  statusChars: number
  historyPage: number
  syncMessages: number
  inactiveRoomDays: number
}

export const DEFAULT_LIMITS: Limits = {
  frameBytes: 3 * 1024 * 1024,
  messageBytes: 4096,
  fileBytes: 2 * 1024 * 1024,
  roomStorageBytes: 200 * 1024 * 1024,
  roomMembers: 50,
  roomsPerUser: 100,
  nameChars: 32,
  statusChars: 64,
  historyPage: 200,
  syncMessages: 200,
  inactiveRoomDays: 180,
}

export const PROTOCOL_VERSION = 0

/** Prefix of the string a client signs to prove key ownership. */
export const AUTH_SIGN_PREFIX = "vibechat-auth-v0:"

/** Client must ping at least this often; server closes after HEARTBEAT_TIMEOUT_MS of silence. */
export const HEARTBEAT_INTERVAL_MS = 30_000
export const HEARTBEAT_TIMEOUT_MS = 90_000
export const NONCE_TTL_MS = 60_000
export const SESSION_GRACE_MS = 60_000
export const TYPING_TTL_MS = 5_000
