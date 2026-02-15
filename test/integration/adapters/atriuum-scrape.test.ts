// ---------------------------------------------------------------------------
// Integration tests for AtriumScrapeAdapter.
//
// Mocks global fetch to return realistic HTML, then verifies that holdings
// are correctly parsed from Atriuum/BookSystems OPAC pages.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import pino from "pino";

import { AtriumScrapeAdapter } from "../../../src/adapters/atriuum/atriuum-scrape-adapter.js";
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
  id: "atriuum-test" as LibrarySystemId,
  name: "Test Atriuum Library",
  vendor: "atriuum",
  region: "Test County",
  catalogUrl: "https://test.booksys.net/opac/test",
  branches: [
    {
      id: "atriuum-test:main" as BranchId,
      name: "Main Library",
      code: "main",
      city: "Testville",
    },
  ],
  adapters: [],
  enabled: true,
};

const TEST_CONFIG: AdapterConfig = {
  protocol: "atriuum_scrape",
  baseUrl: "https://test.booksys.net/opac/test",
  timeoutMs: 10000,
  maxConcurrency: 2,
};

function createSilentLogger() {
  return pino({ level: "silent" });
}

/** HTML with a copy/holdings table (typical Atriuum record detail). */
function createHtmlWithCopiesTable(): string {
  return `<!DOCTYPE html>
<html>
<head><title>Item Details</title></head>
<body>
  <table class="copies-table">
    <tr><th>Location</th><th>Call Number</th><th>Status</th></tr>
    <tr>
      <td>Main Library</td>
      <td>FIC SMI</td>
      <td>Available</td>
    </tr>
    <tr>
      <td>West Branch</td>
      <td>FIC SMI</td>
      <td>Checked Out</td>
    </tr>
  </table>
</body>
</html>`;
}

/** HTML with no results. */
function createHtmlNoResults(): string {
  return `<!DOCTYPE html>
<html>
<head><title>Search Results</title></head>
<body>
  <div id="results">
    <p>No results found.</p>
  </div>
</body>
</html>`;
}

/** HTML with searchResult class items. */
function createHtmlWithSearchResults(): string {
  return `<!DOCTYPE html>
<html>
<body>
  <div class="searchResult">
    <span class="branch">Main Library</span>
    <span class="callnumber">FIC DOE</span>
    <span class="status">Available</span>
  </div>
</body>
</html>`;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("AtriumScrapeAdapter", () => {
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

  it("parses copies table into BookHolding objects", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(createHtmlWithCopiesTable(), {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const adapter = new AtriumScrapeAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(result.holdings).toHaveLength(2);
    expect(result.protocol).toBe("atriuum_scrape");

    const h1 = result.holdings[0];
    expect(h1.isbn).toBe(TEST_ISBN);
    expect(h1.systemId).toBe("atriuum-test");
    expect(h1.branchName).toBe("Main Library");
    expect(h1.branchId).toBe("atriuum-test:main");
    expect(h1.callNumber).toBe("FIC SMI");
    expect(h1.status).toBe("available");

    const h2 = result.holdings[1];
    expect(h2.branchName).toBe("West Branch");
    expect(h2.status).toBe("checked_out");
  });

  it("returns empty holdings for no-results page", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(createHtmlNoResults(), {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const adapter = new AtriumScrapeAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(result.holdings).toHaveLength(0);
  });

  it("parses searchResult-class items", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(createHtmlWithSearchResults(), {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const adapter = new AtriumScrapeAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(result.holdings).toHaveLength(1);
    expect(result.holdings[0].branchName).toBe("Main Library");
    expect(result.holdings[0].callNumber).toBe("FIC DOE");
    expect(result.holdings[0].status).toBe("available");
  });

  it("constructs the correct search URL", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(createHtmlNoResults(), {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const adapter = new AtriumScrapeAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    await adapter.search(TEST_ISBN, TEST_SYSTEM);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toBe(
      "https://test.booksys.net/opac/test/search?q=9780306406157&searchBy=keyword",
    );
  });

  it("uses searchUrlTemplate from config.extra when provided", async () => {
    const configWithTemplate: AdapterConfig = {
      ...TEST_CONFIG,
      extra: {
        searchUrlTemplate: "https://test.booksys.net/opac/test/custom?isbn={isbn}",
      },
    };

    mockFetch.mockResolvedValueOnce(
      new Response(createHtmlNoResults(), {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const adapter = new AtriumScrapeAdapter(TEST_SYSTEM, configWithTemplate, createSilentLogger());
    await adapter.search(TEST_ISBN, TEST_SYSTEM);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toBe("https://test.booksys.net/opac/test/custom?isbn=9780306406157");
  });

  it("throws AdapterConnectionError when fetch returns non-200", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("Not Found", { status: 404 }),
    );

    const adapter = new AtriumScrapeAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());

    await expect(adapter.search(TEST_ISBN, TEST_SYSTEM)).rejects.toThrow(
      /Atriuum search failed with HTTP 404/,
    );
  });

  it("health check returns healthy for 200 response", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("<html><body>OPAC</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const adapter = new AtriumScrapeAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const health = await adapter.healthCheck(TEST_SYSTEM);

    expect(health.healthy).toBe(true);
    expect(health.systemId).toBe("atriuum-test");
    expect(health.protocol).toBe("atriuum_scrape");
  });
});
