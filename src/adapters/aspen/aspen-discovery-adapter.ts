// ---------------------------------------------------------------------------
// AspenDiscoveryAdapter – REST API adapter for Aspen Discovery ILS.
//
// Aspen Discovery (open-source) exposes JSON APIs:
//   /API/SearchAPI?method=search&lookfor={isbn}&searchIndex=ISN
//   /API/ItemAPI?method=getItemAvailability&id={recordId}
//
// Two-step: search for records by ISBN, then fetch item availability per record.
// ---------------------------------------------------------------------------

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
import {
  parseSearchRecords,
  parseItemRecords,
  type AspenSearchRecord,
  type AspenSearchResponse,
  type AspenItemRecord,
  type AspenItemResponse,
} from "./aspen-response-parser.js";

export class AspenDiscoveryAdapter extends BaseAdapter {
  private readonly catalogBaseUrl: string;

  constructor(system: LibrarySystem, config: AdapterConfig, logger: Logger) {
    super(system, { ...config, protocol: "aspen_discovery_api" }, logger);
    this.catalogBaseUrl = config.baseUrl.replace(/\/+$/, "");
  }

  // ── Search ──────────────────────────────────────────────────────────────

  protected async executeSearch(
    isbn: ISBN13,
    signal?: AbortSignal,
  ): Promise<BookHolding[]> {
    const records = await this.searchByISBN(isbn, signal);
    if (records.length === 0) return [];

    const holdings: BookHolding[] = [];

    for (const record of records) {
      const items = await this.getItemAvailability(record.id, signal);
      if (items.length === 0) {
        // No item-level data — create a single record-level holding.
        holdings.push(this.buildRecordLevelHolding(record, isbn));
      } else {
        for (const item of items) {
          holdings.push(this.buildItemHolding(record, item, isbn));
        }
      }
    }

    return holdings;
  }

  // ── Health check ────────────────────────────────────────────────────────

  protected async executeHealthCheck(): Promise<AdapterHealthStatus> {
    const probeUrl = `${this.catalogBaseUrl}/API/SearchAPI?method=search&lookfor=9780061120084&searchIndex=ISN`;

    try {
      const response = await fetch(probeUrl, {
        signal: AbortSignal.timeout(this.config.timeoutMs),
        headers: this.defaultHeaders(),
      });

      return {
        systemId: this.systemId,
        protocol: this.protocol,
        healthy: response.ok,
        latencyMs: 0,
        message: response.ok
          ? "Aspen Discovery API probe succeeded"
          : `Aspen Discovery API returned HTTP ${response.status}`,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        systemId: this.systemId,
        protocol: this.protocol,
        healthy: false,
        latencyMs: 0,
        message: error instanceof Error ? error.message : "Aspen Discovery probe failed",
        checkedAt: new Date().toISOString(),
      };
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private async searchByISBN(
    isbn: ISBN13,
    signal?: AbortSignal,
  ): Promise<AspenSearchRecord[]> {
    const searchUrl = `${this.catalogBaseUrl}/API/SearchAPI?method=search&lookfor=${isbn}&searchIndex=ISN`;
    this.logger.debug({ url: searchUrl }, "Searching Aspen Discovery by ISBN");

    const response = await fetch(searchUrl, {
      signal: signal ?? AbortSignal.timeout(this.config.timeoutMs),
      headers: this.defaultHeaders(),
    });

    if (!response.ok) {
      throw new AdapterConnectionError(
        `Aspen Discovery search failed with HTTP ${response.status}`,
        this.systemId,
        this.protocol,
      );
    }

    let data: AspenSearchResponse;
    try {
      data = (await response.json()) as AspenSearchResponse;
    } catch {
      throw new AdapterParseError(
        "Failed to parse Aspen Discovery search JSON",
        this.systemId,
        this.protocol,
      );
    }

    return parseSearchRecords(data);
  }

  private async getItemAvailability(
    recordId: string,
    signal?: AbortSignal,
  ): Promise<AspenItemRecord[]> {
    const itemUrl = `${this.catalogBaseUrl}/API/ItemAPI?method=getItemAvailability&id=${encodeURIComponent(recordId)}`;
    this.logger.debug({ url: itemUrl }, "Fetching Aspen Discovery item availability");

    try {
      const response = await fetch(itemUrl, {
        signal: signal ?? AbortSignal.timeout(this.config.timeoutMs),
        headers: this.defaultHeaders(),
      });

      if (!response.ok) {
        this.logger.warn(
          { recordId, status: response.status },
          "ItemAPI returned non-OK status; falling back to record-level",
        );
        return [];
      }

      const data = (await response.json()) as AspenItemResponse;
      return parseItemRecords(data);
    } catch {
      // Non-fatal: fall back to record-level holding
      this.logger.warn({ recordId }, "Failed to fetch item availability");
      return [];
    }
  }

  private buildRecordLevelHolding(
    record: AspenSearchRecord,
    isbn: ISBN13,
  ): BookHolding {
    return {
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
      catalogUrl: `${this.catalogBaseUrl}/Record/${record.id}`,
      collection: "",
      volume: null,
      rawStatus: "",
      fingerprint: this.generateFingerprint([this.systemId, isbn, record.id]),
    };
  }

  private buildItemHolding(
    record: AspenSearchRecord,
    item: AspenItemRecord,
    isbn: ISBN13,
  ): BookHolding {
    const locationName =
      item.locationName ?? item.location ?? item.locationCode ?? "Unknown";
    const locationCode = item.locationCode ?? locationName;

    const branchInfo = this.system.branches.find(
      (b) =>
        b.code.toLowerCase() === locationCode.toLowerCase() ||
        b.name.toLowerCase() === locationName.toLowerCase(),
    );
    const branchId = (branchInfo?.id ?? locationCode) as BranchId;
    const branchName = branchInfo?.name ?? locationName;

    const rawStatus =
      item.statusFull ?? item.status ?? (item.available ? "Available" : "");

    return {
      isbn,
      systemId: this.systemId,
      branchId,
      systemName: this.system.name,
      branchName,
      callNumber: item.callNumber ?? null,
      status: this.normalizeStatus(rawStatus),
      materialType: "book",
      dueDate: item.dueDate ?? null,
      holdCount: item.numHolds ?? null,
      copyCount: null,
      catalogUrl: `${this.catalogBaseUrl}/Record/${record.id}`,
      collection: item.collection ?? item.shelfLocation ?? "",
      volume: null,
      rawStatus,
      fingerprint: this.generateFingerprint([
        this.systemId,
        isbn,
        locationCode,
        item.callNumber,
        item.itemId,
      ]),
    };
  }

  private defaultHeaders(): Record<string, string> {
    return {
      Accept: "application/json",
      "User-Agent": "BookFinder/1.0",
    };
  }
}
