// ---------------------------------------------------------------------------
// PolarisApiAdapter – searches Polaris ILS via the PAPI (Public Access API).
//
// Authentication: HMAC-SHA1 signed requests.
//   Signature = Base64(HMAC-SHA1(secret, method + url + date))
//   Headers:
//     PolarisDate: <HTTP date>
//     Authorization: PWS <accessKey>:<signature>
//
// Search endpoint:
//   GET /PAPIService/REST/public/v1/1033/100/1/search/bibs?q=ISBN={isbn}
//
// Holdings endpoint:
//   GET /PAPIService/REST/public/v1/1033/100/1/bib/{bibId}/holdings
// ---------------------------------------------------------------------------

import { createHmac } from "node:crypto";
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
  AdapterAuthError,
  AdapterConnectionError,
  AdapterParseError,
} from "../../core/errors.js";
import { BaseAdapter } from "../base/base-adapter.js";

// ── Polaris response types ────────────────────────────────────────────────

interface PolarisBibSearchResponse {
  PAPIErrorCode: number;
  TotalCount?: number;
  BibSearchRows?: PolarisBibRow[];
}

interface PolarisBibRow {
  BibliographicRecordID: number;
  Title?: string;
  Author?: string;
  FormatDescription?: string;
  PublicationDate?: string;
  CallNumber?: string;
  ISBN?: string;
}

interface PolarisHoldingsResponse {
  PAPIErrorCode: number;
  BibHoldingsRows?: PolarisHoldingRow[];
}

interface PolarisHoldingRow {
  ItemRecordID: number;
  BranchID: number;
  BranchName: string;
  CollectionName?: string;
  CallNumber?: string;
  Barcode?: string;
  CircStatus?: string;
  DueDate?: string;
  MaterialType?: string;
  VolumeNumber?: string;
  CopyNumber?: number;
  HoldRequestCount?: number;
  ShelvingLocation?: string;
}

/** Well-known ISBN for health-check probing. */
const PROBE_ISBN = "9780061120084"; // To Kill a Mockingbird

/**
 * Adapter for Innovative/Clarivate Polaris PAPI (Public Access API).
 * Uses HMAC-SHA1 request signing for authentication.
 */
export class PolarisApiAdapter extends BaseAdapter {
  private readonly accessKey: string;
  private readonly accessSecret: string;
  private readonly papiBasePath: string;

  constructor(system: LibrarySystem, config: AdapterConfig, logger: Logger) {
    super(system, { ...config, protocol: "polaris_papi" }, logger);

    this.accessKey = this.getCredential(config.clientKeyEnvVar, "access key");
    this.accessSecret = this.getCredential(
      config.clientSecretEnvVar,
      "access secret",
    );

    // Allow the PAPI path prefix to be overridden via config.extra.
    this.papiBasePath =
      (config.extra?.papiBasePath as string | undefined) ??
      "/PAPIService/REST/public/v1/1033/100/1";
  }

  // ── Search ──────────────────────────────────────────────────────────────

  protected async executeSearch(
    isbn: ISBN13,
    signal?: AbortSignal,
  ): Promise<BookHolding[]> {
    const effectiveSignal = signal ?? AbortSignal.timeout(this.config.timeoutMs);

    // Step 1: Search for bib records matching the ISBN.
    const bibs = await this.searchBibs(isbn, effectiveSignal);
    if (bibs.length === 0) return [];

    // Step 2: Retrieve holdings for each bib.
    const allHoldings: BookHolding[] = [];

    for (const bib of bibs) {
      const holdings = await this.getHoldings(
        bib.BibliographicRecordID,
        isbn,
        bib,
        effectiveSignal,
      );
      allHoldings.push(...holdings);
    }

    return allHoldings;
  }

  // ── Health check ────────────────────────────────────────────────────────

  protected async executeHealthCheck(): Promise<AdapterHealthStatus> {
    try {
      await this.searchBibs(
        PROBE_ISBN as ISBN13,
        AbortSignal.timeout(this.config.timeoutMs),
      );
      return {
        systemId: this.systemId,
        protocol: this.protocol,
        healthy: true,
        latencyMs: 0, // Overridden by base class
        message: "Polaris PAPI probe search succeeded",
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
            : "Polaris PAPI probe failed",
        checkedAt: new Date().toISOString(),
      };
    }
  }

  // ── Private: API calls ──────────────────────────────────────────────────

  private async searchBibs(
    isbn: ISBN13,
    signal: AbortSignal,
  ): Promise<PolarisBibRow[]> {
    const path = `${this.papiBasePath}/search/bibs?q=ISBN=${isbn}`;
    const url = `${this.config.baseUrl.replace(/\/+$/, "")}${path}`;

    this.logger.debug({ url }, "Searching Polaris bibs");

    const response = await this.signedFetch("GET", url, signal);

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new AdapterAuthError(
          `Polaris PAPI auth failed (HTTP ${response.status})`,
          this.systemId,
          this.protocol,
        );
      }
      throw new AdapterConnectionError(
        `Polaris bib search failed with HTTP ${response.status}`,
        this.systemId,
        this.protocol,
      );
    }

    const data = (await response.json()) as PolarisBibSearchResponse;

    if (data.PAPIErrorCode !== 0) {
      this.logger.warn(
        { errorCode: data.PAPIErrorCode },
        "Polaris PAPI returned error code",
      );
      return [];
    }

    return data.BibSearchRows ?? [];
  }

  private async getHoldings(
    bibId: number,
    isbn: ISBN13,
    bib: PolarisBibRow,
    signal: AbortSignal,
  ): Promise<BookHolding[]> {
    const path = `${this.papiBasePath}/bib/${bibId}/holdings`;
    const url = `${this.config.baseUrl.replace(/\/+$/, "")}${path}`;

    this.logger.debug({ bibId, url }, "Fetching Polaris holdings");

    const response = await this.signedFetch("GET", url, signal);

    if (!response.ok) {
      this.logger.warn(
        { bibId, status: response.status },
        "Failed to fetch Polaris holdings",
      );
      return [];
    }

    const data = (await response.json()) as PolarisHoldingsResponse;

    if (
      data.PAPIErrorCode !== 0 ||
      !data.BibHoldingsRows ||
      data.BibHoldingsRows.length === 0
    ) {
      return [];
    }

    return data.BibHoldingsRows.map((holding) =>
      this.mapHoldingToBookHolding(holding, isbn, bib),
    );
  }

  // ── Private: HMAC signing ───────────────────────────────────────────────

  /**
   * Execute a fetch request with Polaris HMAC-SHA1 authentication headers.
   */
  private async signedFetch(
    method: string,
    url: string,
    signal: AbortSignal,
  ): Promise<Response> {
    const date = new Date().toUTCString();
    const signature = this.computeSignature(method, url, date);

    return fetch(url, {
      method,
      signal,
      headers: {
        PolarisDate: date,
        Authorization: `PWS ${this.accessKey}:${signature}`,
        Accept: "application/json",
        "User-Agent": "BookFinder/1.0",
      },
    });
  }

  /**
   * Compute the HMAC-SHA1 signature for a Polaris PAPI request.
   *
   * Signature = Base64(HMAC-SHA1(accessSecret, method + url + date))
   */
  private computeSignature(
    method: string,
    url: string,
    date: string,
  ): string {
    const payload = method + url + date;
    return createHmac("sha1", this.accessSecret)
      .update(payload)
      .digest("base64");
  }

  // ── Private: Mapping ────────────────────────────────────────────────────

  private mapHoldingToBookHolding(
    holding: PolarisHoldingRow,
    isbn: ISBN13,
    bib: PolarisBibRow,
  ): BookHolding {
    const branchCode = String(holding.BranchID);
    const branchInfo = this.system.branches.find(
      (b) => b.code === branchCode || b.name === holding.BranchName,
    );

    const rawStatus = holding.CircStatus ?? "";

    return {
      isbn,
      systemId: this.systemId,
      branchId: (branchInfo?.id ?? branchCode) as BranchId,
      systemName: this.system.name,
      branchName: branchInfo?.name ?? holding.BranchName,
      callNumber: holding.CallNumber ?? bib.CallNumber ?? null,
      status: this.normalizeStatus(rawStatus),
      materialType: this.mapPolarisMaterialType(holding.MaterialType),
      dueDate: holding.DueDate ?? null,
      holdCount: holding.HoldRequestCount ?? null,
      copyCount: holding.CopyNumber ?? null,
      catalogUrl: this.system.catalogUrl,
      collection: holding.CollectionName ?? "",
      volume: holding.VolumeNumber ?? null,
      rawStatus,
      fingerprint: this.generateFingerprint([
        this.systemId,
        isbn,
        branchCode,
        holding.Barcode ?? String(holding.ItemRecordID),
      ]),
    };
  }

  private mapPolarisMaterialType(
    materialType: string | undefined,
  ): BookHolding["materialType"] {
    if (!materialType) return "unknown";
    const lower = materialType.toLowerCase();

    if (lower.includes("book") || lower === "text") return "book";
    if (lower.includes("large print") || lower.includes("large type"))
      return "large_print";
    if (lower.includes("audiobook") || lower.includes("audio"))
      return "audiobook_cd";
    if (lower.includes("ebook") || lower.includes("e-book")) return "ebook";
    if (lower.includes("dvd") || lower.includes("video")) return "dvd";

    return "unknown";
  }

  // ── Credential helpers ──────────────────────────────────────────────────

  private getCredential(
    envVarName: string | undefined,
    label: string,
  ): string {
    if (!envVarName) {
      throw new AdapterAuthError(
        `Polaris ${label} env var name not configured`,
        this.systemId,
        this.protocol,
      );
    }
    const value = process.env[envVarName];
    if (!value) {
      throw new AdapterAuthError(
        `Polaris ${label} not found in env var "${envVarName}"`,
        this.systemId,
        this.protocol,
      );
    }
    return value;
  }
}
