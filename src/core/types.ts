// ---------------------------------------------------------------------------
// Core types for the Book Finder service.
// All other modules import from this file.
// ---------------------------------------------------------------------------

// ── Branded primitives ──────────────────────────────────────────────────────

/** A validated ISBN-10 string (9 digits + check digit). */
export type ISBN10 = string & { readonly __brand: "ISBN10" };

/** A validated ISBN-13 string (13 digits). */
export type ISBN13 = string & { readonly __brand: "ISBN13" };

/** Either form of a validated ISBN. */
export type ISBN = ISBN10 | ISBN13;

/** Unvalidated ISBN input. */
export type RawISBN = string;

/** Unique identifier for a library system. */
export type LibrarySystemId = string & { readonly __brand: "LibrarySystemId" };

/** Unique identifier for a branch within a system. */
export type BranchId = string & { readonly __brand: "BranchId" };

// ── Enums ───────────────────────────────────────────────────────────────────

export const ILSVendor = {
  SIRSI_DYNIX: "sirsi_dynix",
  INNOVATIVE_SIERRA: "innovative_sierra",
  POLARIS: "polaris",
  EVERGREEN: "evergreen",
  KOHA: "koha",
  BIBLIOCOMMONS: "bibliocommons",
  CARL_X: "carl_x",
  APOLLO: "apollo",
  ATRIUUM: "atriuum",
  TLC: "tlc",
  ASPEN_DISCOVERY: "aspen_discovery",
  SPYDUS: "spydus",
  III_VEGA: "iii_vega",
  UNKNOWN: "unknown",
} as const;
export type ILSVendor = (typeof ILSVendor)[keyof typeof ILSVendor];

export const AdapterProtocol = {
  Z3950: "z3950",
  SRU: "sru",
  OCLC_WORLDCAT: "oclc_worldcat",
  SIERRA_REST: "sierra_rest",
  POLARIS_PAPI: "polaris_papi",
  KOHA_SRU: "koha_sru",
  KOHA_REST: "koha_rest",
  SIRSI_SYMWS: "sirsi_symws",
  SIRSI_ENTERPRISE_SCRAPE: "sirsi_enterprise_scrape",
  BIBLIOCOMMONS_SCRAPE: "bibliocommons_scrape",
  ASPEN_DISCOVERY_API: "aspen_discovery_api",
  ATRIUUM_SCRAPE: "atriuum_scrape",
  APOLLO_API: "apollo_api",
  SPYDUS_SCRAPE: "spydus_scrape",
  TLC_API: "tlc_api",
  PLAYWRIGHT_SCRAPE: "playwright_scrape",
  WEB_SCRAPE: "web_scrape",
} as const;
export type AdapterProtocol =
  (typeof AdapterProtocol)[keyof typeof AdapterProtocol];

export const ItemStatus = {
  AVAILABLE: "available",
  CHECKED_OUT: "checked_out",
  IN_TRANSIT: "in_transit",
  ON_HOLD: "on_hold",
  ON_ORDER: "on_order",
  IN_PROCESSING: "in_processing",
  MISSING: "missing",
  UNKNOWN: "unknown",
} as const;
export type ItemStatus = (typeof ItemStatus)[keyof typeof ItemStatus];

export const MaterialType = {
  BOOK: "book",
  LARGE_PRINT: "large_print",
  AUDIOBOOK_CD: "audiobook_cd",
  AUDIOBOOK_DIGITAL: "audiobook_digital",
  EBOOK: "ebook",
  DVD: "dvd",
  UNKNOWN: "unknown",
} as const;
export type MaterialType = (typeof MaterialType)[keyof typeof MaterialType];

// ── Library system ──────────────────────────────────────────────────────────

export interface Branch {
  id: BranchId;
  name: string;
  code: string;
  address?: string;
  city?: string;
}

export interface AdapterConfig {
  protocol: AdapterProtocol;
  baseUrl: string;
  /** Z39.50 port (if applicable). */
  port?: number;
  /** Z39.50 database name. */
  databaseName?: string;
  /** OAuth / API key (reference to env var name, not the value). */
  clientKeyEnvVar?: string;
  /** OAuth / API secret (reference to env var name). */
  clientSecretEnvVar?: string;
  /** Per-request timeout in ms. */
  timeoutMs: number;
  /** Maximum concurrent requests to this system. */
  maxConcurrency: number;
  /** Additional vendor-specific fields. */
  extra?: Record<string, unknown>;
}

export interface LibrarySystem {
  id: LibrarySystemId;
  name: string;
  vendor: ILSVendor;
  region: string;
  catalogUrl: string;
  branches: Branch[];
  adapters: AdapterConfig[];
  enabled: boolean;
}

// ── Holdings & search results ───────────────────────────────────────────────

export interface BookHolding {
  isbn: string;
  systemId: LibrarySystemId;
  branchId: BranchId;
  systemName: string;
  branchName: string;
  callNumber: string | null;
  status: ItemStatus;
  materialType: MaterialType;
  dueDate: string | null;
  holdCount: number | null;
  copyCount: number | null;
  catalogUrl: string;
  collection: string;
  volume: string | null;
  rawStatus: string;
  /** Hash for deduplication across adapters. */
  fingerprint: string;
}

export interface SearchError {
  systemId: LibrarySystemId;
  systemName: string;
  protocol: AdapterProtocol;
  errorType: "connection" | "timeout" | "auth" | "rate_limit" | "parse" | "unknown";
  message: string;
  timestamp: string;
}

export interface SearchResult {
  searchId: string;
  isbn: string;
  normalizedISBN13: string;
  startedAt: string;
  completedAt: string | null;
  holdings: BookHolding[];
  errors: SearchError[];
  systemsSearched: number;
  systemsSucceeded: number;
  systemsFailed: number;
  systemsTimedOut: number;
  isPartial: boolean;
  fromCache: boolean;
}

// ── Adapter contract ────────────────────────────────────────────────────────

export interface AdapterSearchResult {
  holdings: BookHolding[];
  rawResponse?: unknown;
  responseTimeMs: number;
  protocol: AdapterProtocol;
}

export interface AdapterHealthStatus {
  systemId: LibrarySystemId;
  protocol: AdapterProtocol;
  healthy: boolean;
  latencyMs: number;
  message: string;
  checkedAt: string;
}

/**
 * Every adapter must implement this interface.
 * The orchestrator calls `search()` for ISBN lookups and `healthCheck()`
 * for liveness probes.
 */
export interface LibraryCatalogAdapter {
  readonly protocol: AdapterProtocol;
  readonly systemId: LibrarySystemId;

  search(
    isbn: ISBN13,
    system: LibrarySystem,
    signal?: AbortSignal,
  ): Promise<AdapterSearchResult>;

  healthCheck(system: LibrarySystem): Promise<AdapterHealthStatus>;
}

// ── Brach / system summaries (for aggregated results) ───────────────────────

export interface BranchAvailabilitySummary {
  branchId: BranchId;
  branchName: string;
  city: string;
  copies: number;
  availableCopies: number;
}

export interface SystemAvailabilitySummary {
  systemId: LibrarySystemId;
  systemName: string;
  totalCopies: number;
  availableCopies: number;
  checkedOutCopies: number;
  holdCount: number;
  branches: BranchAvailabilitySummary[];
  catalogUrl: string;
}

// ── ISBN parse result ───────────────────────────────────────────────────────

export type ISBNParseResult =
  | { ok: true; isbn10: ISBN10 | null; isbn13: ISBN13; hyphenated: string }
  | { ok: false; raw: RawISBN; reason: string };

// ── Config types ────────────────────────────────────────────────────────────

export interface AppConfig {
  env: "development" | "staging" | "production";
  port: number;
  logLevel: string;
  search: SearchConfig;
  cache: CacheConfig;
  metrics: MetricsConfig;
  rateLimit: RateLimitConfig;
}

export interface SearchConfig {
  globalTimeoutMs: number;
  perSystemTimeoutMs: number;
  perRequestTimeoutMs: number;
  maxConcurrency: number;
  maxPerHostConcurrency: number;
  maxRetries: number;
  retryBaseDelayMs: number;
}

export interface CacheConfig {
  enabled: boolean;
  maxMemoryEntries: number;
  searchResultTtlSeconds: number;
  libraryMetadataTtlSeconds: number;
  isbnMetadataTtlSeconds: number;
}

export interface MetricsConfig {
  enabled: boolean;
  reportIntervalMs: number;
}

export interface RateLimitConfig {
  enabled: boolean;
  searchRpm: number;
  librariesRpm: number;
}

export interface LoggingConfig {
  level: string;
  prettyPrint: boolean;
  redactSecrets: boolean;
}
