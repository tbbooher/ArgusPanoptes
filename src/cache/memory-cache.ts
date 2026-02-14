// ---------------------------------------------------------------------------
// Generic in-memory LRU cache with per-entry TTL.
// ---------------------------------------------------------------------------

/** Internal cache entry with value, creation time, and TTL. */
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/** Default time-to-live: 1 hour. */
const DEFAULT_TTL_MS = 3_600_000;

/**
 * A generic LRU (Least Recently Used) cache with per-entry TTL support.
 *
 * Backed by a `Map` which preserves insertion order in modern JS runtimes.
 * - On `get`, the entry is moved to the end (most recently used).
 * - On `set`, if at capacity the *first* entry (least recently used) is evicted.
 * - Expired entries are lazily removed on `get`.
 */
export class MemoryCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();
  private readonly maxEntries: number;

  constructor(maxEntries: number) {
    if (maxEntries < 1) {
      throw new RangeError("maxEntries must be at least 1");
    }
    this.maxEntries = maxEntries;
  }

  get(key: string): T | null {
    const entry = this.store.get(key);

    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    // Promote to most recently used: delete + re-insert at end
    this.store.delete(key);
    this.store.set(key, entry);

    return entry.value;
  }

  set(key: string, value: T, ttlMs: number = DEFAULT_TTL_MS): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      const firstKey = this.store.keys().next().value as string;
      this.store.delete(firstKey);
    }

    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
