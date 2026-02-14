// ---------------------------------------------------------------------------
// Tests for the retry / exponential-backoff logic.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { withRetry } from "../../../src/orchestrator/retry.js";
import {
  AdapterConnectionError,
  AdapterTimeoutError,
  AdapterAuthError,
  AdapterRateLimitError,
  AdapterParseError,
} from "../../../src/core/errors.js";
import type { AdapterProtocol, LibrarySystemId } from "../../../src/core/types.js";

/** Helpers for creating branded error constructor arguments. */
const SYS = "test-system" as LibrarySystemId;
const PROTO = "sru" as AdapterProtocol;

/**
 * Create a function that throws on the first N calls and then resolves.
 * Using async functions with `throw` (not `Promise.reject`) avoids
 * unhandled-rejection warnings in vitest.
 */
function failThenSucceed(
  error: Error,
  failCount: number,
  successValue: string = "ok",
): () => Promise<string> {
  let calls = 0;
  return async () => {
    calls++;
    if (calls <= failCount) throw error;
    return successValue;
  };
}

/** Create a function that always throws the given error. */
function alwaysFail(error: Error): () => Promise<string> {
  return async () => {
    throw error;
  };
}

/**
 * Helper that calls withRetry expecting failure, advances all fake timers,
 * and returns the caught error. This avoids unhandled-rejection warnings
 * by immediately attaching a .catch() to the returned promise.
 */
async function expectRetryFailure(
  fn: () => Promise<string>,
  options: Parameters<typeof withRetry>[1],
): Promise<unknown> {
  let caughtError: unknown;
  const promise = withRetry(fn, options).catch((e) => {
    caughtError = e;
  });
  await vi.runAllTimersAsync();
  await promise;
  return caughtError;
}

describe("withRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Successful calls ──────────────────────────────────────────────────

  it("returns the result when the function succeeds on the first call", async () => {
    const fn = vi.fn(async () => "ok");
    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 100 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // ── Retries on transient errors ───────────────────────────────────────

  it("retries and succeeds after transient failures", async () => {
    const inner = failThenSucceed(
      new AdapterConnectionError("conn fail", SYS, PROTO),
      1,
      "recovered",
    );
    const fn = vi.fn(inner);

    const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on AdapterTimeoutError", async () => {
    const inner = failThenSucceed(
      new AdapterTimeoutError("timeout", SYS, PROTO),
      1,
    );
    const fn = vi.fn(inner);

    const promise = withRetry(fn, { maxRetries: 2, baseDelayMs: 10 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  // ── Stops after max retries ───────────────────────────────────────────

  it("throws after exhausting all retries", async () => {
    const fn = vi.fn(alwaysFail(new AdapterConnectionError("conn fail", SYS, PROTO)));

    const err = await expectRetryFailure(fn, { maxRetries: 2, baseDelayMs: 10 });

    expect(err).toBeInstanceOf(AdapterConnectionError);
    expect((err as Error).message).toBe("conn fail");
    // initial call + 2 retries = 3
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry when maxRetries is 0", async () => {
    const fn = vi.fn(alwaysFail(new AdapterConnectionError("fail", SYS, PROTO)));

    const err = await expectRetryFailure(fn, { maxRetries: 0, baseDelayMs: 10 });

    expect(err).toBeInstanceOf(AdapterConnectionError);
    expect((err as Error).message).toBe("fail");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // ── Non-retryable errors ──────────────────────────────────────────────

  it("does not retry AdapterAuthError (permanent failure)", async () => {
    const fn = vi.fn(alwaysFail(new AdapterAuthError("bad creds", SYS, PROTO)));

    const err = await expectRetryFailure(fn, { maxRetries: 5, baseDelayMs: 10 });

    expect(err).toBeInstanceOf(AdapterAuthError);
    expect((err as Error).message).toBe("bad creds");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry AdapterRateLimitError (permanent failure)", async () => {
    const fn = vi.fn(alwaysFail(new AdapterRateLimitError("rate limited", SYS, PROTO)));

    const err = await expectRetryFailure(fn, { maxRetries: 5, baseDelayMs: 10 });

    expect(err).toBeInstanceOf(AdapterRateLimitError);
    expect((err as Error).message).toBe("rate limited");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry AdapterParseError (permanent failure)", async () => {
    const fn = vi.fn(alwaysFail(new AdapterParseError("bad xml", SYS, PROTO)));

    const err = await expectRetryFailure(fn, { maxRetries: 5, baseDelayMs: 10 });

    expect(err).toBeInstanceOf(AdapterParseError);
    expect((err as Error).message).toBe("bad xml");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // ── Custom shouldRetry ────────────────────────────────────────────────

  it("uses a custom shouldRetry predicate when provided", async () => {
    const inner = failThenSucceed(new Error("custom transient"), 1);
    const fn = vi.fn(inner);

    const customShouldRetry = (error: unknown) =>
      error instanceof Error && error.message === "custom transient";

    const promise = withRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 10,
      shouldRetry: customShouldRetry,
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry when custom shouldRetry returns false", async () => {
    const fn = vi.fn(alwaysFail(new Error("non-retryable")));

    const err = await expectRetryFailure(fn, {
      maxRetries: 5,
      baseDelayMs: 10,
      shouldRetry: () => false,
    });

    expect((err as Error).message).toBe("non-retryable");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // ── Default: unknown errors are retried ───────────────────────────────

  it("retries unknown error types by default (non-adapter errors)", async () => {
    const inner = failThenSucceed(new Error("mysterious error"), 1);
    const fn = vi.fn(inner);

    const promise = withRetry(fn, { maxRetries: 2, baseDelayMs: 10 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
