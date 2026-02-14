// ---------------------------------------------------------------------------
// Tests for the CircuitBreaker state machine.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { CircuitBreaker } from "../../../src/orchestrator/circuit-breaker.js";

describe("CircuitBreaker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Initial state ───────────────────────────────────────────────────────

  it("starts in CLOSED state", () => {
    const cb = new CircuitBreaker();
    expect(cb.getState()).toBe("closed");
  });

  it("isOpen returns false when CLOSED", () => {
    const cb = new CircuitBreaker();
    expect(cb.isOpen()).toBe(false);
  });

  // ── CLOSED -> OPEN after threshold failures ─────────────────────────────

  it("stays CLOSED when failures are below the threshold", () => {
    const cb = new CircuitBreaker(3, 1000);
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe("closed");
  });

  it("transitions from CLOSED to OPEN after reaching the failure threshold", () => {
    const cb = new CircuitBreaker(3, 1000);
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe("open");
  });

  it("isOpen returns true when OPEN and timeout has not elapsed", () => {
    const cb = new CircuitBreaker(2, 5000);
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.isOpen()).toBe(true);
  });

  it("rejects conceptually when OPEN (isOpen is true)", () => {
    const cb = new CircuitBreaker(1, 60_000);
    cb.recordFailure();
    expect(cb.getState()).toBe("open");
    expect(cb.isOpen()).toBe(true);
  });

  // ── OPEN -> HALF_OPEN after timeout ─────────────────────────────────────

  it("transitions from OPEN to HALF_OPEN after resetTimeoutMs elapses", () => {
    const cb = new CircuitBreaker(2, 1000);
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe("open");

    vi.advanceTimersByTime(1000);
    expect(cb.getState()).toBe("half_open");
  });

  it("isOpen returns false once timeout elapses (allows probe)", () => {
    const cb = new CircuitBreaker(2, 500);
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.isOpen()).toBe(true);

    vi.advanceTimersByTime(500);
    expect(cb.isOpen()).toBe(false);
  });

  // ── HALF_OPEN -> CLOSED on success ──────────────────────────────────────

  it("transitions from HALF_OPEN to CLOSED on a successful probe", () => {
    const cb = new CircuitBreaker(2, 1000);
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe("open");

    vi.advanceTimersByTime(1000);
    expect(cb.getState()).toBe("half_open");

    cb.recordSuccess();
    expect(cb.getState()).toBe("closed");
  });

  // ── HALF_OPEN -> OPEN on failure ────────────────────────────────────────

  it("transitions from HALF_OPEN back to OPEN on a failed probe", () => {
    const cb = new CircuitBreaker(2, 1000);
    cb.recordFailure();
    cb.recordFailure();

    vi.advanceTimersByTime(1000);
    expect(cb.getState()).toBe("half_open");

    cb.recordFailure();
    expect(cb.getState()).toBe("open");
  });

  // ── Success resets failure count ────────────────────────────────────────

  it("resets the failure counter on success so subsequent failures start from zero", () => {
    const cb = new CircuitBreaker(3, 1000);
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();

    // Two more failures should not open (only 2, not 3)
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe("closed");

    // Third failure after reset opens it
    cb.recordFailure();
    expect(cb.getState()).toBe("open");
  });

  // ── Full cycle ──────────────────────────────────────────────────────────

  it("completes a full cycle: closed -> open -> half_open -> closed", () => {
    const cb = new CircuitBreaker(1, 200);

    expect(cb.getState()).toBe("closed");

    cb.recordFailure();
    expect(cb.getState()).toBe("open");

    vi.advanceTimersByTime(200);
    expect(cb.getState()).toBe("half_open");

    cb.recordSuccess();
    expect(cb.getState()).toBe("closed");
  });

  // ── Default constructor parameters ──────────────────────────────────────

  it("uses default failureThreshold=5 and resetTimeoutMs=60000", () => {
    const cb = new CircuitBreaker();
    for (let i = 0; i < 4; i++) cb.recordFailure();
    expect(cb.getState()).toBe("closed");

    cb.recordFailure(); // 5th
    expect(cb.getState()).toBe("open");

    vi.advanceTimersByTime(59_999);
    expect(cb.getState()).toBe("open");

    vi.advanceTimersByTime(1);
    expect(cb.getState()).toBe("half_open");
  });
});
