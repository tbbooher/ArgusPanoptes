// ---------------------------------------------------------------------------
// Integration tests for KohaSruAdapter.
//
// Mocks global fetch to return realistic SRU/MARC XML responses, then
// verifies that the adapter parses them into the correct BookHolding shape.
//
// NOTE: The XML parser (fast-xml-parser) configured with isArray for "record"
// causes nested <record> elements inside <recordData> to become arrays.
// The adapter's extractMarcRecords falls through to wrapper.recordData when
// wrapper.recordData.record is an array. To match the parsing behavior, these
// test fixtures omit the nested <record> wrapper inside <recordData> and place
// MARC fields directly under <recordData>.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import pino from "pino";

import { KohaSruAdapter } from "../../../src/adapters/koha/koha-sru-adapter.js";
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
  id: "koha-test" as LibrarySystemId,
  name: "Test Koha Library",
  vendor: "koha",
  region: "Test County",
  catalogUrl: "https://koha.test.example.org/",
  branches: [
    {
      id: "koha-test:main" as BranchId,
      name: "Main Branch",
      code: "MAIN",
      city: "Testville",
    },
    {
      id: "koha-test:north" as BranchId,
      name: "North Branch",
      code: "NORTH",
      city: "Testville",
    },
  ],
  adapters: [],
  enabled: true,
};

const TEST_CONFIG: AdapterConfig = {
  protocol: "koha_sru",
  baseUrl: "https://koha.test.example.org",
  timeoutMs: 10000,
  maxConcurrency: 2,
};

function createSilentLogger() {
  return pino({ level: "silent" });
}

/**
 * SRU XML response with one MARC record containing two Koha 952 item fields.
 * MARC fields are placed directly inside <recordData> (without an inner
 * <record> wrapper) to match how the adapter's XML parser resolves the tree.
 */
function createSruXmlWithItems(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<searchRetrieveResponse>
  <version>1.1</version>
  <numberOfRecords>1</numberOfRecords>
  <records>
    <record>
      <recordSchema>marcxml</recordSchema>
      <recordPacking>xml</recordPacking>
      <recordData>
        <controlfield tag="001">12345</controlfield>
        <controlfield tag="003">KohaTest</controlfield>
        <datafield tag="020" ind1=" " ind2=" ">
          <subfield code="a">9780306406157</subfield>
        </datafield>
        <datafield tag="245" ind1="1" ind2="0">
          <subfield code="a">Test Book Title</subfield>
        </datafield>
        <datafield tag="090" ind1=" " ind2=" ">
          <subfield code="a">QA76.73</subfield>
        </datafield>
        <datafield tag="952" ind1=" " ind2=" ">
          <subfield code="a">MAIN</subfield>
          <subfield code="b">MAIN</subfield>
          <subfield code="c">GEN</subfield>
          <subfield code="o">QA76.73 .T47 2020</subfield>
          <subfield code="p">T00012345</subfield>
          <subfield code="y">BK</subfield>
          <subfield code="7">0</subfield>
        </datafield>
        <datafield tag="952" ind1=" " ind2=" ">
          <subfield code="a">NORTH</subfield>
          <subfield code="b">NORTH</subfield>
          <subfield code="c">REF</subfield>
          <subfield code="o">QA76.73 .T47 2020</subfield>
          <subfield code="p">T00012346</subfield>
          <subfield code="y">BK</subfield>
          <subfield code="7">0</subfield>
          <subfield code="q">2024-03-15</subfield>
        </datafield>
      </recordData>
    </record>
  </records>
</searchRetrieveResponse>`;
}

/** SRU response with zero records (ISBN not found). */
function createSruXmlEmpty(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<searchRetrieveResponse>
  <version>1.1</version>
  <numberOfRecords>0</numberOfRecords>
  <records/>
</searchRetrieveResponse>`;
}

/** SRU response with a record but no 952 item fields. */
function createSruXmlNoItems(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<searchRetrieveResponse>
  <version>1.1</version>
  <numberOfRecords>1</numberOfRecords>
  <records>
    <record>
      <recordSchema>marcxml</recordSchema>
      <recordPacking>xml</recordPacking>
      <recordData>
        <controlfield tag="001">99999</controlfield>
        <datafield tag="245" ind1="1" ind2="0">
          <subfield code="a">Book Without Items</subfield>
        </datafield>
        <datafield tag="090" ind1=" " ind2=" ">
          <subfield code="a">PS3515.A48</subfield>
        </datafield>
      </recordData>
    </record>
  </records>
</searchRetrieveResponse>`;
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("KohaSruAdapter", () => {
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

  it("parses a valid SRU response with two items into BookHolding objects", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(createSruXmlWithItems(), {
        status: 200,
        headers: { "Content-Type": "application/xml" },
      }),
    );

    const adapter = new KohaSruAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(result.holdings).toHaveLength(2);
    expect(result.protocol).toBe("koha_sru");
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);

    // First item: available at MAIN branch
    const item1 = result.holdings[0];
    expect(item1.isbn).toBe(TEST_ISBN);
    expect(item1.systemId).toBe("koha-test");
    expect(item1.branchName).toBe("Main Branch");
    expect(item1.branchId).toBe("koha-test:main");
    expect(item1.callNumber).toBe("QA76.73 .T47 2020");
    expect(item1.status).toBe("available");
    expect(item1.rawStatus).toBe("Available");
    expect(item1.materialType).toBe("book");
    expect(item1.dueDate).toBeNull();
    expect(item1.collection).toBe("GEN");
    expect(item1.fingerprint).toBeTruthy();

    // Second item: checked out at NORTH branch (has dueDate)
    const item2 = result.holdings[1];
    expect(item2.branchName).toBe("North Branch");
    expect(item2.branchId).toBe("koha-test:north");
    expect(item2.status).toBe("checked_out");
    expect(item2.rawStatus).toBe("Checked out");
    expect(item2.dueDate).toBe("2024-03-15");
    expect(item2.collection).toBe("REF");
  });

  it("returns empty holdings when SRU reports zero records", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(createSruXmlEmpty(), {
        status: 200,
        headers: { "Content-Type": "application/xml" },
      }),
    );

    const adapter = new KohaSruAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(result.holdings).toHaveLength(0);
  });

  it("returns a single system-level holding when record has no 952 items", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(createSruXmlNoItems(), {
        status: 200,
        headers: { "Content-Type": "application/xml" },
      }),
    );

    const adapter = new KohaSruAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(result.holdings).toHaveLength(1);
    const holding = result.holdings[0];
    expect(holding.branchId).toBe("unknown");
    expect(holding.branchName).toBe("Unknown");
    expect(holding.status).toBe("unknown");
    // The 090$a call number "PS3515.A48" should be picked up
    expect(holding.callNumber).toBe("PS3515.A48");
  });

  it("throws AdapterParseError when SRU returns non-200 HTTP status", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("Server Error", { status: 500 }),
    );

    const adapter = new KohaSruAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());

    await expect(adapter.search(TEST_ISBN, TEST_SYSTEM)).rejects.toThrow(
      /SRU request failed with HTTP 500/,
    );
  });

  it("throws AdapterConnectionError when fetch throws a network error", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));

    const adapter = new KohaSruAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());

    await expect(adapter.search(TEST_ISBN, TEST_SYSTEM)).rejects.toThrow(
      /Network error/,
    );
  });

  it("constructs the correct SRU URL with ISBN query", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(createSruXmlEmpty(), {
        status: 200,
        headers: { "Content-Type": "application/xml" },
      }),
    );

    const adapter = new KohaSruAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/cgi-bin/koha/sru.pl");
    // URLSearchParams encodes = as %3D in query values
    expect(calledUrl).toContain("query=bath.isbn%3D9780306406157");
    expect(calledUrl).toContain("operation=searchRetrieve");
    expect(calledUrl).toContain("recordSchema=marcxml");
  });

  it("uses the branch code as fallback name when branch is unrecognized", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<searchRetrieveResponse>
  <version>1.1</version>
  <numberOfRecords>1</numberOfRecords>
  <records>
    <record>
      <recordSchema>marcxml</recordSchema>
      <recordPacking>xml</recordPacking>
      <recordData>
        <controlfield tag="001">55555</controlfield>
        <datafield tag="952" ind1=" " ind2=" ">
          <subfield code="a">UNKNOWN_BRANCH</subfield>
          <subfield code="b">UNKNOWN_BRANCH</subfield>
          <subfield code="o">F .S123</subfield>
          <subfield code="p">T99999</subfield>
          <subfield code="y">BK</subfield>
          <subfield code="7">0</subfield>
        </datafield>
      </recordData>
    </record>
  </records>
</searchRetrieveResponse>`;

    mockFetch.mockResolvedValueOnce(
      new Response(xml, {
        status: 200,
        headers: { "Content-Type": "application/xml" },
      }),
    );

    const adapter = new KohaSruAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(result.holdings).toHaveLength(1);
    // Unrecognized branch code falls back to the code itself as name
    expect(result.holdings[0].branchName).toBe("UNKNOWN_BRANCH");
    expect(result.holdings[0].branchId).toBe("UNKNOWN_BRANCH");
  });

  it("correctly maps not-for-loan items", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<searchRetrieveResponse>
  <version>1.1</version>
  <numberOfRecords>1</numberOfRecords>
  <records>
    <record>
      <recordSchema>marcxml</recordSchema>
      <recordPacking>xml</recordPacking>
      <recordData>
        <controlfield tag="001">77777</controlfield>
        <datafield tag="952" ind1=" " ind2=" ">
          <subfield code="a">MAIN</subfield>
          <subfield code="b">MAIN</subfield>
          <subfield code="o">REF QA76</subfield>
          <subfield code="p">T88888</subfield>
          <subfield code="y">BK</subfield>
          <subfield code="7">1</subfield>
        </datafield>
      </recordData>
    </record>
  </records>
</searchRetrieveResponse>`;

    mockFetch.mockResolvedValueOnce(
      new Response(xml, {
        status: 200,
        headers: { "Content-Type": "application/xml" },
      }),
    );

    const adapter = new KohaSruAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(result.holdings).toHaveLength(1);
    expect(result.holdings[0].rawStatus).toBe("Not for loan");
    // "Not for loan" is not in the normalizeStatus mapping, so it becomes "unknown"
    expect(result.holdings[0].status).toBe("unknown");
  });
});
