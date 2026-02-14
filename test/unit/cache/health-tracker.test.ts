// ---------------------------------------------------------------------------
// Tests for the HealthTracker.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";

import { HealthTracker } from "../../../src/cache/health-tracker.js";
import type { LibrarySystemId } from "../../../src/core/types.js";

/** Helper to create a branded LibrarySystemId. */
const sysId = (id: string) => id as LibrarySystemId;

describe("HealthTracker", () => {
  let tracker: HealthTracker;

  beforeEach(() => {
    tracker = new HealthTracker();
  });

  // ── recordSuccess ─────────────────────────────────────────────────────

  it("records a success and increments the success counter", () => {
    tracker.recordSuccess(sysId("sys-a"), 100);
    const h = tracker.getSystemHealth(sysId("sys-a"));
    expect(h).not.toBeNull();
    expect(h!.successCount).toBe(1);
  });

  it("accumulates multiple successes", () => {
    tracker.recordSuccess(sysId("sys-a"), 50);
    tracker.recordSuccess(sysId("sys-a"), 75);
    const h = tracker.getSystemHealth(sysId("sys-a"));
    expect(h!.successCount).toBe(2);
  });

  it("records lastSuccessTime as an ISO timestamp", () => {
    tracker.recordSuccess(sysId("sys-a"), 10);
    const h = tracker.getSystemHealth(sysId("sys-a"));
    expect(h!.lastSuccessTime).not.toBeNull();
    // Should be parseable as a date
    expect(new Date(h!.lastSuccessTime!).getTime()).not.toBeNaN();
  });

  it("accumulates totalDurationMs on success", () => {
    tracker.recordSuccess(sysId("sys-a"), 100);
    tracker.recordSuccess(sysId("sys-a"), 200);
    const h = tracker.getSystemHealth(sysId("sys-a"));
    expect(h!.totalDurationMs).toBe(300);
  });

  // ── recordFailure ─────────────────────────────────────────────────────

  it("records a failure and increments the failure counter", () => {
    tracker.recordFailure(sysId("sys-a"), "timeout", 500);
    const h = tracker.getSystemHealth(sysId("sys-a"));
    expect(h).not.toBeNull();
    expect(h!.failureCount).toBe(1);
  });

  it("accumulates multiple failures", () => {
    tracker.recordFailure(sysId("sys-a"), "err1", 100);
    tracker.recordFailure(sysId("sys-a"), "err2", 200);
    const h = tracker.getSystemHealth(sysId("sys-a"));
    expect(h!.failureCount).toBe(2);
  });

  it("stores the last error message", () => {
    tracker.recordFailure(sysId("sys-a"), "first error", 100);
    tracker.recordFailure(sysId("sys-a"), "second error", 100);
    const h = tracker.getSystemHealth(sysId("sys-a"));
    expect(h!.lastErrorMessage).toBe("second error");
  });

  it("records lastFailureTime as an ISO timestamp", () => {
    tracker.recordFailure(sysId("sys-a"), "err", 10);
    const h = tracker.getSystemHealth(sysId("sys-a"));
    expect(h!.lastFailureTime).not.toBeNull();
    expect(new Date(h!.lastFailureTime!).getTime()).not.toBeNaN();
  });

  it("accumulates totalDurationMs on failure", () => {
    tracker.recordFailure(sysId("sys-a"), "err", 150);
    tracker.recordFailure(sysId("sys-a"), "err", 250);
    const h = tracker.getSystemHealth(sysId("sys-a"));
    expect(h!.totalDurationMs).toBe(400);
  });

  // ── getSystemHealth ───────────────────────────────────────────────────

  it("returns null for an untracked system", () => {
    expect(tracker.getSystemHealth(sysId("unknown"))).toBeNull();
  });

  it("returns a snapshot with correct initial values", () => {
    tracker.recordSuccess(sysId("sys-a"), 50);
    const h = tracker.getSystemHealth(sysId("sys-a"))!;
    expect(h.systemId).toBe("sys-a");
    expect(h.successCount).toBe(1);
    expect(h.failureCount).toBe(0);
    expect(h.lastFailureTime).toBeNull();
    expect(h.lastErrorMessage).toBeNull();
  });

  it("returns a defensive copy (mutations do not affect tracker)", () => {
    tracker.recordSuccess(sysId("sys-a"), 10);
    const snap = tracker.getSystemHealth(sysId("sys-a"))!;
    snap.successCount = 999;
    expect(tracker.getSystemHealth(sysId("sys-a"))!.successCount).toBe(1);
  });

  // ── getSuccessRate ────────────────────────────────────────────────────

  it("returns 0 for an untracked system", () => {
    expect(tracker.getSuccessRate(sysId("unknown"))).toBe(0);
  });

  it("returns 1 when all calls succeed", () => {
    tracker.recordSuccess(sysId("sys-a"), 10);
    tracker.recordSuccess(sysId("sys-a"), 20);
    expect(tracker.getSuccessRate(sysId("sys-a"))).toBe(1);
  });

  it("returns 0 when all calls fail", () => {
    tracker.recordFailure(sysId("sys-a"), "e1", 10);
    tracker.recordFailure(sysId("sys-a"), "e2", 10);
    expect(tracker.getSuccessRate(sysId("sys-a"))).toBe(0);
  });

  it("calculates the correct success rate with mixed results", () => {
    tracker.recordSuccess(sysId("sys-a"), 10);
    tracker.recordSuccess(sysId("sys-a"), 10);
    tracker.recordFailure(sysId("sys-a"), "err", 10);
    // 2 successes / 3 total
    expect(tracker.getSuccessRate(sysId("sys-a"))).toBeCloseTo(2 / 3);
  });

  // ── getAllHealth ───────────────────────────────────────────────────────

  it("returns all tracked systems", () => {
    tracker.recordSuccess(sysId("sys-a"), 10);
    tracker.recordFailure(sysId("sys-b"), "err", 20);
    const all = tracker.getAllHealth();
    expect(all.size).toBe(2);
    expect(all.has("sys-a")).toBe(true);
    expect(all.has("sys-b")).toBe(true);
  });

  // ── Isolation between systems ─────────────────────────────────────────

  it("tracks systems independently", () => {
    tracker.recordSuccess(sysId("sys-a"), 10);
    tracker.recordFailure(sysId("sys-b"), "err", 20);

    expect(tracker.getSystemHealth(sysId("sys-a"))!.successCount).toBe(1);
    expect(tracker.getSystemHealth(sysId("sys-a"))!.failureCount).toBe(0);
    expect(tracker.getSystemHealth(sysId("sys-b"))!.successCount).toBe(0);
    expect(tracker.getSystemHealth(sysId("sys-b"))!.failureCount).toBe(1);
  });
});
