// ---------------------------------------------------------------------------
// Tests for the ResultAggregator.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";

import { ResultAggregator } from "../../../src/orchestrator/result-aggregator.js";
import type {
  BookHolding,
  ISBN13,
  LibrarySystemId,
  BranchId,
  ItemStatus,
  MaterialType,
} from "../../../src/core/types.js";

const ISBN = "9780306406157" as ISBN13;

/** Helper to build a BookHolding with sensible defaults. */
function makeHolding(overrides: Partial<BookHolding> = {}): BookHolding {
  return {
    isbn: "9780306406157",
    systemId: "sys-a" as LibrarySystemId,
    branchId: "branch-1" as BranchId,
    systemName: "System A",
    branchName: "Main Branch",
    callNumber: "F GAT",
    status: "available" as ItemStatus,
    materialType: "book" as MaterialType,
    dueDate: null,
    holdCount: null,
    copyCount: 1,
    catalogUrl: "https://catalog.example.com",
    collection: "Fiction",
    volume: null,
    rawStatus: "Available",
    fingerprint: "fp-1",
    ...overrides,
  };
}

describe("ResultAggregator", () => {
  let aggregator: ResultAggregator;

  beforeEach(() => {
    aggregator = new ResultAggregator();
  });

  // ── Deduplication by fingerprint ──────────────────────────────────────

  it("deduplicates holdings with the same fingerprint", () => {
    const h1 = makeHolding({ fingerprint: "fp-same" });
    const h2 = makeHolding({ fingerprint: "fp-same" });
    const result = aggregator.aggregate(ISBN, [h1, h2]);
    expect(result.holdings.length).toBe(1);
  });

  it("keeps holdings with different fingerprints", () => {
    const h1 = makeHolding({ fingerprint: "fp-1" });
    const h2 = makeHolding({ fingerprint: "fp-2" });
    const result = aggregator.aggregate(ISBN, [h1, h2]);
    expect(result.holdings.length).toBe(2);
  });

  it("preserves the first occurrence during deduplication", () => {
    const h1 = makeHolding({ fingerprint: "fp-dup", branchName: "First" });
    const h2 = makeHolding({ fingerprint: "fp-dup", branchName: "Second" });
    const result = aggregator.aggregate(ISBN, [h1, h2]);
    expect(result.holdings[0].branchName).toBe("First");
  });

  // ── Grouping by system ────────────────────────────────────────────────

  it("groups holdings by library system", () => {
    const h1 = makeHolding({
      systemId: "sys-a" as LibrarySystemId,
      systemName: "System A",
      fingerprint: "fp-1",
    });
    const h2 = makeHolding({
      systemId: "sys-b" as LibrarySystemId,
      systemName: "System B",
      fingerprint: "fp-2",
    });
    const result = aggregator.aggregate(ISBN, [h1, h2]);
    expect(result.systems.length).toBe(2);

    const sysIds = result.systems.map((s) => s.systemId);
    expect(sysIds).toContain("sys-a");
    expect(sysIds).toContain("sys-b");
  });

  it("builds per-system summary with correct copy counts", () => {
    const h1 = makeHolding({
      fingerprint: "fp-1",
      copyCount: 2,
      status: "available" as ItemStatus,
    });
    const h2 = makeHolding({
      fingerprint: "fp-2",
      copyCount: 3,
      status: "checked_out" as ItemStatus,
    });
    const result = aggregator.aggregate(ISBN, [h1, h2]);
    const sys = result.systems[0];
    expect(sys.totalCopies).toBe(5);
  });

  // ── Sorting by availability ───────────────────────────────────────────

  it("sorts systems by available copies descending", () => {
    const h1 = makeHolding({
      systemId: "sys-low" as LibrarySystemId,
      systemName: "Low Avail",
      fingerprint: "fp-1",
      copyCount: 1,
      status: "available" as ItemStatus,
    });
    const h2 = makeHolding({
      systemId: "sys-high" as LibrarySystemId,
      systemName: "High Avail",
      fingerprint: "fp-2",
      copyCount: 5,
      status: "available" as ItemStatus,
    });
    const result = aggregator.aggregate(ISBN, [h1, h2]);
    expect(result.systems[0].systemId).toBe("sys-high");
    expect(result.systems[1].systemId).toBe("sys-low");
  });

  it("places systems with no available copies last", () => {
    const h1 = makeHolding({
      systemId: "sys-none" as LibrarySystemId,
      systemName: "No Avail",
      fingerprint: "fp-1",
      status: "checked_out" as ItemStatus,
    });
    const h2 = makeHolding({
      systemId: "sys-some" as LibrarySystemId,
      systemName: "Some Avail",
      fingerprint: "fp-2",
      status: "available" as ItemStatus,
    });
    const result = aggregator.aggregate(ISBN, [h1, h2]);
    expect(result.systems[0].systemId).toBe("sys-some");
    expect(result.systems[1].systemId).toBe("sys-none");
  });

  // ── Totals ────────────────────────────────────────────────────────────

  it("computes totalCopies across all systems", () => {
    const holdings = [
      makeHolding({ fingerprint: "fp-1", copyCount: 2, systemId: "sys-a" as LibrarySystemId }),
      makeHolding({ fingerprint: "fp-2", copyCount: 3, systemId: "sys-b" as LibrarySystemId, systemName: "System B" }),
    ];
    const result = aggregator.aggregate(ISBN, holdings);
    expect(result.totalCopies).toBe(5);
  });

  it("computes totalAvailable across all systems", () => {
    const holdings = [
      makeHolding({
        fingerprint: "fp-1",
        copyCount: 2,
        status: "available" as ItemStatus,
        systemId: "sys-a" as LibrarySystemId,
      }),
      makeHolding({
        fingerprint: "fp-2",
        copyCount: 3,
        status: "checked_out" as ItemStatus,
        systemId: "sys-b" as LibrarySystemId,
        systemName: "System B",
      }),
    ];
    const result = aggregator.aggregate(ISBN, holdings);
    expect(result.totalAvailable).toBe(2);
  });

  // ── Empty input ───────────────────────────────────────────────────────

  it("handles empty holdings array", () => {
    const result = aggregator.aggregate(ISBN, []);
    expect(result.holdings).toEqual([]);
    expect(result.systems).toEqual([]);
    expect(result.totalCopies).toBe(0);
    expect(result.totalAvailable).toBe(0);
  });

  // ── Branch-level detail ───────────────────────────────────────────────

  it("provides branch-level summaries within a system", () => {
    const h1 = makeHolding({
      fingerprint: "fp-1",
      branchId: "branch-1" as BranchId,
      branchName: "Downtown",
    });
    const h2 = makeHolding({
      fingerprint: "fp-2",
      branchId: "branch-2" as BranchId,
      branchName: "Westside",
    });
    const result = aggregator.aggregate(ISBN, [h1, h2]);
    const sys = result.systems[0];
    expect(sys.branches.length).toBe(2);
    const branchNames = sys.branches.map((b) => b.branchName);
    expect(branchNames).toContain("Downtown");
    expect(branchNames).toContain("Westside");
  });

  // ── Hold count accumulation ───────────────────────────────────────────

  it("accumulates hold counts across holdings in a system", () => {
    const h1 = makeHolding({ fingerprint: "fp-1", holdCount: 2 });
    const h2 = makeHolding({ fingerprint: "fp-2", holdCount: 3 });
    const result = aggregator.aggregate(ISBN, [h1, h2]);
    expect(result.systems[0].holdCount).toBe(5);
  });

  // ── Checked-out count ─────────────────────────────────────────────────

  it("counts checked-out copies correctly", () => {
    const h1 = makeHolding({
      fingerprint: "fp-1",
      status: "checked_out" as ItemStatus,
      copyCount: 2,
    });
    const h2 = makeHolding({
      fingerprint: "fp-2",
      status: "available" as ItemStatus,
      copyCount: 1,
    });
    const result = aggregator.aggregate(ISBN, [h1, h2]);
    expect(result.systems[0].checkedOutCopies).toBe(2);
  });

  // ── copyCount defaults to 1 when null ─────────────────────────────────

  it("defaults copyCount to 1 when it is null", () => {
    const h = makeHolding({ fingerprint: "fp-1", copyCount: null });
    const result = aggregator.aggregate(ISBN, [h]);
    expect(result.totalCopies).toBe(1);
  });

  // ── WorldCat cross-source deduplication ─────────────────────────────

  describe("WorldCat cross-source dedup", () => {
    const WORLDCAT_RAW_STATUS =
      "WorldCat holdings - real-time status unavailable";

    it("removes WorldCat holdings when direct results exist for the same systemId", () => {
      const direct = makeHolding({
        systemId: "houston-public" as LibrarySystemId,
        fingerprint: "fp-direct-1",
        rawStatus: "Available",
        status: "available" as ItemStatus,
      });
      const worldcat = makeHolding({
        systemId: "houston-public" as LibrarySystemId,
        fingerprint: "fp-wc-1",
        rawStatus: WORLDCAT_RAW_STATUS,
        status: "unknown" as ItemStatus,
      });

      const result = aggregator.aggregate(ISBN, [direct, worldcat]);
      expect(result.holdings).toHaveLength(1);
      expect(result.holdings[0].fingerprint).toBe("fp-direct-1");
    });

    it("keeps WorldCat holdings for systems without direct results", () => {
      const directHouston = makeHolding({
        systemId: "houston-public" as LibrarySystemId,
        fingerprint: "fp-direct-1",
        rawStatus: "Available",
      });
      const worldcatRural = makeHolding({
        systemId: "worldcat-texas" as LibrarySystemId,
        fingerprint: "fp-wc-rural",
        rawStatus: WORLDCAT_RAW_STATUS,
        status: "unknown" as ItemStatus,
        systemName: "Small Town Library",
      });

      const result = aggregator.aggregate(ISBN, [directHouston, worldcatRural]);
      expect(result.holdings).toHaveLength(2);
      const sysIds = result.systems.map((s) => s.systemId);
      expect(sysIds).toContain("houston-public");
      expect(sysIds).toContain("worldcat-texas");
    });

    it("keeps all WorldCat holdings when no direct results exist", () => {
      const wc1 = makeHolding({
        systemId: "worldcat-texas" as LibrarySystemId,
        fingerprint: "fp-wc-1",
        rawStatus: WORLDCAT_RAW_STATUS,
      });
      const wc2 = makeHolding({
        systemId: "worldcat-texas" as LibrarySystemId,
        fingerprint: "fp-wc-2",
        rawStatus: WORLDCAT_RAW_STATUS,
      });

      const result = aggregator.aggregate(ISBN, [wc1, wc2]);
      expect(result.holdings).toHaveLength(2);
    });

    it("handles mixed direct and WorldCat for multiple systems", () => {
      const directHouston = makeHolding({
        systemId: "houston-public" as LibrarySystemId,
        fingerprint: "fp-d-hou",
        rawStatus: "Available",
      });
      const wcHouston = makeHolding({
        systemId: "houston-public" as LibrarySystemId,
        fingerprint: "fp-wc-hou",
        rawStatus: WORLDCAT_RAW_STATUS,
      });
      const wcAustin = makeHolding({
        systemId: "austin-public" as LibrarySystemId,
        fingerprint: "fp-wc-aus",
        rawStatus: WORLDCAT_RAW_STATUS,
        systemName: "Austin Public Library",
      });

      const result = aggregator.aggregate(ISBN, [
        directHouston,
        wcHouston,
        wcAustin,
      ]);

      // WorldCat Houston dropped (direct exists), WorldCat Austin kept
      expect(result.holdings).toHaveLength(2);
      const fps = result.holdings.map((h) => h.fingerprint);
      expect(fps).toContain("fp-d-hou");
      expect(fps).toContain("fp-wc-aus");
      expect(fps).not.toContain("fp-wc-hou");
    });
  });
});
