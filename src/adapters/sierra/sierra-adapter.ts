// ---------------------------------------------------------------------------
// SierraApiAdapter – searches III Sierra REST API (v6) for ISBN holdings.
//
// Sierra API v6 endpoints used:
//   GET  /iii/sierra-api/v6/bibs/search?index=standardNumber&text={isbn}
//   GET  /iii/sierra-api/v6/items?bibIds={id}&fields=status,location,...
//
// Authentication is handled by SierraAuth (OAuth2 client_credentials).
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
import {
  AdapterAuthError,
  AdapterConnectionError,
  AdapterParseError,
} from "../../core/errors.js";
import { BaseAdapter } from "../base/base-adapter.js";
import { SierraAuth } from "./sierra-auth.js";

// ── Sierra API response shapes ────────────────────────────────────────────

interface SierraBibSearchResponse {
  total: number;
  start: number;
  entries: SierraBibEntry[];
}

interface SierraBibEntry {
  id: string;
  title?: string;
  author?: string;
  materialType?: { code: string; value: string };
  callNumber?: string;
  publishYear?: number;
}

interface SierraItemsResponse {
  total: number;
  start: number;
  entries: SierraItemEntry[];
}

interface SierraItemEntry {
  id: string;
  status?: { code: string; display: string; duedate?: string };
  location?: { code: string; name: string };
  callNumber?: string;
  barcode?: string;
  itemType?: number;
  bibIds?: string[];
  volume?: string;
  copyNumber?: number;
  holdCount?: number;
}

/**
 * Adapter for Innovative Interfaces / Clarivate Sierra REST API v6.
 */
export class SierraApiAdapter extends BaseAdapter {
  private readonly auth: SierraAuth;

  constructor(system: LibrarySystem, config: AdapterConfig, logger: Logger) {
    super(system, { ...config, protocol: "sierra_rest" }, logger);

    const clientKey = this.getCredential(config.clientKeyEnvVar, "client key");
    const clientSecret = this.getCredential(
      config.clientSecretEnvVar,
      "client secret",
    );

    this.auth = new SierraAuth(config.baseUrl, clientKey, clientSecret, logger);
  }

  // ── Search ──────────────────────────────────────────────────────────────

  protected async executeSearch(
    isbn: ISBN13,
    signal?: AbortSignal,
  ): Promise<BookHolding[]> {
    const effectiveSignal = signal ?? AbortSignal.timeout(this.config.timeoutMs);
    const token = await this.auth.getToken();

    // Step 1: Search bibs by ISBN.
    const bibResults = await this.searchBibs(isbn, token, effectiveSignal);
    if (bibResults.length === 0) return [];

    // Step 2: Get items for each bib.
    const allHoldings: BookHolding[] = [];

    for (const bib of bibResults) {
      const items = await this.getItemsForBib(
        bib.id,
        token,
        effectiveSignal,
      );

      for (const item of items) {
        allHoldings.push(this.mapItemToHolding(item, bib, isbn));
      }

      // If a bib has no items, create a bib-level holding.
      if (items.length === 0) {
        allHoldings.push(this.mapBibToHolding(bib, isbn));
      }
    }

    return allHoldings;
  }

  // ── Health check ────────────────────────────────────────────────────────

  protected async executeHealthCheck(): Promise<AdapterHealthStatus> {
    try {
      await this.auth.getToken();
      return {
        systemId: this.systemId,
        protocol: this.protocol,
        healthy: true,
        latencyMs: 0, // Overridden by base class
        message: "Sierra OAuth2 token request succeeded",
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        systemId: this.systemId,
        protocol: this.protocol,
        healthy: false,
        latencyMs: 0,
        message:
          error instanceof Error
            ? error.message
            : "Sierra token request failed",
        checkedAt: new Date().toISOString(),
      };
    }
  }

  // ── Private: API calls ──────────────────────────────────────────────────

  private async searchBibs(
    isbn: ISBN13,
    token: string,
    signal: AbortSignal,
  ): Promise<SierraBibEntry[]> {
    const baseUrl = this.config.baseUrl.replace(/\/+$/, "");
    const searchUrl =
      `${baseUrl}/iii/sierra-api/v6/bibs/search?index=standardNumber&text=${isbn}&limit=20&fields=id,title,author,materialType,callNumber,publishYear`;

    this.logger.debug({ url: searchUrl }, "Searching Sierra bibs");

    const response = await fetch(searchUrl, {
      signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": "BookFinder/1.0",
      },
    });

    if (response.status === 401 || response.status === 403) {
      this.auth.invalidateToken();
      throw new AdapterAuthError(
        `Sierra auth failed (HTTP ${response.status})`,
        this.systemId,
        this.protocol,
      );
    }

    if (!response.ok) {
      throw new AdapterConnectionError(
        `Sierra bib search failed with HTTP ${response.status}`,
        this.systemId,
        this.protocol,
      );
    }

    const data = (await response.json()) as SierraBibSearchResponse;
    return data.entries ?? [];
  }

  private async getItemsForBib(
    bibId: string,
    token: string,
    signal: AbortSignal,
  ): Promise<SierraItemEntry[]> {
    const baseUrl = this.config.baseUrl.replace(/\/+$/, "");
    const itemsUrl =
      `${baseUrl}/iii/sierra-api/v6/items?bibIds=${bibId}&fields=id,status,location,callNumber,barcode,itemType,volume,copyNumber,holdCount&limit=50`;

    this.logger.debug({ bibId, url: itemsUrl }, "Fetching Sierra items");

    const response = await fetch(itemsUrl, {
      signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": "BookFinder/1.0",
      },
    });

    if (response.status === 404) {
      // No items for this bib.
      return [];
    }

    if (response.status === 401 || response.status === 403) {
      this.auth.invalidateToken();
      throw new AdapterAuthError(
        `Sierra auth failed (HTTP ${response.status})`,
        this.systemId,
        this.protocol,
      );
    }

    if (!response.ok) {
      this.logger.warn(
        { bibId, status: response.status },
        "Failed to fetch Sierra items",
      );
      return [];
    }

    const data = (await response.json()) as SierraItemsResponse;
    return data.entries ?? [];
  }

  // ── Private: Mapping ────────────────────────────────────────────────────

  private mapItemToHolding(
    item: SierraItemEntry,
    bib: SierraBibEntry,
    isbn: ISBN13,
  ): BookHolding {
    const locationCode = item.location?.code ?? "unknown";
    const branchInfo = this.system.branches.find(
      (b) => b.code === locationCode,
    );

    const rawStatus = item.status?.display ?? item.status?.code ?? "";
    const status = this.mapSierraStatus(item.status?.code, rawStatus);

    return {
      isbn,
      systemId: this.systemId,
      branchId: (branchInfo?.id ?? locationCode) as BranchId,
      systemName: this.system.name,
      branchName: branchInfo?.name ?? item.location?.name ?? locationCode,
      callNumber: item.callNumber ?? bib.callNumber ?? null,
      status,
      materialType: this.mapSierraMaterialType(bib.materialType?.code),
      dueDate: item.status?.duedate ?? null,
      holdCount: item.holdCount ?? null,
      copyCount: item.copyNumber ?? null,
      catalogUrl: this.system.catalogUrl,
      collection: "",
      volume: item.volume ?? null,
      rawStatus,
      fingerprint: this.generateFingerprint([
        this.systemId,
        isbn,
        locationCode,
        item.barcode ?? item.id,
      ]),
    };
  }

  private mapBibToHolding(bib: SierraBibEntry, isbn: ISBN13): BookHolding {
    return {
      isbn,
      systemId: this.systemId,
      branchId: "unknown" as BranchId,
      systemName: this.system.name,
      branchName: "Unknown",
      callNumber: bib.callNumber ?? null,
      status: "unknown",
      materialType: this.mapSierraMaterialType(bib.materialType?.code),
      dueDate: null,
      holdCount: null,
      copyCount: null,
      catalogUrl: this.system.catalogUrl,
      collection: "",
      volume: null,
      rawStatus: "",
      fingerprint: this.generateFingerprint([
        this.systemId,
        isbn,
        bib.id,
      ]),
    };
  }

  /**
   * Map Sierra item status codes to canonical ItemStatus.
   *
   * Sierra uses single-character status codes:
   *   "-" or "" = available (on shelf)
   *   "!" = on holdshelf
   *   "t" = in transit
   *   "m" = missing
   *   "o" = checked out (indicated by code or presence of duedate)
   */
  private mapSierraStatus(
    code: string | undefined,
    display: string,
  ): BookHolding["status"] {
    if (!code || code === "-" || code === "") {
      return "available";
    }

    switch (code) {
      case "!":
        return "on_hold";
      case "t":
        return "in_transit";
      case "m":
        return "missing";
      case "o":
        return "checked_out";
      case "#":
        return "on_order";
      case "z":
        return "in_processing";
      default:
        // Fall back to display string normalisation.
        return this.normalizeStatus(display);
    }
  }

  /**
   * Map Sierra material type codes to canonical MaterialType.
   *
   * Common Sierra bib material type codes:
   *   a = book (language material)
   *   l = large print
   *   i = audiobook (non-musical recording)
   *   s = audiobook CD (musical sound recording -- context-dependent)
   *   g = DVD / video
   */
  private mapSierraMaterialType(code: string | undefined): MaterialType {
    if (!code) return "unknown";

    switch (code.toLowerCase()) {
      case "a":
        return "book";
      case "l":
        return "large_print";
      case "i":
        return "audiobook_cd";
      case "s":
        return "audiobook_cd";
      case "g":
        return "dvd";
      case "z":
        return "ebook";
      default:
        return "unknown";
    }
  }

  // ── Credential helpers ──────────────────────────────────────────────────

  private getCredential(
    envVarName: string | undefined,
    label: string,
  ): string {
    if (!envVarName) {
      throw new AdapterAuthError(
        `Sierra ${label} env var name not configured`,
        this.systemId,
        this.protocol,
      );
    }
    const value = process.env[envVarName];
    if (!value) {
      throw new AdapterAuthError(
        `Sierra ${label} not found in env var "${envVarName}"`,
        this.systemId,
        this.protocol,
      );
    }
    return value;
  }
}
