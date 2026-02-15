// ---------------------------------------------------------------------------
// AtriumScrapeAdapter – HTML scraping adapter for Atriuum (Book Systems)
// OPAC catalogs hosted on booksys.net.
//
// Atriuum OPACs are Dart/Flutter SPAs but expose a legacy jQuery Mobile
// interface at /SearchMobile and /FullDispMobile with server-rendered HTML.
//
// Search flow:
//   1. GET {baseUrl}/SearchMobile?SF0={isbn}&ST0=I&mode=mobile
//      → returns search results with .itemResultsDiv elements
//   2. Each result has an itemid; GET FullDispMobile?itemid={id}&mode=mobile
//      → has hidden .copiesInfo inputs with location/sublocation/callnumber/status
//
// For efficiency we extract holdings from the search results page directly
// (call number from #callnumber{N}, status from .itemState{IN|OUT} class).
// If there are results, we fetch the first item's full details for copy-level
// information (location, sublocation).
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
import { AdapterConnectionError } from "../../core/errors.js";
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
    const searchUrl = this.buildSearchUrl(isbn);
    this.logger.debug({ url: searchUrl }, "Fetching Atriuum mobile search page");

    const fetchOpts = {
      signal: signal ?? AbortSignal.timeout(this.config.timeoutMs),
      headers: {
        Accept: "text/html",
        "User-Agent":
          "Mozilla/5.0 (compatible; BookFinder/1.0; +https://bookfinder.example.com)",
      },
    };

    const response = await fetch(searchUrl, fetchOpts);

    if (!response.ok) {
      throw new AdapterConnectionError(
        `Atriuum search failed with HTTP ${response.status}`,
        this.systemId,
        this.protocol,
      );
    }

    const html = await response.text();
    const holdings = this.parseSearchResults(html, isbn);

    // If the search page found results, try to enrich with copy-level details
    // from the first result's full display page.
    if (holdings.length === 0) {
      // Try fetching the full details for the first item to get copy info
      const $ = cheerio.load(html);
      const firstItemId = $(".itemResultsDiv").first().find("[itemid]").attr("itemid");
      if (firstItemId) {
        return this.fetchCopyDetails(firstItemId, isbn, fetchOpts);
      }
    }

    return holdings;
  }

  // ── Health check ────────────────────────────────────────────────────────

  protected async executeHealthCheck(): Promise<AdapterHealthStatus> {
    try {
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
    const template = this.config.extra?.searchUrlTemplate as string | undefined;
    if (template) {
      return template.replace("{isbn}", isbn);
    }

    // Legacy mobile interface: ISBN search (ST0=I)
    return `${this.catalogBaseUrl}/SearchMobile?SF0=${isbn}&ST0=I&mode=mobile`;
  }

  /**
   * Parse the SearchMobile results page.
   *
   * Each search result is a .itemResultsDiv with:
   *   - class itemStateIN or itemStateOUT
   *   - #callnumber{N} span with call number
   *   - #ItemStatus_{N} span with status text
   *   - dust jacket div with isbn attribute
   */
  private parseSearchResults(html: string, isbn: ISBN13): BookHolding[] {
    const $ = cheerio.load(html);
    const holdings: BookHolding[] = [];

    const resultDivs = $(".itemResultsDiv");
    if (resultDivs.length === 0) return holdings;

    resultDivs.each((_index, element) => {
      const $el = $(element);

      // Status from class: itemStateIN = available, itemStateOUT = checked out
      const classes = $el.attr("class") || "";
      let rawStatus = "unknown";
      if (classes.includes("itemStateIN")) rawStatus = "In";
      else if (classes.includes("itemStateOUT")) rawStatus = "Out";

      // Also check the ItemStatus span for more detail
      const statusSpan = $el.find("[id^='ItemStatus_']").text().trim();
      if (statusSpan) rawStatus = statusSpan;

      // Call number
      const callNumber =
        $el.find("[id^='callnumber']").text().trim() || null;

      // ISBN from dust jacket div
      const resultIsbn =
        ($el.find("[isbn]").attr("isbn") as string) || isbn;

      const branchName = this.system.name;
      const branchInfo = this.system.branches[0];

      holdings.push({
        isbn: (resultIsbn || isbn) as ISBN13,
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
          resultIsbn || isbn,
          branchName,
          callNumber,
        ]),
      });
    });

    return holdings;
  }

  /**
   * Fetch the FullDispMobile page for copy-level details.
   *
   * The page has hidden .copiesInfo inputs with attributes:
   *   location, sublocation, callnumber, status
   */
  private async fetchCopyDetails(
    itemId: string,
    isbn: ISBN13,
    fetchOpts: RequestInit,
  ): Promise<BookHolding[]> {
    const url = `${this.catalogBaseUrl}/FullDispMobile?itemid=${itemId}&mode=mobile`;
    this.logger.debug({ url }, "Fetching Atriuum full display for copy details");

    const response = await fetch(url, fetchOpts);
    if (!response.ok) return [];

    const html = await response.text();
    const $ = cheerio.load(html);
    const holdings: BookHolding[] = [];

    const copies = $("input.copiesInfo");
    if (copies.length === 0) return holdings;

    copies.each((_index, element) => {
      const $el = $(element);
      const location = $el.attr("location") || this.system.name;
      const sublocation = $el.attr("sublocation") || "";
      const callNumber = $el.attr("callnumber") || null;
      const rawStatus = $el.attr("status") || "unknown";

      const branchInfo = this.system.branches.find(
        (b) =>
          b.name.toLowerCase() === location.toLowerCase() ||
          b.code.toLowerCase() === location.toLowerCase(),
      );

      holdings.push({
        isbn,
        systemId: this.systemId,
        branchId: (branchInfo?.id ?? location) as BranchId,
        systemName: this.system.name,
        branchName: branchInfo?.name ?? location,
        callNumber,
        status: this.normalizeStatus(rawStatus),
        materialType: "book",
        dueDate: null,
        holdCount: null,
        copyCount: null,
        catalogUrl: this.catalogBaseUrl,
        collection: sublocation,
        volume: null,
        rawStatus,
        fingerprint: this.generateFingerprint([
          this.systemId,
          isbn,
          location,
          callNumber,
        ]),
      });
    });

    return holdings;
  }
}
