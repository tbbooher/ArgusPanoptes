// ---------------------------------------------------------------------------
// SpydusScrapeAdapter – HTML scraping adapter for Spydus (Civica) OPAC.
//
// Spydus catalogs use CGI-based search URLs like:
//   https://{host}/cgi-bin/spydus.exe/ENQ/OPAC/BIBENQ?ENTRY={isbn}&ENTRY_NAME=BS&ENTRY_TYPE=K
//
// The adapter expects the base URL to point to the Spydus host (e.g.,
// https://mybcls.spydus.com).  Search URL patterns can be overridden via
// `config.extra.searchUrlTemplate` with a `{isbn}` placeholder.
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

export class SpydusScrapeAdapter extends BaseAdapter {
  private readonly catalogBaseUrl: string;

  constructor(system: LibrarySystem, config: AdapterConfig, logger: Logger) {
    super(system, { ...config, protocol: "spydus_scrape" }, logger);
    this.catalogBaseUrl = config.baseUrl.replace(/\/+$/, "");
  }

  // ── Search ──────────────────────────────────────────────────────────────

  protected async executeSearch(
    isbn: ISBN13,
    signal?: AbortSignal,
  ): Promise<BookHolding[]> {
    const searchUrl = this.buildSearchUrl(isbn);
    this.logger.debug({ url: searchUrl }, "Fetching Spydus OPAC search page");

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
        `Spydus search failed with HTTP ${response.status}`,
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
      const response = await fetch(this.catalogBaseUrl, {
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
          ? "Spydus OPAC probe succeeded"
          : `Spydus OPAC returned HTTP ${response.status}`,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        systemId: this.systemId,
        protocol: this.protocol,
        healthy: false,
        latencyMs: 0,
        message: error instanceof Error ? error.message : "Spydus probe failed",
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

    // Standard Spydus CGI search URL.
    // ENTRY_NAME=SBN searches the ISBN field specifically; BS searches everywhere.
    const fieldCode = (this.config.extra?.searchField as string) ?? "SBN";
    const params = new URLSearchParams({
      ENTRY: isbn,
      ENTRY_NAME: fieldCode,
      ENTRY_TYPE: "K",
      NRECS: "50",
      SORTS: "HBT.SOVR",
    });
    return `${this.catalogBaseUrl}/cgi-bin/spydus.exe/ENQ/OPAC/BIBENQ?${params.toString()}`;
  }

  private parseSearchResults(html: string, isbn: ISBN13): BookHolding[] {
    const $ = cheerio.load(html);
    const holdings: BookHolding[] = [];

    // Spydus renders holdings in various table formats.

    // Pattern 1: Item/copy table rows (common in full record view)
    const copyRows = $(
      "table.copies tr, table.items tr, " +
      "#holdings tr, .holdings-table tr, " +
      "table.itemtable tr, #itemtable tr",
    );

    if (copyRows.length > 0) {
      copyRows.each((_index, element) => {
        const $row = $(element);
        if ($row.find("th").length > 0) return;

        const cells = $row.find("td");
        if (cells.length < 2) return;

        // Spydus typically lays out: Branch | Call Number | Status | Due Date
        const branchName = $(cells[0]).text().trim() || "Unknown";
        const callNumber = cells.length > 1 ? $(cells[1]).text().trim() : null;
        const rawStatus = cells.length > 2 ? $(cells[2]).text().trim() : "";
        const dueDate = cells.length > 3 ? $(cells[3]).text().trim() || null : null;

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
          dueDate,
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

    // Pattern 2: Search results list (when multiple bib records match)
    if (holdings.length === 0) {
      $(".result, .searchresult, .briefrecord").each((_index, element) => {
        const $el = $(element);
        const title = $el.find(".title, .bib-title, a").first().text().trim();
        if (!title) return;

        holdings.push({
          isbn,
          systemId: this.systemId,
          branchId: "unknown" as BranchId,
          systemName: this.system.name,
          branchName: "Unknown",
          callNumber: null,
          status: "unknown",
          materialType: "book",
          dueDate: null,
          holdCount: null,
          copyCount: null,
          catalogUrl: this.catalogBaseUrl,
          collection: "",
          volume: null,
          rawStatus: "",
          fingerprint: this.generateFingerprint([
            this.systemId,
            isbn,
            title,
          ]),
        });
      });
    }

    return holdings;
  }
}
