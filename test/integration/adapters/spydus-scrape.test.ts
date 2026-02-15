// ---------------------------------------------------------------------------
// Integration tests for SpydusScrapeAdapter.
//
// Mocks global fetch to return realistic HTML from a Spydus OPAC, then
// verifies that holdings are correctly parsed.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import pino from "pino";

import { SpydusScrapeAdapter } from "../../../src/adapters/spydus/spydus-scrape-adapter.js";
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
  id: "spydus-test" as LibrarySystemId,
  name: "Test Spydus Library",
  vendor: "spydus",
  region: "Test County",
  catalogUrl: "https://test.spydus.com",
  branches: [
    {
      id: "spydus-test:central" as BranchId,
      name: "Central Library",
      code: "central",
      city: "Testville",
    },
    {
      id: "spydus-test:lake" as BranchId,
      name: "Lake Branch",
      code: "lake",
      city: "Laketown",
    },
  ],
  adapters: [],
  enabled: true,
};

const TEST_CONFIG: AdapterConfig = {
  protocol: "spydus_scrape",
  baseUrl: "https://test.spydus.com",
  timeoutMs: 10000,
  maxConcurrency: 2,
};

function createSilentLogger() {
  return pino({ level: "silent" });
}

/** HTML with a Spydus copy/item table. */
function createHtmlWithCopyTable(): string {
  return `<!DOCTYPE html>
<html>
<head><title>Full Display</title></head>
<body>
  <table class="items">
    <tr><th>Location</th><th>Call Number</th><th>Status</th><th>Due Date</th></tr>
    <tr>
      <td>Central Library</td>
      <td>823.912 SMI</td>
      <td>Available</td>
      <td></td>
    </tr>
    <tr>
      <td>Lake Branch</td>
      <td>823.912 SMI</td>
      <td>On Loan</td>
      <td>15/03/2026</td>
    </tr>
  </table>
</body>
</html>`;
}

/** HTML with no result items. */
function createHtmlNoResults(): string {
  return `<!DOCTYPE html>
<html>
<head><title>Search Results</title></head>
<body>
  <p>Your search returned no results.</p>
</body>
</html>`;
}

/** HTML with brief search results (multiple bib records). */
function createHtmlWithBriefResults(): string {
  return `<!DOCTYPE html>
<html>
<body>
  <div class="result">
    <a class="title" href="/record/1">Test Book Title</a>
  </div>
</body>
</html>`;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("SpydusScrapeAdapter", () => {
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

  it("parses item table into BookHolding objects", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(createHtmlWithCopyTable(), {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const adapter = new SpydusScrapeAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(result.holdings).toHaveLength(2);
    expect(result.protocol).toBe("spydus_scrape");

    const h1 = result.holdings[0];
    expect(h1.isbn).toBe(TEST_ISBN);
    expect(h1.systemId).toBe("spydus-test");
    expect(h1.branchName).toBe("Central Library");
    expect(h1.branchId).toBe("spydus-test:central");
    expect(h1.callNumber).toBe("823.912 SMI");
    expect(h1.status).toBe("available");

    const h2 = result.holdings[1];
    expect(h2.branchName).toBe("Lake Branch");
    expect(h2.branchId).toBe("spydus-test:lake");
    expect(h2.callNumber).toBe("823.912 SMI");
    expect(h2.dueDate).toBe("15/03/2026");
  });

  it("returns empty holdings for no-results page", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(createHtmlNoResults(), {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const adapter = new SpydusScrapeAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(result.holdings).toHaveLength(0);
  });

  it("falls back to brief result parsing when no copy table exists", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(createHtmlWithBriefResults(), {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const adapter = new SpydusScrapeAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(result.holdings).toHaveLength(1);
    expect(result.holdings[0].status).toBe("unknown");
  });

  it("constructs the correct Spydus CGI search URL", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(createHtmlNoResults(), {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const adapter = new SpydusScrapeAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    await adapter.search(TEST_ISBN, TEST_SYSTEM);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/cgi-bin/spydus.exe/ENQ/OPAC/BIBENQ");
    expect(calledUrl).toContain("ENTRY=9780306406157");
    expect(calledUrl).toContain("ENTRY_NAME=SBN");
    expect(calledUrl).toContain("NRECS=50");
  });

  it("uses searchUrlTemplate from config.extra when provided", async () => {
    const configWithTemplate: AdapterConfig = {
      ...TEST_CONFIG,
      extra: {
        searchUrlTemplate: "https://test.spydus.com/custom/search?isbn={isbn}",
      },
    };

    mockFetch.mockResolvedValueOnce(
      new Response(createHtmlNoResults(), {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const adapter = new SpydusScrapeAdapter(TEST_SYSTEM, configWithTemplate, createSilentLogger());
    await adapter.search(TEST_ISBN, TEST_SYSTEM);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toBe("https://test.spydus.com/custom/search?isbn=9780306406157");
  });

  it("throws AdapterConnectionError when fetch returns non-200", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("Server Error", { status: 500 }),
    );

    const adapter = new SpydusScrapeAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());

    await expect(adapter.search(TEST_ISBN, TEST_SYSTEM)).rejects.toThrow(
      /Spydus search failed with HTTP 500/,
    );
  });

  it("health check returns healthy for 200 response", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("<html><body>Spydus OPAC</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const adapter = new SpydusScrapeAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const health = await adapter.healthCheck(TEST_SYSTEM);

    expect(health.healthy).toBe(true);
    expect(health.systemId).toBe("spydus-test");
    expect(health.protocol).toBe("spydus_scrape");
  });

  it("health check returns unhealthy on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

    const adapter = new SpydusScrapeAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const health = await adapter.healthCheck(TEST_SYSTEM);

    expect(health.healthy).toBe(false);
    expect(health.message).toContain("Connection refused");
  });
});
