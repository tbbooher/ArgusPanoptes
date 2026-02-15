// ---------------------------------------------------------------------------
// Library registry loader.
// Reads YAML files from a directory, validates with Zod, and returns typed
// LibrarySystem[] objects ready for use by the adapter layer.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { parse } from "yaml";
import type {
  LibrarySystem,
  LibrarySystemId,
  BranchId,
  ILSVendor,
  AdapterProtocol,
  AdapterConfig,
  Branch,
} from "../core/types.js";

// ── Zod schemas ─────────────────────────────────────────────────────────────

export const BranchSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  code: z.string().min(1),
  address: z.string().optional(),
  city: z.string().optional(),
});

export const AdapterConfigSchema = z.object({
  protocol: z.enum([
    "z3950",
    "sru",
    "oclc_worldcat",
    "sierra_rest",
    "polaris_papi",
    "koha_sru",
    "koha_rest",
    "sirsi_symws",
    "sirsi_enterprise_scrape",
    "bibliocommons_scrape",
    "apollo_api",
    "aspen_discovery_api",
    "atriuum_scrape",
    "spydus_scrape",
    "tlc_api",
    "playwright_scrape",
    "web_scrape",
  ]),
  baseUrl: z.string().url(),
  port: z.number().int().positive().optional(),
  databaseName: z.string().optional(),
  clientKeyEnvVar: z.string().optional(),
  clientSecretEnvVar: z.string().optional(),
  timeoutMs: z.number().int().positive().default(10_000),
  maxConcurrency: z.number().int().positive().default(2),
  extra: z.record(z.unknown()).optional(),
});

export const LibrarySystemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  vendor: z.enum([
    "sirsi_dynix",
    "innovative_sierra",
    "polaris",
    "evergreen",
    "koha",
    "bibliocommons",
    "carl_x",
    "apollo",
    "atriuum",
    "tlc",
    "aspen_discovery",
    "spydus",
    "iii_vega",
    "unknown",
  ]),
  region: z.string().min(1),
  catalogUrl: z.string().url(),
  enabled: z.boolean().default(true),
  branches: z.array(BranchSchema).min(1),
  adapters: z.array(AdapterConfigSchema).min(1),
});

// ── Environment-variable placeholder resolver ───────────────────────────────

const ENV_PLACEHOLDER = /\$\{([A-Z_][A-Z0-9_]*)}/g;

/**
 * Recursively walk a value and replace `${ENV_VAR}` placeholders in strings
 * with the matching `process.env` value.  Throws if a referenced variable is
 * not defined.
 */
function resolveEnvPlaceholders<T>(value: T): T {
  if (typeof value === "string") {
    return value.replace(ENV_PLACEHOLDER, (_match, varName: string) => {
      const envValue = process.env[varName];
      if (envValue === undefined) {
        throw new Error(
          `Environment variable "${varName}" is referenced in a library config but is not defined`,
        );
      }
      return envValue;
    }) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map(resolveEnvPlaceholders) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const resolved: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      resolved[k] = resolveEnvPlaceholders(v);
    }
    return resolved as T;
  }
  return value;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Load every `*.yaml` file from `dir`, validate each against the
 * {@link LibrarySystemSchema}, resolve `${ENV_VAR}` placeholders, and return
 * an array of typed {@link LibrarySystem} objects.
 *
 * Files that fail validation are skipped with a warning logged to stderr.
 */
export function loadLibraryRegistry(dir: string): LibrarySystem[] {
  const absoluteDir = path.resolve(dir);

  if (!fs.existsSync(absoluteDir)) {
    throw new Error(`Library registry directory does not exist: ${absoluteDir}`);
  }

  const files = fs
    .readdirSync(absoluteDir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort();

  const systems: LibrarySystem[] = [];

  for (const file of files) {
    const filePath = path.join(absoluteDir, file);
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = parse(raw);
      const resolved = resolveEnvPlaceholders(parsed);
      const validated = LibrarySystemSchema.parse(resolved);

      systems.push({
        id: validated.id as LibrarySystemId,
        name: validated.name,
        vendor: validated.vendor as ILSVendor,
        region: validated.region,
        catalogUrl: validated.catalogUrl,
        enabled: validated.enabled,
        branches: validated.branches.map((b) => ({
          id: b.id as BranchId,
          name: b.name,
          code: b.code,
          address: b.address,
          city: b.city,
        })) satisfies Branch[],
        adapters: validated.adapters.map((a) => ({
          protocol: a.protocol as AdapterProtocol,
          baseUrl: a.baseUrl,
          port: a.port,
          databaseName: a.databaseName,
          clientKeyEnvVar: a.clientKeyEnvVar,
          clientSecretEnvVar: a.clientSecretEnvVar,
          timeoutMs: a.timeoutMs,
          maxConcurrency: a.maxConcurrency,
          extra: a.extra,
        })) satisfies AdapterConfig[],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[library-registry] Skipping ${file}: ${message}`);
    }
  }

  return systems;
}
