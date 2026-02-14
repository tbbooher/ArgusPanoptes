// ---------------------------------------------------------------------------
// Library system listing routes.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import type { LibrarySystem, LibrarySystemId } from "../../core/types.js";
import type { HealthTracker } from "../../cache/health-tracker.js";

/** Dependencies required by library routes. */
export interface LibraryRouteDeps {
  systems: LibrarySystem[];
  healthTracker: HealthTracker;
}

/**
 * Mounts library system endpoints:
 *
 * - `GET /libraries`      -- List all systems (optional `?region=` filter).
 * - `GET /libraries/:id`  -- Single system detail including health.
 */
export function libraryRoutes(deps: LibraryRouteDeps): Hono {
  const app = new Hono();

  // GET /libraries
  app.get("/", (c) => {
    const regionFilter = c.req.query("region")?.toLowerCase();

    let systems = deps.systems;

    if (regionFilter) {
      systems = systems.filter(
        (s) => s.region.toLowerCase() === regionFilter,
      );
    }

    const payload = systems.map((s) => ({
      id: s.id,
      name: s.name,
      vendor: s.vendor,
      region: s.region,
      catalogUrl: s.catalogUrl,
      branchCount: s.branches.length,
      enabled: s.enabled,
    }));

    return c.json({ libraries: payload, total: payload.length });
  });

  // GET /libraries/:id
  app.get("/:id", (c) => {
    const id = c.req.param("id");
    const system = deps.systems.find((s) => (s.id as string) === id);

    if (!system) {
      return c.json({ error: "Library system not found", type: "not_found" }, 404);
    }

    const health = deps.healthTracker.getSystemHealth(
      system.id as LibrarySystemId,
    );

    return c.json({
      library: {
        id: system.id,
        name: system.name,
        vendor: system.vendor,
        region: system.region,
        catalogUrl: system.catalogUrl,
        branches: system.branches,
        adapters: system.adapters.map((a) => ({
          protocol: a.protocol,
          baseUrl: a.baseUrl,
          timeoutMs: a.timeoutMs,
          maxConcurrency: a.maxConcurrency,
        })),
        enabled: system.enabled,
      },
      health: health ?? null,
    });
  });

  return app;
}
