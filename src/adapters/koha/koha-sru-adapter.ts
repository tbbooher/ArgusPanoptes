// ---------------------------------------------------------------------------
// KohaSruAdapter – searches Koha library systems via the SRU protocol.
//
// Koha exposes an unauthenticated SRU endpoint at:
//   ${baseUrl}/cgi-bin/koha/sru.pl
//
// Item-level holdings are embedded in MARC field 952 (Koha-specific):
//   952$a - Home branch code
//   952$b - Current branch code
//   952$c - Shelving location
//   952$d - Acquisition date
//   952$o - Call number
//   952$p - Barcode
//   952$y - Material type (Koha itype)
//   952$2 - Classification source
//   952$7 - Not-for-loan status
//   952$q - Due date (checked-out items)
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
 * Adapter for Koha instances exposed via the SRU (Search/Retrieve via URL)
 * protocol.  No authentication is required.
 */
export class KohaSruAdapter extends BaseAdapter {
  constructor(system: LibrarySystem, config: AdapterConfig, logger: Logger) {
    super(system, { ...config, protocol: "koha_sru" }, logger);
  }

  // ── Search ──────────────────────────────────────────────────────────────

  protected async executeSearch(
    isbn: ISBN13,
    signal?: AbortSignal,
  ): Promise<BookHolding[]> {
    const sruUrl = this.buildSearchUrl(isbn);
    this.logger.debug({ url: sruUrl }, "Fetching SRU search results");

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
    const explainUrl = `${this.config.baseUrl}/cgi-bin/koha/sru.pl?version=1.1&operation=explain`;

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
    const params = new URLSearchParams({
      version: "1.1",
      operation: "searchRetrieve",
      query: `bath.isbn=${isbn}`,
      recordSchema: "marcxml",
      maximumRecords: "50",
    });
    return `${this.config.baseUrl}/cgi-bin/koha/sru.pl?${params.toString()}`;
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
   * Map a single MARC record into zero or more BookHolding entries.
   * Each Koha 952 field represents one physical item.
   */
  private mapRecordToHoldings(record: any, isbn: ISBN13): BookHolding[] {
    const controlNumber = extractControlField(record, "001") ?? null;

    // Koha items are in field 952
    const itemFields = extractAllDataFields(record, "952");
    if (itemFields.length === 0) {
      // No item data; return a single holding at the system level
      const callNumber = extractDataField(record, "090", "a") ?? null;
      return [
        {
          isbn,
          systemId: this.systemId,
          branchId: "unknown" as BranchId,
          systemName: this.system.name,
          branchName: "Unknown",
          callNumber,
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

    for (const item of itemFields) {
      const branchCode =
        extractSubfieldValues(item, "b")[0] ??
        extractSubfieldValues(item, "a")[0] ??
        "unknown";
      const callNumber = extractSubfieldValues(item, "o")[0] ?? null;
      const barcode = extractSubfieldValues(item, "p")[0] ?? null;
      const itype = extractSubfieldValues(item, "y")[0] ?? null;
      const notForLoan = extractSubfieldValues(item, "7")[0] ?? "0";
      const dueDate = extractSubfieldValues(item, "q")[0] ?? null;
      const location = extractSubfieldValues(item, "c")[0] ?? "";

      // Determine status
      let rawStatus: string;
      if (notForLoan !== "0" && notForLoan !== "") {
        rawStatus = "Not for loan";
      } else if (dueDate) {
        rawStatus = "Checked out";
      } else {
        rawStatus = "Available";
      }

      // Look up branch name from system branches
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
        status: this.normalizeStatus(rawStatus),
        materialType: this.mapKohaMaterialType(itype),
        dueDate,
        holdCount: null,
        copyCount: null,
        catalogUrl: this.system.catalogUrl,
        collection: location,
        volume: null,
        rawStatus,
        fingerprint: this.generateFingerprint([
          this.systemId,
          isbn,
          branchCode,
          barcode ?? callNumber,
        ]),
      });
    }

    return holdings;
  }

  /**
   * Map Koha item-type codes to our canonical material types.
   */
  private mapKohaMaterialType(itype: string | null): MaterialType {
    if (!itype) return "book";
    const lower = itype.toLowerCase();

    if (lower === "bk" || lower === "book" || lower.includes("book"))
      return "book";
    if (lower === "lp" || lower.includes("large print")) return "large_print";
    if (lower === "cd" || lower.includes("audiobook") || lower.includes("audio cd"))
      return "audiobook_cd";
    if (lower.includes("ebook") || lower.includes("e-book")) return "ebook";
    if (lower === "dvd" || lower.includes("dvd")) return "dvd";

    return "book";
  }
}
