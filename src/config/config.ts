// ---------------------------------------------------------------------------
// Typed configuration loader.
// Reads from environment variables with sensible defaults.
// ---------------------------------------------------------------------------

import type { AppConfig } from "../core/types.js";

/**
 * Load the application configuration from environment variables.
 *
 * Every setting has a hard-coded default so the service can start with zero
 * configuration for local development.
 */
export function loadConfig(): AppConfig {
  const env = (process.env.BOOK_FINDER_ENV ?? "development") as AppConfig["env"];
  const port = parseInt(process.env.BOOK_FINDER_PORT ?? "3000", 10);
  const logLevel = process.env.BOOK_FINDER_LOG_LEVEL ?? "info";

  return {
    env,
    port,
    logLevel,

    search: {
      globalTimeoutMs: 30_000,
      perSystemTimeoutMs: 15_000,
      perRequestTimeoutMs: 10_000,
      maxConcurrency: 20,
      maxPerHostConcurrency: 2,
      maxRetries: 2,
      retryBaseDelayMs: 500,
    },

    cache: {
      enabled: true,
      maxMemoryEntries: 1_000,
      searchResultTtlSeconds: 3_600,        // 1 hour
      libraryMetadataTtlSeconds: 86_400,    // 1 day
      isbnMetadataTtlSeconds: 2_592_000,    // 30 days
    },

    metrics: {
      enabled: true,
      reportIntervalMs: 60_000,             // 1 minute
    },

    rateLimit: {
      enabled: true,
      searchRpm: 60,
      librariesRpm: 300,
    },
  };
}
