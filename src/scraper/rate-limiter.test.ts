import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limiter.js";

describe("RateLimiter", () => {
  it("allows requests up to the limit", async () => {
    const limiter = new RateLimiter(10);
    expect(limiter.availableTokens).toBe(10);

    await limiter.acquire();
    expect(limiter.availableTokens).toBe(9);
  });

  it("drains tokens on repeated acquire", async () => {
    const limiter = new RateLimiter(3);
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    // Should have 0 tokens now (may have refilled slightly due to timing)
    expect(limiter.availableTokens).toBeLessThanOrEqual(1);
  });

  it("blocks when no tokens available and eventually resolves", async () => {
    const limiter = new RateLimiter(60); // 1 per second
    // Drain all
    for (let i = 0; i < 60; i++) {
      await limiter.acquire();
    }
    // Next acquire should wait but resolve
    const start = Date.now();
    await limiter.acquire();
    const elapsed = Date.now() - start;
    // Should have waited at least ~50ms (the minimum wait floor)
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });
});
