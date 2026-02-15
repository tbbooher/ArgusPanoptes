// ---------------------------------------------------------------------------
// Result aggregation: deduplication, grouping, and summarisation.
// ---------------------------------------------------------------------------

import type {
  BookHolding,
  BranchAvailabilitySummary,
  BranchId,
  ISBN13,
  ItemStatus,
  LibrarySystemId,
  SystemAvailabilitySummary,
} from "../core/types.js";

// ── Aggregated result shape ────────────────────────────────────────────────

export interface AggregatedResult {
  /** Per-system availability summaries, sorted by available copies descending. */
  systems: SystemAvailabilitySummary[];
  /** Deduplicated holdings list. */
  holdings: BookHolding[];
  /** Total number of physical copies across all systems. */
  totalCopies: number;
  /** Total number of currently available copies. */
  totalAvailable: number;
}

// ── ResultAggregator ───────────────────────────────────────────────────────

/**
 * Deduplicates raw holdings (by fingerprint), groups them by library system,
 * and builds per-system availability summaries.
 */
export class ResultAggregator {
  /**
   * Aggregate a collection of raw holdings for a single ISBN.
   *
   * @param _isbn - The ISBN-13 the holdings relate to (for context; not
   *   currently used in the aggregation logic itself).
   * @param rawHoldings - Flat list of holdings collected from all adapters.
   * @returns An `AggregatedResult` with deduped holdings, per-system summaries,
   *   and totals.
   */
  aggregate(_isbn: ISBN13, rawHoldings: BookHolding[]): AggregatedResult {
    // 1. Deduplicate by fingerprint
    const deduped = this.deduplicateByFingerprint(rawHoldings);

    // 2. Remove WorldCat holdings for systems that have direct adapter results
    const afterCrossSourceDedup =
      this.deduplicateWorldCatOverlap(deduped);

    // 3. Group by system
    const bySystem = this.groupBySystem(afterCrossSourceDedup);

    // 4. Build per-system summaries
    const systems: SystemAvailabilitySummary[] = [];

    for (const [systemId, holdings] of bySystem) {
      systems.push(this.buildSystemSummary(systemId, holdings));
    }

    // 5. Sort by available copies descending
    systems.sort((a, b) => b.availableCopies - a.availableCopies);

    // 6. Compute totals
    let totalCopies = 0;
    let totalAvailable = 0;
    for (const sys of systems) {
      totalCopies += sys.totalCopies;
      totalAvailable += sys.availableCopies;
    }

    return {
      systems,
      holdings: afterCrossSourceDedup,
      totalCopies,
      totalAvailable,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────

  /**
   * Remove WorldCat holdings for systems that already have direct adapter
   * results.  WorldCat only provides "status unknown" so direct results
   * (with real-time availability) are always preferred.
   *
   * A holding is considered a WorldCat entry if its `rawStatus` contains
   * the marker string set by the WorldCat adapter.
   */
  private deduplicateWorldCatOverlap(holdings: BookHolding[]): BookHolding[] {
    // Collect systemIds that have at least one non-WorldCat holding.
    const directSystemIds = new Set<LibrarySystemId>();
    for (const h of holdings) {
      if (!this.isWorldCatHolding(h)) {
        directSystemIds.add(h.systemId);
      }
    }

    // If no direct results at all, keep everything.
    if (directSystemIds.size === 0) {
      return holdings;
    }

    // Drop WorldCat holdings whose mapped systemId overlaps with a
    // directly-queried system.
    return holdings.filter(
      (h) => !this.isWorldCatHolding(h) || !directSystemIds.has(h.systemId),
    );
  }

  private isWorldCatHolding(h: BookHolding): boolean {
    return h.rawStatus.includes("WorldCat holdings");
  }

  private deduplicateByFingerprint(holdings: BookHolding[]): BookHolding[] {
    const seen = new Set<string>();
    const result: BookHolding[] = [];

    for (const h of holdings) {
      if (!seen.has(h.fingerprint)) {
        seen.add(h.fingerprint);
        result.push(h);
      }
    }

    return result;
  }

  private groupBySystem(
    holdings: BookHolding[],
  ): Map<LibrarySystemId, BookHolding[]> {
    const map = new Map<LibrarySystemId, BookHolding[]>();

    for (const h of holdings) {
      let list = map.get(h.systemId);
      if (!list) {
        list = [];
        map.set(h.systemId, list);
      }
      list.push(h);
    }

    return map;
  }

  private buildSystemSummary(
    systemId: LibrarySystemId,
    holdings: BookHolding[],
  ): SystemAvailabilitySummary {
    // Group holdings by branch
    const byBranch = new Map<BranchId, BookHolding[]>();
    for (const h of holdings) {
      let list = byBranch.get(h.branchId);
      if (!list) {
        list = [];
        byBranch.set(h.branchId, list);
      }
      list.push(h);
    }

    const branches: BranchAvailabilitySummary[] = [];
    let totalCopies = 0;
    let availableCopies = 0;
    let checkedOutCopies = 0;
    let holdCount = 0;

    for (const [branchId, branchHoldings] of byBranch) {
      const first = branchHoldings[0];
      let branchCopies = 0;
      let branchAvailable = 0;

      for (const h of branchHoldings) {
        const copies = h.copyCount ?? 1;
        branchCopies += copies;
        if (this.isAvailable(h.status)) {
          branchAvailable += copies;
        }
        if (h.status === "checked_out") {
          checkedOutCopies += copies;
        }
        if (h.holdCount) {
          holdCount += h.holdCount;
        }
      }

      totalCopies += branchCopies;
      availableCopies += branchAvailable;

      branches.push({
        branchId,
        branchName: first.branchName,
        city: "", // city is not stored on BookHolding; leave blank
        copies: branchCopies,
        availableCopies: branchAvailable,
      });
    }

    // Derive systemName and catalogUrl from the first holding
    const firstHolding = holdings[0];

    return {
      systemId,
      systemName: firstHolding.systemName,
      totalCopies,
      availableCopies,
      checkedOutCopies,
      holdCount,
      branches,
      catalogUrl: firstHolding.catalogUrl,
    };
  }

  private isAvailable(status: ItemStatus): boolean {
    return status === "available";
  }
}
