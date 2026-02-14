// ---------------------------------------------------------------------------
// Integration tests for the /search routes.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";

import { searchRoutes } from "../../../src/api/routes/search.js";
import { errorHandler } from "../../../src/api/middleware/error-handler.js";
import type { SearchCoordinator } from "../../../src/orchestrator/search-coordinator.js";
import type { SearchResult, ISBN13 } from "../../../src/core/types.js";
import pino from "pino";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Create a silent pino logger for testing. */
function createTestLogger() {
  return pino({ level: "silent" });
}

/** Build a mock SearchResult matching the actual type. */
function createMockSearchResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    searchId: "test-search-id",
    isbn: "9780306406157",
    normalizedISBN13: "9780306406157",
    startedAt: "2024-01-01T00:00:00.000Z",
    completedAt: "2024-01-01T00:00:01.000Z",
    holdings: [],
    errors: [],
    systemsSearched: 5,
    systemsSucceeded: 5,
    systemsFailed: 0,
    systemsTimedOut: 0,
    isPartial: false,
    fromCache: false,
    ...overrides,
  };
}

/**
 * Create a Hono app wrapping the search routes with the error handler,
 * mirroring how server.ts mounts them.
 */
function createTestApp(mockCoordinator: Partial<SearchCoordinator>) {
  const app = new Hono();
  app.route(
    "/search",
    searchRoutes({
      searchCoordinator: mockCoordinator as SearchCoordinator,
      logger: createTestLogger(),
    }),
  );
  app.onError(errorHandler);
  return app;
}

// ── Tests: GET /search?isbn= ─────────────────────────────────────────────

describe("GET /search?isbn=", () => {
  let mockSearch: ReturnType<typeof vi.fn>;
  let app: Hono;

  beforeEach(() => {
    mockSearch = vi.fn();
    app = createTestApp({ search: mockSearch });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 200 with a SearchResult for a valid ISBN-13", async () => {
    const expectedResult = createMockSearchResult({
      holdings: [
        {
          isbn: "9780306406157",
          systemId: "test-system" as any,
          branchId: "test-branch" as any,
          systemName: "Test Library",
          branchName: "Main Branch",
          callNumber: "QA76.73",
          status: "available",
          materialType: "book",
          dueDate: null,
          holdCount: null,
          copyCount: 2,
          catalogUrl: "https://test.library.org",
          collection: "General",
          volume: null,
          rawStatus: "Available",
          fingerprint: "test:9780306406157:main:qa76.73",
        },
      ],
    });

    mockSearch.mockResolvedValueOnce(expectedResult);

    const res = await app.request("/search?isbn=9780306406157");

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("searchId");
    expect(body).toHaveProperty("isbn", "9780306406157");
    expect(body).toHaveProperty("normalizedISBN13", "9780306406157");
    expect(body).toHaveProperty("startedAt");
    expect(body).toHaveProperty("completedAt");
    expect(body).toHaveProperty("holdings");
    expect(body).toHaveProperty("errors");
    expect(body).toHaveProperty("systemsSearched");
    expect(body).toHaveProperty("systemsSucceeded");
    expect(body).toHaveProperty("systemsFailed");
    expect(body).toHaveProperty("systemsTimedOut");
    expect(body).toHaveProperty("isPartial");
    expect(body).toHaveProperty("fromCache");

    expect(body.holdings).toHaveLength(1);
    expect(body.holdings[0].systemName).toBe("Test Library");
    expect(body.holdings[0].status).toBe("available");
  });

  it("accepts a valid ISBN-10 and passes the converted ISBN-13 to coordinator", async () => {
    mockSearch.mockResolvedValueOnce(createMockSearchResult());

    const res = await app.request("/search?isbn=0306406152");

    expect(res.status).toBe(200);
    expect(mockSearch).toHaveBeenCalledTimes(1);

    // parseISBN("0306406152") converts to ISBN-13 "9780306406157"
    const [isbn13Arg] = mockSearch.mock.calls[0];
    expect(isbn13Arg).toBe("9780306406157");
  });

  it("accepts a hyphenated ISBN and strips formatting", async () => {
    mockSearch.mockResolvedValueOnce(createMockSearchResult());

    const res = await app.request("/search?isbn=978-0-306-40615-7");

    expect(res.status).toBe(200);
    expect(mockSearch).toHaveBeenCalledTimes(1);

    const [isbn13Arg] = mockSearch.mock.calls[0];
    expect(isbn13Arg).toBe("9780306406157");
  });

  it("returns 400 when isbn query parameter is missing", async () => {
    const res = await app.request("/search");

    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(body.error).toContain("isbn");
    expect(body.type).toBe("validation_error");
  });

  it("returns 400 for an ISBN with invalid check digit", async () => {
    const res = await app.request("/search?isbn=9780306406158");

    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(body.type).toBe("isbn_validation_error");
  });

  it("returns 400 for an ISBN that is too short", async () => {
    const res = await app.request("/search?isbn=12345");

    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(body.type).toBe("isbn_validation_error");
  });

  it("returns 400 for an ISBN with invalid characters", async () => {
    const res = await app.request("/search?isbn=978030640615Z");

    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(body.type).toBe("isbn_validation_error");
  });

  it("passes a unique searchId to the coordinator on each call", async () => {
    mockSearch.mockResolvedValue(createMockSearchResult());

    await app.request("/search?isbn=9780306406157");
    await app.request("/search?isbn=9780306406157");

    expect(mockSearch).toHaveBeenCalledTimes(2);

    const searchId1 = mockSearch.mock.calls[0][1];
    const searchId2 = mockSearch.mock.calls[1][1];
    expect(searchId1).not.toBe(searchId2);
    // Verify they look like UUIDs
    expect(searchId1).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("returns application/json content type", async () => {
    mockSearch.mockResolvedValueOnce(createMockSearchResult());

    const res = await app.request("/search?isbn=9780306406157");

    expect(res.headers.get("content-type")).toContain("application/json");
  });
});

// ── Tests: POST /search (async) ──────────────────────────────────────────

describe("POST /search", () => {
  let mockSearch: ReturnType<typeof vi.fn>;
  let app: Hono;

  beforeEach(() => {
    mockSearch = vi.fn();
    app = createTestApp({ search: mockSearch });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 202 with searchId and pending status for a valid ISBN", async () => {
    // Make the search take a while so we can observe the 202 response
    mockSearch.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(createMockSearchResult()), 100)),
    );

    const res = await app.request("/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isbn: "9780306406157" }),
    });

    expect(res.status).toBe(202);

    const body = await res.json();
    expect(body).toHaveProperty("searchId");
    expect(body).toHaveProperty("status", "pending");
    expect(typeof body.searchId).toBe("string");
  });

  it("returns 400 when body is invalid JSON", async () => {
    const res = await app.request("/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });

    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.type).toBe("validation_error");
  });

  it("returns 400 when isbn field is missing from body", async () => {
    const res = await app.request("/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "something" }),
    });

    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain("isbn");
    expect(body.type).toBe("validation_error");
  });

  it("returns 400 for an invalid ISBN in POST body", async () => {
    const res = await app.request("/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isbn: "invalid-isbn" }),
    });

    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.type).toBe("isbn_validation_error");
  });
});

// ── Tests: GET /search/:searchId ──────────────────────────────────────────

describe("GET /search/:searchId", () => {
  let mockSearch: ReturnType<typeof vi.fn>;
  let app: Hono;

  beforeEach(() => {
    mockSearch = vi.fn();
    app = createTestApp({ search: mockSearch });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 400 for a non-UUID searchId format", async () => {
    const res = await app.request("/search/nonexistent-search-id");

    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(body.error).toBe("Invalid search ID format");
    expect(body.type).toBe("validation_error");
  });

  it("returns 404 for a valid UUID that does not exist", async () => {
    const res = await app.request(
      "/search/00000000-0000-0000-0000-000000000000",
    );

    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(body.error).toBe("Search not found");
    expect(body.type).toBe("not_found");
  });

  it("returns pending status for an in-progress search", async () => {
    // Create a search that never resolves within the test
    let resolveSearch: (value: SearchResult) => void;
    mockSearch.mockImplementation(
      () =>
        new Promise<SearchResult>((resolve) => {
          resolveSearch = resolve;
        }),
    );

    // Initiate async search via POST
    const postRes = await app.request("/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isbn: "9780306406157" }),
    });

    const { searchId } = await postRes.json();

    // Poll for the result -- should be pending
    const pollRes = await app.request(`/search/${searchId}`);

    expect(pollRes.status).toBe(200);

    const body = await pollRes.json();
    expect(body).toHaveProperty("searchId", searchId);
    expect(body).toHaveProperty("status", "pending");

    // Resolve the search to prevent dangling promise
    resolveSearch!(createMockSearchResult());
  });

  it("returns the completed result after search finishes", async () => {
    const expectedResult = createMockSearchResult({
      holdings: [
        {
          isbn: "9780306406157",
          systemId: "test-system" as any,
          branchId: "test-branch" as any,
          systemName: "Test Library",
          branchName: "Main Branch",
          callNumber: "QA76.73",
          status: "available",
          materialType: "book",
          dueDate: null,
          holdCount: null,
          copyCount: 1,
          catalogUrl: "https://test.library.org",
          collection: "",
          volume: null,
          rawStatus: "Available",
          fingerprint: "test:fp",
        },
      ],
    });

    mockSearch.mockResolvedValueOnce(expectedResult);

    // Initiate async search
    const postRes = await app.request("/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isbn: "9780306406157" }),
    });

    const { searchId } = await postRes.json();

    // Wait for the background search to finish
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Poll for the result
    const pollRes = await app.request(`/search/${searchId}`);

    expect(pollRes.status).toBe(200);

    const body = await pollRes.json();
    expect(body).toHaveProperty("searchId");
    expect(body).toHaveProperty("holdings");
    expect(body.holdings).toHaveLength(1);
  });
});
