// ---------------------------------------------------------------------------
// Hono application factory.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import type pino from "pino";
import type { LibrarySystem } from "../core/types.js";
import type { SearchCoordinator } from "../orchestrator/search-coordinator.js";
import type { HealthTracker } from "../cache/health-tracker.js";
import type { MetricsCollector } from "../metrics/metrics-collector.js";

import { requestIdMiddleware } from "./middleware/request-id.js";
import { createRequestLogger } from "../logging/context.js";
import { rateLimitMiddleware } from "./middleware/rate-limit.js";
import { errorHandler } from "./middleware/error-handler.js";

import { searchRoutes } from "./routes/search.js";
import { libraryRoutes } from "./routes/libraries.js";
import { healthRoutes } from "./routes/health.js";

import type { RateLimitConfig } from "../core/types.js";

// ── Dependency bundle ──────────────────────────────────────────────────────

export interface AppDependencies {
  searchCoordinator: SearchCoordinator;
  systems: LibrarySystem[];
  healthTracker: HealthTracker;
  metricsCollector: MetricsCollector;
  logger: pino.Logger;
  rateLimitConfig: RateLimitConfig;
}

// ── App factory ────────────────────────────────────────────────────────────

/**
 * Create and configure the Hono application.
 *
 * Middleware stack (applied in order):
 * 1. Request ID generation (`X-Request-ID`).
 * 2. Request-scoped child logger attached to context.
 * 3. Per-IP rate limiting.
 * 4. Route handlers.
 * 5. Global error handler (maps domain errors to HTTP status codes).
 */
export function createApp(deps: AppDependencies): Hono {
  const app = new Hono();

  // ── Global middleware ──────────────────────────────────────────────────

  app.use("*", requestIdMiddleware());
  app.use("*", createRequestLogger(deps.logger));
  app.use("*", rateLimitMiddleware(deps.rateLimitConfig));

  // ── Routes ────────────────────────────────────────────────────────────

  app.route(
    "/search",
    searchRoutes({
      searchCoordinator: deps.searchCoordinator,
      logger: deps.logger,
    }),
  );

  app.route(
    "/libraries",
    libraryRoutes({
      systems: deps.systems,
      healthTracker: deps.healthTracker,
    }),
  );

  app.route(
    "/health",
    healthRoutes({
      healthTracker: deps.healthTracker,
      metricsCollector: deps.metricsCollector,
    }),
  );

  // ── Error handler ─────────────────────────────────────────────────────

  app.onError(errorHandler);

  return app;
}
