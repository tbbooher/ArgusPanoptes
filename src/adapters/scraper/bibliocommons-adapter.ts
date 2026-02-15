// ---------------------------------------------------------------------------
// BiblioCommonsScrapeAdapter – dedicated adapter for BiblioCommons catalog
// discovery layers.  Wraps the existing parseBiblioCommonsResults() parser.
//
// BiblioCommons search URLs follow a predictable pattern:
//   https://<subdomain>.bibliocommons.com/search?query=<isbn>&searchType=isbn
// ---------------------------------------------------------------------------

import type { Logger } from "pino";

import type {
  AdapterConfig,
  AdapterHealthStatus,
  BookHolding,
  ISBN13,
  LibrarySystem,
} from "../../core/types.js";
import { AdapterConnectionError } from "../../core/errors.js";
import { BaseAdapter } from "../base/base-adapter.js";
import { parseBiblioCommonsResults } from "./parsers/bibliocommons-parser.js";

/**
 * Adapter for BiblioCommons-powered library catalogs.
 *
 * Fetches the search page and delegates HTML parsing to the shared
 * BiblioCommons parser.
 */
export class BiblioCommonsScrapeAdapter extends BaseAdapter {
  private readonly catalogBaseUrl: string;

  constructor(system: LibrarySystem, config: AdapterConfig, logger: Logger) {
    super(system, config, logger);
    // Ensure trailing slash is removed for consistent URL construction.
    this.catalogBaseUrl = config.baseUrl.replace(/\/+$/, "");
  }

  // ── Search ──────────────────────────────────────────────────────────────

  protected async executeSearch(
    isbn: ISBN13,
    signal?: AbortSignal,
  ): Promise<BookHolding[]> {
    const searchUrl = `${this.catalogBaseUrl}/search?query=${isbn}&searchType=isbn`;

    this.logger.debug({ url: searchUrl }, "fetching BiblioCommons search page");

    const response = await fetch(searchUrl, {
      signal: signal ?? AbortSignal.timeout(this.config.timeoutMs),
      headers: {
        Accept: "text/html",
        "User-Agent":
          "Mozilla/5.0 (compatible; BookFinder/1.0; +https://bookfinder.example.com)",
      },
    });

    if (!response.ok) {
      throw new AdapterConnectionError(
        `BiblioCommons search failed with HTTP ${response.status}`,
        this.systemId,
        this.protocol,
      );
    }

    const html = await response.text();
    return parseBiblioCommonsResults(html, this.system, isbn);
  }

  // ── Health check ────────────────────────────────────────────────────────

  protected async executeHealthCheck(): Promise<AdapterHealthStatus> {
    const probeIsbn = "9780061120084";
    const probeUrl = `${this.catalogBaseUrl}/search?query=${probeIsbn}&searchType=isbn`;

    try {
      const response = await fetch(probeUrl, {
        signal: AbortSignal.timeout(this.config.timeoutMs),
        headers: {
          Accept: "text/html",
          "User-Agent":
            "Mozilla/5.0 (compatible; BookFinder/1.0; +https://bookfinder.example.com)",
        },
      });

      return {
        systemId: this.systemId,
        protocol: this.protocol,
        healthy: response.ok,
        latencyMs: 0,
        message: response.ok
          ? "BiblioCommons probe succeeded"
          : `BiblioCommons probe returned HTTP ${response.status}`,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        systemId: this.systemId,
        protocol: this.protocol,
        healthy: false,
        latencyMs: 0,
        message:
          error instanceof Error ? error.message : "BiblioCommons probe failed",
        checkedAt: new Date().toISOString(),
      };
    }
  }
}
