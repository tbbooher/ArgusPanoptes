// ---------------------------------------------------------------------------
// Integration tests for the /libraries routes.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";

import { libraryRoutes } from "../../../src/api/routes/libraries.js";
import { HealthTracker } from "../../../src/cache/health-tracker.js";
import type {
  LibrarySystem,
  LibrarySystemId,
  BranchId,
} from "../../../src/core/types.js";

// ── Test fixtures ──────────────────────────────────────────────────────────

function createTestSystems(): LibrarySystem[] {
  return [
    {
      id: "austin-public" as LibrarySystemId,
      name: "Austin Public Library",
      vendor: "sirsi_dynix",
      region: "Travis County",
      catalogUrl: "https://library.austintexas.gov",
      branches: [
        {
          id: "austin-public:central" as BranchId,
          name: "Central Library",
          code: "central",
          city: "Austin",
        },
        {
          id: "austin-public:north-village" as BranchId,
          name: "North Village Branch",
          code: "north-village",
          city: "Austin",
        },
      ],
      adapters: [
        {
          protocol: "sirsi_enterprise_scrape",
          baseUrl: "https://library.austintexas.gov",
          timeoutMs: 10000,
          maxConcurrency: 2,
        },
      ],
      enabled: true,
    },
    {
      id: "houston-public" as LibrarySystemId,
      name: "Houston Public Library",
      vendor: "sirsi_dynix",
      region: "Harris County",
      catalogUrl: "https://houstonlibrary.org",
      branches: [
        {
          id: "houston-public:central" as BranchId,
          name: "Central Library",
          code: "central",
          city: "Houston",
        },
      ],
      adapters: [
        {
          protocol: "sirsi_enterprise_scrape",
          baseUrl: "https://houstonlibrary.org",
          timeoutMs: 10000,
          maxConcurrency: 2,
        },
      ],
      enabled: true,
    },
    {
      id: "koha-carrollton" as LibrarySystemId,
      name: "Carrollton Public Library",
      vendor: "koha",
      region: "Dallas County",
      catalogUrl: "https://koha.carrolltontx.gov/",
      branches: [],
      adapters: [
        {
          protocol: "koha_sru",
          baseUrl: "https://koha.carrolltontx.gov",
          timeoutMs: 10000,
          maxConcurrency: 2,
        },
      ],
      enabled: false,
    },
  ];
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("GET /libraries", () => {
  let app: ReturnType<typeof libraryRoutes>;
  let healthTracker: HealthTracker;
  let systems: LibrarySystem[];

  beforeEach(() => {
    healthTracker = new HealthTracker();
    systems = createTestSystems();
    app = libraryRoutes({ systems, healthTracker });
  });

  it("returns 200 with all library systems", async () => {
    const res = await app.request("/");

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("libraries");
    expect(body).toHaveProperty("total");
    expect(body.total).toBe(3);
    expect(body.libraries).toHaveLength(3);
  });

  it("returns the correct shape for each library in the list", async () => {
    const res = await app.request("/");
    const body = await res.json();

    const austin = body.libraries.find(
      (lib: any) => lib.id === "austin-public",
    );
    expect(austin).toBeDefined();
    expect(austin).toEqual({
      id: "austin-public",
      name: "Austin Public Library",
      vendor: "sirsi_dynix",
      region: "Travis County",
      catalogUrl: "https://library.austintexas.gov",
      branchCount: 2,
      enabled: true,
    });
  });

  it("filters by region query parameter", async () => {
    const res = await app.request("/?region=Harris%20County");

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.libraries).toHaveLength(1);
    expect(body.libraries[0].id).toBe("houston-public");
  });

  it("filters by region case-insensitively", async () => {
    const res = await app.request("/?region=dallas%20county");

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.libraries[0].id).toBe("koha-carrollton");
  });

  it("returns empty array when region filter matches no systems", async () => {
    const res = await app.request("/?region=nonexistent");

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.total).toBe(0);
    expect(body.libraries).toHaveLength(0);
  });

  it("returns application/json content type", async () => {
    const res = await app.request("/");

    expect(res.headers.get("content-type")).toContain("application/json");
  });
});

describe("GET /libraries/:id", () => {
  let app: ReturnType<typeof libraryRoutes>;
  let healthTracker: HealthTracker;
  let systems: LibrarySystem[];

  beforeEach(() => {
    healthTracker = new HealthTracker();
    systems = createTestSystems();
    app = libraryRoutes({ systems, healthTracker });
  });

  it("returns 200 with full library detail for a valid id", async () => {
    const res = await app.request("/austin-public");

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("library");
    expect(body).toHaveProperty("health");

    const lib = body.library;
    expect(lib.id).toBe("austin-public");
    expect(lib.name).toBe("Austin Public Library");
    expect(lib.vendor).toBe("sirsi_dynix");
    expect(lib.region).toBe("Travis County");
    expect(lib.catalogUrl).toBe("https://library.austintexas.gov");
    expect(lib.enabled).toBe(true);
    expect(lib.branches).toHaveLength(2);
    expect(lib.adapters).toHaveLength(1);
  });

  it("includes branch details in the response", async () => {
    const res = await app.request("/austin-public");
    const body = await res.json();

    const branches = body.library.branches;
    expect(branches[0]).toEqual({
      id: "austin-public:central",
      name: "Central Library",
      code: "central",
      city: "Austin",
    });
  });

  it("includes adapter config in the response (without secrets)", async () => {
    const res = await app.request("/austin-public");
    const body = await res.json();

    const adapter = body.library.adapters[0];
    expect(adapter.protocol).toBe("sirsi_enterprise_scrape");
    expect(adapter.baseUrl).toBe("https://library.austintexas.gov");
    expect(adapter.timeoutMs).toBe(10000);
    expect(adapter.maxConcurrency).toBe(2);
    // Ensure secrets are not exposed
    expect(adapter).not.toHaveProperty("clientKeyEnvVar");
    expect(adapter).not.toHaveProperty("clientSecretEnvVar");
  });

  it("returns health as null when no health data recorded", async () => {
    const res = await app.request("/austin-public");
    const body = await res.json();

    expect(body.health).toBeNull();
  });

  it("returns health data when system has health records", async () => {
    healthTracker.recordSuccess("austin-public" as LibrarySystemId, 120);

    const res = await app.request("/austin-public");
    const body = await res.json();

    expect(body.health).not.toBeNull();
    expect(body.health.successCount).toBe(1);
    expect(body.health.totalDurationMs).toBe(120);
  });

  it("returns 404 for a non-existent library id", async () => {
    const res = await app.request("/nonexistent-library");

    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(body.error).toBe("Library system not found");
    expect(body.type).toBe("not_found");
  });

  it("returns application/json even for 404 responses", async () => {
    const res = await app.request("/nonexistent-library");

    expect(res.headers.get("content-type")).toContain("application/json");
  });
});
