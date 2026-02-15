// ---------------------------------------------------------------------------
// ApolloAdapter – XML API adapter for Biblionix Apollo ILS.
//
// Apollo catalogs expose an undocumented AJAX backend:
//   GET  /catalog/ajax_backend/search_setup.xml.pl?search=keyword:{isbn}
//   POST /catalog/ajax_backend/perform_search.xml.pl  {search_id, catalog_version}
//
// Two-step: setup creates a search session, perform executes and returns XML
// with records, branches, and individual holdings.
// ---------------------------------------------------------------------------

import { XMLParser } from "fast-xml-parser";
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

// Soft-hyphen character that Apollo embeds in titles/authors for wrapping hints.
const SOFT_HYPHEN = /\u00AD/g;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  processEntities: false,
  // <s>, <br>, and <h> elements may appear once or many times.
  isArray: (name) => name === "s" || name === "br" || name === "h",
});

/** Attributes of an <s> element (search result record). */
interface ApolloRecord {
  "@_b": string;    // biblio ID
  "@_t"?: string;   // title (may contain soft-hyphens)
  "@_a"?: string;   // author (inverted, with soft-hyphens)
  "@_ani"?: string; // author (natural order)
  "@_c"?: string;   // call number
  "@_sl"?: string;  // shelf location
  "@_m"?: string;   // medium code (Book, CDBK, DVD, etc.)
  "@_e"?: string;   // external provider (overdrive_api, etc.) — empty for physical
  "@_v"?: string;   // available count (at matched branch)
  "@_x"?: string;   // available anywhere (0/1)
  "@_cp"?: string;  // copyright year
  ol?: ApolloOwningLibrary | ApolloOwningLibrary[];
}

interface ApolloOwningLibrary {
  "@_id": string;
  br?: ApolloBranch[];
}

interface ApolloBranch {
  "@_id": string;
  "@_in"?: string;   // items available at this branch
  "@_bt"?: string;   // 0 or 1 — whether branch has items (total)
  hs?: { h?: ApolloHolding[] };
}

interface ApolloHolding {
  "@_id": string;
  "@_available": string; // "0" or "1"
  "@_mat_num"?: string;  // barcode/material number
  "@_volume"?: string;
}

/** Root of perform_search.xml.pl response. */
interface ApolloSearchRoot {
  root?: {
    result?: {
      "@_matches"?: string;
    };
    s?: ApolloRecord[];
  };
}

export class ApolloAdapter extends BaseAdapter {
  private readonly catalogBaseUrl: string;

  constructor(system: LibrarySystem, config: AdapterConfig, logger: Logger) {
    super(system, { ...config, protocol: "apollo_api" }, logger);
    this.catalogBaseUrl = config.baseUrl.replace(/\/+$/, "");
  }

  // ── Search ──────────────────────────────────────────────────────────────

  protected async executeSearch(
    isbn: ISBN13,
    signal?: AbortSignal,
  ): Promise<BookHolding[]> {
    // Step 1: Create search session
    const searchId = await this.setupSearch(isbn, signal);
    if (!searchId) return [];

    // Step 2: Execute search
    const xml = await this.performSearch(searchId, signal);

    // Step 3: Parse results
    return this.parseSearchResults(xml, isbn);
  }

  // ── Health check ────────────────────────────────────────────────────────

  protected async executeHealthCheck(): Promise<AdapterHealthStatus> {
    const probeUrl = `${this.catalogBaseUrl}/catalog/ajax_backend/search_setup.xml.pl?search=keyword%3A9780061120084`;

    try {
      const response = await fetch(probeUrl, {
        signal: AbortSignal.timeout(this.config.timeoutMs),
        headers: this.defaultHeaders(),
      });

      const healthy = response.ok;
      return {
        systemId: this.systemId,
        protocol: this.protocol,
        healthy,
        latencyMs: 0,
        message: healthy
          ? "Apollo search_setup probe succeeded"
          : `Apollo search_setup returned HTTP ${response.status}`,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        systemId: this.systemId,
        protocol: this.protocol,
        healthy: false,
        latencyMs: 0,
        message: error instanceof Error ? error.message : "Apollo probe failed",
        checkedAt: new Date().toISOString(),
      };
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private async setupSearch(
    isbn: ISBN13,
    signal?: AbortSignal,
  ): Promise<string | null> {
    const setupUrl = `${this.catalogBaseUrl}/catalog/ajax_backend/search_setup.xml.pl?search=keyword%3A${isbn}`;
    this.logger.debug({ url: setupUrl }, "Setting up Apollo search");

    const response = await fetch(setupUrl, {
      signal: signal ?? AbortSignal.timeout(this.config.timeoutMs),
      headers: this.defaultHeaders(),
    });

    if (!response.ok) {
      throw new AdapterConnectionError(
        `Apollo search_setup failed with HTTP ${response.status}`,
        this.systemId,
        this.protocol,
      );
    }

    const xml = await response.text();

    // Response is: <root search_id="953537997"></root>
    let parsed: any;
    try {
      parsed = xmlParser.parse(xml);
    } catch {
      throw new AdapterParseError(
        "Failed to parse Apollo search_setup XML",
        this.systemId,
        this.protocol,
      );
    }

    const searchId = parsed?.root?.["@_search_id"];
    if (!searchId) {
      this.logger.warn("Apollo search_setup returned no search_id");
      return null;
    }

    return String(searchId);
  }

  private async performSearch(
    searchId: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const searchUrl = `${this.catalogBaseUrl}/catalog/ajax_backend/perform_search.xml.pl`;
    this.logger.debug({ searchId }, "Executing Apollo search");

    const response = await fetch(searchUrl, {
      method: "POST",
      signal: signal ?? AbortSignal.timeout(this.config.timeoutMs),
      headers: {
        ...this.defaultHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ search_id: Number(searchId), catalog_version: "" }),
    });

    if (!response.ok) {
      throw new AdapterConnectionError(
        `Apollo perform_search failed with HTTP ${response.status}`,
        this.systemId,
        this.protocol,
      );
    }

    return response.text();
  }

  private parseSearchResults(xml: string, isbn: ISBN13): BookHolding[] {
    let parsed: ApolloSearchRoot;
    try {
      parsed = xmlParser.parse(xml) as ApolloSearchRoot;
    } catch {
      throw new AdapterParseError(
        "Failed to parse Apollo search results XML",
        this.systemId,
        this.protocol,
      );
    }

    const matches = Number(parsed?.root?.result?.["@_matches"] ?? "0");
    if (matches === 0) return [];

    const records = parsed?.root?.s ?? [];
    const holdings: BookHolding[] = [];

    for (const record of records) {
      // Skip external/digital providers (Libby, Kanopy, Hoopla, etc.)
      if (record["@_e"] && record["@_e"] !== "") continue;

      const recordHoldings = this.buildHoldingsFromRecord(record, isbn);
      holdings.push(...recordHoldings);
    }

    return holdings;
  }

  private buildHoldingsFromRecord(
    record: ApolloRecord,
    isbn: ISBN13,
  ): BookHolding[] {
    const biblioId = record["@_b"];
    const title = this.cleanSoftHyphens(record["@_t"] ?? "");
    const callNumber = record["@_c"] ?? null;
    const shelfLocation = record["@_sl"] ?? "";
    const catalogUrl = `${this.catalogBaseUrl}/?biblio=${biblioId}`;

    // Collect all holdings from branch/holding tree
    const owningLibs = this.normalizeArray(record.ol);
    const allHoldings: { holding: ApolloHolding; branchId: string }[] = [];

    for (const ol of owningLibs) {
      const branches = ol.br ?? [];
      for (const br of branches) {
        const branchHoldings = br.hs?.h ?? [];
        for (const h of branchHoldings) {
          allHoldings.push({ holding: h, branchId: br["@_id"] });
        }
      }
    }

    if (allHoldings.length === 0) {
      // No item-level data — create a single record-level holding.
      const defaultBranch = this.system.branches[0];
      return [
        {
          isbn,
          systemId: this.systemId,
          branchId: defaultBranch?.id ?? ("unknown" as BranchId),
          systemName: this.system.name,
          branchName: defaultBranch?.name ?? "Unknown",
          callNumber,
          status: record["@_x"] === "1" ? "available" : "unknown",
          materialType: this.mapMedium(record["@_m"]),
          dueDate: null,
          holdCount: null,
          copyCount: null,
          catalogUrl,
          collection: shelfLocation,
          volume: null,
          rawStatus: record["@_x"] === "1" ? "Available" : "",
          fingerprint: this.generateFingerprint([this.systemId, isbn, biblioId]),
        },
      ];
    }

    // Build one BookHolding per physical item
    return allHoldings.map(({ holding, branchId }) => {
      // Try to match Apollo branch ID to our configured branches.
      // Apollo branch IDs are internal numeric IDs; fallback to first branch
      // for single-branch systems (the common case).
      const branchInfo =
        this.system.branches.find((b) => b.code === branchId) ??
        (this.system.branches.length === 1
          ? this.system.branches[0]
          : undefined);

      const available = holding["@_available"] === "1";

      return {
        isbn,
        systemId: this.systemId,
        branchId: (branchInfo?.id ?? branchId) as BranchId,
        systemName: this.system.name,
        branchName: branchInfo?.name ?? this.system.name,
        callNumber,
        status: this.normalizeStatus(available ? "Available" : "Checked Out"),
        materialType: this.mapMedium(record["@_m"]),
        dueDate: null,
        holdCount: null,
        copyCount: null,
        catalogUrl,
        collection: shelfLocation,
        volume: holding["@_volume"] || null,
        rawStatus: available ? "Available" : "Checked Out",
        fingerprint: this.generateFingerprint([
          this.systemId,
          isbn,
          branchId,
          holding["@_mat_num"],
          holding["@_id"],
        ]),
      };
    });
  }

  private cleanSoftHyphens(text: string): string {
    return text.replace(SOFT_HYPHEN, "");
  }

  private mapMedium(medium: string | undefined): MaterialType {
    if (!medium) return "book";
    const lower = medium.toLowerCase();
    if (lower === "cdbk" || lower.includes("audiobook") || lower.includes("audio cd"))
      return "audiobook_cd";
    if (lower === "dvd" || lower.includes("dvd")) return "dvd";
    if (lower.includes("large print") || lower === "lp") return "large_print";
    if (lower.includes("ebook") || lower.includes("e-book")) return "ebook";
    return "book";
  }

  private normalizeArray<T>(value: T | T[] | undefined): T[] {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  }

  private defaultHeaders(): Record<string, string> {
    return {
      Accept: "application/xml, text/xml",
      "User-Agent": "BookFinder/1.0",
    };
  }
}
