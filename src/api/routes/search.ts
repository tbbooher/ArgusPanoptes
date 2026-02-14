// ---------------------------------------------------------------------------
// Search routes: synchronous, asynchronous (POST + poll), and result lookup.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import type { SearchResult } from "../../core/types.js";
import { parseISBN } from "../../domain/isbn/isbn.js";
import { ISBNValidationError } from "../../core/errors.js";
import type { SearchCoordinator } from "../../orchestrator/search-coordinator.js";
import type pino from "pino";

/** Dependencies required by search routes. */
export interface SearchRouteDeps {
  searchCoordinator: SearchCoordinator;
  logger: pino.Logger;
}

/**
 * Mounts search endpoints:
 *
 * - `GET  /search?isbn=<isbn>` -- Synchronous search (blocks until complete).
 * - `POST /search`             -- Asynchronous search (returns 202 + searchId).
 * - `GET  /search/:searchId`   -- Poll for async search results.
 */
export function searchRoutes(deps: SearchRouteDeps): Hono {
  const app = new Hono();

  /**
   * In-memory store for async search results.
   * Keys are searchIds, values are either a pending marker or a completed
   * SearchResult, plus a creation timestamp for eviction.
   *
   * SECURITY: Capped at MAX_ASYNC_RESULTS to prevent unbounded memory growth
   * from repeated POST /search requests (denial-of-service vector).
   * Entries older than ASYNC_RESULT_TTL_MS are lazily evicted.
   */
  const MAX_ASYNC_RESULTS = 1_000;
  const ASYNC_RESULT_TTL_MS = 10 * 60 * 1_000; // 10 minutes

  const asyncResults = new Map<
    string,
    { status: "pending"; createdAt: number }
    | { status: "completed"; result: SearchResult; createdAt: number }
  >();

  /** Evict entries older than the TTL and enforce the size cap. */
  function evictStaleEntries(): void {
    const now = Date.now();
    for (const [key, entry] of asyncResults) {
      if (now - entry.createdAt > ASYNC_RESULT_TTL_MS) {
        asyncResults.delete(key);
      }
    }
    // If still over cap after TTL eviction, remove oldest entries.
    while (asyncResults.size > MAX_ASYNC_RESULTS) {
      const oldestKey = asyncResults.keys().next().value as string;
      asyncResults.delete(oldestKey);
    }
  }

  // ── GET /search?isbn= ────────────────────────────────────────────────

  app.get("/", async (c) => {
    const rawIsbn = c.req.query("isbn");
    if (!rawIsbn) {
      return c.json(
        { error: "Missing required query parameter: isbn", type: "validation_error" },
        400,
      );
    }

    const parsed = parseISBN(rawIsbn);
    if (!parsed.ok) {
      throw new ISBNValidationError(rawIsbn, parsed.reason);
    }

    const searchId = crypto.randomUUID();
    const result = await deps.searchCoordinator.search(
      parsed.isbn13,
      searchId,
    );

    return c.json(result);
  });

  // ── POST /search ─────────────────────────────────────────────────────

  app.post("/", async (c) => {
    let body: { isbn?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { error: "Invalid JSON body", type: "validation_error" },
        400,
      );
    }

    const rawIsbn = body.isbn;
    if (!rawIsbn) {
      return c.json(
        { error: "Missing required field: isbn", type: "validation_error" },
        400,
      );
    }

    const parsed = parseISBN(rawIsbn);
    if (!parsed.ok) {
      throw new ISBNValidationError(rawIsbn, parsed.reason);
    }

    const searchId = crypto.randomUUID();

    // Evict stale entries before adding a new one.
    evictStaleEntries();

    // Mark as pending before kicking off the background search.
    const createdAt = Date.now();
    asyncResults.set(searchId, { status: "pending", createdAt });

    // Fire-and-forget: run the search in the background.
    deps.searchCoordinator
      .search(parsed.isbn13, searchId)
      .then((result) => {
        asyncResults.set(searchId, { status: "completed", result, createdAt });
      })
      .catch((err: unknown) => {
        deps.logger.error(
          { searchId, error: err instanceof Error ? err.message : String(err) },
          "async search failed",
        );
        // Leave as pending -- the caller will see that it never completes.
        // A production implementation would store the error state.
      });

    return c.json({ searchId, status: "pending" }, 202);
  });

  // ── GET /search/:searchId ────────────────────────────────────────────

  app.get("/:searchId", (c) => {
    const searchId = c.req.param("searchId");

    // Validate searchId format: must be a UUID to prevent reflection attacks
    // where arbitrary user input is echoed back in the response.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(searchId)) {
      return c.json(
        { error: "Invalid search ID format", type: "validation_error" },
        400,
      );
    }

    const entry = asyncResults.get(searchId);

    if (!entry) {
      return c.json(
        { error: "Search not found", type: "not_found" },
        404,
      );
    }

    if (entry.status === "pending") {
      return c.json({ searchId, status: "pending" }, 200);
    }

    return c.json(entry.result);
  });

  return app;
}
