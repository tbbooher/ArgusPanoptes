// ---------------------------------------------------------------------------
// Integration tests for PlaywrightAdapter.
//
// Mocks playwright-core to return controlled responses from the browser-context
// fetch calls. Verifies search, health check, error handling, and pool cleanup.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import pino from "pino";

import { PlaywrightAdapter } from "../../../src/adapters/playwright/playwright-adapter.js";
import { BrowserPool } from "../../../src/adapters/playwright/browser-pool.js";
import type {
  AdapterConfig,
  LibrarySystem,
  LibrarySystemId,
  BranchId,
  ISBN13,
} from "../../../src/core/types.js";

// ── Mock playwright-core ──────────────────────────────────────────────────

function createMockPage(evaluateResult?: unknown) {
  const mockPage = {
    goto: vi.fn().mockResolvedValue(undefined),
    title: vi.fn().mockResolvedValue("Library Catalog"),
    evaluate: vi.fn().mockResolvedValue(evaluateResult ?? {}),
    waitForFunction: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return mockPage;
}

function createMockContext() {
  return {
    close: vi.fn().mockResolvedValue(undefined),
  };
}

// ── Fixtures ─────────────────────────────────────────────────────────────

const TEST_ISBN = "9780306406157" as ISBN13;

const TEST_SYSTEM: LibrarySystem = {
  id: "playwright-test" as LibrarySystemId,
  name: "Test Playwright Library",
  vendor: "aspen_discovery",
  region: "Test County",
  catalogUrl: "https://test.aspendiscovery.org",
  branches: [
    {
      id: "playwright-test:main" as BranchId,
      name: "Main Library",
      code: "main",
      city: "Testville",
    },
    {
      id: "playwright-test:north" as BranchId,
      name: "North Branch",
      code: "north",
      city: "Testville",
    },
  ],
  adapters: [],
  enabled: true,
};

const TEST_CONFIG: AdapterConfig = {
  protocol: "playwright_scrape",
  baseUrl: "https://test.aspendiscovery.org",
  timeoutMs: 30000,
  maxConcurrency: 1,
};

function createSilentLogger() {
  return pino({ level: "silent" });
}

/** SearchAPI response with one record. */
function createSearchResponse() {
  return {
    result: {
      success: true,
      totalResults: 1,
      recordCount: 1,
      records: [
        {
          id: "pw.12345",
          title_display: "Test Book Title",
          author_display: "Test Author",
          isbn: ["9780306406157"],
        },
      ],
    },
  };
}

/** ItemAPI response with two items. */
function createItemResponse() {
  return {
    result: [
      {
        itemId: "item-1",
        locationCode: "main",
        locationName: "Main Library",
        callNumber: "QA76.73 .T47 2020",
        statusFull: "Available",
        available: true,
        dueDate: null,
        numHolds: 0,
        collection: "Fiction",
      },
      {
        itemId: "item-2",
        locationCode: "north",
        locationName: "North Branch",
        callNumber: "QA76.73 .T47 2020",
        statusFull: "Checked Out",
        available: false,
        dueDate: "2026-03-15",
        numHolds: 2,
        collection: "Fiction",
      },
    ],
  };
}

function createEmptySearchResponse() {
  return { result: { success: true, totalResults: 0, recordCount: 0, records: [] } };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("PlaywrightAdapter", () => {
  let mockPage: ReturnType<typeof createMockPage>;
  let mockContext: ReturnType<typeof createMockContext>;
  let acquirePageSpy: ReturnType<typeof vi.spyOn>;
  let releasePageSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockPage = createMockPage();
    mockContext = createMockContext();

    // Mock BrowserPool.getInstance() to return our controlled pool
    acquirePageSpy = vi
      .spyOn(BrowserPool.prototype, "acquirePage")
      .mockResolvedValue({ page: mockPage as any, context: mockContext as any });
    releasePageSpy = vi
      .spyOn(BrowserPool.prototype, "releasePage")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    BrowserPool.resetInstance();
  });

  it("parses search + item responses into BookHolding objects", async () => {
    // First evaluate call: SearchAPI
    mockPage.evaluate
      .mockResolvedValueOnce(createSearchResponse())
      // Second evaluate call: ItemAPI
      .mockResolvedValueOnce(createItemResponse());

    const adapter = new PlaywrightAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(result.holdings).toHaveLength(2);
    expect(result.protocol).toBe("playwright_scrape");

    const h1 = result.holdings[0];
    expect(h1.isbn).toBe(TEST_ISBN);
    expect(h1.systemId).toBe("playwright-test");
    expect(h1.branchName).toBe("Main Library");
    expect(h1.branchId).toBe("playwright-test:main");
    expect(h1.status).toBe("available");
    expect(h1.callNumber).toBe("QA76.73 .T47 2020");
    expect(h1.collection).toBe("Fiction");
    expect(h1.catalogUrl).toContain("pw.12345");

    const h2 = result.holdings[1];
    expect(h2.branchName).toBe("North Branch");
    expect(h2.branchId).toBe("playwright-test:north");
    expect(h2.status).toBe("checked_out");
    expect(h2.dueDate).toBe("2026-03-15");
    expect(h2.holdCount).toBe(2);
  });

  it("returns empty holdings for empty search response", async () => {
    mockPage.evaluate.mockResolvedValueOnce(createEmptySearchResponse());

    const adapter = new PlaywrightAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(result.holdings).toHaveLength(0);
    // Only one evaluate call (SearchAPI), no ItemAPI call
    expect(mockPage.evaluate).toHaveBeenCalledTimes(1);
  });

  it("navigates to catalog URL before fetching API", async () => {
    mockPage.evaluate.mockResolvedValueOnce(createEmptySearchResponse());

    const adapter = new PlaywrightAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(mockPage.goto).toHaveBeenCalledWith(
      "https://test.aspendiscovery.org",
      expect.objectContaining({ waitUntil: "domcontentloaded" }),
    );
  });

  it("waits for Cloudflare challenge to resolve", async () => {
    // First title() call returns Cloudflare challenge page
    mockPage.title.mockResolvedValueOnce("Just a moment...");
    mockPage.evaluate.mockResolvedValueOnce(createEmptySearchResponse());

    const adapter = new PlaywrightAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(mockPage.waitForFunction).toHaveBeenCalledTimes(1);
  });

  it("throws AdapterConnectionError when Cloudflare challenge doesn't resolve", async () => {
    mockPage.title.mockResolvedValueOnce("Just a moment...");
    mockPage.waitForFunction.mockRejectedValueOnce(new Error("Timeout"));

    const adapter = new PlaywrightAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());

    await expect(adapter.search(TEST_ISBN, TEST_SYSTEM)).rejects.toThrow(
      /Cloudflare challenge did not resolve/,
    );
  });

  it("throws AdapterTimeoutError when navigation times out", async () => {
    const timeoutError = new Error("Timeout 20000ms exceeded");
    timeoutError.name = "TimeoutError";
    mockPage.goto.mockRejectedValueOnce(timeoutError);

    const adapter = new PlaywrightAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());

    await expect(adapter.search(TEST_ISBN, TEST_SYSTEM)).rejects.toThrow(
      /navigation timed out/,
    );
  });

  it("throws AdapterConnectionError when browser fetch returns non-OK", async () => {
    mockPage.evaluate.mockResolvedValueOnce({
      __error: true,
      status: 403,
      statusText: "Forbidden",
    });

    const adapter = new PlaywrightAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());

    await expect(adapter.search(TEST_ISBN, TEST_SYSTEM)).rejects.toThrow(
      /Playwright fetch failed with HTTP 403/,
    );
  });

  it("falls back to record-level holding when ItemAPI fails", async () => {
    mockPage.evaluate
      .mockResolvedValueOnce(createSearchResponse())
      // ItemAPI returns error
      .mockResolvedValueOnce({ __error: true, status: 500, statusText: "Server Error" });

    const adapter = new PlaywrightAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(result.holdings).toHaveLength(1);
    expect(result.holdings[0].branchName).toBe("Unknown");
    expect(result.holdings[0].status).toBe("unknown");
  });

  it("always releases page even on error", async () => {
    mockPage.goto.mockRejectedValueOnce(new Error("Connection refused"));

    const adapter = new PlaywrightAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());

    await expect(adapter.search(TEST_ISBN, TEST_SYSTEM)).rejects.toThrow();

    expect(releasePageSpy).toHaveBeenCalledTimes(1);
  });

  it("health check returns healthy for valid probe response", async () => {
    mockPage.evaluate.mockResolvedValueOnce({
      result: { success: true, totalResults: 0, records: [] },
    });

    const adapter = new PlaywrightAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const health = await adapter.healthCheck(TEST_SYSTEM);

    expect(health.healthy).toBe(true);
    expect(health.systemId).toBe("playwright-test");
    expect(health.protocol).toBe("playwright_scrape");
  });

  it("health check returns unhealthy on navigation failure", async () => {
    mockPage.goto.mockRejectedValueOnce(new Error("net::ERR_CONNECTION_REFUSED"));

    const adapter = new PlaywrightAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const health = await adapter.healthCheck(TEST_SYSTEM);

    expect(health.healthy).toBe(false);
  });

  it("health check always releases page", async () => {
    mockPage.goto.mockRejectedValueOnce(new Error("Connection failed"));

    const adapter = new PlaywrightAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    await adapter.healthCheck(TEST_SYSTEM);

    expect(releasePageSpy).toHaveBeenCalledTimes(1);
  });
});

describe("BrowserPool", () => {
  afterEach(() => {
    BrowserPool.resetInstance();
  });

  it("returns the same singleton instance", () => {
    const pool1 = BrowserPool.getInstance();
    const pool2 = BrowserPool.getInstance();
    expect(pool1).toBe(pool2);
  });

  it("returns a fresh instance after reset", () => {
    const pool1 = BrowserPool.getInstance();
    BrowserPool.resetInstance();
    const pool2 = BrowserPool.getInstance();
    expect(pool1).not.toBe(pool2);
  });

  it("starts with zero active pages", () => {
    const pool = BrowserPool.getInstance();
    expect(pool.currentPages).toBe(0);
  });
});
