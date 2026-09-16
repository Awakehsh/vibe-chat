/** Token bucket: `capacity` tokens, refilled continuously at `capacity` per `windowMs`. */
export class TokenBucket {
  private tokens: number
  private last: number

  constructor(
    private readonly capacity: number,
    private readonly windowMs: number,
    now: number = Date.now(),
  ) {
    this.tokens = capacity
    this.last = now
  }

  /** Returns 0 when a token was taken, else the ms until one is available. */
  take(now: number = Date.now()): number {
    const refill = ((now - this.last) / this.windowMs) * this.capacity
    this.tokens = Math.min(this.capacity, this.tokens + refill)
    this.last = now
    if (this.tokens >= 1) {
      this.tokens -= 1
      return 0
    }
    return Math.ceil(((1 - this.tokens) / this.capacity) * this.windowMs)
  }
}
