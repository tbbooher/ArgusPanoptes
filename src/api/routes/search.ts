// ---------------------------------------------------------------------------
// Search routes: synchronous, asynchronous (POST + poll), and result lookup.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import type { SearchResult } from "../../core/types.js";
import { parseISBN } from "../../domain/isbn/isbn.js";
import { ISBNValidationError } from "../../core/errors.js";
import type { SearchCoordinator } from "../../orchestrator/search-coordinator.js";
import type pino from "pino";
import { resolveISBN13sFromTitle } from "../../domain/metadata/openlibrary.js";
import { ResultAggregator } from "../../orchestrator/result-aggregator.js";
import { resolveISBN13sFromGoogleBooks } from "../../domain/metadata/googlebooks.js";
import type { ISBN13 } from "../../core/types.js";

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
  const aggregator = new ResultAggregator();

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

  // ── GET /search/title?title=&author= ────────────────────────────────

  app.get("/title", async (c) => {
    const title = (c.req.query("title") ?? "").trim();
    const author = (c.req.query("author") ?? "").trim() || undefined;
    const maxIsbnsToSearchRaw = (c.req.query("maxIsbns") ?? "").trim();
    const maxIsbnsToSearch = Math.max(
      1,
      Math.min(25, Number.parseInt(maxIsbnsToSearchRaw || "10", 10) || 10),
    );

    if (!title) {
      return c.json(
        { error: "Missing required query parameter: title", type: "validation_error" },
        400,
      );
    }

    const searchId = crypto.randomUUID();
    const startedAt = new Date().toISOString();

    // 1. Resolve candidate ISBNs from title/author
    const resolveErrors: string[] = [];

    let googleResolved: Awaited<
      ReturnType<typeof resolveISBN13sFromGoogleBooks>
    > | null = null;
    try {
      googleResolved = await resolveISBN13sFromGoogleBooks({
        title,
        author,
        maxResults: 20,
        maxIsbns: 25,
        timeoutMs: 8000,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      resolveErrors.push(`googlebooks: ${msg}`);
      deps.logger.warn({ title, author, err: msg }, "googlebooks resolve failed");
    }

    let openLibraryResolved: Awaited<
      ReturnType<typeof resolveISBN13sFromTitle>
    > | null = null;
    try {
      openLibraryResolved = await resolveISBN13sFromTitle({
        title,
        author,
        limitDocs: 10,
        maxWorks: 5,
        limitEditionsPerWork: 20,
        maxIsbns: 25,
        timeoutMs: 8000,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      resolveErrors.push(`openlibrary: ${msg}`);
      deps.logger.warn({ title, author, err: msg }, "openlibrary resolve failed");
    }

    const allIsbn13s = Array.from(
      new Set<ISBN13>([
        ...(googleResolved?.isbn13s ?? []),
        ...(openLibraryResolved?.isbn13s ?? []),
      ]),
    );

    const isbn13s = allIsbn13s.slice(0, maxIsbnsToSearch);

    const candidates = {
      isbn13sAll: allIsbn13s,
      isbn13sSearched: isbn13s,
      sources: {
        googlebooks: googleResolved ? googleResolved.isbn13s.length : 0,
        openlibrary: openLibraryResolved ? openLibraryResolved.isbn13s.length : 0,
      },
      resolveErrors,
      skippedPreview: [
        ...((googleResolved?.skipped as unknown[]) ?? []),
        ...((openLibraryResolved?.skipped as unknown[]) ?? []),
      ].slice(0, 10),
    };

    if (isbn13s.length === 0 && resolveErrors.length) {
      return c.json(
        { error: `Failed to resolve ISBNs for title search: ${resolveErrors.join("; ")}`, type: "upstream_error" },
        502,
      );
    }

    if (isbn13s.length === 0) {
      const completedAt = new Date().toISOString();
      return c.json({
        searchId,
        query: { title, author },
        candidates,
        startedAt,
        completedAt,
        searches: [],
        holdings: [],
        errors: [],
        isPartial: false,
      });
    }

    // 2. Search all ISBNs concurrently — each search already respects
    //    per-host concurrency limits, so parallelising here is safe and
    //    dramatically reduces wall-clock time (from N×30 s to ~30 s).
    const settled = await Promise.allSettled(
      isbn13s.map((isbn13) =>
        deps.searchCoordinator
          .search(isbn13, `${searchId}:${isbn13}`)
          .then((r) => ({ isbn13, r })),
      ),
    );

    const searches: Array<{
      isbn13: string;
      systemsSearched: number;
      systemsSucceeded: number;
      systemsFailed: number;
      systemsTimedOut: number;
      holdingsCount: number;
      errorsCount: number;
      isPartial: boolean;
      fromCache: boolean;
    }> = [];

    const mergedHoldings: SearchResult["holdings"] = [];
    const mergedErrors: Array<SearchResult["errors"][number] & { isbn13: string }> = [];
    let anyPartial = false;

    for (const outcome of settled) {
      if (outcome.status === "rejected") {
        deps.logger.warn({ searchId, err: String(outcome.reason) }, "isbn search rejected");
        anyPartial = true;
        continue;
      }
      const { isbn13, r } = outcome.value;

      searches.push({
        isbn13,
        systemsSearched: r.systemsSearched,
        systemsSucceeded: r.systemsSucceeded,
        systemsFailed: r.systemsFailed,
        systemsTimedOut: r.systemsTimedOut,
        holdingsCount: r.holdings.length,
        errorsCount: r.errors.length,
        isPartial: r.isPartial,
        fromCache: r.fromCache,
      });

      mergedHoldings.push(...r.holdings);
      for (const e of r.errors) mergedErrors.push({ ...e, isbn13 });
      anyPartial = anyPartial || r.isPartial;
    }

    // 3. Deduplicate merged holdings across ISBNs.
    const aggregated = aggregator.aggregate(isbn13s[0], mergedHoldings);

    const completedAt = new Date().toISOString();
    return c.json({
      searchId,
      query: { title, author },
      candidates,
      startedAt,
      completedAt,
      searches,
      holdings: aggregated.holdings,
      errors: mergedErrors,
      isPartial: anyPartial,
    });
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
