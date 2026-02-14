// ---------------------------------------------------------------------------
// BaseAdapter – abstract base class shared by every catalog adapter.
// ---------------------------------------------------------------------------

import type { Logger } from "pino";

import type {
  AdapterConfig,
  AdapterHealthStatus,
  AdapterProtocol,
  AdapterSearchResult,
  BookHolding,
  ISBN13,
  ItemStatus,
  LibraryCatalogAdapter,
  LibrarySystem,
  LibrarySystemId,
} from "../../core/types.js";
import {
  AdapterConnectionError,
  AdapterError,
  AdapterParseError,
  AdapterTimeoutError,
} from "../../core/errors.js";

/**
 * Abstract base adapter that implements the {@link LibraryCatalogAdapter}
 * contract.  Concrete adapters extend this class and provide implementations
 * of {@link executeSearch} and {@link executeHealthCheck}.
 *
 * The base class provides:
 *   - Automatic response-time measurement around search calls.
 *   - Consistent error wrapping (unknown errors become `AdapterError`).
 *   - Shared helpers: status normalisation, fingerprint generation.
 */
export abstract class BaseAdapter implements LibraryCatalogAdapter {
  public readonly protocol: AdapterProtocol;
  public readonly systemId: LibrarySystemId;

  protected readonly system: LibrarySystem;
  protected readonly config: AdapterConfig;
  protected readonly logger: Logger;

  constructor(system: LibrarySystem, config: AdapterConfig, logger: Logger) {
    this.system = system;
    this.config = config;
    this.protocol = config.protocol;
    this.systemId = system.id;
    this.logger = logger.child({
      adapter: this.constructor.name,
      systemId: system.id,
      protocol: config.protocol,
    });
  }

  // ── Public interface ────────────────────────────────────────────────────

  /**
   * Perform an ISBN search, measuring elapsed time and catching errors.
   */
  async search(
    isbn: ISBN13,
    _system: LibrarySystem,
    signal?: AbortSignal,
  ): Promise<AdapterSearchResult> {
    const start = performance.now();

    try {
      this.logger.debug({ isbn }, "Starting search");
      const holdings = await this.executeSearch(isbn, signal);
      const responseTimeMs = Math.round(performance.now() - start);

      this.logger.info(
        { isbn, holdings: holdings.length, responseTimeMs },
        "Search completed",
      );

      return {
        holdings,
        responseTimeMs,
        protocol: this.protocol,
      };
    } catch (error: unknown) {
      const responseTimeMs = Math.round(performance.now() - start);

      // Re-throw our own error types unchanged.
      if (error instanceof AdapterError) {
        this.logger.warn(
          { isbn, responseTimeMs, err: error },
          "Search failed with adapter error",
        );
        throw error;
      }

      // Wrap AbortError / timeout signals.
      if (
        error instanceof DOMException &&
        error.name === "AbortError"
      ) {
        throw new AdapterTimeoutError(
          `Search for ${isbn} was aborted`,
          this.systemId,
          this.protocol,
          { cause: error },
        );
      }

      // Wrap fetch network errors.
      if (error instanceof TypeError) {
        throw new AdapterConnectionError(
          `Network error searching for ${isbn}: ${(error as Error).message}`,
          this.systemId,
          this.protocol,
          { cause: error },
        );
      }

      // Anything else becomes a generic AdapterError.
      const msg =
        error instanceof Error
          ? error.message
          : "Unknown error during search";
      throw new AdapterError(
        `Search for ${isbn} failed: ${msg}`,
        this.systemId,
        this.protocol,
        { cause: error instanceof Error ? error : undefined },
      );
    }
  }

  /**
   * Delegate to the concrete health-check implementation.
   */
  async healthCheck(system: LibrarySystem): Promise<AdapterHealthStatus> {
    const start = performance.now();
    try {
      const status = await this.executeHealthCheck();
      return {
        ...status,
        latencyMs: Math.round(performance.now() - start),
        checkedAt: new Date().toISOString(),
      };
    } catch (error: unknown) {
      const latencyMs = Math.round(performance.now() - start);
      const message =
        error instanceof Error ? error.message : "Unknown health-check error";

      this.logger.warn({ err: error }, "Health check failed");

      return {
        systemId: this.systemId,
        protocol: this.protocol,
        healthy: false,
        latencyMs,
        message,
        checkedAt: new Date().toISOString(),
      };
    }
  }

  // ── Abstract methods for subclasses ─────────────────────────────────────

  /**
   * Execute the actual search against the remote catalog.
   * Subclasses MUST implement this.
   */
  protected abstract executeSearch(
    isbn: ISBN13,
    signal?: AbortSignal,
  ): Promise<BookHolding[]>;

  /**
   * Execute a lightweight health-check against the remote catalog.
   * Subclasses MUST implement this.
   */
  protected abstract executeHealthCheck(): Promise<AdapterHealthStatus>;

  // ── Protected helpers ───────────────────────────────────────────────────

  /**
   * Normalise a raw status string from a remote system into one of
   * the canonical {@link ItemStatus} values.
   */
  protected normalizeStatus(raw: string): ItemStatus {
    if (!raw) return "unknown";

    const lower = raw.toLowerCase().trim();

    // Available
    if (
      lower === "available" ||
      lower === "in" ||
      lower === "in library" ||
      lower === "on shelf" ||
      lower === "lib use only" ||
      lower === "check shelf" ||
      lower === "not checked out"
    ) {
      return "available";
    }

    // Checked out
    if (
      lower === "checked out" ||
      lower === "out" ||
      lower === "charged" ||
      lower === "due" ||
      lower.startsWith("due ")
    ) {
      return "checked_out";
    }

    // In transit
    if (
      lower === "in transit" ||
      lower === "transit" ||
      lower === "in-transit"
    ) {
      return "in_transit";
    }

    // On hold
    if (
      lower === "on hold" ||
      lower === "hold" ||
      lower === "on holdshelf" ||
      lower === "hold shelf"
    ) {
      return "on_hold";
    }

    // On order
    if (lower === "on order" || lower === "order") {
      return "on_order";
    }

    // In processing
    if (
      lower === "in processing" ||
      lower === "processing" ||
      lower === "cataloging" ||
      lower === "in cataloging"
    ) {
      return "in_processing";
    }

    // Missing
    if (
      lower === "missing" ||
      lower === "lost" ||
      lower === "withdrawn" ||
      lower === "claimed returned" ||
      lower === "lost and paid"
    ) {
      return "missing";
    }

    return "unknown";
  }

  /**
   * Generate a deterministic fingerprint string for deduplication.
   * Null / undefined parts are filtered out before joining.
   */
  protected generateFingerprint(
    parts: (string | number | null | undefined)[],
  ): string {
    return parts
      .filter((p): p is string | number => p != null && p !== "")
      .map((p) => String(p).trim().toLowerCase())
      .join(":");
  }
}
