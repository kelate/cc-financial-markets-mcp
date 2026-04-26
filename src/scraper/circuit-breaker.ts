/**
 * Circuit breaker for the scraper fetcher.
 *
 * Wraps a function call with a 3-state machine (CLOSED → OPEN → HALF_OPEN)
 * to short-circuit requests when the underlying service is failing repeatedly.
 *
 * - CLOSED:    requests pass through; consecutive failures are counted.
 * - OPEN:      requests fail immediately with `CircuitOpenError` until the cooldown elapses.
 * - HALF_OPEN: a probe request is allowed; success closes the circuit, failure re-opens it.
 */

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  /** Consecutive failures before transitioning CLOSED → OPEN. */
  failureThreshold: number;
  /** Consecutive successes in HALF_OPEN to transition back to CLOSED. */
  successThreshold: number;
  /** Cooldown (ms) before transitioning OPEN → HALF_OPEN. */
  timeoutMs: number;
}

export class CircuitOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CircuitOpenError";
  }
}

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failureCount = 0;
  private successCount = 0;
  private openedAt: number | null = null;
  private readonly options: Required<CircuitBreakerOptions>;

  constructor(options: Partial<CircuitBreakerOptions> = {}) {
    this.options = {
      failureThreshold: options.failureThreshold ?? 3,
      successThreshold: options.successThreshold ?? 1,
      timeoutMs: options.timeoutMs ?? 30_000,
    };
  }

  get currentState(): CircuitState {
    return this.state;
  }

  /**
   * Execute `fn` through the breaker.
   * Throws `CircuitOpenError` immediately when the circuit is OPEN and the cooldown hasn't elapsed.
   */
  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "OPEN") {
      if (Date.now() - (this.openedAt ?? 0) >= this.options.timeoutMs) {
        this.state = "HALF_OPEN";
        this.successCount = 0;
      } else {
        throw new CircuitOpenError(
          `Circuit breaker open — service unavailable. Retry after ${this.retryAfterMs()}ms`,
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (e) {
      this.onFailure();
      throw e;
    }
  }

  retryAfterMs(): number {
    if (this.state !== "OPEN" || this.openedAt === null) return 0;
    return Math.max(0, this.options.timeoutMs - (Date.now() - this.openedAt));
  }

  reset(): void {
    this.state = "CLOSED";
    this.failureCount = 0;
    this.successCount = 0;
    this.openedAt = null;
  }

  private onSuccess(): void {
    if (this.state === "HALF_OPEN") {
      this.successCount++;
      if (this.successCount >= this.options.successThreshold) {
        this.state = "CLOSED";
        this.failureCount = 0;
        this.openedAt = null;
      }
    } else {
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    if (this.state === "HALF_OPEN" || this.failureCount >= this.options.failureThreshold) {
      this.state = "OPEN";
      this.openedAt = Date.now();
    }
  }
}
