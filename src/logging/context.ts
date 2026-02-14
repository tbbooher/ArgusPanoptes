// ---------------------------------------------------------------------------
// Request-scoped logging middleware for Hono.
// ---------------------------------------------------------------------------

import type { Context, Next } from "hono";
import type pino from "pino";

/**
 * Creates a Hono middleware that attaches a request-scoped child logger
 * to every incoming request context.
 *
 * The child logger carries `requestId`, `method`, and `path` as bindings
 * so that every log line within a request includes correlation data.
 *
 * Downstream handlers access the logger via `c.get("logger")`.
 */
export function createRequestLogger(
  baseLogger: pino.Logger,
): (c: Context, next: Next) => Promise<void> {
  return async (c: Context, next: Next): Promise<void> => {
    const requestId =
      c.req.header("x-request-id") ?? crypto.randomUUID();

    const childLogger = baseLogger.child({
      requestId,
      method: c.req.method,
      path: c.req.path,
    });

    c.set("logger", childLogger);

    const start = Date.now();
    childLogger.info("request started");

    await next();

    const durationMs = Date.now() - start;
    childLogger.info({ durationMs, status: c.res.status }, "request completed");
  };
}
