// ---------------------------------------------------------------------------
// Hono error handler: maps domain errors to HTTP responses.
// ---------------------------------------------------------------------------

import type { Context } from "hono";
import {
  ISBNValidationError,
  AdapterRateLimitError,
  SearchTimeoutError,
} from "../../core/errors.js";

/**
 * Hono `onError` handler that inspects the thrown error and returns an
 * appropriate HTTP status code with a JSON body.
 *
 * SECURITY: In production, error messages are sanitized to avoid leaking
 * internal details (adapter names, system IDs, internal URLs, stack traces).
 * Only ISBN validation errors expose the original message because that is
 * user-controlled input feedback.
 *
 * Mapping:
 * - `ISBNValidationError`  -> 400 Bad Request
 * - `AdapterRateLimitError` -> 429 Too Many Requests
 * - `SearchTimeoutError`    -> 504 Gateway Timeout
 * - Everything else         -> 500 Internal Server Error
 */
export function errorHandler(err: Error, c: Context): Response {
  const isProduction = process.env["NODE_ENV"] === "production";

  if (err instanceof ISBNValidationError) {
    // ISBN validation messages are safe to expose -- they only reference
    // the user-supplied ISBN and a generic reason (length, check digit, etc.).
    return c.json(
      { error: err.message, type: "isbn_validation_error" },
      400,
    );
  }

  if (err instanceof AdapterRateLimitError) {
    const headers: Record<string, string> = {};
    if (err.retryAfterMs !== null) {
      headers["Retry-After"] = String(Math.ceil(err.retryAfterMs / 1000));
    }
    return c.json(
      {
        error: isProduction
          ? "Too many requests to upstream service"
          : err.message,
        type: "rate_limit_error",
      },
      { status: 429, headers },
    );
  }

  if (err instanceof SearchTimeoutError) {
    return c.json(
      {
        error: isProduction
          ? "Search timed out"
          : err.message,
        type: "search_timeout_error",
      },
      504,
    );
  }

  // Default: 500 -- NEVER leak internal error details in production.
  const message = isProduction
    ? "Internal server error"
    : err.message;

  return c.json({ error: message, type: "internal_error" }, 500);
}
