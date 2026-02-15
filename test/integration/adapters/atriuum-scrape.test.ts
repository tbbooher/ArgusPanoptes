// ---------------------------------------------------------------------------
// Integration tests for AtriumScrapeAdapter.
//
// Mocks global fetch to return realistic Atriuum mobile HTML, then verifies
// that holdings are correctly parsed from the SearchMobile and FullDispMobile
// pages.
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

/** Mobile search page with one IN result and one OUT result. */
function createMobileSearchWithResults(): string {
  return `<!DOCTYPE html>
<html>
<body class='ui-body-c' data-startpageid='atriuum-mobile-summarysearch'>
  <div data-role='content' class='atriuum-mobile-summarysearch'>
    <div id="ajaxSearchResultsDiv" style='text-align: center;'>
      <div id='searchSummary_1' class='itemResultsDiv itemStateIN' data-role='collapsible'>
        <h1>Test Book Title / Test Author.</h1>
        <table width="100%" cellspacing="0">
          <tr>
            <td style="text-align:center;vertical-align:top;width:90px;">
              <div id='dustJacketSummary_0' index='0' itemid='12345'
                   isbn='9780306406157' materialtypecode='1'></div>
            </td>
            <td align='left' valign='top'>
              <table valign='top'>
                <tr><td><a id="TitleLink_1" href="#">Test Book</a></td></tr>
                <tr><td><span id="author0">by Test Author</span></td></tr>
                <tr><td><span id="callnumber0">FIC TST</span></td></tr>
              </table>
            </td>
            <td align='right' valign='top'>
              <b><span id="ItemStatus_1">IN</span></b>
            </td>
          </tr>
        </table>
      </div>
      <div id='searchSummary_2' class='itemResultsDiv itemStateOUT' data-role='collapsible'>
        <h1>Another Book / Other Author.</h1>
        <table width="100%" cellspacing="0">
          <tr>
            <td style="text-align:center;vertical-align:top;width:90px;">
              <div id='dustJacketSummary_1' index='1' itemid='12346'
                   isbn='9780306406157' materialtypecode='1'></div>
            </td>
            <td align='left' valign='top'>
              <table valign='top'>
                <tr><td><a id="TitleLink_2" href="#">Another Book</a></td></tr>
                <tr><td><span id="author1">by Other Author</span></td></tr>
                <tr><td><span id="callnumber1">FIC OTH</span></td></tr>
              </table>
            </td>
            <td align='right' valign='top'>
              <b><span id="ItemStatus_2">OUT</span></b>
            </td>
          </tr>
        </table>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/** Mobile search page with no results. */
function createMobileSearchNoResults(): string {
  return `<!DOCTYPE html>
<html>
<body class='ui-body-c' data-startpageid='atriuum-mobile-summarysearch'>
  <div data-role='content' class='atriuum-mobile-summarysearch'>
    <div id="ajaxSearchResultsDiv" style='text-align: center;'>
    </div>
  </div>
</body>
</html>`;
}

/** Full display page with copy-level details. */
function createFullDisplayWithCopies(): string {
  return `<!DOCTYPE html>
<html>
<body class='ui-body-c' data-startpageid='atriuum-mobile-fulldetails'>
  <div data-role='content' class='atriuum-mobile-fulldetails'>
    <div id='ajaxSearchResultsDiv'>
      <input class='copiesInfo' type='hidden' name='copies_1' value=''
             callnumber='FIC TST'
             location='Main Library'
             sublocation='Adult Fiction Section'
             status='In' />
      <input class='copiesInfo' type='hidden' name='copies_2' value=''
             callnumber='FIC TST'
             location='Main Library'
             sublocation='Young Adult Section'
             status='Out' />
    </div>
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

  it("parses mobile search results with IN and OUT items", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(createMobileSearchWithResults(), {
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
    expect(h1.callNumber).toBe("FIC TST");
    expect(h1.status).toBe("available");
    expect(h1.rawStatus).toBe("IN");

    const h2 = result.holdings[1];
    expect(h2.callNumber).toBe("FIC OTH");
    expect(h2.status).toBe("checked_out");
    expect(h2.rawStatus).toBe("OUT");
  });

  it("returns empty holdings for no-results page", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(createMobileSearchNoResults(), {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const adapter = new AtriumScrapeAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(result.holdings).toHaveLength(0);
  });

  it("constructs the correct SearchMobile URL", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(createMobileSearchNoResults(), {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const adapter = new AtriumScrapeAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    await adapter.search(TEST_ISBN, TEST_SYSTEM);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toBe(
      "https://test.booksys.net/opac/test/SearchMobile?SF0=9780306406157&ST0=I&mode=mobile",
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
      new Response(createMobileSearchNoResults(), {
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

  it("extracts ISBN from dust jacket div when different from search ISBN", async () => {
    const htmlWithDifferentIsbn = createMobileSearchWithResults()
      .replace("isbn='9780306406157'", "isbn='9781234567890'");

    mockFetch.mockResolvedValueOnce(
      new Response(htmlWithDifferentIsbn, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const adapter = new AtriumScrapeAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    // First result should use the ISBN from the dust jacket div
    expect(result.holdings[0].isbn).toBe("9781234567890");
  });
});
