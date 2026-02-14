// ---------------------------------------------------------------------------
// Per-IP rate-limiting middleware for Hono.
// ---------------------------------------------------------------------------

import type { Context, Next } from "hono";
import type { RateLimitConfig } from "../../core/types.js";

/** Internal tracker for a single client. */
interface ClientRecord {
  /** Number of requests in the current window. */
  count: number;
  /** Timestamp (ms) when the current window started. */
  windowStart: number;
}

/** Window duration in milliseconds (fixed at 60 seconds). */
const WINDOW_MS = 60_000;

/**
 * Creates a Hono middleware that rate-limits incoming requests on a per-IP
 * basis using a fixed-window counter.
 *
 * When the limit is exceeded a `429 Too Many Requests` response is returned
 * with a `Retry-After` header indicating how many seconds remain in the
 * current window.
 *
 * @param config - Rate limit configuration. The `searchRpm` field is used
 *   as the requests-per-minute limit.
 */
export function rateLimitMiddleware(
  config: RateLimitConfig,
): (c: Context, next: Next) => Promise<Response | void> {
  const clients = new Map<string, ClientRecord>();

  // Periodic cleanup of stale entries (every 5 minutes).
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of clients) {
      if (now - record.windowStart > WINDOW_MS * 2) {
        clients.delete(ip);
      }
    }
  }, 300_000);

  // Allow the process to exit even if the timer is running.
  if (typeof cleanupInterval === "object" && "unref" in cleanupInterval) {
    cleanupInterval.unref();
  }

  return async (c: Context, next: Next): Promise<Response | void> => {
    if (!config.enabled) {
      await next();
      return;
    }

    const ip = getClientIP(c);
    const now = Date.now();
    const maxRequests = config.searchRpm;

    let record = clients.get(ip);

    if (!record || now - record.windowStart >= WINDOW_MS) {
      // Start a new window.
      record = { count: 0, windowStart: now };
      clients.set(ip, record);
    }

    record.count++;

    if (record.count > maxRequests) {
      const retryAfterSeconds = Math.ceil(
        (record.windowStart + WINDOW_MS - now) / 1000,
      );

      c.header("Retry-After", String(retryAfterSeconds));
      return c.json(
        {
          error: "Too many requests",
          type: "rate_limit_exceeded",
          retryAfterSeconds,
        },
        429,
      );
    }

    await next();
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract the client IP from the Hono request context.
 *
 * SECURITY: We do NOT trust X-Forwarded-For or X-Real-IP headers by default
 * because they can be trivially spoofed by any client to bypass rate limits.
 * These headers should only be trusted when the service runs behind a known
 * reverse proxy that overwrites them.
 *
 * To opt in to trusting proxy headers, set the TRUST_PROXY=true environment
 * variable. Only do this when running behind a reverse proxy (e.g., nginx,
 * Cloudflare, AWS ALB) that sets these headers reliably.
 */
function getClientIP(c: Context): string {
  const trustProxy = process.env["TRUST_PROXY"] === "true";

  if (trustProxy) {
    const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;

    const realIp = c.req.header("x-real-ip");
    if (realIp) return realIp;
  }

  // Fall back to the connection-level address provided by the runtime.
  // Hono exposes this via c.env or the underlying request in some runtimes.
  // Using "unknown" as a safe fallback ensures rate limiting still applies
  // (all unidentifiable clients share a single bucket).
  return "unknown";
}
