// ---------------------------------------------------------------------------
// Request ID middleware for Hono.
// ---------------------------------------------------------------------------

import type { Context, Next } from "hono";

/**
 * Returns a Hono middleware that generates a unique request ID for every
 * incoming request.
 *
 * The ID is generated via `crypto.randomUUID()` (globally available in
 * modern runtimes) and is:
 *
 * 1. Stored on the Hono context as `"requestId"` for downstream handlers.
 * 2. Echoed back to the client in the `X-Request-ID` response header.
 *
 * If the incoming request already carries an `X-Request-ID` header, that
 * value is reused instead of generating a new one.
 */
export function requestIdMiddleware(): (
  c: Context,
  next: Next,
) => Promise<void> {
  return async (c: Context, next: Next): Promise<void> => {
    const existing = c.req.header("x-request-id");

    // SECURITY: Only accept the client-supplied request ID if it matches a
    // strict format (UUID or short alphanumeric).  This prevents log injection
    // attacks where a malicious X-Request-ID could contain newlines, control
    // characters, or excessively long payloads.
    const SAFE_REQUEST_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
    const requestId =
      existing && SAFE_REQUEST_ID_RE.test(existing)
        ? existing
        : crypto.randomUUID();

    c.set("requestId", requestId);
    c.header("X-Request-ID", requestId);

    await next();
  };
}
