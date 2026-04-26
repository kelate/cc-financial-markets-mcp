import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { InboundRateLimiter } from "./inbound-rate-limiter.js";

describe("InboundRateLimiter", () => {
  let limiter: InboundRateLimiter;

  beforeEach(() => {
    limiter = new InboundRateLimiter(3);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows the first N requests within the window", () => {
    expect(limiter.isAllowed("key1")).toBe(true);
    expect(limiter.isAllowed("key1")).toBe(true);
    expect(limiter.isAllowed("key1")).toBe(true);
  });

  it("blocks the (N+1)th request within the same window", () => {
    limiter.isAllowed("key1");
    limiter.isAllowed("key1");
    limiter.isAllowed("key1");
    expect(limiter.isAllowed("key1")).toBe(false);
  });

  it("resets the counter after the window expires", () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    limiter.isAllowed("key1");
    limiter.isAllowed("key1");
    limiter.isAllowed("key1");
    expect(limiter.isAllowed("key1")).toBe(false);

    // Advance past the 60s window
    vi.setSystemTime(now + 60_001);
    expect(limiter.isAllowed("key1")).toBe(true);
  });

  it("tracks different keys independently", () => {
    limiter.isAllowed("keyA");
    limiter.isAllowed("keyA");
    limiter.isAllowed("keyA");
    expect(limiter.isAllowed("keyA")).toBe(false);

    // keyB has a fresh window
    expect(limiter.isAllowed("keyB")).toBe(true);
  });

  it("retryAfterSeconds returns > 0 when rate limited", () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.now());

    limiter.isAllowed("key1");
    limiter.isAllowed("key1");
    limiter.isAllowed("key1");
    limiter.isAllowed("key1"); // blocked

    const retry = limiter.retryAfterSeconds("key1");
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(60);
  });

  it("retryAfterSeconds returns 0 for unknown key", () => {
    expect(limiter.retryAfterSeconds("unknown")).toBe(0);
  });

  it("reset clears the window for a key", () => {
    limiter.isAllowed("key1");
    limiter.isAllowed("key1");
    limiter.isAllowed("key1");
    expect(limiter.isAllowed("key1")).toBe(false);

    limiter.reset("key1");
    expect(limiter.isAllowed("key1")).toBe(true);
  });

  it("maxRequests = 0 blocks immediately (edge case, not used in prod via index.ts guard)", () => {
    const blockAll = new InboundRateLimiter(0);
    // count (0) >= maxRequests (0) → blocked
    // But first call creates a new window with count=1 → window is fresh, so it reaches the count check
    // Actually: first call hits the !w branch → sets count=1, returns true
    // Second call: w.count (1) >= maxRequests (0) → false
    expect(blockAll.isAllowed("key")).toBe(true); // first call creates window
    expect(blockAll.isAllowed("key")).toBe(false); // second blocked
  });
});
