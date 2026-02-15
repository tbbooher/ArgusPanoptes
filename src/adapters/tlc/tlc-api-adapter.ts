// ---------------------------------------------------------------------------
// TlcApiAdapter – REST API adapter for TLC Library.Solution / LS2 PAC.
//
// TLC Delivers catalogs expose an unauthenticated REST API:
//   POST /search  — search by ISBN, title, author, etc.
//   GET  /hostSystem/getRealtimeHostRecordInformation/{id}  — live availability
//
// The search response returns resources with holdings, but not real-time
// checkout status. A second call to the host system endpoint is needed
// for accurate available/checked-out status.
// ---------------------------------------------------------------------------

import type { Logger } from "pino";

import type {
  AdapterConfig,
  AdapterHealthStatus,
  BookHolding,
  BranchId,
  ISBN13,
  LibrarySystem,
  MaterialType,
} from "../../core/types.js";
import { AdapterConnectionError, AdapterParseError } from "../../core/errors.js";
import { BaseAdapter } from "../base/base-adapter.js";

/** A single holding/copy from the TLC search response. */
interface TlcHolding {
  id?: number;
  branchIdentifier?: string;
  branchName?: string;
  barcode?: string;
  shelfLocation?: string;
  formattedCallNumber?: string;
  collectionCode?: string;
  collectionName?: string;
  volume?: string | null;
  copy?: string | null;
  hideFromPublic?: boolean;
  reserved?: boolean;
}

/** A resource (bibliographic record) from the TLC search response. */
interface TlcResource {
  id?: number;
  shortTitle?: string;
  shortAuthor?: string;
  format?: string;
  hostBibliographicId?: string;
  downloadable?: boolean;
  standardNumbers?: Array<{ type: string; data: string }>;
  holdingsInformations?: TlcHolding[];
  publicationInformations?: Array<{
    publicationDate?: string;
    publisherName?: string;
  }>;
}

/** TLC search API response. */
interface TlcSearchResponse {
  totalHits?: number;
  resources?: TlcResource[];
}

/** Real-time availability from hostSystem endpoint. */
interface TlcRealtimeInfo {
  totalCheckouts?: number;
  totalPendingRequests?: number;
  totalCopies?: number;
}

export class TlcApiAdapter extends BaseAdapter {
  private readonly catalogBaseUrl: string;

  constructor(system: LibrarySystem, config: AdapterConfig, logger: Logger) {
    super(system, { ...config, protocol: "tlc_api" }, logger);
    this.catalogBaseUrl = config.baseUrl.replace(/\/+$/, "");
  }

  // ── Search ──────────────────────────────────────────────────────────────

  protected async executeSearch(
    isbn: ISBN13,
    signal?: AbortSignal,
  ): Promise<BookHolding[]> {
    const searchResult = await this.searchByISBN(isbn, signal);
    if (!searchResult.resources || searchResult.resources.length === 0) return [];

    const holdings: BookHolding[] = [];

    for (const resource of searchResult.resources) {
      // Skip downloadable/digital resources
      if (resource.downloadable) continue;

      // Try to get real-time availability for accurate status
      let realtimeInfo: TlcRealtimeInfo | null = null;
      if (resource.hostBibliographicId) {
        realtimeInfo = await this.getRealtimeInfo(
          resource.hostBibliographicId,
          signal,
        );
      }

      const resourceHoldings = this.buildHoldingsFromResource(
        resource,
        isbn,
        realtimeInfo,
      );
      holdings.push(...resourceHoldings);
    }

    return holdings;
  }

  // ── Health check ────────────────────────────────────────────────────────

  protected async executeHealthCheck(): Promise<AdapterHealthStatus> {
    const countUrl = `${this.catalogBaseUrl}/search/count`;

    try {
      const response = await fetch(countUrl, {
        method: "POST",
        signal: AbortSignal.timeout(this.config.timeoutMs),
        headers: this.defaultHeaders(),
        body: JSON.stringify({
          searchTerm: "isbn:\"9780061120084\"",
          startIndex: 0,
          hitsPerPage: 1,
          facetFilters: [],
          branchFilters: [],
          sortCriteria: "Relevancy",
          targetAudience: "",
          dbCodes: [],
        }),
      });

      return {
        systemId: this.systemId,
        protocol: this.protocol,
        healthy: response.ok,
        latencyMs: 0,
        message: response.ok
          ? "TLC search/count probe succeeded"
          : `TLC search/count returned HTTP ${response.status}`,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        systemId: this.systemId,
        protocol: this.protocol,
        healthy: false,
        latencyMs: 0,
        message: error instanceof Error ? error.message : "TLC probe failed",
        checkedAt: new Date().toISOString(),
      };
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private async searchByISBN(
    isbn: ISBN13,
    signal?: AbortSignal,
  ): Promise<TlcSearchResponse> {
    const searchUrl = `${this.catalogBaseUrl}/search`;
    this.logger.debug({ url: searchUrl, isbn }, "Searching TLC by ISBN");

    const response = await fetch(searchUrl, {
      method: "POST",
      signal: signal ?? AbortSignal.timeout(this.config.timeoutMs),
      headers: this.defaultHeaders(),
      body: JSON.stringify({
        searchTerm: `isbn:"${isbn}"`,
        startIndex: 0,
        hitsPerPage: 10,
        facetFilters: [],
        branchFilters: [],
        sortCriteria: "Relevancy",
        targetAudience: "",
        dbCodes: [],
      }),
    });

    if (!response.ok) {
      throw new AdapterConnectionError(
        `TLC search failed with HTTP ${response.status}`,
        this.systemId,
        this.protocol,
      );
    }

    let data: TlcSearchResponse;
    try {
      data = (await response.json()) as TlcSearchResponse;
    } catch {
      throw new AdapterParseError(
        "Failed to parse TLC search JSON",
        this.systemId,
        this.protocol,
      );
    }

    return data;
  }

  private async getRealtimeInfo(
    hostBibId: string,
    signal?: AbortSignal,
  ): Promise<TlcRealtimeInfo | null> {
    const url = `${this.catalogBaseUrl}/hostSystem/getRealtimeHostRecordInformation/${encodeURIComponent(hostBibId)}`;
    this.logger.debug({ url }, "Fetching TLC real-time availability");

    try {
      const response = await fetch(url, {
        signal: signal ?? AbortSignal.timeout(this.config.timeoutMs),
        headers: {
          Accept: "application/json",
          "User-Agent": "BookFinder/1.0",
        },
      });

      if (!response.ok) return null;

      return (await response.json()) as TlcRealtimeInfo;
    } catch {
      // Non-fatal: fall back to holdings-only data
      this.logger.warn({ hostBibId }, "Failed to fetch TLC real-time info");
      return null;
    }
  }

  private buildHoldingsFromResource(
    resource: TlcResource,
    isbn: ISBN13,
    realtimeInfo: TlcRealtimeInfo | null,
  ): BookHolding[] {
    const items = resource.holdingsInformations ?? [];
    if (items.length === 0) return [];

    const catalogUrl = resource.hostBibliographicId
      ? `${this.catalogBaseUrl}/#/search/card?id=${resource.hostBibliographicId}`
      : this.system.catalogUrl;

    // Determine per-title status from real-time info
    const totalCheckouts = realtimeInfo?.totalCheckouts ?? 0;
    const totalCopies = realtimeInfo?.totalCopies ?? items.length;
    const availableCopies = totalCopies - totalCheckouts;

    return items
      .filter((item) => !item.hideFromPublic)
      .map((item, index) => {
        const branchName = item.branchName ?? "Unknown";
        const branchInfo = this.system.branches.find(
          (b) =>
            b.name.toLowerCase() === branchName.toLowerCase() ||
            b.code === item.branchIdentifier,
        );
        const branchId = (branchInfo?.id ?? branchName) as BranchId;

        // If we have real-time info, derive per-item status:
        // If there are more items than checkouts, first N items are available.
        const isAvailable = realtimeInfo
          ? index < availableCopies
          : !item.reserved;

        const rawStatus = item.reserved
          ? "On Hold"
          : isAvailable
            ? "Available"
            : "Checked Out";

        return {
          isbn,
          systemId: this.systemId,
          branchId,
          systemName: this.system.name,
          branchName: branchInfo?.name ?? branchName,
          callNumber: item.formattedCallNumber?.trim() ?? item.shelfLocation ?? null,
          status: this.normalizeStatus(rawStatus),
          materialType: this.mapFormat(resource.format),
          dueDate: null,
          holdCount: realtimeInfo?.totalPendingRequests ?? null,
          copyCount: totalCopies,
          catalogUrl,
          collection: item.collectionName ?? "",
          volume: item.volume ?? null,
          rawStatus,
          fingerprint: this.generateFingerprint([
            this.systemId,
            isbn,
            item.branchIdentifier,
            item.barcode,
          ]),
        };
      });
  }

  private mapFormat(format: string | undefined): MaterialType {
    if (!format) return "book";
    const lower = format.toLowerCase();
    if (lower === "large print") return "large_print";
    if (lower === "audiobook" || lower === "audiobook on cd" || lower.includes("audio"))
      return "audiobook_cd";
    if (lower === "dvd" || lower.includes("dvd")) return "dvd";
    if (lower === "ebook" || lower.includes("e-book")) return "ebook";
    return "book";
  }

  private defaultHeaders(): Record<string, string> {
    return {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "BookFinder/1.0",
    };
  }
}
