// ---------------------------------------------------------------------------
// Tests for the MemoryCache (LRU cache with TTL).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { MemoryCache } from "../../../src/cache/memory-cache.js";

describe("MemoryCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Basic get / set ─────────────────────────────────────────────────────

  it("returns null for a key that was never set", () => {
    const cache = new MemoryCache<string>(10);
    expect(cache.get("missing")).toBeNull();
  });

  it("can set and get a value", () => {
    const cache = new MemoryCache<string>(10);
    cache.set("key1", "value1");
    expect(cache.get("key1")).toBe("value1");
  });

  it("overwrites an existing key with a new value", () => {
    const cache = new MemoryCache<number>(10);
    cache.set("k", 1);
    cache.set("k", 2);
    expect(cache.get("k")).toBe(2);
  });

  // ── TTL expiry ──────────────────────────────────────────────────────────

  it("returns null for an expired entry", () => {
    const cache = new MemoryCache<string>(10);
    cache.set("k", "v", 500);
    vi.advanceTimersByTime(501);
    expect(cache.get("k")).toBeNull();
  });

  it("returns the value before TTL has elapsed", () => {
    const cache = new MemoryCache<string>(10);
    cache.set("k", "v", 1000);
    vi.advanceTimersByTime(999);
    expect(cache.get("k")).toBe("v");
  });

  it("removes expired entries from the store on get", () => {
    const cache = new MemoryCache<string>(10);
    cache.set("k", "v", 100);
    expect(cache.size).toBe(1);
    vi.advanceTimersByTime(101);
    cache.get("k"); // triggers lazy removal
    expect(cache.size).toBe(0);
  });

  // ── LRU eviction ───────────────────────────────────────────────────────

  it("evicts the least recently used entry when at capacity", () => {
    const cache = new MemoryCache<string>(2);
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3"); // should evict "a"
    expect(cache.get("a")).toBeNull();
    expect(cache.get("b")).toBe("2");
    expect(cache.get("c")).toBe("3");
  });

  it("promotes accessed entry so it is not evicted next", () => {
    const cache = new MemoryCache<string>(2);
    cache.set("a", "1");
    cache.set("b", "2");
    cache.get("a"); // promote "a" to most recently used
    cache.set("c", "3"); // should evict "b" (least recently used)
    expect(cache.get("a")).toBe("1");
    expect(cache.get("b")).toBeNull();
    expect(cache.get("c")).toBe("3");
  });

  // ── Size limits ─────────────────────────────────────────────────────────

  it("size returns the number of entries", () => {
    const cache = new MemoryCache<string>(10);
    expect(cache.size).toBe(0);
    cache.set("a", "1");
    expect(cache.size).toBe(1);
    cache.set("b", "2");
    expect(cache.size).toBe(2);
  });

  it("size never exceeds maxEntries", () => {
    const cache = new MemoryCache<string>(3);
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");
    cache.set("d", "4");
    cache.set("e", "5");
    expect(cache.size).toBe(3);
  });

  it("throws RangeError when maxEntries is less than 1", () => {
    expect(() => new MemoryCache<string>(0)).toThrow(RangeError);
    expect(() => new MemoryCache<string>(-1)).toThrow(RangeError);
  });

  // ── delete and clear ────────────────────────────────────────────────────

  it("delete removes a specific key", () => {
    const cache = new MemoryCache<string>(10);
    cache.set("a", "1");
    cache.delete("a");
    expect(cache.get("a")).toBeNull();
    expect(cache.size).toBe(0);
  });

  it("clear removes all entries", () => {
    const cache = new MemoryCache<string>(10);
    cache.set("a", "1");
    cache.set("b", "2");
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get("a")).toBeNull();
  });

  // ── Overwrite does not grow size ────────────────────────────────────────

  it("overwriting an existing key does not increase size", () => {
    const cache = new MemoryCache<string>(5);
    cache.set("a", "1");
    cache.set("a", "2");
    expect(cache.size).toBe(1);
  });
});
