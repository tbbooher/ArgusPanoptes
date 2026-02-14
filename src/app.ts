// ---------------------------------------------------------------------------
// Book Finder -- Application bootstrap (shared by Bun/OpenClaw and Node).
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import pino from "pino";
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "yaml";

import type {
  AdapterConfig,
  AppConfig,
  LibraryCatalogAdapter,
  LibrarySystem,
  LibrarySystemId,
} from "./core/types.js";
import { AdapterProtocol } from "./core/types.js";
import { AdapterAuthError } from "./core/errors.js";
import { createLogger } from "./logging/logger.js";
import { CacheManager } from "./cache/cache-manager.js";
import { HealthTracker } from "./cache/health-tracker.js";
import { MetricsCollector } from "./metrics/metrics-collector.js";
import { AdapterRegistry } from "./core/adapter-registry.js";
import { SearchCoordinator } from "./orchestrator/search-coordinator.js";
import { createApp } from "./api/server.js";

// ── Adapter imports ────────────────────────────────────────────────────────
import { KohaSruAdapter } from "./adapters/koha/koha-sru-adapter.js";
import { GenericSruAdapter } from "./adapters/sru/sru-adapter.js";
import { WorldCatAdapter } from "./adapters/worldcat/worldcat-adapter.js";
import { SierraApiAdapter } from "./adapters/sierra/sierra-adapter.js";
import { PolarisApiAdapter } from "./adapters/polaris/polaris-adapter.js";
import { WebScraperAdapter } from "./adapters/scraper/web-scraper-adapter.js";
import { BiblioCommonsScrapeAdapter } from "./adapters/scraper/bibliocommons-adapter.js";
import { SirsiEnterpriseScrapeAdapter } from "./adapters/sirsi/sirsi-enterprise-scrape-adapter.js";

// ── Config ─────────────────────────────────────────────────────────────────

function loadConfig(): AppConfig {
  return {
    env: (process.env["NODE_ENV"] as AppConfig["env"]) ?? "development",
    port: Number(process.env["PORT"] ?? 3000),
    logLevel: process.env["LOG_LEVEL"] ?? "info",
    search: {
      globalTimeoutMs: Number(process.env["SEARCH_GLOBAL_TIMEOUT_MS"] ?? 30_000),
      perSystemTimeoutMs: Number(process.env["SEARCH_PER_SYSTEM_TIMEOUT_MS"] ?? 15_000),
      perRequestTimeoutMs: Number(process.env["SEARCH_PER_REQUEST_TIMEOUT_MS"] ?? 10_000),
      maxConcurrency: Number(process.env["SEARCH_MAX_CONCURRENCY"] ?? 20),
      maxPerHostConcurrency: Number(process.env["SEARCH_MAX_PER_HOST"] ?? 2),
      maxRetries: Number(process.env["SEARCH_MAX_RETRIES"] ?? 2),
      retryBaseDelayMs: Number(process.env["SEARCH_RETRY_BASE_DELAY_MS"] ?? 500),
    },
    cache: {
      enabled: process.env["CACHE_ENABLED"] !== "false",
      maxMemoryEntries: Number(process.env["CACHE_MAX_ENTRIES"] ?? 500),
      searchResultTtlSeconds: Number(process.env["CACHE_SEARCH_TTL_S"] ?? 3600),
      libraryMetadataTtlSeconds: Number(process.env["CACHE_LIB_METADATA_TTL_S"] ?? 86_400),
      isbnMetadataTtlSeconds: Number(process.env["CACHE_ISBN_METADATA_TTL_S"] ?? 2_592_000),
    },
    metrics: {
      enabled: process.env["METRICS_ENABLED"] !== "false",
      reportIntervalMs: Number(process.env["METRICS_REPORT_INTERVAL_MS"] ?? 60_000),
    },
    rateLimit: {
      enabled: process.env["RATE_LIMIT_ENABLED"] !== "false",
      searchRpm: Number(process.env["RATE_LIMIT_SEARCH_RPM"] ?? 30),
      librariesRpm: Number(process.env["RATE_LIMIT_LIBRARIES_RPM"] ?? 60),
    },
  };
}

// ── Library registry loader ────────────────────────────────────────────────

function loadLibraryRegistry(): LibrarySystem[] {
  const librariesDir = path.resolve(
    import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname),
    "config",
    "libraries",
  );

  if (!fs.existsSync(librariesDir)) {
    return [];
  }

  const files = fs.readdirSync(librariesDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));

  const systems: LibrarySystem[] = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(librariesDir, file), "utf-8");
    const parsed = yaml.parse(content) as LibrarySystem;
    systems.push(parsed);
  }

  return systems;
}

// ── Adapter factory ────────────────────────────────────────────────────────

function createAdapterForConfig(
  system: LibrarySystem,
  adapterConfig: AdapterConfig,
  logger: pino.Logger,
): LibraryCatalogAdapter | null {
  switch (adapterConfig.protocol) {
    case AdapterProtocol.KOHA_SRU:
      return new KohaSruAdapter(system, adapterConfig, logger);

    case AdapterProtocol.SRU:
      return new GenericSruAdapter(system, adapterConfig, logger);

    case AdapterProtocol.OCLC_WORLDCAT:
      return new WorldCatAdapter(system, adapterConfig, logger);

    case AdapterProtocol.SIERRA_REST:
      return new SierraApiAdapter(system, adapterConfig, logger);

    case AdapterProtocol.POLARIS_PAPI:
      return new PolarisApiAdapter(system, adapterConfig, logger);

    case AdapterProtocol.SIRSI_ENTERPRISE_SCRAPE:
      return new SirsiEnterpriseScrapeAdapter(system, adapterConfig, logger);

    case AdapterProtocol.BIBLIOCOMMONS_SCRAPE:
      return new BiblioCommonsScrapeAdapter(system, adapterConfig, logger);

    case AdapterProtocol.WEB_SCRAPE:
      return new WebScraperAdapter(system, adapterConfig, logger);

    default:
      return null;
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

export async function buildApp(): Promise<Hono> {
  // 1. Load configuration
  const config = loadConfig();

  // 2. Create logger
  const logger = createLogger({
    level: config.logLevel,
    prettyPrint: config.env === "development",
    redactSecrets: true,
  });

  // 3. Load library registry from YAML files
  const systems = loadLibraryRegistry();
  logger.info({ systemsLoaded: systems.length }, "library registry loaded");

  // 4. Create infrastructure services
  const cacheManager = new CacheManager(config.cache, logger.child({ module: "cache" }));
  const healthTracker = new HealthTracker();
  const metricsCollector = new MetricsCollector(config.metrics, logger.child({ module: "metrics" }));
  const adapterRegistry = new AdapterRegistry();

  // 5. Create and register adapters for each system
  let totalAdapters = 0;

  for (const system of systems) {
    for (const adapterConfig of system.adapters) {
      let adapter: LibraryCatalogAdapter | null = null;
      try {
        adapter = createAdapterForConfig(system, adapterConfig, logger);
      } catch (err) {
        if (err instanceof AdapterAuthError) {
          logger.warn(
            { systemId: err.systemId, protocol: err.protocol },
            "adapter credentials missing; skipping adapter",
          );
          continue;
        }

        logger.error(
          {
            systemId: system.id,
            protocol: adapterConfig.protocol,
            err: err instanceof Error ? { name: err.name, message: err.message } : err,
          },
          "adapter failed to initialize; skipping adapter",
        );
        continue;
      }

      if (adapter) {
        adapterRegistry.register(system.id as LibrarySystemId, adapter);
        totalAdapters++;
      } else {
        logger.warn(
          { systemId: system.id, protocol: adapterConfig.protocol },
          "no adapter implementation for protocol; skipping",
        );
      }
    }
  }

  // 6. Create search coordinator
  const searchCoordinator = new SearchCoordinator(
    adapterRegistry,
    systems,
    cacheManager,
    healthTracker,
    metricsCollector,
    config.search,
    logger.child({ module: "coordinator" }),
  );

  // 7. Create Hono app
  const app = createApp({
    searchCoordinator,
    systems,
    healthTracker,
    metricsCollector,
    logger,
    rateLimitConfig: config.rateLimit,
  });

  // 8. Log startup summary
  logger.info(
    {
      port: config.port,
      env: config.env,
      systemsCount: systems.length,
      adaptersCount: totalAdapters,
      enabledSystems: systems.filter((s) => s.enabled).length,
    },
    "book-finder ready",
  );

  return app;
}
