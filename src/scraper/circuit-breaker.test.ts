import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CircuitBreaker, CircuitOpenError } from "./circuit-breaker.js";

describe("CircuitBreaker", () => {
  describe("initial state", () => {
    it("starts in CLOSED state", () => {
      const breaker = new CircuitBreaker();
      expect(breaker.currentState).toBe("CLOSED");
    });

    it("uses default options when none provided", async () => {
      const breaker = new CircuitBreaker();
      // Default failureThreshold = 3 → first 2 failures keep CLOSED, 3rd opens
      await expect(breaker.call(async () => { throw new Error("fail"); })).rejects.toThrow("fail");
      await expect(breaker.call(async () => { throw new Error("fail"); })).rejects.toThrow("fail");
      expect(breaker.currentState).toBe("CLOSED");
      await expect(breaker.call(async () => { throw new Error("fail"); })).rejects.toThrow("fail");
      expect(breaker.currentState).toBe("OPEN");
    });
  });

  describe("CLOSED → OPEN transition", () => {
    it("opens after failureThreshold consecutive failures", async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 3 });
      const failing = vi.fn(async () => { throw new Error("boom"); });

      for (let i = 0; i < 3; i++) {
        await expect(breaker.call(failing)).rejects.toThrow("boom");
      }
      expect(breaker.currentState).toBe("OPEN");
      expect(failing).toHaveBeenCalledTimes(3);
    });

    it("resets failure count on success in CLOSED state", async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 3 });
      await expect(breaker.call(async () => { throw new Error("fail"); })).rejects.toThrow();
      await expect(breaker.call(async () => { throw new Error("fail"); })).rejects.toThrow();
      // success resets the counter
      await expect(breaker.call(async () => "ok")).resolves.toBe("ok");
      // 2 more failures should NOT open the circuit (counter was reset)
      await expect(breaker.call(async () => { throw new Error("fail"); })).rejects.toThrow();
      await expect(breaker.call(async () => { throw new Error("fail"); })).rejects.toThrow();
      expect(breaker.currentState).toBe("CLOSED");
    });
  });

  describe("OPEN state", () => {
    it("throws CircuitOpenError without calling fn when OPEN", async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 1, timeoutMs: 30_000 });
      await expect(breaker.call(async () => { throw new Error("fail"); })).rejects.toThrow("fail");
      expect(breaker.currentState).toBe("OPEN");

      const fn = vi.fn(async () => "should-not-run");
      await expect(breaker.call(fn)).rejects.toBeInstanceOf(CircuitOpenError);
      expect(fn).not.toHaveBeenCalled();
    });

    it("CircuitOpenError is identifiable via instanceof", async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 1 });
      await expect(breaker.call(async () => { throw new Error("fail"); })).rejects.toThrow();

      try {
        await breaker.call(async () => "x");
        expect.fail("expected CircuitOpenError to be thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(CircuitOpenError);
        expect((e as Error).name).toBe("CircuitOpenError");
      }
    });
  });

  describe("OPEN → HALF_OPEN transition (timeout)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("transitions to HALF_OPEN after timeoutMs elapses", async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 1, timeoutMs: 5_000 });
      await expect(breaker.call(async () => { throw new Error("fail"); })).rejects.toThrow();
      expect(breaker.currentState).toBe("OPEN");

      // Before timeout: still OPEN
      vi.advanceTimersByTime(4_999);
      const fn1 = vi.fn(async () => "ok");
      await expect(breaker.call(fn1)).rejects.toBeInstanceOf(CircuitOpenError);
      expect(fn1).not.toHaveBeenCalled();

      // After timeout: probe is allowed (HALF_OPEN), and on success closes circuit
      vi.advanceTimersByTime(2);
      const fn2 = vi.fn(async () => "ok");
      await expect(breaker.call(fn2)).resolves.toBe("ok");
      expect(fn2).toHaveBeenCalledTimes(1);
      expect(breaker.currentState).toBe("CLOSED");
    });
  });

  describe("HALF_OPEN behaviour", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("HALF_OPEN: success transitions back to CLOSED", async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 1, successThreshold: 1, timeoutMs: 1_000 });
      await expect(breaker.call(async () => { throw new Error("fail"); })).rejects.toThrow();
      vi.advanceTimersByTime(1_000);

      await expect(breaker.call(async () => "ok")).resolves.toBe("ok");
      expect(breaker.currentState).toBe("CLOSED");
    });

    it("HALF_OPEN: failure re-opens the circuit immediately", async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 2, timeoutMs: 1_000 });
      await expect(breaker.call(async () => { throw new Error("fail"); })).rejects.toThrow();
      await expect(breaker.call(async () => { throw new Error("fail"); })).rejects.toThrow();
      expect(breaker.currentState).toBe("OPEN");

      vi.advanceTimersByTime(1_000);

      // First call after timeout → HALF_OPEN, fails → back to OPEN
      await expect(breaker.call(async () => { throw new Error("still-failing"); })).rejects.toThrow("still-failing");
      expect(breaker.currentState).toBe("OPEN");

      // Subsequent call should short-circuit again
      const fn = vi.fn(async () => "x");
      await expect(breaker.call(fn)).rejects.toBeInstanceOf(CircuitOpenError);
      expect(fn).not.toHaveBeenCalled();
    });

    it("HALF_OPEN: respects successThreshold > 1", async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 1, successThreshold: 2, timeoutMs: 1_000 });
      await expect(breaker.call(async () => { throw new Error("fail"); })).rejects.toThrow();
      vi.advanceTimersByTime(1_000);

      // First success in HALF_OPEN: still HALF_OPEN (threshold = 2)
      await expect(breaker.call(async () => "ok")).resolves.toBe("ok");
      expect(breaker.currentState).toBe("HALF_OPEN");

      // Second success: now CLOSED
      await expect(breaker.call(async () => "ok")).resolves.toBe("ok");
      expect(breaker.currentState).toBe("CLOSED");
    });
  });

  describe("retryAfterMs", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns 0 when CLOSED", () => {
      const breaker = new CircuitBreaker();
      expect(breaker.retryAfterMs()).toBe(0);
    });

    it("returns remaining cooldown when OPEN", async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 1, timeoutMs: 10_000 });
      await expect(breaker.call(async () => { throw new Error("fail"); })).rejects.toThrow();

      expect(breaker.retryAfterMs()).toBe(10_000);
      vi.advanceTimersByTime(3_000);
      expect(breaker.retryAfterMs()).toBe(7_000);
    });
  });

  describe("reset", () => {
    it("returns the breaker to CLOSED with cleared counters", async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 2 });
      await expect(breaker.call(async () => { throw new Error("fail"); })).rejects.toThrow();
      await expect(breaker.call(async () => { throw new Error("fail"); })).rejects.toThrow();
      expect(breaker.currentState).toBe("OPEN");

      breaker.reset();
      expect(breaker.currentState).toBe("CLOSED");
      expect(breaker.retryAfterMs()).toBe(0);

      // After reset, the circuit accepts new calls and re-counts from zero
      const fn = vi.fn(async () => "ok");
      await expect(breaker.call(fn)).resolves.toBe("ok");
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});
