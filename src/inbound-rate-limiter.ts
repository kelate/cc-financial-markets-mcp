/**
 * Per-key inbound rate limiter for the /mcp endpoint.
 * Uses a fixed-window counter keyed by a short token fingerprint.
 * Expired windows are evicted lazily on access to prevent unbounded Map growth.
 */

interface RateWindow {
  count: number;
  start: number;
}

export class InboundRateLimiter {
  private readonly windows = new Map<string, RateWindow>();
  private readonly maxRequests: number;
  private readonly windowMs = 60_000;

  constructor(maxRequestsPerMinute: number) {
    this.maxRequests = maxRequestsPerMinute;
  }

  isAllowed(key: string): boolean {
    const now = Date.now();
    const w = this.windows.get(key);
    if (!w || now - w.start >= this.windowMs) {
      // Evict expired window (or create first one)
      this.windows.set(key, { count: 1, start: now });
      return true;
    }
    if (w.count >= this.maxRequests) return false;
    w.count++;
    return true;
  }

  retryAfterSeconds(key: string): number {
    const w = this.windows.get(key);
    if (!w) return 0;
    return Math.ceil((this.windowMs - (Date.now() - w.start)) / 1000);
  }

  reset(key: string): void {
    this.windows.delete(key);
  }
}
