// ---------------------------------------------------------------------------
// Integration tests for TlcApiAdapter.
//
// Mocks global fetch to return realistic JSON responses from the TLC
// Library.Solution / LS2 PAC REST API endpoints.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import pino from "pino";

import { TlcApiAdapter } from "../../../src/adapters/tlc/tlc-api-adapter.js";
import type {
  AdapterConfig,
  LibrarySystem,
  LibrarySystemId,
  BranchId,
  ISBN13,
} from "../../../src/core/types.js";

// ── Fixtures ─────────────────────────────────────────────────────────────

const TEST_ISBN = "9780062420701" as ISBN13;

const TEST_SYSTEM: LibrarySystem = {
  id: "tlc-test" as LibrarySystemId,
  name: "Test TLC Library",
  vendor: "tlc",
  region: "Test County",
  catalogUrl: "https://test.tlcdelivers.com",
  branches: [
    {
      id: "tlc-test:main" as BranchId,
      name: "Main",
      code: "1",
      city: "Testville",
    },
    {
      id: "tlc-test:north" as BranchId,
      name: "North Branch",
      code: "2",
      city: "Testville",
    },
  ],
  adapters: [],
  enabled: true,
};

const TEST_CONFIG: AdapterConfig = {
  protocol: "tlc_api",
  baseUrl: "https://test.tlcdelivers.com",
  timeoutMs: 10000,
  maxConcurrency: 2,
};

function createSilentLogger() {
  return pino({ level: "silent" });
}

/** Typical TLC search response with one resource and holdings. */
function createSearchResponse() {
  return {
    totalHits: 1,
    resources: [
      {
        id: 59474873,
        shortTitle: "To kill a mockingbird",
        shortAuthor: "Lee, Harper",
        format: "Large Print",
        hostBibliographicId: "162514",
        downloadable: false,
        standardNumbers: [
          { type: "Isbn", data: "9780062420701" },
          { type: "Isbn", data: "0062420704" },
        ],
        holdingsInformations: [
          {
            id: 211523568,
            branchIdentifier: "1",
            branchName: "Main",
            barcode: "38800005553820",
            shelfLocation: "LP F LEE",
            formattedCallNumber: "LP F LEE",
            collectionCode: "LPF",
            collectionName: "Large Print Fiction",
            volume: null,
            hideFromPublic: false,
            reserved: false,
          },
          {
            id: 211523569,
            branchIdentifier: "2",
            branchName: "North Branch",
            barcode: "38800005553821",
            shelfLocation: "LP F LEE",
            formattedCallNumber: "LP F LEE",
            collectionCode: "LPF",
            collectionName: "Large Print Fiction",
            volume: null,
            hideFromPublic: false,
            reserved: true,
          },
        ],
      },
    ],
  };
}

/** Real-time host record information. */
function createRealtimeInfo() {
  return {
    totalCheckouts: 1,
    totalPendingRequests: 3,
    totalCopies: 2,
  };
}

/** Empty search response. */
function createEmptySearchResponse() {
  return { totalHits: 0, resources: [] };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("TlcApiAdapter", () => {
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

  it("parses search + realtime responses into BookHolding objects", async () => {
    // First call: /search
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(createSearchResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    // Second call: /hostSystem/getRealtimeHostRecordInformation
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(createRealtimeInfo()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const adapter = new TlcApiAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(result.holdings).toHaveLength(2);
    expect(result.protocol).toBe("tlc_api");

    const h1 = result.holdings[0];
    expect(h1.isbn).toBe(TEST_ISBN);
    expect(h1.systemId).toBe("tlc-test");
    expect(h1.branchName).toBe("Main");
    expect(h1.branchId).toBe("tlc-test:main");
    expect(h1.callNumber).toBe("LP F LEE");
    expect(h1.status).toBe("available");
    expect(h1.materialType).toBe("large_print");
    expect(h1.collection).toBe("Large Print Fiction");
    expect(h1.holdCount).toBe(3);
    expect(h1.copyCount).toBe(2);

    const h2 = result.holdings[1];
    expect(h2.branchName).toBe("North Branch");
    expect(h2.branchId).toBe("tlc-test:north");
    expect(h2.status).toBe("on_hold");
  });

  it("returns empty holdings for zero-hit response", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(createEmptySearchResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const adapter = new TlcApiAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(result.holdings).toHaveLength(0);
    expect(mockFetch).toHaveBeenCalledTimes(1); // No realtime call needed
  });

  it("sends correct search POST body", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(createEmptySearchResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const adapter = new TlcApiAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    await adapter.search(TEST_ISBN, TEST_SYSTEM);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://test.tlcdelivers.com/search");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.searchTerm).toBe('isbn:"9780062420701"');
    expect(body.sortCriteria).toBe("Relevancy");
  });

  it("falls back gracefully when realtime info fails", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(createSearchResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    // Realtime endpoint returns 500
    mockFetch.mockResolvedValueOnce(
      new Response("Server Error", { status: 500 }),
    );

    const adapter = new TlcApiAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(result.holdings).toHaveLength(2);
    // Without realtime info, uses reserved flag
    expect(result.holdings[0].status).toBe("available");
    expect(result.holdings[1].status).toBe("on_hold");
  });

  it("skips downloadable/digital resources", async () => {
    const responseWithDigital = {
      totalHits: 2,
      resources: [
        {
          id: 1,
          shortTitle: "Physical Book",
          format: "Book",
          hostBibliographicId: "111",
          downloadable: false,
          holdingsInformations: [
            {
              id: 1,
              branchIdentifier: "1",
              branchName: "Main",
              barcode: "123",
              formattedCallNumber: "FIC TEST",
              collectionName: "Fiction",
              hideFromPublic: false,
              reserved: false,
            },
          ],
        },
        {
          id: 2,
          shortTitle: "eBook Version",
          format: "eBook",
          hostBibliographicId: "222",
          downloadable: true,
          holdingsInformations: [],
        },
      ],
    };

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(responseWithDigital), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    // Realtime for physical book
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ totalCheckouts: 0, totalCopies: 1 }), {
        status: 200,
      }),
    );

    const adapter = new TlcApiAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(result.holdings).toHaveLength(1);
    expect(result.holdings[0].callNumber).toBe("FIC TEST");
  });

  it("hides items marked hideFromPublic", async () => {
    const responseWithHidden = {
      totalHits: 1,
      resources: [
        {
          id: 1,
          format: "Book",
          hostBibliographicId: "111",
          downloadable: false,
          holdingsInformations: [
            {
              id: 1,
              branchIdentifier: "1",
              branchName: "Main",
              barcode: "123",
              formattedCallNumber: "FIC A",
              collectionName: "Fiction",
              hideFromPublic: false,
              reserved: false,
            },
            {
              id: 2,
              branchIdentifier: "1",
              branchName: "Main",
              barcode: "456",
              formattedCallNumber: "FIC A",
              collectionName: "Staff Only",
              hideFromPublic: true,
              reserved: false,
            },
          ],
        },
      ],
    };

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(responseWithHidden), { status: 200 }),
    );
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ totalCheckouts: 0, totalCopies: 1 }), { status: 200 }),
    );

    const adapter = new TlcApiAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(result.holdings).toHaveLength(1);
    expect(result.holdings[0].collection).toBe("Fiction");
  });

  it("throws AdapterConnectionError when search returns non-200", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("Forbidden", { status: 403 }),
    );

    const adapter = new TlcApiAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());

    await expect(adapter.search(TEST_ISBN, TEST_SYSTEM)).rejects.toThrow(
      /TLC search failed with HTTP 403/,
    );
  });

  it("throws AdapterConnectionError on network error", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));

    const adapter = new TlcApiAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());

    await expect(adapter.search(TEST_ISBN, TEST_SYSTEM)).rejects.toThrow(
      /Network error/,
    );
  });

  it("health check returns healthy for 200 response", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, totalHits: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const adapter = new TlcApiAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const health = await adapter.healthCheck(TEST_SYSTEM);

    expect(health.healthy).toBe(true);
    expect(health.systemId).toBe("tlc-test");
    expect(health.protocol).toBe("tlc_api");
  });

  it("health check returns unhealthy on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

    const adapter = new TlcApiAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const health = await adapter.healthCheck(TEST_SYSTEM);

    expect(health.healthy).toBe(false);
    expect(health.message).toContain("Connection refused");
  });

  it("generates catalog URL with hostBibliographicId", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(createSearchResponse()), { status: 200 }),
    );
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(createRealtimeInfo()), { status: 200 }),
    );

    const adapter = new TlcApiAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(result.holdings[0].catalogUrl).toContain("162514");
  });
});
