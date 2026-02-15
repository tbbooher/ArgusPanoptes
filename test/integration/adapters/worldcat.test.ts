// ---------------------------------------------------------------------------
// Integration tests for WorldCatAdapter.
//
// Mocks global fetch to simulate OAuth token and WorldCat search endpoints.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import pino from "pino";

import { WorldCatAdapter } from "../../../src/adapters/worldcat/worldcat-adapter.js";
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
  id: "worldcat-test" as LibrarySystemId,
  name: "WorldCat Test",
  vendor: "unknown",
  region: "Texas",
  catalogUrl: "https://worldcat.org",
  branches: [],
  adapters: [],
  enabled: true,
};

const TEST_CONFIG: AdapterConfig = {
  protocol: "oclc_worldcat",
  baseUrl: "https://americas.discovery.api.oclc.org",
  timeoutMs: 10000,
  maxConcurrency: 2,
  clientKeyEnvVar: "TEST_WORLDCAT_KEY",
  clientSecretEnvVar: "TEST_WORLDCAT_SECRET",
};

function createSilentLogger() {
  return pino({ level: "silent" });
}

/** Mock OAuth token response. */
function createTokenResponse() {
  return {
    access_token: "test-access-token-abc123",
    expires_in: 3600,
    token_type: "bearer",
  };
}

/** Mock WorldCat bib search response with one record. */
function createBibSearchResponse() {
  return {
    numberOfRecords: 1,
    bibRecords: [
      {
        identifier: { oclcNumber: "12345678" },
        title: "Test Book Title",
        creator: "Test Author",
        date: "2020",
      },
    ],
  };
}

/** Mock WorldCat holdings response with two Texas holdings. */
function createHoldingsResponse() {
  return {
    numberOfHoldings: 2,
    briefRecords: [
      {
        oclcNumber: "12345678",
        institutionSymbol: "TXA",
        institutionName: "Austin Public Library",
        branchName: "Central Branch",
        shelvingLocation: "Adult Fiction",
        callNumber: "F .T47 2020",
      },
      {
        oclcNumber: "12345678",
        institutionSymbol: "TXH",
        institutionName: "Houston Public Library",
        branchName: "Main Library",
        shelvingLocation: "General Collection",
        callNumber: "F .T47 2020",
      },
    ],
  };
}

/** Mock WorldCat empty bib search response. */
function createEmptyBibSearchResponse() {
  return {
    numberOfRecords: 0,
    bibRecords: [],
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("WorldCatAdapter", () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
    // Set up required env vars
    process.env["TEST_WORLDCAT_KEY"] = "test-client-key";
    process.env["TEST_WORLDCAT_SECRET"] = "test-client-secret";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    // Restore env
    delete process.env["TEST_WORLDCAT_KEY"];
    delete process.env["TEST_WORLDCAT_SECRET"];
    vi.restoreAllMocks();
  });

  it("authenticates via OAuth then searches and returns holdings", async () => {
    // Call 1: OAuth token
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(createTokenResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    // Call 2: Bib search
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(createBibSearchResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    // Call 3: Holdings for the bib
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(createHoldingsResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const adapter = new WorldCatAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(result.holdings).toHaveLength(2);
    expect(result.protocol).toBe("oclc_worldcat");

    // Verify token request
    const tokenCall = mockFetch.mock.calls[0];
    expect(tokenCall[0]).toBe("https://oauth.oclc.org/token");
    expect(tokenCall[1].method).toBe("POST");

    // Verify bib search request includes Bearer token
    const bibCall = mockFetch.mock.calls[1];
    expect(bibCall[0]).toContain("bn:9780306406157");
    expect(bibCall[1].headers.Authorization).toBe("Bearer test-access-token-abc123");

    // Verify holdings
    const h1 = result.holdings[0];
    expect(h1.isbn).toBe(TEST_ISBN);
    expect(h1.systemName).toBe("Austin Public Library");
    expect(h1.branchName).toBe("Central Branch");
    expect(h1.callNumber).toBe("F .T47 2020");
    expect(h1.collection).toBe("Adult Fiction");
    expect(h1.status).toBe("unknown"); // WorldCat does not provide real-time status

    const h2 = result.holdings[1];
    expect(h2.systemName).toBe("Houston Public Library");
    expect(h2.branchName).toBe("Main Library");
  });

  it("returns empty holdings when no bibs match the ISBN", async () => {
    // Token
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(createTokenResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    // Empty bib search
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(createEmptyBibSearchResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const adapter = new WorldCatAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(result.holdings).toHaveLength(0);
    // Should not have made a holdings request
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("caches the OAuth token and reuses it for subsequent calls", async () => {
    // First search: token + bib search + holdings
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(createTokenResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(createEmptyBibSearchResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const adapter = new WorldCatAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    await adapter.search(TEST_ISBN, TEST_SYSTEM);

    // Second search: should reuse cached token (no token request)
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(createEmptyBibSearchResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await adapter.search(TEST_ISBN, TEST_SYSTEM);

    // Total calls: 1 token + 1 bib + 1 bib (reused token) = 3
    expect(mockFetch).toHaveBeenCalledTimes(3);
    // Verify the 3rd call (second bib search) used the cached token
    const secondBibCall = mockFetch.mock.calls[2];
    expect(secondBibCall[1].headers.Authorization).toBe("Bearer test-access-token-abc123");
  });

  it("throws AdapterAuthError when OAuth token request fails", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    );

    const adapter = new WorldCatAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());

    await expect(adapter.search(TEST_ISBN, TEST_SYSTEM)).rejects.toThrow(
      /OAuth2 token request failed/,
    );
  });

  it("throws AdapterAuthError when bib search returns 401", async () => {
    // Token succeeds
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(createTokenResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    // Bib search returns 401
    mockFetch.mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    );

    const adapter = new WorldCatAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());

    await expect(adapter.search(TEST_ISBN, TEST_SYSTEM)).rejects.toThrow(
      /auth failed/,
    );
  });

  it("throws AdapterAuthError when env vars are missing during search", async () => {
    delete process.env["TEST_WORLDCAT_KEY"];

    const adapter = new WorldCatAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());

    // The credential check happens during token refresh (at search time),
    // not during constructor, so the error occurs when search() is called.
    await expect(adapter.search(TEST_ISBN, TEST_SYSTEM)).rejects.toThrow(
      /not found in env var/,
    );
  });

  it("maps institution symbols to system IDs when institutionSymbolMap is configured", async () => {
    const configWithMap: AdapterConfig = {
      ...TEST_CONFIG,
      extra: {
        institutionSymbolMap: {
          TXA: "austin-public",
          TXH: "houston-public",
        },
      },
    };

    // Token
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(createTokenResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    // Bib search
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(createBibSearchResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    // Holdings
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(createHoldingsResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const adapter = new WorldCatAdapter(TEST_SYSTEM, configWithMap, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(result.holdings).toHaveLength(2);
    // TXA mapped to austin-public
    expect(result.holdings[0].systemId).toBe("austin-public");
    // TXH mapped to houston-public
    expect(result.holdings[1].systemId).toBe("houston-public");
  });

  it("uses default systemId for unmapped institution symbols", async () => {
    const configWithMap: AdapterConfig = {
      ...TEST_CONFIG,
      extra: {
        institutionSymbolMap: {
          TXA: "austin-public",
          // TXH is NOT in the map
        },
      },
    };

    // Token
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(createTokenResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    // Bib search
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(createBibSearchResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    // Holdings
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(createHoldingsResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const adapter = new WorldCatAdapter(TEST_SYSTEM, configWithMap, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    expect(result.holdings).toHaveLength(2);
    // TXA mapped
    expect(result.holdings[0].systemId).toBe("austin-public");
    // TXH unmapped, falls back to adapter's own systemId
    expect(result.holdings[1].systemId).toBe("worldcat-test");
  });

  it("handles holdings endpoint returning non-200 gracefully", async () => {
    // Token
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(createTokenResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    // Bib search with one result
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(createBibSearchResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    // Holdings endpoint returns 500
    mockFetch.mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 }),
    );

    const adapter = new WorldCatAdapter(TEST_SYSTEM, TEST_CONFIG, createSilentLogger());
    const result = await adapter.search(TEST_ISBN, TEST_SYSTEM);

    // Should return empty holdings rather than throwing
    expect(result.holdings).toHaveLength(0);
  });
});
