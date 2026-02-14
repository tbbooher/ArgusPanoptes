// ---------------------------------------------------------------------------
// In-memory metrics collection for adapter calls and searches.
// ---------------------------------------------------------------------------

import type { AdapterProtocol, LibrarySystemId, MetricsConfig } from "../core/types.js";
import type pino from "pino";

// ── Per-adapter metrics ─────────────────────────────────────────────────────

interface AdapterMetrics {
  systemId: string;
  protocol: string;
  totalRequests: number;
  successCount: number;
  failureCount: number;
  timeoutCount: number;
  circuitOpenCount: number;
  totalDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
}

// ── Search-level metrics ────────────────────────────────────────────────────

interface SearchMetrics {
  totalSearches: number;
  completedSearches: number;
  failedSearches: number;
  cacheHits: number;
  cacheMisses: number;
  totalDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
}

/** Outcome of a single adapter call. */
export type AdapterOutcome = "success" | "failure" | "timeout" | "circuit_open";

/** Outcome of a search operation. */
export type SearchOutcome = "completed" | "failed";

/** Immutable snapshot of all metrics at a point in time. */
export interface MetricsSnapshot {
  adapters: ReadonlyMap<string, Readonly<AdapterMetrics>>;
  search: Readonly<SearchMetrics>;
  collectedAt: string;
}

/**
 * Collects in-memory metrics for adapter calls and search operations.
 *
 * Optionally logs a periodic report at a configurable interval.
 */
export class MetricsCollector {
  private readonly adapterMetrics = new Map<string, AdapterMetrics>();
  private readonly searchMetrics: SearchMetrics = {
    totalSearches: 0,
    completedSearches: 0,
    failedSearches: 0,
    cacheHits: 0,
    cacheMisses: 0,
    totalDurationMs: 0,
    minDurationMs: Infinity,
    maxDurationMs: 0,
  };

  private reportTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly config: MetricsConfig,
    private readonly logger?: pino.Logger,
  ) {
    if (config.enabled && config.reportIntervalMs > 0 && logger) {
      this.reportTimer = setInterval(() => {
        this.logReport();
      }, config.reportIntervalMs);

      // Allow the process to exit even if the timer is still running.
      if (typeof this.reportTimer === "object" && "unref" in this.reportTimer) {
        this.reportTimer.unref();
      }
    }
  }

  // ── Adapter metrics ─────────────────────────────────────────────────────

  recordAdapterCall(
    systemId: LibrarySystemId,
    protocol: AdapterProtocol,
    outcome: AdapterOutcome,
    durationMs: number,
  ): void {
    const key = `${systemId}:${protocol}`;
    let m = this.adapterMetrics.get(key);

    if (!m) {
      m = {
        systemId: systemId as string,
        protocol: protocol as string,
        totalRequests: 0,
        successCount: 0,
        failureCount: 0,
        timeoutCount: 0,
        circuitOpenCount: 0,
        totalDurationMs: 0,
        minDurationMs: Infinity,
        maxDurationMs: 0,
      };
      this.adapterMetrics.set(key, m);
    }

    m.totalRequests++;
    m.totalDurationMs += durationMs;

    if (durationMs < m.minDurationMs) m.minDurationMs = durationMs;
    if (durationMs > m.maxDurationMs) m.maxDurationMs = durationMs;

    switch (outcome) {
      case "success":
        m.successCount++;
        break;
      case "failure":
        m.failureCount++;
        break;
      case "timeout":
        m.timeoutCount++;
        break;
      case "circuit_open":
        m.circuitOpenCount++;
        break;
    }
  }

  // ── Search metrics ──────────────────────────────────────────────────────

  recordSearch(
    outcome: SearchOutcome,
    durationMs: number,
    fromCache: boolean,
  ): void {
    const s = this.searchMetrics;

    s.totalSearches++;
    s.totalDurationMs += durationMs;

    if (durationMs < s.minDurationMs) s.minDurationMs = durationMs;
    if (durationMs > s.maxDurationMs) s.maxDurationMs = durationMs;

    if (outcome === "completed") {
      s.completedSearches++;
    } else {
      s.failedSearches++;
    }

    if (fromCache) {
      s.cacheHits++;
    } else {
      s.cacheMisses++;
    }
  }

  // ── Snapshot ────────────────────────────────────────────────────────────

  snapshot(): MetricsSnapshot {
    const adaptersCopy = new Map<string, AdapterMetrics>();
    for (const [key, value] of this.adapterMetrics) {
      adaptersCopy.set(key, { ...value });
    }

    return {
      adapters: adaptersCopy,
      search: { ...this.searchMetrics },
      collectedAt: new Date().toISOString(),
    };
  }

  // ── Periodic report ─────────────────────────────────────────────────────

  private logReport(): void {
    if (!this.logger) return;

    const snap = this.snapshot();
    const adapters: Record<string, AdapterMetrics> = {};
    for (const [key, value] of snap.adapters) {
      adapters[key] = value;
    }

    this.logger.info(
      { metrics: { adapters, search: snap.search } },
      "periodic metrics report",
    );
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────

  dispose(): void {
    if (this.reportTimer !== null) {
      clearInterval(this.reportTimer);
      this.reportTimer = null;
    }
  }
}
