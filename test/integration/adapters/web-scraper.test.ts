// ---------------------------------------------------------------------------
// Integration tests for WebScraperAdapter.
//
// Mocks global fetch to return realistic HTML pages, then verifies that
// the adapter extracts BookHolding objects using the configured CSS selectors.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import pino from "pino";

import { WebScraperAdapter } from "../../../src/adapters/scraper/web-scraper-adapter.js";
import type {
  AdapterConfig,
  LibrarySystem,
  LibrarySystemId,
  BranchId,
  ISBN13,
} from "../../../src/core/types.js";

// ── Fixtures ─────────────────────────────────────────────────────────────

const TEST_ISBN = "9780306406157" as ISBN13;

const TEST_SYSTEM: LibrarySystem = {
  id: "scraper-test" as LibrarySystemId,
  name: "Test Scraper Library",
  vendor: "sirsi_dynix",
  region: "Test County",
  catalogUrl: "https://opac.test.example.org",
  branches: [
    {
      id: "scraper-test:main" as BranchId,
      name: "Central Library",
      code: "central",
      city: "Testville",
    },
    {
      id: "scraper-test:north" as BranchId,
      name: "North Branch",
      code: "north",
      city: "Testville",
    },
  ],
  adapters: [],
  enabled: true,
};

const TEST_CONFIG: AdapterConfig = {
  protocol: "web_scrape",
  baseUrl: "https://opac.test.example.org",
  timeoutMs: 10000,
  maxConcurrency: 2,
  extra: {
    searchUrlTemplate: "https://opac.test.example.org/search?isbn={isbn}",
    resultSelector: ".result-item",
    titleSelector: ".title",
    branchSelector: ".branch",
    statusSelector: ".status",
    callNumberSelector: ".call-number",
  },
};

function createSilentLogger() {
  return pino({ level: "silent" });
}

/** Realistic HTML response with two result items. */
function createHtmlWithResults(): string {
  return `<!DOCTYPE html>
<html>
<head><title>Search Results</title></head>
<body>
  <div id="results">
    <div class="result-item">
      <span class="title">Test Book Title</span>
      <span class="branch">Central Library</span>
      <span class="status">Available</span>
      <span class="call-number">QA76.73 .T47 2020</span>
    </div>
    <div class="result-item">
      <span class="title">Test Book Title</span>
      <span class="branch">North Branch</span>
      <span class="status">Checked out</span>
      <span class="call-number">QA76.73 .T47 2020</span>
    </div>
  </div>
</body>
</html>`;
}

/** HTML with no matching result items. */
function createHtmlNoResults(): string {
  return `<!DOCTYPE html>
<html>
<head><title>Search Results</title></head>
<body>
  <div id="results">
    <p class="no-results">No results found for your search.</p>
  </div>
</body>
</html>`;
}

/** HTML with result items that have empty/missing fields. */
function createHtmlPartialData(): string {
  return `<!DOCTYPE html>
<html>
<body>
  <div class="result-item">
    <span class="title"></span>
    <span class="branch"></span>
    <span class="status"></span>
    <span class="call-number"></span>
  </div>
</body>
</html>`;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("WebScraperAdapter", () => {
  const originalFetch = globalThis.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("parses HTML with two results into BookHolding objects", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(createHtmlWithResults(), {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const adapter = new WebScraperAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(result.holdings).toHaveLength(2);
    expect(result.protocol).toBe("web_scrape");

    // First result: available
    const h1 = result.holdings[0];
    expect(h1.isbn).toBe(TEST_ISBN);
    expect(h1.systemId).toBe("scraper-test");
    expect(h1.branchName).toBe("Central Library");
    expect(h1.branchId).toBe("scraper-test:main");
    expect(h1.status).toBe("available");
    expect(h1.rawStatus).toBe("Available");
    expect(h1.callNumber).toBe("QA76.73 .T47 2020");
    expect(h1.materialType).toBe("book");
    expect(h1.catalogUrl).toContain(TEST_ISBN);

    // Second result: checked out
    const h2 = result.holdings[1];
    expect(h2.branchName).toBe("North Branch");
    expect(h2.branchId).toBe("scraper-test:north");
    expect(h2.status).toBe("checked_out");
    expect(h2.rawStatus).toBe("Checked out");
  });

  it("returns empty holdings when HTML has no matching result elements", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(createHtmlNoResults(), {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const adapter = new WebScraperAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(result.holdings).toHaveLength(0);
  });

  it("handles empty fields gracefully", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(createHtmlPartialData(), {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const adapter = new WebScraperAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(result.holdings).toHaveLength(1);
    const h = result.holdings[0];
    expect(h.branchName).toBe("Unknown");
    expect(h.callNumber).toBeNull();
    expect(h.status).toBe("unknown");
    expect(h.rawStatus).toBe("");
  });

  it("constructs the correct search URL by replacing {isbn}", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(createHtmlNoResults(), {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const adapter = new WebScraperAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toBe("https://opac.test.example.org/search?isbn=9780306406157");
  });

  it("throws AdapterConnectionError when fetch returns non-200", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("Not Found", { status: 404 }),
    );

    const adapter = new WebScraperAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());

    await expect(adapter.search(TEST_ISBN, TEST_SYSTEM)).rejects.toThrow(
      /OPAC request failed with HTTP 404/,
    );
  });

  it("throws AdapterConnectionError when fetch throws a network error", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));

    const adapter = new WebScraperAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());

    await expect(adapter.search(TEST_ISBN, TEST_SYSTEM)).rejects.toThrow(
      /Network error/,
    );
  });

  it("throws AdapterParseError when searchUrlTemplate is missing from config", () => {
    const configWithoutTemplate: AdapterConfig = {
      protocol: "web_scrape",
      baseUrl: "https://opac.test.example.org",
      timeoutMs: 10000,
      maxConcurrency: 2,
      extra: {},
    };

    expect(
      () => new WebScraperAdapter(TEST_SYSTEM, configWithoutTemplate, createSilentLogger()),
    ).toThrow(/searchUrlTemplate/);
  });

  it("uses default CSS selectors when none are provided in config", async () => {
    const configWithDefaults: AdapterConfig = {
      protocol: "web_scrape",
      baseUrl: "https://opac.test.example.org",
      timeoutMs: 10000,
      maxConcurrency: 2,
      extra: {
        searchUrlTemplate: "https://opac.test.example.org/search?isbn={isbn}",
        // All other selectors default to .result-item, .title, etc.
      },
    };

    // HTML using the default class names
    const html = `<html><body>
      <div class="result-item">
        <span class="title">Default Test</span>
        <span class="branch">Main</span>
        <span class="status">Available</span>
        <span class="call-number">ABC.123</span>
      </div>
    </body></html>`;

    mockFetch.mockResolvedValueOnce(
      new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const adapter = new WebScraperAdapter(TEST_SYSTEM, configWithDefaults, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(result.holdings).toHaveLength(1);
    expect(result.holdings[0].callNumber).toBe("ABC.123");
    expect(result.holdings[0].status).toBe("available");
  });

  it("matches branch by name case-insensitively", async () => {
    const html = `<html><body>
      <div class="result-item">
        <span class="title">Test</span>
        <span class="branch">central library</span>
        <span class="status">Available</span>
        <span class="call-number">X.1</span>
      </div>
    </body></html>`;

    mockFetch.mockResolvedValueOnce(
      new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const adapter = new WebScraperAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(result.holdings).toHaveLength(1);
    // Should match "Central Library" branch case-insensitively
    expect(result.holdings[0].branchId).toBe("scraper-test:main");
    expect(result.holdings[0].branchName).toBe("Central Library");
  });
});
