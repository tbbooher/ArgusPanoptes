// ---------------------------------------------------------------------------
// Integration tests for the /health routes.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";

import { healthRoutes } from "../../../src/api/routes/health.js";
import { HealthTracker } from "../../../src/cache/health-tracker.js";
import { MetricsCollector } from "../../../src/metrics/metrics-collector.js";
import type { LibrarySystemId } from "../../../src/core/types.js";

describe("GET /health", () => {
  let app: ReturnType<typeof healthRoutes>;
  let healthTracker: HealthTracker;
  let metricsCollector: MetricsCollector;

  beforeEach(() => {
    healthTracker = new HealthTracker();
    metricsCollector = new MetricsCollector({ enabled: false, reportIntervalMs: 0 });
    app = healthRoutes({ healthTracker, metricsCollector });
  });

  it("returns 200 with status ok, uptime, and timestamp", async () => {
    const res = await app.request("/");

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("status", "ok");
    expect(body).toHaveProperty("uptime");
    expect(typeof body.uptime).toBe("number");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(body).toHaveProperty("timestamp");
    expect(typeof body.timestamp).toBe("string");
    // Verify timestamp is a valid ISO 8601 string
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });

  it("returns application/json content type", async () => {
    const res = await app.request("/");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});

describe("GET /health/systems", () => {
  let app: ReturnType<typeof healthRoutes>;
  let healthTracker: HealthTracker;
  let metricsCollector: MetricsCollector;

  beforeEach(() => {
    healthTracker = new HealthTracker();
    metricsCollector = new MetricsCollector({ enabled: false, reportIntervalMs: 0 });
    app = healthRoutes({ healthTracker, metricsCollector });
  });

  it("returns 200 with an empty systems object when no systems tracked", async () => {
    const res = await app.request("/systems");

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("systems");
    expect(typeof body.systems).toBe("object");
    expect(Object.keys(body.systems)).toHaveLength(0);
  });

  it("returns system health data after recording successes and failures", async () => {
    const systemId = "test-library" as LibrarySystemId;
    healthTracker.recordSuccess(systemId, 150);
    healthTracker.recordSuccess(systemId, 200);
    healthTracker.recordFailure(systemId, "Connection timeout", 5000);

    const res = await app.request("/systems");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.systems).toHaveProperty("test-library");

    const systemHealth = body.systems["test-library"];
    expect(systemHealth.successCount).toBe(2);
    expect(systemHealth.failureCount).toBe(1);
    expect(systemHealth.totalDurationMs).toBe(5350);
    expect(systemHealth.lastErrorMessage).toBe("Connection timeout");
    expect(systemHealth.lastSuccessTime).toBeTruthy();
    expect(systemHealth.lastFailureTime).toBeTruthy();
  });

  it("returns multiple systems when multiple are tracked", async () => {
    healthTracker.recordSuccess("system-a" as LibrarySystemId, 100);
    healthTracker.recordSuccess("system-b" as LibrarySystemId, 200);

    const res = await app.request("/systems");
    const body = await res.json();

    expect(Object.keys(body.systems)).toHaveLength(2);
    expect(body.systems).toHaveProperty("system-a");
    expect(body.systems).toHaveProperty("system-b");
  });

  it("returns application/json content type", async () => {
    const res = await app.request("/systems");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});
