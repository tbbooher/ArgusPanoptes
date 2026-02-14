// ---------------------------------------------------------------------------
// Retry logic with exponential backoff and jitter.
// ---------------------------------------------------------------------------

import {
  AdapterConnectionError,
  AdapterTimeoutError,
  AdapterAuthError,
  AdapterRateLimitError,
  AdapterParseError,
} from "../core/errors.js";

// ── Types ──────────────────────────────────────────────────────────────────

export interface RetryOptions {
  /** Maximum number of retries (0 means no retries, just the initial call). */
  maxRetries: number;
  /** Base delay in milliseconds before the first retry. */
  baseDelayMs: number;
  /**
   * Predicate that decides whether a given error is retryable.
   *
   * When omitted the default policy is used:
   * - Retry: `AdapterConnectionError`, `AdapterTimeoutError`
   * - Do NOT retry: `AdapterAuthError`, `AdapterRateLimitError`, `AdapterParseError`
   */
  shouldRetry?: (error: unknown) => boolean;
}

// ── Default retry predicate ────────────────────────────────────────────────

/**
 * Default predicate: only retry transient errors (connection / timeout).
 * Auth, rate-limit, and parse errors are considered permanent.
 */
function defaultShouldRetry(error: unknown): boolean {
  if (error instanceof AdapterConnectionError) return true;
  if (error instanceof AdapterTimeoutError) return true;

  // Permanent failures -- do not retry.
  if (error instanceof AdapterAuthError) return false;
  if (error instanceof AdapterRateLimitError) return false;
  if (error instanceof AdapterParseError) return false;

  // Unknown errors -- default to retryable so we don't silently drop.
  return true;
}

// ── Delay helper ───────────────────────────────────────────────────────────

/**
 * Compute the delay for a given attempt using exponential backoff with
 * full jitter (random value between 0 and the exponential ceiling).
 */
function computeDelay(attempt: number, baseDelayMs: number): number {
  const exponential = baseDelayMs * 2 ** attempt;
  return Math.round(Math.random() * exponential);
}

/** Returns a promise that resolves after `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Execute `fn` with retry semantics.
 *
 * On failure `shouldRetry` is consulted.  If `true`, the function sleeps
 * using exponential backoff with jitter before retrying up to
 * `maxRetries` times.
 *
 * If all attempts are exhausted, the last error is thrown.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const { maxRetries, baseDelayMs, shouldRetry = defaultShouldRetry } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;

      // If not retryable or we've exhausted attempts, bail out.
      if (!shouldRetry(error) || attempt >= maxRetries) {
        throw error;
      }

      const delay = computeDelay(attempt, baseDelayMs);
      await sleep(delay);
    }
  }

  // Should be unreachable, but satisfy the compiler.
  throw lastError;
}
