import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache } from "./cache.js";

describe("Cache", () => {
  let cache: Cache;

  beforeEach(() => {
    cache = new Cache(60); // 60s default TTL
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stores and retrieves values", () => {
    cache.set("key1", { data: "hello" });
    expect(cache.get("key1")).toEqual({ data: "hello" });
  });

  it("returns undefined for missing keys", () => {
    expect(cache.get("nonexistent")).toBeUndefined();
  });

  it("evicts entries after TTL expires", () => {
    vi.useFakeTimers();
    cache.set("key1", "value1");
    expect(cache.get("key1")).toBe("value1");

    vi.advanceTimersByTime(61_000);
    expect(cache.get("key1")).toBeUndefined();
    vi.useRealTimers();
  });

  it("supports custom TTL per entry", () => {
    vi.useFakeTimers();
    cache.set("short", "data", 5);
    cache.set("long", "data", 120);

    vi.advanceTimersByTime(6_000);
    expect(cache.get("short")).toBeUndefined();
    expect(cache.get("long")).toBe("data");
    vi.useRealTimers();
  });

  it("deletes entries", () => {
    cache.set("key1", "value1");
    expect(cache.delete("key1")).toBe(true);
    expect(cache.get("key1")).toBeUndefined();
  });

  it("clears all entries", () => {
    cache.set("a", 1);
    cache.set("b", 2);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("reports correct size excluding expired", () => {
    vi.useFakeTimers();
    cache.set("a", 1, 10);
    cache.set("b", 2, 120);
    expect(cache.size).toBe(2);

    vi.advanceTimersByTime(11_000);
    expect(cache.size).toBe(1);
    vi.useRealTimers();
  });

  it("has() returns false for expired entries", () => {
    vi.useFakeTimers();
    cache.set("key1", "value1", 1);
    expect(cache.has("key1")).toBe(true);

    vi.advanceTimersByTime(2_000);
    expect(cache.has("key1")).toBe(false);
    vi.useRealTimers();
  });
});
