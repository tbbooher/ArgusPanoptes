// ---------------------------------------------------------------------------
// Search coordinator: fans out ISBN lookups to all library system adapters.
// ---------------------------------------------------------------------------

import type pino from "pino";
import type {
  AdapterProtocol,
  BookHolding,
  ISBN13,
  LibraryCatalogAdapter,
  LibrarySystem,
  LibrarySystemId,
  SearchConfig,
  SearchError,
  SearchResult,
} from "../core/types.js";
import type { AdapterRegistry } from "../core/adapter-registry.js";
import type { CacheManager } from "../cache/cache-manager.js";
import type { HealthTracker } from "../cache/health-tracker.js";
import type { MetricsCollector } from "../metrics/metrics-collector.js";

import { CircuitBreaker } from "./circuit-breaker.js";
import { PerHostLimiter } from "./concurrency.js";
import { withRetry } from "./retry.js";
import { ResultAggregator } from "./result-aggregator.js";
import {
  AdapterConnectionError,
  AdapterTimeoutError,
} from "../core/errors.js";

// ── Types ──────────────────────────────────────────────────────────────────

/** Outcome of searching a single system. */
interface SystemSearchOutcome {
  systemId: LibrarySystemId;
  systemName: string;
  protocol: AdapterProtocol;
  holdings: BookHolding[];
  error: SearchError | null;
  durationMs: number;
  timedOut: boolean;
}

// ── SearchCoordinator ──────────────────────────────────────────────────────

/**
 * Orchestrates parallel ISBN searches across all configured library systems.
 *
 * Responsibilities:
 * - Check the cache for recent results.
 * - Skip systems whose circuit breakers are open.
 * - Fan out to adapters via Promise.allSettled with a global timeout.
 * - Apply per-host concurrency limits.
 * - Wrap each adapter call with retry logic.
 * - Collect results, update circuit breakers, health tracker, and metrics.
 * - Deduplicate and aggregate holdings.
 * - Cache the final SearchResult before returning.
 */
export class SearchCoordinator {
  private readonly circuitBreakers = new Map<string, CircuitBreaker>();
  private readonly hostLimiter: PerHostLimiter;
  private readonly aggregator = new ResultAggregator();

  constructor(
    private readonly adapterRegistry: AdapterRegistry,
    private readonly systems: LibrarySystem[],
    private readonly cache: CacheManager,
    private readonly healthTracker: HealthTracker,
    private readonly metrics: MetricsCollector,
    private readonly config: SearchConfig,
    private readonly logger: pino.Logger,
  ) {
    this.hostLimiter = new PerHostLimiter(config.maxPerHostConcurrency);

    // Pre-create a circuit breaker for every system.
    for (const sys of systems) {
      this.circuitBreakers.set(
        sys.id as string,
        new CircuitBreaker(5, 60_000),
      );
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Search for an ISBN across all enabled library systems.
   *
   * @param isbn  - A validated ISBN-13.
   * @param searchId - Unique identifier for this search request.
   * @returns Consolidated `SearchResult`.
   */
  async search(isbn: ISBN13, searchId: string): Promise<SearchResult> {
    const startedAt = new Date().toISOString();
    const startMs = Date.now();

    // 1. Cache check
    const cached = this.cache.getSearchResult(isbn as string);
    if (cached) {
      const durationMs = Date.now() - startMs;
      this.metrics.recordSearch("completed", durationMs, true);
      return { ...cached, searchId, fromCache: true };
    }

    // 2. Collect enabled systems
    const enabledSystems = this.systems.filter((s) => s.enabled);

    // 3. Build per-system search tasks, skipping open circuit breakers
    const tasks: Array<Promise<SystemSearchOutcome>> = [];
    const skippedSystems: LibrarySystemId[] = [];

    for (const sys of enabledSystems) {
      const cb = this.getCircuitBreaker(sys.id);
      if (cb.isOpen()) {
        skippedSystems.push(sys.id);
        // Record circuit-open in metrics for each adapter config
        for (const ac of sys.adapters) {
          this.metrics.recordAdapterCall(sys.id, ac.protocol, "circuit_open", 0);
        }
        continue;
      }

      tasks.push(this.searchSystem(isbn, sys));
    }

    this.logger.info(
      {
        searchId,
        isbn,
        totalSystems: enabledSystems.length,
        skipped: skippedSystems.length,
        tasksLaunched: tasks.length,
      },
      "fan-out started",
    );

    // 4. Fan out with a global timeout via AbortSignal.timeout
    let outcomes: SystemSearchOutcome[];
    try {
      const globalTimeout = this.config.globalTimeoutMs;
      const settled = await Promise.allSettled(
        tasks.map((task) =>
          Promise.race([
            task,
            new Promise<SystemSearchOutcome>((_, reject) =>
              setTimeout(
                () => reject(new Error("global_timeout")),
                globalTimeout,
              ),
            ),
          ]),
        ),
      );

      outcomes = settled.map((s) => {
        if (s.status === "fulfilled") {
          return s.value;
        }
        // Rejection from global timeout -- we don't have a systemId here,
        // but this is a catch-all; individual per-system timeouts are handled
        // inside searchSystem.
        return {
          systemId: "unknown" as LibrarySystemId,
          systemName: "unknown",
          protocol: "sru" as AdapterProtocol,
          holdings: [],
          error: null,
          durationMs: 0,
          timedOut: true,
        };
      });
    } catch {
      outcomes = [];
    }

    // 5. Collect results and update metrics / health
    const allHoldings: BookHolding[] = [];
    const errors: SearchError[] = [];
    let systemsSucceeded = 0;
    let systemsFailed = 0;
    let systemsTimedOut = 0;

    for (const outcome of outcomes) {
      if (outcome.timedOut) {
        systemsTimedOut++;
        continue;
      }

      if (outcome.error) {
        errors.push(outcome.error);
        if (outcome.error.errorType === "timeout") {
          systemsTimedOut++;
        } else {
          systemsFailed++;
        }
      } else {
        systemsSucceeded++;
      }

      allHoldings.push(...outcome.holdings);
    }

    // Include skipped systems in the failure count
    systemsFailed += skippedSystems.length;

    // 6. Aggregate (dedup, group, summarize)
    const aggregated = this.aggregator.aggregate(isbn, allHoldings);

    // 7. Build SearchResult
    const completedAt = new Date().toISOString();
    const totalSearched = enabledSystems.length;
    const isPartial = systemsFailed > 0 || systemsTimedOut > 0;

    const result: SearchResult = {
      searchId,
      isbn: isbn as string,
      normalizedISBN13: isbn as string,
      startedAt,
      completedAt,
      holdings: aggregated.holdings,
      errors,
      systemsSearched: totalSearched,
      systemsSucceeded,
      systemsFailed,
      systemsTimedOut,
      isPartial,
      fromCache: false,
    };

    // 8. Cache the result
    this.cache.setSearchResult(isbn as string, result);

    // 9. Record search-level metrics
    const totalDurationMs = Date.now() - startMs;
    this.metrics.recordSearch("completed", totalDurationMs, false);

    this.logger.info(
      {
        searchId,
        isbn,
        totalDurationMs,
        systemsSucceeded,
        systemsFailed,
        systemsTimedOut,
        holdingsFound: aggregated.holdings.length,
        totalCopies: aggregated.totalCopies,
        totalAvailable: aggregated.totalAvailable,
      },
      "search completed",
    );

    return result;
  }

  // ── Private helpers ────────────────────────────────────────────────────

  /**
   * Search a single library system using its first available adapter.
   *
   * Applies per-host concurrency limiting and retry logic.
   */
  private async searchSystem(
    isbn: ISBN13,
    system: LibrarySystem,
  ): Promise<SystemSearchOutcome> {
    const systemId = system.id;
    const cb = this.getCircuitBreaker(systemId);
    const startMs = Date.now();

    // Pick the first adapter config for this system.
    const adapterConfig = system.adapters[0];
    if (!adapterConfig) {
      return {
        systemId,
        systemName: system.name,
        protocol: "sru" as AdapterProtocol,
        holdings: [],
        error: {
          systemId,
          systemName: system.name,
          protocol: "sru" as AdapterProtocol,
          errorType: "unknown",
          message: "No adapter config found for system",
          timestamp: new Date().toISOString(),
        },
        durationMs: 0,
        timedOut: false,
      };
    }

    const adapter = this.adapterRegistry.getPrimaryAdapter(systemId);
    if (!adapter) {
      return {
        systemId,
        systemName: system.name,
        protocol: adapterConfig.protocol,
        holdings: [],
        error: {
          systemId,
          systemName: system.name,
          protocol: adapterConfig.protocol,
          errorType: "unknown",
          message: `No adapter registered for ${systemId}:${adapterConfig.protocol}`,
          timestamp: new Date().toISOString(),
        },
        durationMs: 0,
        timedOut: false,
      };
    }

    try {
      const adapterResult = await this.hostLimiter.run(
        systemId as string,
        () =>
          withRetry(
            () => {
              const signal = AbortSignal.timeout(this.config.perSystemTimeoutMs);
              return adapter.search(isbn, system, signal);
            },
            {
              maxRetries: this.config.maxRetries,
              baseDelayMs: this.config.retryBaseDelayMs,
            },
          ),
      );

      const durationMs = Date.now() - startMs;

      // Success
      cb.recordSuccess();
      this.healthTracker.recordSuccess(systemId, durationMs);
      this.metrics.recordAdapterCall(
        systemId,
        adapterConfig.protocol,
        "success",
        durationMs,
      );

      return {
        systemId,
        systemName: system.name,
        protocol: adapterConfig.protocol,
        holdings: adapterResult.holdings,
        error: null,
        durationMs,
        timedOut: false,
      };
    } catch (err: unknown) {
      const durationMs = Date.now() - startMs;
      const isTimeout =
        err instanceof AdapterTimeoutError ||
        (err instanceof Error && err.name === "TimeoutError");

      // Update circuit breaker
      cb.recordFailure();

      // Update health tracker
      const errorMessage =
        err instanceof Error ? err.message : String(err);
      this.healthTracker.recordFailure(systemId, errorMessage, durationMs);

      // Update metrics
      this.metrics.recordAdapterCall(
        systemId,
        adapterConfig.protocol,
        isTimeout ? "timeout" : "failure",
        durationMs,
      );

      const errorType = this.classifyError(err);

      return {
        systemId,
        systemName: system.name,
        protocol: adapterConfig.protocol,
        holdings: [],
        error: {
          systemId,
          systemName: system.name,
          protocol: adapterConfig.protocol,
          errorType,
          message: errorMessage,
          timestamp: new Date().toISOString(),
        },
        durationMs,
        timedOut: isTimeout,
      };
    }
  }

  private getCircuitBreaker(systemId: LibrarySystemId): CircuitBreaker {
    const key = systemId as string;
    let cb = this.circuitBreakers.get(key);
    if (!cb) {
      cb = new CircuitBreaker(5, 60_000);
      this.circuitBreakers.set(key, cb);
    }
    return cb;
  }

  private classifyError(
    err: unknown,
  ): "connection" | "timeout" | "auth" | "rate_limit" | "parse" | "unknown" {
    if (err instanceof AdapterConnectionError) return "connection";
    if (err instanceof AdapterTimeoutError) return "timeout";
    if (
      err instanceof Error &&
      err.name === "TimeoutError"
    )
      return "timeout";
    if (err instanceof Error && err.name === "AdapterAuthError") return "auth";
    if (err instanceof Error && err.name === "AdapterRateLimitError")
      return "rate_limit";
    if (err instanceof Error && err.name === "AdapterParseError") return "parse";
    return "unknown";
  }
}
