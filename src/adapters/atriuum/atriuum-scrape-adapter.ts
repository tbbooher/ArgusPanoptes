// ---------------------------------------------------------------------------
// AtriumScrapeAdapter – HTML scraping adapter for Atriuum (Book Systems)
// OPAC catalogs hosted on booksys.net.
//
// Atriuum OPACs use server-rendered HTML with search URLs like:
//   https://{library}.booksys.net/opac/{code}/search?q={isbn}&searchBy=keyword
//
// The adapter expects `config.extra.libraryCode` and `config.extra.opacCode`
// to construct URLs, or falls back to parsing from `config.baseUrl`.
// ---------------------------------------------------------------------------

import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { Logger } from "pino";

import type {
  AdapterConfig,
  AdapterHealthStatus,
  BookHolding,
  BranchId,
  ISBN13,
  LibrarySystem,
} from "../../core/types.js";
import { AdapterConnectionError, AdapterParseError } from "../../core/errors.js";
import { BaseAdapter } from "../base/base-adapter.js";

export class AtriumScrapeAdapter extends BaseAdapter {
  private readonly catalogBaseUrl: string;

  constructor(system: LibrarySystem, config: AdapterConfig, logger: Logger) {
    super(system, { ...config, protocol: "atriuum_scrape" }, logger);
    this.catalogBaseUrl = config.baseUrl.replace(/\/+$/, "");
  }

  // ── Search ──────────────────────────────────────────────────────────────

  protected async executeSearch(
    isbn: ISBN13,
    signal?: AbortSignal,
  ): Promise<BookHolding[]> {
    // Atriuum supports multiple search URL patterns depending on version.
    // Try the standard keyword search URL first.
    const searchUrl = this.buildSearchUrl(isbn);
    this.logger.debug({ url: searchUrl }, "Fetching Atriuum OPAC search page");

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
        `Atriuum search failed with HTTP ${response.status}`,
        this.systemId,
        this.protocol,
      );
    }

    const html = await response.text();
    return this.parseSearchResults(html, isbn);
  }

  // ── Health check ────────────────────────────────────────────────────────

  protected async executeHealthCheck(): Promise<AdapterHealthStatus> {
    try {
      // Atriuum OPACs serve SPAs at /opac/{code}/index.html — the bare
      // directory path returns 404, so we probe index.html explicitly.
      const probeUrl = `${this.catalogBaseUrl}/index.html`;
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
          ? "Atriuum OPAC probe succeeded"
          : `Atriuum OPAC returned HTTP ${response.status}`,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        systemId: this.systemId,
        protocol: this.protocol,
        healthy: false,
        latencyMs: 0,
        message: error instanceof Error ? error.message : "Atriuum probe failed",
        checkedAt: new Date().toISOString(),
      };
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private buildSearchUrl(isbn: ISBN13): string {
    // Config can override the search URL template via extra.searchUrlTemplate
    const template = this.config.extra?.searchUrlTemplate as string | undefined;
    if (template) {
      return template.replace("{isbn}", isbn);
    }

    // Default: keyword search on the base URL
    return `${this.catalogBaseUrl}/search?q=${isbn}&searchBy=keyword`;
  }

  private parseSearchResults(html: string, isbn: ISBN13): BookHolding[] {
    const $ = cheerio.load(html);
    const holdings: BookHolding[] = [];

    // Atriuum OPAC uses various markup patterns. Try common selectors.

    // Pattern 1: Table-based results with .item-row or tr elements
    const resultRows = $(
      ".searchResult, .result-item, .item-row, " +
      "table.results tr, #searchResults tr, " +
      ".opac-result, .record-detail",
    );

    if (resultRows.length > 0) {
      resultRows.each((_index, element) => {
        const $el = $(element);
        const holding = this.extractHoldingFromElement($, $el, isbn);
        if (holding) holdings.push(holding);
      });
    }

    // Pattern 2: Copy/item availability tables within a single record view
    // (Sometimes a search for an ISBN goes straight to the record detail page)
    if (holdings.length === 0) {
      const copyRows = $(
        ".copies-table tr, .holdings-table tr, " +
        "#copies tr, #holdings tr, " +
        "table.copies tr, table.holdings tr",
      );

      copyRows.each((_index, element) => {
        const $el = $(element);
        // Skip header rows
        if ($el.find("th").length > 0) return;

        const cells = $el.find("td");
        if (cells.length < 2) return;

        const branchName = $(cells[0]).text().trim() || "Unknown";
        const callNumber = cells.length > 1 ? $(cells[1]).text().trim() : null;
        const rawStatus = cells.length > 2 ? $(cells[2]).text().trim() : "";

        const branchInfo = this.system.branches.find(
          (b) =>
            b.name.toLowerCase() === branchName.toLowerCase() ||
            b.code.toLowerCase() === branchName.toLowerCase(),
        );

        holdings.push({
          isbn,
          systemId: this.systemId,
          branchId: (branchInfo?.id ?? branchName) as BranchId,
          systemName: this.system.name,
          branchName: branchInfo?.name ?? branchName,
          callNumber: callNumber || null,
          status: this.normalizeStatus(rawStatus),
          materialType: "book",
          dueDate: null,
          holdCount: null,
          copyCount: null,
          catalogUrl: this.catalogBaseUrl,
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
    }

    return holdings;
  }

  private extractHoldingFromElement(
    $: cheerio.CheerioAPI,
    $el: cheerio.Cheerio<AnyNode>,
    isbn: ISBN13,
  ): BookHolding | null {
    // Try various selectors that Atriuum OPACs use
    const branchName =
      $el.find(".branch, .location, .library, td:nth-child(1)").first().text().trim() ||
      "Unknown";
    const rawStatus =
      $el.find(".status, .availability, .avail, td:nth-child(3)").first().text().trim() ||
      "";
    const callNumber =
      $el.find(".callnumber, .call-number, td:nth-child(2)").first().text().trim() ||
      null;

    // Skip rows that look like headers or are empty
    if (!branchName || branchName === "Unknown") {
      const text = $el.text().trim();
      if (!text || text.length < 5) return null;
    }

    const branchInfo = this.system.branches.find(
      (b) =>
        b.name.toLowerCase() === branchName.toLowerCase() ||
        b.code.toLowerCase() === branchName.toLowerCase(),
    );

    return {
      isbn,
      systemId: this.systemId,
      branchId: (branchInfo?.id ?? branchName) as BranchId,
      systemName: this.system.name,
      branchName: branchInfo?.name ?? branchName,
      callNumber,
      status: this.normalizeStatus(rawStatus),
      materialType: "book",
      dueDate: null,
      holdCount: null,
      copyCount: null,
      catalogUrl: this.catalogBaseUrl,
      collection: "",
      volume: null,
      rawStatus,
      fingerprint: this.generateFingerprint([
        this.systemId,
        isbn,
        branchName,
        callNumber,
      ]),
    };
  }
}
