// ---------------------------------------------------------------------------
// WorldCatAdapter – searches OCLC WorldCat Search API v2 for holdings.
//
// Authentication: OAuth2 client_credentials flow.
// Token endpoint:  https://oauth.oclc.org/token
// Search endpoint: https://americas.discovery.api.oclc.org/worldcat/search/v2/bibs
//
// Credentials are read from environment variables whose names are specified
// in AdapterConfig (clientKeyEnvVar / clientSecretEnvVar), keeping secrets
// out of configuration files.
// ---------------------------------------------------------------------------

import type { Logger } from "pino";

import type {
  AdapterConfig,
  AdapterHealthStatus,
  BookHolding,
  BranchId,
  ISBN13,
  LibrarySystem,
  LibrarySystemId,
} from "../../core/types.js";
import {
  AdapterAuthError,
  AdapterConnectionError,
  AdapterParseError,
} from "../../core/errors.js";
import { BaseAdapter } from "../base/base-adapter.js";

// ── Constants ─────────────────────────────────────────────────────────────

const TOKEN_URL = "https://oauth.oclc.org/token";
const SEARCH_BASE_URL =
  "https://americas.discovery.api.oclc.org/worldcat/search/v2/bibs";

/** Safety margin before token actually expires (ms). */
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

// ── Types ─────────────────────────────────────────────────────────────────

interface OAuthToken {
  accessToken: string;
  expiresAt: number; // Unix ms
}

interface WorldCatBibResponse {
  numberOfRecords?: number;
  bibRecords?: WorldCatBibRecord[];
}

interface WorldCatBibRecord {
  identifier?: { oclcNumber?: string };
  title?: string;
  creator?: string;
  date?: string;
  machineReadableRecord?: any;
}

interface WorldCatHoldingsResponse {
  numberOfHoldings?: number;
  briefRecords?: WorldCatHoldingRecord[];
}

interface WorldCatHoldingRecord {
  oclcNumber?: string;
  institutionSymbol?: string;
  institutionName?: string;
  branchName?: string;
  shelvingLocation?: string;
  callNumber?: string;
}

/**
 * Adapter for OCLC WorldCat Search API v2.  Queries the global bibliographic
 * database and filters holdings to Texas libraries.
 */
export class WorldCatAdapter extends BaseAdapter {
  private cachedToken: OAuthToken | null = null;

  /**
   * Maps OCLC institution symbols (e.g. "TXH") to our library system IDs
   * (e.g. "houston-public").  When a mapping exists, the holding is stamped
   * with the direct system's ID so the ResultAggregator can detect overlap
   * and prefer direct adapter results over WorldCat's "status unknown" entries.
   */
  private readonly institutionSymbolMap: ReadonlyMap<string, LibrarySystemId>;

  constructor(system: LibrarySystem, config: AdapterConfig, logger: Logger) {
    super(system, { ...config, protocol: "oclc_worldcat" }, logger);

    const rawMap = (config.extra?.institutionSymbolMap ?? {}) as Record<
      string,
      string
    >;
    this.institutionSymbolMap = new Map(
      Object.entries(rawMap).map(([symbol, id]) => [
        symbol,
        id as LibrarySystemId,
      ]),
    );
  }

  // ── Search ──────────────────────────────────────────────────────────────

  protected async executeSearch(
    isbn: ISBN13,
    signal?: AbortSignal,
  ): Promise<BookHolding[]> {
    const token = await this.getToken();
    const effectiveSignal = signal ?? AbortSignal.timeout(this.config.timeoutMs);

    // Step 1: Search for bibs matching the ISBN.
    const searchUrl = `${SEARCH_BASE_URL}?q=bn:${isbn}&itemType=book&itemSubType=book-printbook&limit=10`;
    this.logger.debug({ url: searchUrl }, "Searching WorldCat bibs");

    const bibResponse = await fetch(searchUrl, {
      signal: effectiveSignal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": "BookFinder/1.0",
      },
    });

    if (!bibResponse.ok) {
      if (bibResponse.status === 401 || bibResponse.status === 403) {
        this.invalidateToken();
        throw new AdapterAuthError(
          `WorldCat auth failed (HTTP ${bibResponse.status})`,
          this.systemId,
          this.protocol,
        );
      }
      throw new AdapterConnectionError(
        `WorldCat search failed with HTTP ${bibResponse.status}`,
        this.systemId,
        this.protocol,
      );
    }

    const bibData = (await bibResponse.json()) as WorldCatBibResponse;
    if (!bibData.bibRecords || bibData.bibRecords.length === 0) {
      return [];
    }

    // Step 2: For each bib, get Texas holdings.
    const allHoldings: BookHolding[] = [];

    for (const bib of bibData.bibRecords) {
      const oclcNumber = bib.identifier?.oclcNumber;
      if (!oclcNumber) continue;

      const holdings = await this.fetchHoldings(
        oclcNumber,
        isbn,
        bib,
        token,
        effectiveSignal,
      );
      allHoldings.push(...holdings);
    }

    return allHoldings;
  }

  // ── Health check ────────────────────────────────────────────────────────

  protected async executeHealthCheck(): Promise<AdapterHealthStatus> {
    try {
      await this.getToken();
      return {
        systemId: this.systemId,
        protocol: this.protocol,
        healthy: true,
        latencyMs: 0, // Overridden by base class
        message: "OAuth2 token request succeeded",
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
            : "Token request failed",
        checkedAt: new Date().toISOString(),
      };
    }
  }

  // ── OAuth2 token management ─────────────────────────────────────────────

  private async getToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt) {
      return this.cachedToken.accessToken;
    }
    return this.refreshToken();
  }

  private invalidateToken(): void {
    this.cachedToken = null;
  }

  private async refreshToken(): Promise<string> {
    const clientKey = this.getCredential(this.config.clientKeyEnvVar, "client key");
    const clientSecret = this.getCredential(
      this.config.clientSecretEnvVar,
      "client secret",
    );

    const basicAuth = Buffer.from(`${clientKey}:${clientSecret}`).toString(
      "base64",
    );

    this.logger.debug("Requesting new WorldCat OAuth2 token");

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: "wcapi",
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new AdapterAuthError(
        `WorldCat OAuth2 token request failed (HTTP ${response.status}): ${body}`,
        this.systemId,
        this.protocol,
      );
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
      token_type: string;
    };

    this.cachedToken = {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000 - TOKEN_EXPIRY_MARGIN_MS,
    };

    this.logger.info(
      { expiresInSeconds: data.expires_in },
      "WorldCat OAuth2 token refreshed",
    );

    return this.cachedToken.accessToken;
  }

  // ── Holdings retrieval ──────────────────────────────────────────────────

  private async fetchHoldings(
    oclcNumber: string,
    isbn: ISBN13,
    bib: WorldCatBibRecord,
    token: string,
    signal: AbortSignal,
  ): Promise<BookHolding[]> {
    const holdingsUrl =
      `${SEARCH_BASE_URL}/${oclcNumber}/institutionHoldings?heldInState=US-TX&limit=50`;

    this.logger.debug(
      { oclcNumber, url: holdingsUrl },
      "Fetching WorldCat holdings",
    );

    const response = await fetch(holdingsUrl, {
      signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": "BookFinder/1.0",
      },
    });

    if (!response.ok) {
      this.logger.warn(
        { oclcNumber, status: response.status },
        "Failed to fetch WorldCat holdings",
      );
      return [];
    }

    const holdingsData = (await response.json()) as WorldCatHoldingsResponse;
    if (
      !holdingsData.briefRecords ||
      holdingsData.briefRecords.length === 0
    ) {
      return [];
    }

    return holdingsData.briefRecords.map((holding) => {
      const symbol = holding.institutionSymbol ?? "unknown";
      const mappedSystemId =
        this.institutionSymbolMap.get(symbol) ?? this.systemId;

      return {
        isbn,
        systemId: mappedSystemId,
        branchId: symbol as BranchId,
        systemName: holding.institutionName ?? this.system.name,
        branchName: holding.branchName ?? holding.institutionName ?? "Unknown",
        callNumber: holding.callNumber ?? null,
        status: "unknown" as const,
        materialType: "book" as const,
        dueDate: null,
        holdCount: null,
        copyCount: null,
        catalogUrl: this.system.catalogUrl,
        collection: holding.shelvingLocation ?? "",
        volume: null,
        rawStatus: "WorldCat holdings - real-time status unavailable",
        fingerprint: this.generateFingerprint([
          "worldcat",
          isbn,
          symbol,
          oclcNumber,
        ]),
      };
    });
  }

  // ── Credential helpers ──────────────────────────────────────────────────

  private getCredential(envVarName: string | undefined, label: string): string {
    if (!envVarName) {
      throw new AdapterAuthError(
        `WorldCat ${label} env var name not configured`,
        this.systemId,
        this.protocol,
      );
    }
    const value = process.env[envVarName];
    if (!value) {
      throw new AdapterAuthError(
        `WorldCat ${label} not found in env var "${envVarName}"`,
        this.systemId,
        this.protocol,
      );
    }
    return value;
  }
}
