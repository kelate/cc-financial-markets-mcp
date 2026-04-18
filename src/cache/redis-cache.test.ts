/**
 * Unit tests for RedisCache
 * Redis client is fully mocked — no real connection required.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock ioredis before importing RedisCache ──────────────────────────────────

const mockGet    = vi.fn();
const mockSet    = vi.fn();
const mockSetex  = vi.fn();
const mockDel    = vi.fn();
const mockPing   = vi.fn();
const mockOn     = vi.fn();

vi.mock("ioredis", () => ({
  Redis: vi.fn().mockImplementation(() => ({
    get:    mockGet,
    set:    mockSet,
    setex:  mockSetex,
    del:    mockDel,
    ping:   mockPing,
    on:     mockOn,
  })),
}));

import { RedisCache } from "./redis-cache.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCache(url = "redis://localhost:6379"): RedisCache {
  return new RedisCache(url);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("RedisCache — mode désactivé (pas de REDIS_URL)", () => {
  let cache: RedisCache;

  beforeEach(() => {
    cache = new RedisCache("");
  });

  it("enabled est false", () => {
    expect(cache.enabled).toBe(false);
  });

  it("get() retourne null sans appel Redis", async () => {
    const result = await cache.get("key");
    expect(result).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("set() ne fait rien sans appel Redis", async () => {
    await cache.set("key", { val: 1 });
    expect(mockSet).not.toHaveBeenCalled();
    expect(mockSetex).not.toHaveBeenCalled();
  });

  it("getRaw() retourne null", async () => {
    expect(await cache.getRaw("key")).toBeNull();
  });

  it("setRaw() ne fait rien", async () => {
    await cache.setRaw("key", "value");
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("acquireLock() retourne true (fail-open)", async () => {
    expect(await cache.acquireLock("lock:key", 30)).toBe(true);
  });

  it("releaseLock() ne fait rien", async () => {
    await cache.releaseLock("lock:key");
    expect(mockDel).not.toHaveBeenCalled();
  });

  it("ping() retourne false", async () => {
    expect(await cache.ping()).toBe(false);
  });
});

describe("RedisCache — mode activé (avec REDIS_URL)", () => {
  let cache: RedisCache;

  beforeEach(() => {
    vi.clearAllMocks();
    cache = makeCache();
  });

  it("enabled est true", () => {
    expect(cache.enabled).toBe(true);
  });

  // ── get ───────────────────────────────────────────────────────────────────

  describe("get()", () => {
    it("retourne la valeur désérialisée si clé présente", async () => {
      mockGet.mockResolvedValueOnce(JSON.stringify({ price: 15000 }));
      const result = await cache.get<{ price: number }>("market:brvm");
      expect(result).toEqual({ price: 15000 });
    });

    it("retourne null si clé absente", async () => {
      mockGet.mockResolvedValueOnce(null);
      expect(await cache.get("missing")).toBeNull();
    });

    it("retourne null et ne lève pas si Redis échoue", async () => {
      mockGet.mockRejectedValueOnce(new Error("ECONNRESET"));
      expect(await cache.get("key")).toBeNull();
    });
  });

  // ── set ───────────────────────────────────────────────────────────────────

  describe("set()", () => {
    it("utilise setex quand ttlSeconds > 0", async () => {
      mockSetex.mockResolvedValueOnce("OK");
      await cache.set("market:brvm", { stocks: [] }, 300);
      expect(mockSetex).toHaveBeenCalledWith("market:brvm", 300, expect.any(String));
    });

    it("utilise set sans TTL quand ttlSeconds absent", async () => {
      mockSet.mockResolvedValueOnce("OK");
      await cache.set("key", { x: 1 });
      expect(mockSet).toHaveBeenCalledWith("key", expect.any(String));
      expect(mockSetex).not.toHaveBeenCalled();
    });

    it("ne lève pas si Redis échoue", async () => {
      mockSetex.mockRejectedValueOnce(new Error("ECONNRESET"));
      await expect(cache.set("key", { x: 1 }, 60)).resolves.toBeUndefined();
    });
  });

  // ── getRaw / setRaw ───────────────────────────────────────────────────────

  describe("getRaw()", () => {
    it("retourne la chaîne brute", async () => {
      mockGet.mockResolvedValueOnce("2025-01-01T12:00:00.000Z");
      expect(await cache.getRaw("fresh:brvm")).toBe("2025-01-01T12:00:00.000Z");
    });

    it("retourne null si clé absente", async () => {
      mockGet.mockResolvedValueOnce(null);
      expect(await cache.getRaw("missing")).toBeNull();
    });
  });

  describe("setRaw()", () => {
    it("utilise setex avec TTL", async () => {
      mockSetex.mockResolvedValueOnce("OK");
      await cache.setRaw("fresh:brvm", "2025-01-01T12:00:00.000Z", 60);
      expect(mockSetex).toHaveBeenCalledWith("fresh:brvm", 60, "2025-01-01T12:00:00.000Z");
    });

    it("utilise set sans TTL", async () => {
      mockSet.mockResolvedValueOnce("OK");
      await cache.setRaw("fresh:brvm", "2025-01-01T12:00:00.000Z");
      expect(mockSet).toHaveBeenCalledWith("fresh:brvm", "2025-01-01T12:00:00.000Z");
    });
  });

  // ── acquireLock ───────────────────────────────────────────────────────────

  describe("acquireLock()", () => {
    it("retourne true quand SET NX réussit (verrou acquis)", async () => {
      mockSet.mockResolvedValueOnce("OK");
      expect(await cache.acquireLock("lock:brvm", 120)).toBe(true);
      expect(mockSet).toHaveBeenCalledWith("lock:brvm", "1", "EX", 120, "NX");
    });

    it("retourne false quand le verrou est déjà pris", async () => {
      mockSet.mockResolvedValueOnce(null);
      expect(await cache.acquireLock("lock:brvm", 120)).toBe(false);
    });

    it("retourne true (fail-open) si Redis échoue", async () => {
      mockSet.mockRejectedValueOnce(new Error("timeout"));
      expect(await cache.acquireLock("lock:brvm", 120)).toBe(true);
    });
  });

  // ── releaseLock ───────────────────────────────────────────────────────────

  describe("releaseLock()", () => {
    it("appelle del sur la clé du verrou", async () => {
      mockDel.mockResolvedValueOnce(1);
      await cache.releaseLock("lock:brvm");
      expect(mockDel).toHaveBeenCalledWith("lock:brvm");
    });

    it("ne lève pas si Redis échoue", async () => {
      mockDel.mockRejectedValueOnce(new Error("ERR"));
      await expect(cache.releaseLock("lock:brvm")).resolves.toBeUndefined();
    });
  });

  // ── ping ──────────────────────────────────────────────────────────────────

  describe("ping()", () => {
    it("retourne true si Redis répond PONG", async () => {
      mockPing.mockResolvedValueOnce("PONG");
      expect(await cache.ping()).toBe(true);
    });

    it("retourne false si Redis ne répond pas PONG", async () => {
      mockPing.mockResolvedValueOnce("ERROR");
      expect(await cache.ping()).toBe(false);
    });

    it("retourne false si Redis échoue", async () => {
      mockPing.mockRejectedValueOnce(new Error("timeout"));
      expect(await cache.ping()).toBe(false);
    });
  });
});
