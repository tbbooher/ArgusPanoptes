// ---------------------------------------------------------------------------
// GenericSruAdapter – searches any library system that exposes an SRU
// (Search/Retrieve via URL) endpoint with standard MARC XML responses.
//
// Unlike the Koha-specific adapter, this one uses standard MARC fields
// for holdings data (852, 245, 100, 090) rather than Koha's custom 952.
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
} from "../../core/types.js";
import { AdapterParseError } from "../../core/errors.js";
import { BaseAdapter } from "../base/base-adapter.js";
import {
  extractAllDataFields,
  extractControlField,
  extractDataField,
  extractSubfieldValues,
} from "../../utils/marc-parser.js";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // SECURITY: Disable XML entity processing to mitigate XXE-style attacks.
  // fast-xml-parser v4 does not support DTD/external entities by default,
  // but explicitly disabling processEntities hardens against future changes.
  processEntities: false,
  isArray: (name) =>
    name === "record" ||
    name === "datafield" ||
    name === "subfield" ||
    name === "controlfield",
});

/**
 * Generic SRU adapter for any ILS that exposes a standard SRU endpoint
 * with MARC XML record responses.
 *
 * The SRU base URL is taken from `config.baseUrl`.  The adapter constructs
 * CQL queries using the `bath.isbn` index.
 */
export class GenericSruAdapter extends BaseAdapter {
  constructor(system: LibrarySystem, config: AdapterConfig, logger: Logger) {
    super(system, { ...config, protocol: "sru" }, logger);
  }

  // ── Search ──────────────────────────────────────────────────────────────

  protected async executeSearch(
    isbn: ISBN13,
    signal?: AbortSignal,
  ): Promise<BookHolding[]> {
    const sruUrl = this.buildSearchUrl(isbn);
    this.logger.debug({ url: sruUrl }, "Fetching generic SRU results");

    const response = await fetch(sruUrl, {
      signal: signal ?? AbortSignal.timeout(this.config.timeoutMs),
      headers: {
        Accept: "application/xml, text/xml",
        "User-Agent": "BookFinder/1.0",
      },
    });

    if (!response.ok) {
      throw new AdapterParseError(
        `SRU request failed with HTTP ${response.status}`,
        this.systemId,
        this.protocol,
      );
    }

    const xml = await response.text();
    return this.parseSearchResponse(xml, isbn);
  }

  // ── Health check ────────────────────────────────────────────────────────

  protected async executeHealthCheck(): Promise<AdapterHealthStatus> {
    const explainUrl = this.buildExplainUrl();

    const response = await fetch(explainUrl, {
      signal: AbortSignal.timeout(this.config.timeoutMs),
      headers: { Accept: "application/xml, text/xml" },
    });

    return {
      systemId: this.systemId,
      protocol: this.protocol,
      healthy: response.ok,
      latencyMs: 0, // Overridden by base class
      message: response.ok
        ? "SRU explain request succeeded"
        : `SRU explain returned HTTP ${response.status}`,
      checkedAt: new Date().toISOString(),
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private buildSearchUrl(isbn: ISBN13): string {
    const baseUrl = this.config.baseUrl.replace(/\/+$/, "");
    const params = new URLSearchParams({
      version: "1.1",
      operation: "searchRetrieve",
      query: `bath.isbn=${isbn}`,
      recordSchema: "marcxml",
      maximumRecords: "50",
    });
    return `${baseUrl}?${params.toString()}`;
  }

  private buildExplainUrl(): string {
    const baseUrl = this.config.baseUrl.replace(/\/+$/, "");
    const params = new URLSearchParams({
      version: "1.1",
      operation: "explain",
    });
    return `${baseUrl}?${params.toString()}`;
  }

  private parseSearchResponse(xml: string, isbn: ISBN13): BookHolding[] {
    let parsed: any;
    try {
      parsed = xmlParser.parse(xml);
    } catch (err) {
      throw new AdapterParseError(
        `Failed to parse SRU XML: ${err instanceof Error ? err.message : String(err)}`,
        this.systemId,
        this.protocol,
        { cause: err instanceof Error ? err : undefined },
      );
    }

    // Navigate the SRU response envelope.
    const searchRetrieveResponse =
      parsed?.searchRetrieveResponse ?? parsed?.["zs:searchRetrieveResponse"];
    if (!searchRetrieveResponse) return [];

    const numberOfRecords =
      Number(searchRetrieveResponse.numberOfRecords) || 0;
    if (numberOfRecords === 0) return [];

    const records = this.extractMarcRecords(searchRetrieveResponse);
    const holdings: BookHolding[] = [];

    for (const record of records) {
      const recordHoldings = this.mapRecordToHoldings(record, isbn);
      holdings.push(...recordHoldings);
    }

    return holdings;
  }

  /**
   * Walk the SRU XML tree to find MARC record elements.
   */
  private extractMarcRecords(searchRetrieveResponse: any): any[] {
    const recordsContainer = searchRetrieveResponse.records;
    if (!recordsContainer) return [];

    const recordWrappers = Array.isArray(recordsContainer.record)
      ? recordsContainer.record
      : recordsContainer.record
        ? [recordsContainer.record]
        : [];

    const marcRecords: any[] = [];
    for (const wrapper of recordWrappers) {
      const recordData =
        wrapper?.recordData?.record ??
        wrapper?.recordData?.["marc:record"] ??
        wrapper?.recordData;
      if (recordData) {
        marcRecords.push(recordData);
      }
    }

    return marcRecords;
  }

  /**
   * Map a single MARC record into BookHolding entries.
   *
   * Standard MARC uses:
   *   245$a - Title
   *   100$a - Author
   *   090$a - Call number (LC local)
   *   050$a - Call number (LC)
   *   852   - Location / holdings
   *     852$b - Branch/sublocation
   *     852$h - Call number
   *     852$z - Public note
   */
  private mapRecordToHoldings(record: any, isbn: ISBN13): BookHolding[] {
    const title = extractDataField(record, "245", "a") ?? "Unknown Title";
    const author = extractDataField(record, "100", "a") ?? null;
    const controlNumber = extractControlField(record, "001") ?? null;
    const callNumberFallback =
      extractDataField(record, "090", "a") ??
      extractDataField(record, "050", "a") ??
      null;

    // Standard MARC holdings in 852
    const holdingsFields = extractAllDataFields(record, "852");

    if (holdingsFields.length === 0) {
      // No holdings data -- return a single record-level holding.
      return [
        {
          isbn,
          systemId: this.systemId,
          branchId: "unknown" as BranchId,
          systemName: this.system.name,
          branchName: "Unknown",
          callNumber: callNumberFallback,
          status: "unknown",
          materialType: "book",
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
            controlNumber,
          ]),
        },
      ];
    }

    const holdings: BookHolding[] = [];

    for (const holdingField of holdingsFields) {
      const branchCode = extractSubfieldValues(holdingField, "b")[0] ?? "unknown";
      const callNumber =
        extractSubfieldValues(holdingField, "h")[0] ?? callNumberFallback;
      const publicNote = extractSubfieldValues(holdingField, "z")[0] ?? "";
      const sublocation = extractSubfieldValues(holdingField, "c")[0] ?? "";

      // Look up branch from system branches
      const branchInfo = this.system.branches.find(
        (b) => b.code === branchCode,
      );
      const branchName = branchInfo?.name ?? branchCode;
      const branchId = (branchInfo?.id ?? branchCode) as BranchId;

      holdings.push({
        isbn,
        systemId: this.systemId,
        branchId,
        systemName: this.system.name,
        branchName,
        callNumber,
        status: "unknown", // Standard SRU/MARC 852 rarely has real-time status
        materialType: "book",
        dueDate: null,
        holdCount: null,
        copyCount: null,
        catalogUrl: this.system.catalogUrl,
        collection: sublocation,
        volume: null,
        rawStatus: publicNote,
        fingerprint: this.generateFingerprint([
          this.systemId,
          isbn,
          branchCode,
          callNumber,
        ]),
      });
    }

    return holdings;
  }
}
