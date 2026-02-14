// ---------------------------------------------------------------------------
// WebScraperAdapter – generic HTML-scraping adapter for OPACs that lack
// a structured API.
//
// Configuration is driven entirely by `config.extra`:
//   - searchUrlTemplate: URL template with `{isbn}` placeholder
//   - resultSelector:    CSS selector for each result row/item
//   - titleSelector:     CSS selector (relative to row) for title text
//   - branchSelector:    CSS selector for branch/location text
//   - statusSelector:    CSS selector for availability status text
//   - callNumberSelector: CSS selector for call number text
// ---------------------------------------------------------------------------

import * as cheerio from "cheerio";
import type { Logger } from "pino";

import type {
  AdapterConfig,
  AdapterHealthStatus,
  BookHolding,
  BranchId,
  ISBN13,
  LibrarySystem,
} from "../../core/types.js";
import {
  AdapterConnectionError,
  AdapterParseError,
} from "../../core/errors.js";
import { BaseAdapter } from "../base/base-adapter.js";

/** Shape of the extra config fields required by this adapter. */
interface ScraperConfig {
  searchUrlTemplate: string;
  resultSelector: string;
  titleSelector: string;
  branchSelector: string;
  statusSelector: string;
  callNumberSelector: string;
}

/**
 * Generic web-scraping adapter.  Fetches an OPAC search page and extracts
 * holdings data using CSS selectors specified in the adapter config.
 */
export class WebScraperAdapter extends BaseAdapter {
  private readonly scraperConfig: ScraperConfig;

  constructor(system: LibrarySystem, config: AdapterConfig, logger: Logger) {
    super(system, { ...config, protocol: "web_scrape" }, logger);
    this.scraperConfig = this.parseScraperConfig(config);
  }

  // ── Search ──────────────────────────────────────────────────────────────

  protected async executeSearch(
    isbn: ISBN13,
    signal?: AbortSignal,
  ): Promise<BookHolding[]> {
    const searchUrl = this.scraperConfig.searchUrlTemplate.replace(
      "{isbn}",
      isbn,
    );

    this.logger.debug({ url: searchUrl }, "Fetching OPAC search page");

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
        `OPAC request failed with HTTP ${response.status}`,
        this.systemId,
        this.protocol,
      );
    }

    const html = await response.text();
    return this.parseHtml(html, isbn);
  }

  // ── Health check ────────────────────────────────────────────────────────

  protected async executeHealthCheck(): Promise<AdapterHealthStatus> {
    // Use a well-known ISBN for the health probe.
    const probeIsbn = "9780061120084";
    const probeUrl = this.scraperConfig.searchUrlTemplate.replace(
      "{isbn}",
      probeIsbn,
    );

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
        latencyMs: 0, // Overridden by base class
        message: response.ok
          ? "OPAC probe request succeeded"
          : `OPAC probe returned HTTP ${response.status}`,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        systemId: this.systemId,
        protocol: this.protocol,
        healthy: false,
        latencyMs: 0,
        message:
          error instanceof Error ? error.message : "OPAC probe failed",
        checkedAt: new Date().toISOString(),
      };
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private parseHtml(html: string, isbn: ISBN13): BookHolding[] {
    const $ = cheerio.load(html);
    const holdings: BookHolding[] = [];

    const {
      resultSelector,
      titleSelector,
      branchSelector,
      statusSelector,
      callNumberSelector,
    } = this.scraperConfig;

    $(resultSelector).each((_index, element) => {
      const $el = $(element);

      const title = $el.find(titleSelector).first().text().trim() || null;
      const branchName =
        $el.find(branchSelector).first().text().trim() || "Unknown";
      const rawStatus =
        $el.find(statusSelector).first().text().trim() || "";
      const callNumber =
        $el.find(callNumberSelector).first().text().trim() || null;

      // Try to find branch in the system's branches list.
      const branchInfo = this.system.branches.find(
        (b) =>
          b.name.toLowerCase() === branchName.toLowerCase() ||
          b.code.toLowerCase() === branchName.toLowerCase(),
      );
      const branchId = (branchInfo?.id ?? branchName) as BranchId;

      holdings.push({
        isbn,
        systemId: this.systemId,
        branchId,
        systemName: this.system.name,
        branchName: branchInfo?.name ?? branchName,
        callNumber,
        status: this.normalizeStatus(rawStatus),
        materialType: "book",
        dueDate: null,
        holdCount: null,
        copyCount: null,
        catalogUrl: this.scraperConfig.searchUrlTemplate.replace(
          "{isbn}",
          isbn,
        ),
        collection: "",
        volume: null,
        rawStatus,
        fingerprint: this.generateFingerprint([
          this.systemId,
          isbn,
          branchName,
          callNumber,
        ]),
      });
    });

    return holdings;
  }

  /**
   * Extract and validate scraper configuration from adapter config extra.
   */
  private parseScraperConfig(config: AdapterConfig): ScraperConfig {
    const extra = config.extra ?? {};

    const searchUrlTemplate = extra.searchUrlTemplate as string | undefined;
    if (!searchUrlTemplate) {
      throw new AdapterParseError(
        "WebScraperAdapter requires extra.searchUrlTemplate",
        this.systemId,
        this.protocol,
      );
    }

    return {
      searchUrlTemplate,
      resultSelector: (extra.resultSelector as string) ?? ".result-item",
      titleSelector: (extra.titleSelector as string) ?? ".title",
      branchSelector: (extra.branchSelector as string) ?? ".branch, .location",
      statusSelector: (extra.statusSelector as string) ?? ".status, .availability",
      callNumberSelector:
        (extra.callNumberSelector as string) ?? ".call-number, .callnumber",
    };
  }
}
