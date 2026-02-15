// ---------------------------------------------------------------------------
// Integration tests for AspenDiscoveryAdapter.
//
// Mocks global fetch to return realistic JSON responses from the Aspen
// Discovery SearchAPI and ItemAPI endpoints.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import pino from "pino";

import { AspenDiscoveryAdapter } from "../../../src/adapters/aspen/aspen-discovery-adapter.js";
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
  id: "aspen-test" as LibrarySystemId,
  name: "Test Aspen Library",
  vendor: "aspen_discovery",
  region: "Test County",
  catalogUrl: "https://aspen.test.example.org",
  branches: [
    {
      id: "aspen-test:main" as BranchId,
      name: "Main Library",
      code: "main",
      city: "Testville",
    },
    {
      id: "aspen-test:north" as BranchId,
      name: "North Branch",
      code: "north",
      city: "Testville",
    },
  ],
  adapters: [],
  enabled: true,
};

const TEST_CONFIG: AdapterConfig = {
  protocol: "aspen_discovery_api",
  baseUrl: "https://aspen.test.example.org",
  timeoutMs: 10000,
  maxConcurrency: 2,
};

function createSilentLogger() {
  return pino({ level: "silent" });
}

/** Search API response with one record. */
function createSearchResponse() {
  return {
    result: {
      success: true,
      totalResults: 1,
      recordCount: 1,
      records: [
        {
          id: "aspen.12345",
          title_display: "Test Book Title",
          author_display: "Test Author",
          isbn: ["9780306406157"],
        },
      ],
    },
  };
}

/** Item API response with two items at different locations. */
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

/** Empty search response. */
function createEmptySearchResponse() {
  return { result: { success: true, totalResults: 0, recordCount: 0, records: [] } };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("AspenDiscoveryAdapter", () => {
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

  it("parses search + item responses into BookHolding objects", async () => {
    // First call: SearchAPI
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(createSearchResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    // Second call: ItemAPI
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(createItemResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const adapter = new AspenDiscoveryAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(result.holdings).toHaveLength(2);
    expect(result.protocol).toBe("aspen_discovery_api");

    const h1 = result.holdings[0];
    expect(h1.isbn).toBe(TEST_ISBN);
    expect(h1.systemId).toBe("aspen-test");
    expect(h1.branchName).toBe("Main Library");
    expect(h1.branchId).toBe("aspen-test:main");
    expect(h1.status).toBe("available");
    expect(h1.callNumber).toBe("QA76.73 .T47 2020");
    expect(h1.collection).toBe("Fiction");
    expect(h1.catalogUrl).toContain("aspen.12345");

    const h2 = result.holdings[1];
    expect(h2.branchName).toBe("North Branch");
    expect(h2.branchId).toBe("aspen-test:north");
    expect(h2.status).toBe("checked_out");
    expect(h2.dueDate).toBe("2026-03-15");
    expect(h2.holdCount).toBe(2);
  });

  it("returns empty holdings for empty search response", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(createEmptySearchResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const adapter = new AspenDiscoveryAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(result.holdings).toHaveLength(0);
    expect(mockFetch).toHaveBeenCalledTimes(1); // No ItemAPI call needed
  });

  it("calls SearchAPI with correct ISBN search URL", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(createEmptySearchResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const adapter = new AspenDiscoveryAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    await adapter.search(TEST_ISBN, TEST_SYSTEM);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toBe(
      "https://aspen.test.example.org/API/SearchAPI?method=search&lookfor=9780306406157&searchIndex=ISN",
    );
  });

  it("falls back to record-level holding when ItemAPI fails", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(createSearchResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    // ItemAPI returns 500
    mockFetch.mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 }),
    );

    const adapter = new AspenDiscoveryAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(result.holdings).toHaveLength(1);
    expect(result.holdings[0].branchName).toBe("Unknown");
    expect(result.holdings[0].status).toBe("unknown");
  });

  it("throws AdapterConnectionError when SearchAPI returns non-200", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("Forbidden", { status: 403 }),
    );

    const adapter = new AspenDiscoveryAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());

    await expect(adapter.search(TEST_ISBN, TEST_SYSTEM)).rejects.toThrow(
      /Aspen Discovery search failed with HTTP 403/,
    );
  });

  it("throws AdapterConnectionError on network error", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));

    const adapter = new AspenDiscoveryAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());

    await expect(adapter.search(TEST_ISBN, TEST_SYSTEM)).rejects.toThrow(
      /Network error/,
    );
  });

  it("handles alternative response shape (records at top level)", async () => {
    const altResponse = {
      success: true,
      totalResults: 1,
      records: [{ id: "alt.99", title: "Alt Book" }],
    };

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(altResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    // Empty item response
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const adapter = new AspenDiscoveryAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(result.holdings).toHaveLength(1);
    expect(result.holdings[0].catalogUrl).toContain("alt.99");
  });

  it("handles result.holdings response shape from ItemAPI", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(createSearchResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    // ItemAPI returns items nested in result.holdings
    const holdingsResponse = {
      result: {
        holdings: [
          {
            itemId: "h-1",
            locationCode: "main",
            locationName: "Main Library",
            callNumber: "FIC TEST",
            statusFull: "In Transit",
            available: false,
          },
        ],
      },
    };
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(holdingsResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const adapter = new AspenDiscoveryAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(result.holdings).toHaveLength(1);
    expect(result.holdings[0].branchName).toBe("Main Library");
    expect(result.holdings[0].callNumber).toBe("FIC TEST");
    expect(result.holdings[0].status).toBe("in_transit");
  });

  it("health check returns healthy for 200 response", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ result: { success: true } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const adapter = new AspenDiscoveryAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const health = await adapter.healthCheck(TEST_SYSTEM);

    expect(health.healthy).toBe(true);
    expect(health.systemId).toBe("aspen-test");
    expect(health.protocol).toBe("aspen_discovery_api");
  });
});
