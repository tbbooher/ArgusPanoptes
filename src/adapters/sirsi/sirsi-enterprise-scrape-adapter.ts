// ---------------------------------------------------------------------------
// SirsiDynix Enterprise ("BLUEcloud") HTML adapter.
//
// Strategy (no credentials):
// 1) Fetch the search results page for the ISBN.
// 2) Extract the session CSRF token (`__sdcsrf`) and the first detailclick URL.
// 3) Fetch the detail panel via XHR-style request (returns JSON with HTML).
// 4) POST the "lookuptitleinfo" endpoint to resolve per-barcode status/library.
//
// This adapter is intentionally narrow: it targets the common Enterprise
// patterns used by several Texas libraries.
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
  MaterialType,
} from "../../core/types.js";
import { AdapterParseError } from "../../core/errors.js";
import { BaseAdapter } from "../base/base-adapter.js";

type CookieMap = Map<string, string>;

function parseSetCookieToMap(existing: CookieMap, setCookie: string): void {
  // "NAME=value; Path=/; Secure; HttpOnly"
  const first = setCookie.split(";", 1)[0];
  const idx = first.indexOf("=");
  if (idx <= 0) return;
  const name = first.slice(0, idx).trim();
  const value = first.slice(idx + 1).trim();
  if (!name) return;
  existing.set(name, value);
}

function cookieHeader(cookies: CookieMap): string {
  return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function getSetCookie(headers: Headers): string[] {
  // Node.js fetch exposes this helper (undici).
  const anyHeaders = headers as unknown as { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === "function") {
    return anyHeaders.getSetCookie();
  }
  // Best-effort fallback (may be merged and unusable).
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

function parseCatalogContext(system: LibrarySystem): { locale: string; friendly: string } {
  try {
    const u = new URL(system.catalogUrl);
    // Typical: /client/en_US/default/ or /client/en_US/hou/
    const m = u.pathname.match(/\/client\/([^/]+)\/([^/]+)\//);
    if (m) return { locale: m[1], friendly: m[2] };
  } catch {
    // fall through
  }
  return { locale: "en_US", friendly: "default" };
}

function extractSdCsrf(html: string): string {
  // Match multiple declaration forms:
  //   var __sdcsrf = "..."
  //   window.__sdcsrf = "..."
  //   const __sdcsrf = "..."
  //   let __sdcsrf = "..."
  //   __sdcsrf = "..."
  const m = html.match(/__sdcsrf\s*=\s*["']([a-f0-9-]+)["']/i);
  if (!m) {
    throw new Error("Sirsi: missing __sdcsrf token");
  }
  return m[1];
}

function extractFirstDetailPath(html: string): string | null {
  // window.dialogs['tabDISCOVERY_ALLlistItem'][0] = '/client/...:detailclick/...';
  const re = /window\.dialogs\['tabDISCOVERY_ALLlistItem'\]\[(\d+)\]\s*=\s*'([^']+detailclick[^']*)';/g;
  const m = re.exec(html);
  return m ? m[2] : null;
}

function extractCatKeyAndHitNum(detailPath: string): { catKey: string; hitNum: string } {
  // ...SD_ILS:307174/0/0/tab...
  const m = detailPath.match(/SD_ILS:(\d+)\/(\d+)\/\2\//);
  if (!m) throw new Error("Unable to parse catKey/hitNum from detail path");
  return { catKey: m[1], hitNum: m[2] };
}

function stripQueryParam(url: string, param: string): string {
  const u = new URL(url);
  u.searchParams.delete(param);
  return u.toString();
}

function normalizeMaterialType(raw: string): MaterialType {
  const lower = raw.toLowerCase();
  if (lower.includes("dvd") || lower.includes("blu-ray") || lower.includes("bluray")) return "dvd";
  if (lower.includes("large print")) return "large_print";
  if (lower.includes("audiobook") && (lower.includes("cd") || lower.includes("compact disc"))) return "audiobook_cd";
  if (lower.includes("ebook") || lower.includes("e-book")) return "ebook";
  return "book";
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export class SirsiEnterpriseScrapeAdapter extends BaseAdapter {
  constructor(system: LibrarySystem, config: AdapterConfig, logger: Logger) {
    super(system, { ...config, protocol: "sirsi_enterprise_scrape" }, logger);
  }

  protected async executeSearch(isbn: ISBN13, signal?: AbortSignal): Promise<BookHolding[]> {
    const { locale, friendly } = parseCatalogContext(this.system);
    const baseUrl = this.config.baseUrl.replace(/\/+$/, "");

    const cookies: CookieMap = new Map();

    const searchUrl = `${baseUrl}/client/${locale}/${friendly}/search/results?qu=${encodeURIComponent(isbn)}`;
    this.logger.debug({ url: searchUrl }, "Sirsi Enterprise search");

    const searchResp = await fetch(searchUrl, {
      signal: signal ?? AbortSignal.timeout(this.config.timeoutMs),
      headers: {
        Accept: "text/html",
        "User-Agent": "Mozilla/5.0 (compatible; Argus/1.0)",
      },
    });

    for (const sc of getSetCookie(searchResp.headers)) parseSetCookieToMap(cookies, sc);

    if (!searchResp.ok) {
      throw new AdapterParseError(
        `Sirsi search returned HTTP ${searchResp.status}`,
        this.systemId,
        this.protocol,
      );
    }

    const searchHtml = await searchResp.text();
    let sdcsrf: string;
    try {
      sdcsrf = extractSdCsrf(searchHtml);
    } catch (e) {
      throw new AdapterParseError(
        e instanceof Error ? e.message : "Sirsi: missing __sdcsrf token",
        this.systemId,
        this.protocol,
      );
    }
    const detailPath = extractFirstDetailPath(searchHtml);
    if (!detailPath) return [];

    const detailUrl = stripQueryParam(`${baseUrl}${detailPath}`, "sdcsrf");
    const { catKey, hitNum } = extractCatKeyAndHitNum(detailPath);

    // Detail panel (XHR JSON -> HTML)
    const detailResp = await fetch(detailUrl, {
      signal: signal ?? AbortSignal.timeout(this.config.timeoutMs),
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        "User-Agent": "Mozilla/5.0 (compatible; Argus/1.0)",
        "X-Requested-With": "XMLHttpRequest",
        Referer: searchUrl,
        sdcsrf,
        Cookie: cookieHeader(cookies),
      },
    });

    for (const sc of getSetCookie(detailResp.headers)) parseSetCookieToMap(cookies, sc);

    if (!detailResp.ok) {
      throw new AdapterParseError(
        `Sirsi detail returned HTTP ${detailResp.status}`,
        this.systemId,
        this.protocol,
      );
    }

    const detailJson = (await detailResp.json()) as { content?: string };
    const contentHtml = detailJson.content;
    if (!contentHtml) return [];

    // Lookup title info to fill per-barcode status/location.
    const dParam = `ent://SD_ILS/0/SD_ILS:${catKey}~ILS~${hitNum}`;
    const lookupUrl = `${baseUrl}/client/${locale}/${friendly}/search/results.displaypanel.displaycell_0.detail.detailavailabilityaccordions:lookuptitleinfo/ent:$002f$002fSD_ILS$002f0$002fSD_ILS:${catKey}/ILS/${hitNum}/true/true?qu=${encodeURIComponent(isbn)}&d=${encodeURIComponent(dParam)}&h=8`;

    const lookupResp = await fetch(stripQueryParam(lookupUrl, "sdcsrf"), {
      method: "POST",
      signal: signal ?? AbortSignal.timeout(this.config.timeoutMs),
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; Argus/1.0)",
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Referer: searchUrl,
        sdcsrf,
        Cookie: cookieHeader(cookies),
      },
      body: "",
    });

    for (const sc of getSetCookie(lookupResp.headers)) parseSetCookieToMap(cookies, sc);

    const titleInfo = lookupResp.ok
      ? ((await lookupResp.json()) as {
          childRecords?: Array<{ barcode?: string; LIBRARY?: string; SD_ITEM_STATUS?: string }>;
        })
      : { childRecords: [] };

    const byBarcode = new Map<string, { library?: string; status?: string }>();
    for (const rec of titleInfo.childRecords ?? []) {
      if (!rec.barcode) continue;
      byBarcode.set(rec.barcode, { library: rec.LIBRARY, status: rec.SD_ITEM_STATUS });
    }

    const $ = cheerio.load(contentHtml);
    const holdings: BookHolding[] = [];

    const hasBarcodeColumn = $(".detailItemTable .detailItemsTable_BARCODE").length > 0;
    if (hasBarcodeColumn) {
      $(".detailItemTable tbody tr").each((_i, el) => {
        const row = $(el);
        const barcode = row.find(".detailItemsTable_BARCODE").text().trim();
        if (!barcode) return;

        const callNumberText = row.find(".detailItemsTable_CALLNUMBER").text().trim();
        const itypeText = row.find(".detailItemsTable_ITYPE").text().trim();

        // Library is in a hidden div in the detail HTML, but titleInfo is more reliable.
        const fromTitleInfo = byBarcode.get(barcode);
        const libFromHtml = row.find(`#asyncFieldDefaultdetailItemsDiv0LIBRARY${barcode}`).text().trim();
        const branchName = (fromTitleInfo?.library ?? libFromHtml ?? "Unknown").trim() || "Unknown";

        const rawStatus =
          (fromTitleInfo?.status ??
            row.find(`#asyncFieldDefaultdetailItemsDiv0SD_ITEM_STATUS${barcode}`).text().trim() ??
            "Unknown").trim() || "Unknown";

        const branchInfo = this.system.branches.find(
          (b) =>
            b.name.toLowerCase() === branchName.toLowerCase() ||
            b.code.toLowerCase() === branchName.toLowerCase(),
        );

        const branchId = (branchInfo?.id ??
          (`${this.systemId}:${slugify(branchName)}` as unknown)) as BranchId;

        holdings.push({
          isbn,
          systemId: this.systemId,
          branchId,
          systemName: this.system.name,
          branchName: branchInfo?.name ?? branchName,
          callNumber: callNumberText || null,
          status: this.normalizeStatus(rawStatus),
          materialType: normalizeMaterialType(itypeText),
          dueDate: null,
          holdCount: null,
          copyCount: null,
          catalogUrl: `${baseUrl}/client/${locale}/${friendly}/search/results?qu=${encodeURIComponent(isbn)}`,
          collection: "",
          volume: null,
          rawStatus,
          fingerprint: this.generateFingerprint([this.systemId, isbn, barcode, callNumberText, branchName]),
        });
      });
    } else {
      // Some Enterprise configs don't expose barcodes in the detail HTML.
      // Fall back to the titleInfo webservice response which includes barcode/status/location.
      for (const [barcode, meta] of byBarcode.entries()) {
        const branchName = (meta.library ?? "Unknown").trim() || "Unknown";
        const rawStatus = (meta.status ?? "Unknown").trim() || "Unknown";

        const branchInfo = this.system.branches.find(
          (b) =>
            b.name.toLowerCase() === branchName.toLowerCase() ||
            b.code.toLowerCase() === branchName.toLowerCase(),
        );
        const branchId = (branchInfo?.id ??
          (`${this.systemId}:${slugify(branchName)}` as unknown)) as BranchId;

        holdings.push({
          isbn,
          systemId: this.systemId,
          branchId,
          systemName: this.system.name,
          branchName: branchInfo?.name ?? branchName,
          callNumber: null,
          status: this.normalizeStatus(rawStatus),
          materialType: "book",
          dueDate: null,
          holdCount: null,
          copyCount: null,
          catalogUrl: `${baseUrl}/client/${locale}/${friendly}/search/results?qu=${encodeURIComponent(isbn)}`,
          collection: "",
          volume: null,
          rawStatus,
          fingerprint: this.generateFingerprint([this.systemId, isbn, barcode, branchName, rawStatus]),
        });
      }
    }

    // If there was a hit but we couldn't parse item rows, return a system-level holding.
    if (holdings.length === 0) {
      return [
        {
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
          catalogUrl: searchUrl,
          collection: "",
          volume: null,
          rawStatus: "",
          fingerprint: this.generateFingerprint([this.systemId, isbn, catKey]),
        },
      ];
    }

    return holdings;
  }

  protected async executeHealthCheck(): Promise<AdapterHealthStatus> {
    const { locale, friendly } = parseCatalogContext(this.system);
    const baseUrl = this.config.baseUrl.replace(/\/+$/, "");
    const url = `${baseUrl}/client/${locale}/${friendly}/`;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(this.config.timeoutMs),
      headers: {
        Accept: "text/html",
        "User-Agent": "Mozilla/5.0 (compatible; Argus/1.0)",
      },
    });

    return {
      systemId: this.systemId,
      protocol: this.protocol,
      healthy: resp.ok,
      latencyMs: 0,
      message: resp.ok ? "OK" : `HTTP ${resp.status}`,
      checkedAt: new Date().toISOString(),
    };
  }
}
