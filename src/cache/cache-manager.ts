// ---------------------------------------------------------------------------
// Search result cache manager backed by MemoryCache.
// ---------------------------------------------------------------------------

import type pino from "pino";
import type { CacheConfig, SearchResult } from "../core/types.js";
import { MemoryCache } from "./memory-cache.js";

/**
 * Manages caching of ISBN search results.
 *
 * Wraps a generic `MemoryCache<SearchResult>` and adds logging at debug
 * level for cache hits and misses.
 */
export class CacheManager {
  private readonly cache: MemoryCache<SearchResult>;
  private readonly ttlMs: number;
  private readonly enabled: boolean;
  private readonly logger: pino.Logger;

  constructor(config: CacheConfig, logger: pino.Logger) {
    this.cache = new MemoryCache<SearchResult>(config.maxMemoryEntries);
    this.ttlMs = config.searchResultTtlSeconds * 1000;
    this.enabled = config.enabled;
    this.logger = logger;
  }

  getSearchResult(isbn: string): SearchResult | null {
    if (!this.enabled) {
      return null;
    }

    const result = this.cache.get(isbn);

    if (result) {
      this.logger.debug({ isbn }, "cache hit");
    } else {
      this.logger.debug({ isbn }, "cache miss");
    }

    return result;
  }

  setSearchResult(isbn: string, result: SearchResult): void {
    if (!this.enabled) {
      return;
    }

    this.cache.set(isbn, result, this.ttlMs);
    this.logger.debug({ isbn }, "cache set");
  }

  invalidate(isbn: string): void {
    this.cache.delete(isbn);
    this.logger.debug({ isbn }, "cache invalidated");
  }

  clear(): void {
    this.cache.clear();
    this.logger.debug("cache cleared");
  }
}
