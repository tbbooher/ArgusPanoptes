// ---------------------------------------------------------------------------
// Health check routes.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import type { HealthTracker } from "../../cache/health-tracker.js";
import type { MetricsCollector } from "../../metrics/metrics-collector.js";

/** Dependencies required by health routes. */
export interface HealthRouteDeps {
  healthTracker: HealthTracker;
  metricsCollector: MetricsCollector;
}

const startedAt = Date.now();

/**
 * Mounts health-check endpoints:
 *
 * - `GET /health`         -- Basic liveness probe.
 * - `GET /health/systems` -- Per-library-system health matrix.
 */
export function healthRoutes(deps: HealthRouteDeps): Hono {
  const app = new Hono();

  // GET /health
  app.get("/", (c) => {
    const uptimeMs = Date.now() - startedAt;
    return c.json({
      status: "ok",
      uptime: uptimeMs,
      timestamp: new Date().toISOString(),
    });
  });

  // GET /health/systems
  app.get("/systems", (c) => {
    const allHealth = deps.healthTracker.getAllHealth();
    const systems: Record<string, unknown> = {};

    for (const [key, snapshot] of allHealth) {
      systems[key] = snapshot;
    }

    return c.json({ systems });
  });

  return app;
}
