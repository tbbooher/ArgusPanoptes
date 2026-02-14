// ---------------------------------------------------------------------------
// Per-system health tracking.
// ---------------------------------------------------------------------------

import type { LibrarySystemId } from "../core/types.js";

/**
 * Point-in-time health snapshot for a single library system.
 */
export interface SystemHealthSnapshot {
  systemId: string;
  lastSuccessTime: string | null;
  lastFailureTime: string | null;
  lastErrorMessage: string | null;
  successCount: number;
  failureCount: number;
  totalDurationMs: number;
}

/** Mutable internal record used while tracking. */
interface HealthRecord {
  systemId: string;
  lastSuccessTime: string | null;
  lastFailureTime: string | null;
  lastErrorMessage: string | null;
  successCount: number;
  failureCount: number;
  totalDurationMs: number;
}

/**
 * Tracks per-library-system health (success / failure counts, latency,
 * most recent error, etc.).
 */
export class HealthTracker {
  private readonly records = new Map<string, HealthRecord>();

  recordSuccess(systemId: LibrarySystemId, durationMs: number): void {
    const rec = this.getOrCreate(systemId);
    rec.successCount++;
    rec.totalDurationMs += durationMs;
    rec.lastSuccessTime = new Date().toISOString();
  }

  recordFailure(
    systemId: LibrarySystemId,
    error: string,
    durationMs: number,
  ): void {
    const rec = this.getOrCreate(systemId);
    rec.failureCount++;
    rec.totalDurationMs += durationMs;
    rec.lastFailureTime = new Date().toISOString();
    rec.lastErrorMessage = error;
  }

  getSystemHealth(systemId: LibrarySystemId): SystemHealthSnapshot | null {
    const rec = this.records.get(systemId as string);
    if (!rec) return null;
    return { ...rec };
  }

  getAllHealth(): Map<string, SystemHealthSnapshot> {
    const result = new Map<string, SystemHealthSnapshot>();
    for (const [key, rec] of this.records) {
      result.set(key, { ...rec });
    }
    return result;
  }

  getSuccessRate(systemId: LibrarySystemId): number {
    const rec = this.records.get(systemId as string);
    if (!rec) return 0;

    const total = rec.successCount + rec.failureCount;
    if (total === 0) return 0;

    return rec.successCount / total;
  }

  private getOrCreate(systemId: LibrarySystemId): HealthRecord {
    const key = systemId as string;
    let rec = this.records.get(key);

    if (!rec) {
      rec = {
        systemId: key,
        lastSuccessTime: null,
        lastFailureTime: null,
        lastErrorMessage: null,
        successCount: 0,
        failureCount: 0,
        totalDurationMs: 0,
      };
      this.records.set(key, rec);
    }

    return rec;
  }
}
