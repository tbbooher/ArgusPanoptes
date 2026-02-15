#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// validate-systems — Health-check every enabled library system.
//
// Usage:
//   npx tsx src/scripts/validate-systems.ts [options]
//
// Options:
//   --protocol <name>   Only check systems using this adapter protocol
//   --region <name>     Only check systems in this region (substring match)
//   --system <id>       Only check a single system by ID
//   --concurrency <n>   Max parallel health checks (default: 10)
//   --timeout <ms>      Override per-request timeout (default: from config)
//   --json              Output results as JSON (for CI/scripting)
//   --verbose           Show detailed info for healthy systems too
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "yaml";
import pino from "pino";
import pLimit from "p-limit";

import type {
  AdapterConfig,
  AdapterHealthStatus,
  LibraryCatalogAdapter,
  LibrarySystem,
  LibrarySystemId,
} from "../core/types.js";
import { AdapterProtocol } from "../core/types.js";

// ── Adapter imports ────────────────────────────────────────────────────────
import { KohaSruAdapter } from "../adapters/koha/koha-sru-adapter.js";
import { GenericSruAdapter } from "../adapters/sru/sru-adapter.js";
import { WorldCatAdapter } from "../adapters/worldcat/worldcat-adapter.js";
import { SierraApiAdapter } from "../adapters/sierra/sierra-adapter.js";
import { PolarisApiAdapter } from "../adapters/polaris/polaris-adapter.js";
import { WebScraperAdapter } from "../adapters/scraper/web-scraper-adapter.js";
import { BiblioCommonsScrapeAdapter } from "../adapters/scraper/bibliocommons-adapter.js";
import { SirsiEnterpriseScrapeAdapter } from "../adapters/sirsi/sirsi-enterprise-scrape-adapter.js";
import { ApolloAdapter } from "../adapters/apollo/apollo-adapter.js";
import { AspenDiscoveryAdapter } from "../adapters/aspen/aspen-discovery-adapter.js";
import { AtriumScrapeAdapter } from "../adapters/atriuum/atriuum-scrape-adapter.js";
import { SpydusScrapeAdapter } from "../adapters/spydus/spydus-scrape-adapter.js";
import { TlcApiAdapter } from "../adapters/tlc/tlc-api-adapter.js";

// ── CLI argument parsing ─────────────────────────────────────────────────

interface CliOptions {
  protocol?: string;
  region?: string;
  system?: string;
  concurrency: number;
  timeout?: number;
  json: boolean;
  verbose: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = {
    concurrency: 10,
    json: false,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--protocol":
        opts.protocol = args[++i];
        break;
      case "--region":
        opts.region = args[++i];
        break;
      case "--system":
        opts.system = args[++i];
        break;
      case "--concurrency":
        opts.concurrency = Number(args[++i]);
        break;
      case "--timeout":
        opts.timeout = Number(args[++i]);
        break;
      case "--json":
        opts.json = true;
        break;
      case "--verbose":
        opts.verbose = true;
        break;
      case "--help":
        console.log(`
Usage: npx tsx src/scripts/validate-systems.ts [options]

Options:
  --protocol <name>   Only check systems using this adapter protocol
  --region <name>     Only check systems in this region (substring match)
  --system <id>       Only check a single system by ID
  --concurrency <n>   Max parallel health checks (default: 10)
  --timeout <ms>      Override per-request timeout (default: from config)
  --json              Output results as JSON (for CI/scripting)
  --verbose           Show detailed info for healthy systems too
  --help              Show this help message

Protocols: ${Object.values(AdapterProtocol).join(", ")}
`);
        process.exit(0);
    }
  }

  return opts;
}

// ── Library registry loader ──────────────────────────────────────────────

function loadLibraryRegistry(): LibrarySystem[] {
  const librariesDir = path.resolve(
    import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname),
    "..",
    "config",
    "libraries",
  );

  if (!fs.existsSync(librariesDir)) {
    console.error(`Libraries directory not found: ${librariesDir}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(librariesDir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));

  const systems: LibrarySystem[] = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(librariesDir, file), "utf-8");
    const parsed = yaml.parse(content) as LibrarySystem;
    systems.push(parsed);
  }

  return systems;
}

// ── Adapter factory (mirrors app.ts) ─────────────────────────────────────

function createAdapter(
  system: LibrarySystem,
  adapterConfig: AdapterConfig,
  logger: pino.Logger,
): LibraryCatalogAdapter | null {
  try {
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
      case AdapterProtocol.APOLLO_API:
        return new ApolloAdapter(system, adapterConfig, logger);
      case AdapterProtocol.ASPEN_DISCOVERY_API:
        return new AspenDiscoveryAdapter(system, adapterConfig, logger);
      case AdapterProtocol.ATRIUUM_SCRAPE:
        return new AtriumScrapeAdapter(system, adapterConfig, logger);
      case AdapterProtocol.SPYDUS_SCRAPE:
        return new SpydusScrapeAdapter(system, adapterConfig, logger);
      case AdapterProtocol.TLC_API:
        return new TlcApiAdapter(system, adapterConfig, logger);
      case AdapterProtocol.WEB_SCRAPE:
        return new WebScraperAdapter(system, adapterConfig, logger);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

// ── Health check runner ──────────────────────────────────────────────────

interface CheckResult {
  systemId: string;
  systemName: string;
  protocol: string;
  region: string;
  baseUrl: string;
  healthy: boolean;
  latencyMs: number;
  message: string;
  checkedAt: string;
}

async function runHealthCheck(
  system: LibrarySystem,
  adapter: LibraryCatalogAdapter,
  adapterConfig: AdapterConfig,
): Promise<CheckResult> {
  try {
    const status: AdapterHealthStatus = await adapter.healthCheck(system);
    return {
      systemId: system.id,
      systemName: system.name,
      protocol: adapterConfig.protocol,
      region: system.region,
      baseUrl: adapterConfig.baseUrl,
      healthy: status.healthy,
      latencyMs: status.latencyMs,
      message: status.message,
      checkedAt: status.checkedAt,
    };
  } catch (error: unknown) {
    return {
      systemId: system.id,
      systemName: system.name,
      protocol: adapterConfig.protocol,
      region: system.region,
      baseUrl: adapterConfig.baseUrl,
      healthy: false,
      latencyMs: 0,
      message: error instanceof Error ? error.message : "Unknown error",
      checkedAt: new Date().toISOString(),
    };
  }
}

// ── Output formatting ────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

function printResults(results: CheckResult[], opts: CliOptions): void {
  if (opts.json) {
    const summary = {
      checkedAt: new Date().toISOString(),
      total: results.length,
      healthy: results.filter((r) => r.healthy).length,
      unhealthy: results.filter((r) => !r.healthy).length,
      results,
    };
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const healthy = results.filter((r) => r.healthy);
  const unhealthy = results.filter((r) => !r.healthy);

  // ── Header ──
  console.log();
  console.log(`${BOLD}═══════════════════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}  Argus Panoptes — System Health Validation Report${RESET}`);
  console.log(`${BOLD}═══════════════════════════════════════════════════════════════${RESET}`);
  console.log(`  ${DIM}Checked at: ${new Date().toISOString()}${RESET}`);
  console.log();

  // ── Summary ──
  const healthPct = results.length > 0 ? ((healthy.length / results.length) * 100).toFixed(1) : "0";
  const summaryColor = unhealthy.length === 0 ? GREEN : unhealthy.length <= 3 ? YELLOW : RED;
  console.log(`  ${BOLD}Summary:${RESET}`);
  console.log(`    Total systems checked:  ${BOLD}${results.length}${RESET}`);
  console.log(`    ${GREEN}Healthy:${RESET}                ${GREEN}${healthy.length}${RESET}`);
  console.log(`    ${RED}Unhealthy:${RESET}              ${RED}${unhealthy.length}${RESET}`);
  console.log(`    ${summaryColor}Health rate:             ${healthPct}%${RESET}`);
  console.log();

  // ── Protocol breakdown ──
  const byProtocol = new Map<string, { total: number; healthy: number }>();
  for (const r of results) {
    const entry = byProtocol.get(r.protocol) ?? { total: 0, healthy: 0 };
    entry.total++;
    if (r.healthy) entry.healthy++;
    byProtocol.set(r.protocol, entry);
  }

  console.log(`  ${BOLD}By Protocol:${RESET}`);
  for (const [proto, stats] of [...byProtocol.entries()].sort((a, b) => b[1].total - a[1].total)) {
    const pct = ((stats.healthy / stats.total) * 100).toFixed(0);
    const color = stats.healthy === stats.total ? GREEN : YELLOW;
    console.log(
      `    ${CYAN}${proto.padEnd(28)}${RESET} ${color}${stats.healthy}/${stats.total}${RESET} (${pct}%)`,
    );
  }
  console.log();

  // ── Unhealthy systems ──
  if (unhealthy.length > 0) {
    console.log(`  ${RED}${BOLD}Unhealthy Systems:${RESET}`);
    console.log(`  ${DIM}${"─".repeat(59)}${RESET}`);

    for (const r of unhealthy.sort((a, b) => a.systemId.localeCompare(b.systemId))) {
      console.log(`    ${RED}✗${RESET} ${BOLD}${r.systemId}${RESET} ${DIM}(${r.protocol})${RESET}`);
      console.log(`      ${r.systemName} — ${r.region}`);
      console.log(`      ${DIM}URL:${RESET} ${r.baseUrl}`);
      console.log(`      ${RED}Error: ${r.message}${RESET}`);
      console.log();
    }
  }

  // ── Healthy systems (verbose only) ──
  if (opts.verbose && healthy.length > 0) {
    console.log(`  ${GREEN}${BOLD}Healthy Systems:${RESET}`);
    console.log(`  ${DIM}${"─".repeat(59)}${RESET}`);

    for (const r of healthy.sort((a, b) => a.latencyMs - b.latencyMs)) {
      const latencyColor = r.latencyMs < 1000 ? GREEN : r.latencyMs < 3000 ? YELLOW : RED;
      console.log(
        `    ${GREEN}✓${RESET} ${r.systemId.padEnd(35)} ${latencyColor}${String(r.latencyMs).padStart(5)}ms${RESET} ${DIM}(${r.protocol})${RESET}`,
      );
    }
    console.log();
  }

  // ── Latency stats ──
  if (healthy.length > 0) {
    const latencies = healthy.map((r) => r.latencyMs).sort((a, b) => a - b);
    const avg = Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length);
    const p50 = latencies[Math.floor(latencies.length * 0.5)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    const p99 = latencies[Math.floor(latencies.length * 0.99)];

    console.log(`  ${BOLD}Latency (healthy systems):${RESET}`);
    console.log(`    Avg: ${avg}ms  P50: ${p50}ms  P95: ${p95}ms  P99: ${p99}ms`);
    console.log(`    Min: ${latencies[0]}ms  Max: ${latencies[latencies.length - 1]}ms`);
    console.log();
  }

  console.log(`${BOLD}═══════════════════════════════════════════════════════════════${RESET}`);
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs();

  // Silent logger for health checks (we handle output ourselves)
  const logger = pino({ level: "silent" });

  // Load all systems
  const allSystems = loadLibraryRegistry();

  // Filter to enabled systems
  let systems = allSystems.filter((s) => s.enabled);

  // Apply filters
  if (opts.system) {
    systems = systems.filter((s) => s.id === opts.system);
    if (systems.length === 0) {
      console.error(`System not found: ${opts.system}`);
      const match = allSystems.find((s) => s.id === opts.system);
      if (match && !match.enabled) {
        console.error(`  (system exists but is disabled)`);
      }
      process.exit(1);
    }
  }

  if (opts.region) {
    const regionLower = opts.region.toLowerCase();
    systems = systems.filter((s) => s.region.toLowerCase().includes(regionLower));
  }

  if (opts.protocol) {
    const protoLower = opts.protocol.toLowerCase();
    systems = systems.filter((s) =>
      s.adapters.some((a) => a.protocol.toLowerCase() === protoLower),
    );
  }

  if (systems.length === 0) {
    console.error("No systems match the specified filters.");
    process.exit(1);
  }

  if (!opts.json) {
    console.log(`\n  Checking ${systems.length} enabled systems (concurrency: ${opts.concurrency})...\n`);
  }

  // Build check tasks
  const limit = pLimit(opts.concurrency);
  const tasks: Promise<CheckResult>[] = [];

  for (const system of systems) {
    for (const adapterConfig of system.adapters) {
      // When filtering by protocol, skip non-matching adapters
      if (opts.protocol && adapterConfig.protocol.toLowerCase() !== opts.protocol.toLowerCase()) {
        continue;
      }

      const config = opts.timeout
        ? { ...adapterConfig, timeoutMs: opts.timeout }
        : adapterConfig;

      const adapter = createAdapter(system, config, logger);
      if (!adapter) continue;

      tasks.push(
        limit(async () => {
          if (!opts.json) {
            process.stdout.write(`  ${DIM}Checking ${system.id}...${RESET}\r`);
          }
          return runHealthCheck(system, adapter, config);
        }),
      );
    }
  }

  // Run all checks
  const results = await Promise.all(tasks);

  // Clear the progress line
  if (!opts.json) {
    process.stdout.write(" ".repeat(80) + "\r");
  }

  // Print results
  printResults(results, opts);

  // Exit with error code if any unhealthy
  const unhealthyCount = results.filter((r) => !r.healthy).length;
  process.exit(unhealthyCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(2);
});
