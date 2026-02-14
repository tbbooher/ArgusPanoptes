// ---------------------------------------------------------------------------
// Concurrency control utilities wrapping p-limit.
// ---------------------------------------------------------------------------

import pLimit from "p-limit";

// ── Global concurrency pool ────────────────────────────────────────────────

/**
 * A global concurrency pool that caps the total number of in-flight async
 * operations.
 */
export class ConcurrencyPool {
  private readonly limiter: ReturnType<typeof pLimit>;

  constructor(maxConcurrency = 20) {
    this.limiter = pLimit(maxConcurrency);
  }

  /**
   * Run `fn` within the global concurrency limit.
   *
   * Resolves once a slot is available and `fn` completes.
   */
  run<T>(fn: () => Promise<T>): Promise<T> {
    return this.limiter(fn);
  }
}

// ── Per-host limiter ───────────────────────────────────────────────────────

/**
 * Per-host concurrency limiter that maintains a separate p-limit instance
 * for each host (identified by an arbitrary string key such as a system ID
 * or hostname).
 *
 * This prevents a single slow host from consuming all slots in the global
 * pool.
 */
export class PerHostLimiter {
  private readonly limiters = new Map<string, ReturnType<typeof pLimit>>();
  private readonly maxPerHost: number;

  constructor(maxPerHost = 2) {
    this.maxPerHost = maxPerHost;
  }

  /**
   * Run `fn` within the concurrency limit for the given `hostId`.
   *
   * A new p-limit instance is lazily created for each unique host.
   */
  run<T>(hostId: string, fn: () => Promise<T>): Promise<T> {
    let limiter = this.limiters.get(hostId);
    if (!limiter) {
      limiter = pLimit(this.maxPerHost);
      this.limiters.set(hostId, limiter);
    }
    return limiter(fn);
  }
}
