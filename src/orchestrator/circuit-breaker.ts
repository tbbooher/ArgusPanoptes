// ---------------------------------------------------------------------------
// Per-system circuit breaker with three states: closed, open, half_open.
// ---------------------------------------------------------------------------

/**
 * Possible states a circuit breaker can be in.
 *
 * - `closed`    -- normal operation; requests flow through.
 * - `open`      -- too many failures; requests are rejected immediately.
 * - `half_open` -- probe phase; one request is allowed through to test recovery.
 */
export type CircuitBreakerState = "closed" | "open" | "half_open";

/**
 * A lightweight circuit breaker scoped to a single library system.
 *
 * After `failureThreshold` consecutive failures the breaker **opens** and
 * stays open for `resetTimeoutMs` milliseconds.  After that window elapses
 * the breaker transitions to `half_open`, allowing a single probe request.
 *
 * - A successful probe transitions back to `closed`.
 * - A failed probe re-opens the breaker for another `resetTimeoutMs` window.
 */
export class CircuitBreaker {
  private state: CircuitBreakerState = "closed";
  private consecutiveFailures = 0;
  private lastFailureTime = 0;

  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;

  constructor(failureThreshold = 5, resetTimeoutMs = 60_000) {
    this.failureThreshold = failureThreshold;
    this.resetTimeoutMs = resetTimeoutMs;
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  /**
   * Returns `true` when the circuit is **open** (i.e. requests should be
   * short-circuited).  Automatically transitions from `open` to `half_open`
   * once the reset timeout has elapsed.
   */
  isOpen(): boolean {
    if (this.state === "open") {
      // Check if enough time has elapsed to transition to half_open.
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this.state = "half_open";
        return false; // allow one probe
      }
      return true;
    }
    return false;
  }

  /**
   * Returns the current state *after* applying any automatic transitions
   * (open -> half_open on timeout expiry).
   */
  getState(): CircuitBreakerState {
    // Calling isOpen() triggers the time-based transition if applicable.
    this.isOpen();
    return this.state;
  }

  // ── Mutations ────────────────────────────────────────────────────────────

  /**
   * Record a successful call.
   *
   * Resets the failure counter and transitions back to `closed`.
   */
  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = "closed";
  }

  /**
   * Record a failed call.
   *
   * Increments the consecutive-failure counter.  If the threshold is reached
   * the breaker transitions to `open`.  In the `half_open` state any failure
   * immediately re-opens the breaker.
   */
  recordFailure(): void {
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();

    if (this.state === "half_open") {
      // Probe failed -- re-open.
      this.state = "open";
      return;
    }

    if (this.consecutiveFailures >= this.failureThreshold) {
      this.state = "open";
    }
  }
}
