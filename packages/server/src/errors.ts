import type { ErrorCode } from "@vibechat/protocol"

export class ProtoError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message)
  }
}

export const invalid = (m: string) => new ProtoError("invalid", m)
export const forbidden = (m: string) => new ProtoError("forbidden", m)
export const notFound = (m: string) => new ProtoError("not_found", m)
export const conflict = (m: string) => new ProtoError("conflict", m)
export const tooLarge = (m: string) => new ProtoError("too_large", m)
export const limitReached = (m: string) => new ProtoError("limit_reached", m)
