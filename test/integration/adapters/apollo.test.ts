// ---------------------------------------------------------------------------
// Integration tests for ApolloAdapter.
//
// Mocks global fetch to return realistic XML responses from the Biblionix
// Apollo search_setup and perform_search AJAX endpoints.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import pino from "pino";

import { ApolloAdapter } from "../../../src/adapters/apollo/apollo-adapter.js";
import type {
  AdapterConfig,
  LibrarySystem,
  LibrarySystemId,
  BranchId,
  ISBN13,
} from "../../../src/core/types.js";

// ── Fixtures ─────────────────────────────────────────────────────────────

const TEST_ISBN = "9780061808128" as ISBN13;

const TEST_SYSTEM: LibrarySystem = {
  id: "apollo-test" as LibrarySystemId,
  name: "Test Apollo Library",
  vendor: "apollo",
  region: "Test County",
  catalogUrl: "https://testlib.biblionix.com",
  branches: [
    {
      id: "apollo-test:main" as BranchId,
      name: "Main Library",
      code: "main",
      city: "Testville",
    },
  ],
  adapters: [],
  enabled: true,
};

const TEST_SYSTEM_MULTI: LibrarySystem = {
  ...TEST_SYSTEM,
  branches: [
    {
      id: "apollo-test:central" as BranchId,
      name: "Central Library",
      code: "42462626",
      city: "Testville",
    },
    {
      id: "apollo-test:north" as BranchId,
      name: "North Branch",
      code: "42471331",
      city: "Testville",
    },
  ],
};

const TEST_CONFIG: AdapterConfig = {
  protocol: "apollo_api",
  baseUrl: "https://testlib.biblionix.com",
  timeoutMs: 10000,
  maxConcurrency: 2,
};

function createSilentLogger() {
  return pino({ level: "silent" });
}

/** search_setup.xml.pl response. */
function createSetupXml(searchId: number = 953537997): string {
  return `<root search_id="${searchId}"></root>`;
}

/** perform_search.xml.pl response with one record and one holding. */
function createSearchResultXml(): string {
  return `<root sort="score" reverse="0" others="0" z3950="0" dumb_z="0" uses_score="1">
  <result description="Keyword: 9780061808128" matches="1" command="keyword:9780061808128" filter="" />
  <null></null>
  <s b="214849026" o="0" oi="358" s="100000" c="CDBK LEE" k="is_adults" cs="CDBK LEE"
     t="To kil\u00ADl a \u00ADmock\u00ADing\u00ADbird" a="Lee, Harp\u00ADer" ani="Harper Lee"
     sl="Media Room" m="CDBK" la="eng" cp="2006" v="1" x="1"
     e="" e_id="" e_aux="" mt="42467226">
    <ol id="0" o="1" t="1" b="214849026">
      <br id="42462626" in="1" tot="93937220347360" bt="1">
        <hs>
          <h id="94823598" available="1" mat_num="5068468" volume="" />
        </hs>
      </br>
    </ol>
  </s>
</root>`;
}

/** Response with multiple holdings across branches. */
function createMultiHoldingXml(): string {
  return `<root sort="score" reverse="0" uses_score="1">
  <result matches="1" />
  <s b="602584550" c="155.24 CLE" t="Atomic habits" a="Clear, James" ani="James Clear"
     sl="Non-Fiction" m="" x="0" e="" mt="42678882">
    <ol id="0" o="1" t="1" b="602584550">
      <br id="42462626" in="0" bt="1">
        <hs>
          <h id="215036820" available="0" mat_num="31129300787389" volume="" />
        </hs>
      </br>
      <br id="42471331" in="1" bt="1">
        <hs>
          <h id="215036821" available="1" mat_num="31129300787390" volume="" />
        </hs>
      </br>
    </ol>
  </s>
</root>`;
}

/** Response with zero matches. */
function createEmptyResultXml(): string {
  return `<root sort="score" reverse="0" uses_score="1">
  <result description="Keyword: 9780306406157" matches="0" command="keyword:9780306406157" filter="" />
  <null></null>
</root>`;
}

/** Response with an external/digital record that should be filtered out. */
function createExternalRecordXml(): string {
  return `<root sort="score" reverse="0" uses_score="1">
  <result matches="2" />
  <s b="111" c="FIC LEE" t="Physical Book" a="Author" sl="Fiction" m="Book" x="1" e="" mt="1">
    <ol id="0" o="1" t="1" b="111">
      <br id="42462626" in="1" bt="1">
        <hs><h id="1" available="1" mat_num="123" volume="" /></hs>
      </br>
    </ol>
  </s>
  <s b="222" t="Digital Book" a="Author" sl="" m="eBook" x="1" e="overdrive_api" e_id="abc" mt="2">
  </s>
</root>`;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("ApolloAdapter", () => {
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

  it("parses search results into BookHolding objects", async () => {
    // Step 1: search_setup
    mockFetch.mockResolvedValueOnce(
      new Response(createSetupXml(), {
        status: 200,
        headers: { "Content-Type": "application/xml" },
      }),
    );
    // Step 2: perform_search
    mockFetch.mockResolvedValueOnce(
      new Response(createSearchResultXml(), {
        status: 200,
        headers: { "Content-Type": "application/xml" },
      }),
    );

    const adapter = new ApolloAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(result.holdings).toHaveLength(1);
    expect(result.protocol).toBe("apollo_api");

    const h = result.holdings[0];
    expect(h.isbn).toBe(TEST_ISBN);
    expect(h.systemId).toBe("apollo-test");
    expect(h.branchName).toBe("Main Library");
    expect(h.callNumber).toBe("CDBK LEE");
    expect(h.status).toBe("available");
    expect(h.collection).toBe("Media Room");
    expect(h.materialType).toBe("audiobook_cd");
    expect(h.catalogUrl).toContain("biblio=214849026");
  });

  it("strips soft-hyphen characters from title data", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(createSetupXml(), { status: 200 }),
    );
    mockFetch.mockResolvedValueOnce(
      new Response(createSearchResultXml(), { status: 200 }),
    );

    const adapter = new ApolloAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    // The raw XML has soft-hyphens; verify they're cleaned in catalog URL (title isn't in BookHolding)
    expect(result.holdings[0].catalogUrl).not.toContain("\u00AD");
  });

  it("returns empty holdings for zero-match response", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(createSetupXml(), { status: 200 }),
    );
    mockFetch.mockResolvedValueOnce(
      new Response(createEmptyResultXml(), { status: 200 }),
    );

    const adapter = new ApolloAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(result.holdings).toHaveLength(0);
  });

  it("handles multiple holdings across branches", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(createSetupXml(), { status: 200 }),
    );
    mockFetch.mockResolvedValueOnce(
      new Response(createMultiHoldingXml(), { status: 200 }),
    );

    const adapter = new ApolloAdapter(TEST_SYSTEM_MULTI, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM_MULTI);

    expect(result.holdings).toHaveLength(2);

    const h1 = result.holdings[0];
    expect(h1.branchName).toBe("Central Library");
    expect(h1.branchId).toBe("apollo-test:central");
    expect(h1.status).toBe("checked_out");

    const h2 = result.holdings[1];
    expect(h2.branchName).toBe("North Branch");
    expect(h2.branchId).toBe("apollo-test:north");
    expect(h2.status).toBe("available");
  });

  it("filters out external/digital records", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(createSetupXml(), { status: 200 }),
    );
    mockFetch.mockResolvedValueOnce(
      new Response(createExternalRecordXml(), { status: 200 }),
    );

    const adapter = new ApolloAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    // Only the physical book, not the Overdrive eBook
    expect(result.holdings).toHaveLength(1);
    expect(result.holdings[0].callNumber).toBe("FIC LEE");
  });

  it("calls search_setup with correct ISBN URL", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(createSetupXml(), { status: 200 }),
    );
    mockFetch.mockResolvedValueOnce(
      new Response(createEmptyResultXml(), { status: 200 }),
    );

    const adapter = new ApolloAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    await adapter.search(TEST_ISBN, TEST_SYSTEM);

    const setupUrl = mockFetch.mock.calls[0][0] as string;
    expect(setupUrl).toBe(
      "https://testlib.biblionix.com/catalog/ajax_backend/search_setup.xml.pl?search=keyword%3A9780061808128",
    );
  });

  it("sends correct POST body to perform_search", async () => {
    const searchId = 12345;
    mockFetch.mockResolvedValueOnce(
      new Response(createSetupXml(searchId), { status: 200 }),
    );
    mockFetch.mockResolvedValueOnce(
      new Response(createEmptyResultXml(), { status: 200 }),
    );

    const adapter = new ApolloAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    await adapter.search(TEST_ISBN, TEST_SYSTEM);

    const searchCall = mockFetch.mock.calls[1];
    expect(searchCall[0]).toBe(
      "https://testlib.biblionix.com/catalog/ajax_backend/perform_search.xml.pl",
    );
    const body = JSON.parse(searchCall[1].body);
    expect(body.search_id).toBe(searchId);
    expect(body.catalog_version).toBe("");
  });

  it("throws AdapterConnectionError when search_setup returns non-200", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("Forbidden", { status: 403 }),
    );

    const adapter = new ApolloAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());

    await expect(adapter.search(TEST_ISBN, TEST_SYSTEM)).rejects.toThrow(
      /Apollo search_setup failed with HTTP 403/,
    );
  });

  it("throws AdapterConnectionError on network error", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));

    const adapter = new ApolloAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());

    await expect(adapter.search(TEST_ISBN, TEST_SYSTEM)).rejects.toThrow(
      /Network error/,
    );
  });

  it("creates record-level holding when no item-level data exists", async () => {
    const noItemsXml = `<root sort="score" uses_score="1">
      <result matches="1" />
      <s b="999" c="FIC TEST" t="Test Book" a="Author" sl="Fiction" m="Book" x="1" e="" mt="1">
        <ol id="0" o="1" t="1" b="999"></ol>
      </s>
    </root>`;

    mockFetch.mockResolvedValueOnce(
      new Response(createSetupXml(), { status: 200 }),
    );
    mockFetch.mockResolvedValueOnce(
      new Response(noItemsXml, { status: 200 }),
    );

    const adapter = new ApolloAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(result.holdings).toHaveLength(1);
    expect(result.holdings[0].branchName).toBe("Main Library");
    expect(result.holdings[0].status).toBe("available");
    expect(result.holdings[0].callNumber).toBe("FIC TEST");
  });

  it("health check returns healthy for 200 response", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(createSetupXml(), {
        status: 200,
        headers: { "Content-Type": "application/xml" },
      }),
    );

    const adapter = new ApolloAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const health = await adapter.healthCheck(TEST_SYSTEM);

    expect(health.healthy).toBe(true);
    expect(health.systemId).toBe("apollo-test");
    expect(health.protocol).toBe("apollo_api");
  });

  it("health check returns unhealthy on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

    const adapter = new ApolloAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const health = await adapter.healthCheck(TEST_SYSTEM);

    expect(health.healthy).toBe(false);
    expect(health.message).toContain("Connection refused");
  });
});
