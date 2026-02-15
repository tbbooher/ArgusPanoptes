// ---------------------------------------------------------------------------
// PlaywrightAdapter – Browser-context fetch adapter for Cloudflare WAF sites.
//
// Uses Playwright to open a real Chromium page, navigate to the catalog URL
// (resolving any Cloudflare challenge), then executes fetch() calls inside
// the browser context to hit the same Aspen Discovery REST API endpoints.
// Returns JSON for parsing with the shared Aspen response parser.
// ---------------------------------------------------------------------------

import type { Logger } from "pino";
import type { BrowserContext, Page } from "playwright-core";

import type {
  AdapterConfig,
  AdapterHealthStatus,
  BookHolding,
  BranchId,
  ISBN13,
  LibrarySystem,
} from "../../core/types.js";
import {
  AdapterConnectionError,
  AdapterTimeoutError,
} from "../../core/errors.js";
import { BaseAdapter } from "../base/base-adapter.js";
import {
  parseSearchRecords,
  parseItemRecords,
  type AspenSearchRecord,
  type AspenSearchResponse,
  type AspenItemResponse,
} from "../aspen/aspen-response-parser.js";
import { BrowserPool } from "./browser-pool.js";

/** Default wait time for Cloudflare challenge to resolve (ms). */
const CF_CHALLENGE_WAIT_MS = 8_000;

/** Max time to wait for page navigation (ms). */
const NAVIGATION_TIMEOUT_MS = 20_000;

export class PlaywrightAdapter extends BaseAdapter {
  private readonly catalogBaseUrl: string;

  constructor(system: LibrarySystem, config: AdapterConfig, logger: Logger) {
    super(system, { ...config, protocol: "playwright_scrape" }, logger);
    this.catalogBaseUrl = config.baseUrl.replace(/\/+$/, "");
  }

  // ── Search ──────────────────────────────────────────────────────────────

  protected async executeSearch(
    isbn: ISBN13,
    _signal?: AbortSignal,
  ): Promise<BookHolding[]> {
    const pool = BrowserPool.getInstance();
    const { page, context } = await pool.acquirePage();

    try {
      await this.navigateAndWaitForClearance(page);

      // Search by ISBN via browser-context fetch
      const searchUrl = `${this.catalogBaseUrl}/API/SearchAPI?method=search&lookfor=${isbn}&searchIndex=ISN`;
      this.logger.debug({ url: searchUrl }, "Playwright: searching Aspen Discovery by ISBN");

      const searchData = await this.browserFetch<AspenSearchResponse>(page, searchUrl);
      const records = parseSearchRecords(searchData);

      if (records.length === 0) return [];

      const holdings: BookHolding[] = [];

      for (const record of records) {
        const items = await this.getItemAvailability(page, record.id);
        if (items.length === 0) {
          holdings.push(this.buildRecordLevelHolding(record, isbn));
        } else {
          for (const item of items) {
            holdings.push(this.buildItemHolding(record, item, isbn));
          }
        }
      }

      return holdings;
    } finally {
      await pool.releasePage(page, context);
    }
  }

  // ── Health check ────────────────────────────────────────────────────────

  protected async executeHealthCheck(): Promise<AdapterHealthStatus> {
    const pool = BrowserPool.getInstance();
    const { page, context } = await pool.acquirePage();

    try {
      await this.navigateAndWaitForClearance(page);

      // Probe the SearchAPI with a known ISBN
      const probeUrl = `${this.catalogBaseUrl}/API/SearchAPI?method=search&lookfor=9780061120084&searchIndex=ISN`;
      const data = await this.browserFetch<AspenSearchResponse>(page, probeUrl);

      const healthy = data != null && typeof data === "object";

      return {
        systemId: this.systemId,
        protocol: this.protocol,
        healthy,
        latencyMs: 0,
        message: healthy
          ? "Playwright Aspen Discovery probe succeeded"
          : "Playwright probe returned unexpected data",
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        systemId: this.systemId,
        protocol: this.protocol,
        healthy: false,
        latencyMs: 0,
        message: error instanceof Error ? error.message : "Playwright probe failed",
        checkedAt: new Date().toISOString(),
      };
    } finally {
      await pool.releasePage(page, context);
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /**
   * Navigate to the catalog base URL and wait for any Cloudflare challenge
   * to resolve. After navigation, the browser context holds the cf_clearance
   * cookie so subsequent fetch() calls bypass WAF.
   */
  private async navigateAndWaitForClearance(page: Page): Promise<void> {
    try {
      await page.goto(this.catalogBaseUrl, {
        waitUntil: "domcontentloaded",
        timeout: NAVIGATION_TIMEOUT_MS,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("Timeout") || error.name === "TimeoutError")
      ) {
        throw new AdapterTimeoutError(
          `Playwright navigation timed out for ${this.catalogBaseUrl}`,
          this.systemId,
          this.protocol,
          { cause: error },
        );
      }
      throw new AdapterConnectionError(
        `Playwright navigation failed for ${this.catalogBaseUrl}: ${error instanceof Error ? error.message : "unknown"}`,
        this.systemId,
        this.protocol,
        { cause: error instanceof Error ? error : undefined },
      );
    }

    // Check if we hit a Cloudflare challenge page
    const title = await page.title();
    if (
      title.includes("Just a moment") ||
      title.includes("Attention Required")
    ) {
      this.logger.debug("Cloudflare challenge detected, waiting for resolution");
      try {
        await page.waitForFunction(
          `!document.title.includes("Just a moment") && !document.title.includes("Attention Required")`,
          { timeout: CF_CHALLENGE_WAIT_MS },
        );
      } catch {
        throw new AdapterConnectionError(
          `Cloudflare challenge did not resolve within ${CF_CHALLENGE_WAIT_MS}ms for ${this.catalogBaseUrl}`,
          this.systemId,
          this.protocol,
        );
      }
    }
  }

  /**
   * Execute a fetch() call inside the browser context.
   * Returns parsed JSON from the response.
   */
  private async browserFetch<T>(page: Page, url: string): Promise<T> {
    const result = await page.evaluate(async (fetchUrl: string) => {
      const response = await fetch(fetchUrl, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        return { __error: true, status: response.status, statusText: response.statusText };
      }
      return response.json();
    }, url);

    if (result && typeof result === "object" && "__error" in result) {
      const errorResult = result as unknown as { status: number; statusText: string };
      throw new AdapterConnectionError(
        `Playwright fetch failed with HTTP ${errorResult.status}: ${errorResult.statusText}`,
        this.systemId,
        this.protocol,
      );
    }

    return result as T;
  }

  private async getItemAvailability(
    page: Page,
    recordId: string,
  ): Promise<import("../aspen/aspen-response-parser.js").AspenItemRecord[]> {
    const itemUrl = `${this.catalogBaseUrl}/API/ItemAPI?method=getItemAvailability&id=${encodeURIComponent(recordId)}`;
    this.logger.debug({ url: itemUrl }, "Playwright: fetching item availability");

    try {
      const data = await this.browserFetch<AspenItemResponse>(page, itemUrl);
      return parseItemRecords(data);
    } catch {
      this.logger.warn({ recordId }, "Playwright: failed to fetch item availability");
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
    item: import("../aspen/aspen-response-parser.js").AspenItemRecord,
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
}
