# Book Finder: Comprehensive Project Plan
## TypeScript Backend Service for Texas Public Library ISBN Search

---

## Executive Summary

**Book Finder** is a TypeScript backend service that, given an ISBN, searches every public library system in Texas and returns a consolidated list of which libraries hold copies of that book. Texas has **892 public library facilities** across **50+ independent library systems**, using **9+ different ILS vendors** and multiple discovery protocols (Z39.50, SRU, vendor REST APIs, web scraping). The service fans out queries in parallel across all systems, normalizes heterogeneous responses into a unified result format, and returns them through a REST API.

**Runtime:** OpenClaw (TypeScript platform)
**Scope:** Pure backend, no UI

---

## 1. Texas Library Landscape (Research Agent 1 + 2 Findings)

### 1.1 Scale of the Problem

| Metric | Count |
|--------|-------|
| Total TX public library facilities | **892** |
| Independent library systems | ~50+ |
| ILS vendors in use | 9+ |
| Discovery layers | 4+ |
| Statewide union catalog | **None exists** |

### 1.2 ILS Vendor Distribution (Confirmed)

| ILS Vendor | Product | # TX Libraries | % | API Quality |
|---|---|---|---|---|
| **Biblionix** | Apollo | **292** | 32.7% | Minimal/None |
| **SirsiDynix** | Symphony | **211** | 23.7% | SWS REST API |
| **Book Systems** | Atriuum | **95** | 10.6% | Minimal/None |
| **Innovative/Clarivate** | Polaris | **89** | 10.0% | PAPI REST API |
| **TLC** | Library.Solution | **48** | 5.4% | Limited |
| **ByWater Solutions** | Koha | **48** | 5.4% | Full REST + SRU + Z39.50 |
| **SirsiDynix** | Horizon | **13** | 1.5% | Z39.50 only |
| **Insignia Software** | Insignia | **11** | 1.2% | Unknown |
| **Innovative/Clarivate** | Sierra | **5** | 0.6% | Full REST API |
| **Auto-Graphics** | VERSO | **4** | 0.4% | Minimal |
| Various/None | | ~73 | ~8.2% | Varies |

### 1.3 Critical Finding: The API Gap

**~45% of TX libraries (401 facilities)** use systems with minimal or no public API:
- Apollo (292) + Atriuum (95) + Insignia (11) + Genesis (3)
- These will require **web scraping or WorldCat** as fallback

**~40% of TX libraries (353 facilities)** use systems with documented APIs:
- Symphony (211) + Polaris (89) + Koha (48) + Sierra (5)

### 1.4 Confirmed Library Systems with Catalog URLs

#### SirsiDynix Enterprise (12+ systems)

| Library System | Catalog URL |
|---|---|
| Houston Public Library | `halan.sdp.sirsi.net/client/en_US/hou/` |
| Harris County PL (shared) | `hcpl2.ent.sirsi.net` (+ BiblioCommons frontend) |
| Pasadena PL | `hcpl2.ent.sirsi.net/client/en_US/pas/` |
| Montgomery County Memorial | `hcpl2.ent.sirsi.net/client/en_US/mcmlweb/` |
| El Paso PL | `elpasopl.ent.sirsi.net/client/en_US/default` |
| Plano PL | `plano.ent.sirsi.net/client/en_US/default` |
| Laredo PL | `lar.ent.sirsi.net/client/en_US/default` |
| Garland PL (Nicholson) | `nm.ent.sirsi.net/client/en_US/default` |
| Beaumont PL | `beaupl.ent.sirsi.net/client/en_US/default/` |
| Abilene PL | `ablc.ent.sirsi.net/client/en_US/apl/search/` |
| League City (Helen Hall) | `hhal.ent.sirsi.net/client/en_US/default` |
| Amarillo PL (HLC) | `hlc.ent.sirsi.net/client/en_US/amarillo` |

#### Polaris (4 systems)

| Library System | Catalog URL |
|---|---|
| Fort Worth Library | `fwpl.polarislibrary.com/Polaris/` |
| Arlington PL | `polarisweb.arlingtonlibrary.org/polaris/` |
| Fort Bend County | `catalog.fortbendlibraries.gov/polaris/` |
| Longview PL | `catalog.longviewtexas.gov/` |

#### BiblioCommons Discovery Layer (6 systems)

| Library System | Catalog URL | Backend ILS |
|---|---|---|
| San Antonio PL | `sanantonio.bibliocommons.com` | SirsiDynix |
| Austin PL | `austin.bibliocommons.com` | Sierra/Innovative |
| Harris County PL | `hcpl.bibliocommons.com` | SirsiDynix |
| Frisco PL | `friscolibrary.bibliocommons.com` | Unknown |
| Denton PL | `denton.bibliocommons.com` | Unknown |

#### TLC Delivers (5 systems)

| Library System | Catalog URL |
|---|---|
| McAllen PL | `mpl.tlcdelivers.com` |
| Waco-McLennan County | `waco.tlcdelivers.com/` |
| Leander PL | `leandertx.tlcdelivers.com/` |
| Wichita Falls PL | `wfpl.tlcdelivers.com` |
| Bryan/College Station | `bcslibrary.tlcdelivers.com/` |

#### Biblionix Apollo (4 confirmed)

| Library System | Catalog URL |
|---|---|
| Pflugerville PL | `pflugerville.biblionix.com/catalog` |
| Killeen PL | `killeen.biblionix.com/catalog` |
| Victoria PL | `victoria.biblionix.com/catalog/` |
| Rosenberg Library | `catalog.rosenberg-library.org/` |

#### Other Systems

| Library System | ILS | Catalog URL |
|---|---|---|
| McKinney PL | Aspen Discovery | `mckinney.aspendiscovery.org/` |
| Cedar Park PL | Aspen Discovery | `library.cedarparktexas.gov/` |
| San Marcos PL | III Vega | `smpl.na5.iiivega.com/` |
| Sherman PL | Evergreen | `sherman.biblio.org/eg/opac/home` |
| Brazoria County | Spydus | `mybcls.spydus.com/` |
| Round Rock PL | Unknown | `discovery.roundrocktexas.gov/` |
| Midland County | Unknown | `mcpl-websvr.co.midland.tx.us/` |

### 1.5 Key Regional Findings

- **Harris County shared SirsiDynix instance** (`hcpl2.ent.sirsi.net`): covers Harris County PL, Pasadena PL, Montgomery County -- ~2M residents in one query
- **Harrington Library Consortium** (`hlc.ent.sirsi.net`): Amarillo PL + Panhandle area libraries share one instance
- **No statewide union catalog** -- unlike Ohio (SearchOhio) or Colorado (Marmot), Texas has no unified search
- **48 Koha libraries** are the easiest targets -- SRU search requires zero authentication

---

## 2. Technical Protocols & APIs (Research Agent 2 Findings)

### 2.1 Protocol Coverage Matrix

| Protocol | How It Works | ISBN Search | Auth | TX Libraries |
|---|---|---|---|---|
| **OCLC WorldCat v2** | REST/JSON | `bn:{isbn}` + `heldInState=US-TX` | OAuth2 (WSKey) | ~400-600 (45-67%) |
| **SirsiDynix SWS** | REST/JSON | `/catalog/search?term1={isbn}&index1=ISBN` | Session-based | 211 (23.7%) |
| **Polaris PAPI** | REST/XML+JSON | `/search/bibs?q=ISBN={isbn}` | HMAC-signed | 89 (10.0%) |
| **Koha SRU** | HTTP/XML | `bath.isbn={isbn}` | None | 48 (5.4%) |
| **Koha REST** | REST/JSON | `/api/v1/biblios` | OAuth2/Basic | 48 (5.4%) |
| **Sierra REST** | REST/JSON | `/v6/bibs/search?index=standardNumber&text={isbn}` | OAuth2 | 5 (0.6%) |
| **Z39.50** | TCP/MARC | Use Attr 7 = ISBN | None (usually) | Most enterprise ILS |
| **SRU** | HTTP/XML | CQL: `bath.isbn={isbn}` | None (usually) | Koha, some Symphony |
| **Web Scraping** | HTTP/HTML | Vendor-specific URL patterns | None | ~401 fallback |

### 2.2 Realistic Coverage Tiers

| Tier | Method | Libraries | Cumulative % |
|---|---|---|---|
| 1 | Koha SRU (free, no auth) | 48 | 5.4% |
| 2 | + Vendor APIs (Symphony, Polaris, Sierra) | +305 | 39.6% |
| 3 | + OCLC WorldCat | +~200-300 | ~56-67% |
| 4 | + Web Scraping (Apollo, Atriuum, others) | +~400 | **~90-95%** |

### 2.3 Key npm Packages

| Category | Package | Purpose |
|---|---|---|
| MARC Parsing | `@natlibfi/marc-record-js` | TypeScript-native MARC parser |
| ISBN | `isbn3` | Validation, 10/13 conversion |
| XML | `fast-xml-parser` | SRU/MARCXML response parsing |
| HTML Scraping | `cheerio` | Static HTML parsing |
| JS Scraping | `playwright` | JavaScript-rendered OPACs |
| Rate Limiting | `bottleneck` | Per-host rate limiters |
| Concurrency | `p-limit` | Fan-out concurrency control |
| Retry | `p-retry` | Exponential backoff |
| HTTP | `undici` (built-in) or `axios` | REST API calls |
| Related ISBNs | LibraryThing ThingISBN API | Maps editions/formats |

### 2.4 Authentication Requirements

**No Auth Required:** Koha SRU, Koha OAI-PMH, Open Library, ThingISBN, public OPACs (scraping)

**API Key Required:** OCLC WorldCat (WSKey + institutional membership), Sierra (per-library OAuth2), OverDrive (partnership)

**Vendor Relationship Required:** SirsiDynix SWS (customer portal), Polaris PAPI (HMAC access keys), Biblionix Apollo (no known API at all)

---

## 3. Architecture (Architect Agent Output)

### 3.1 System Overview

```
                    +-----------------+
                    |   REST API      |
                    |   (Hono)        |
                    +--------+--------+
                             |
                    +--------v--------+
                    | Search          |
                    | Coordinator     |
                    | (Fan-out)       |
                    +--------+--------+
                             |
              +--------------+--------------+
              |              |              |
     +--------v---+  +------v-----+  +-----v------+
     | WorldCat   |  | SirsiDynix |  | Koha SRU   |  ...N adapters
     | Adapter    |  | Adapter    |  | Adapter    |
     +------------+  +------------+  +------------+
              |              |              |
     +--------v---+  +------v-----+  +-----v------+
     | OCLC API   |  | SWS REST   |  | SRU/HTTP   |  ...library systems
     +------------+  +------------+  +------------+
```

### 3.2 Project Structure

```
book_finder/
  src/
    index.ts                         # Entry point
    core/
      types.ts                       # ISBN, Library, Branch, Holding, SearchResult
      adapter.ts                     # LibraryCatalogAdapter interface
      adapter-registry.ts            # Maps (vendor, protocol) -> adapter
      errors.ts                      # Error hierarchy
    config/
      config.ts                      # Typed config loader (env vars + defaults)
      library-registry.ts            # Registry loader + Zod validation
      libraries/                     # One YAML file per library system
        houston-public.yaml
        harris-county.yaml
        ...
    adapters/
      base/
        base-adapter.ts              # Abstract base with shared logic
      sierra/
        sierra-adapter.ts            # Sierra REST API
        sierra-auth.ts               # OAuth2 token management
      sirsi/
        sirsi-adapter.ts             # SirsiDynix SWS
      polaris/
        polaris-adapter.ts           # Polaris PAPI
      koha/
        koha-sru-adapter.ts          # Koha SRU (no auth)
        koha-rest-adapter.ts         # Koha REST API
      worldcat/
        worldcat-adapter.ts          # OCLC WorldCat v2
      z3950/
        z3950-adapter.ts             # Generic Z39.50
      sru/
        sru-adapter.ts               # Generic SRU
      scraper/
        web-scraper-adapter.ts       # Generic OPAC scraper
        parsers/
          enterprise-parser.ts       # SirsiDynix Enterprise HTML
          polaris-parser.ts          # Polaris PowerPAC HTML
          apollo-parser.ts           # Biblionix Apollo HTML
          bibliocommons-parser.ts    # BiblioCommons HTML
    orchestrator/
      search-coordinator.ts          # Fan-out across all systems
      concurrency.ts                 # Semaphore, per-host limits
      circuit-breaker.ts             # Per-system circuit breaker
      timeout.ts                     # Multi-layer timeout handling
      retry.ts                       # Exponential backoff + jitter
      result-aggregator.ts           # Merge, dedup, normalize results
    cache/
      cache-manager.ts               # Two-tier: memory LRU + SQLite
      memory-cache.ts                # In-memory LRU with TTL
      sqlite-cache.ts                # Persistent cache (optional)
      health-tracker.ts              # Per-system health metrics
    domain/
      isbn/
        isbn.ts                      # Parse, validate, convert ISBN-10/13
        check-digit.ts               # Checksum algorithms
    api/
      server.ts                      # Hono app setup + middleware
      routes/
        search.ts                    # GET /search, POST /search, GET /search/:id
        batch-search.ts              # POST /search/batch
        libraries.ts                 # GET /libraries, GET /libraries/:id
        health.ts                    # GET /health, GET /health/systems
      middleware/
        rate-limit.ts                # Per-IP rate limiting
        error-handler.ts             # BookFinderError -> HTTP response
        request-id.ts                # Correlation ID
    logging/
      logger.ts                      # Pino structured JSON logging
      context.ts                     # Request-scoped child loggers
    metrics/
      metrics-collector.ts           # Per-adapter + per-search metrics
    utils/
      marc-parser.ts                 # MARC field extraction helpers
  test/
    unit/
      adapters/                      # Mocked adapter tests
      orchestrator/                  # Coordinator, circuit breaker tests
      domain/                        # ISBN validation tests
    integration/
      adapters/                      # Live endpoint tests (flag-gated)
    contract/
      adapter-contract.test.ts       # All adapters meet interface
    e2e/
      search-flow.test.ts            # Full API flow
    load/
      search-load.test.ts            # Concurrent fan-out tests
    fixtures/
      worldcat/                      # Saved WorldCat responses
      sirsi/                         # Saved SirsiDynix responses
      sierra/                        # Saved Sierra responses
      koha-sru/                      # Saved SRU XML responses
      polaris/                       # Saved Polaris responses
      scraper/                       # Saved HTML pages
```

### 3.3 Core TypeScript Interfaces

```typescript
// Branded ISBN types (compile-time safety)
type ISBN10 = string & { readonly __brand: 'ISBN10' };
type ISBN13 = string & { readonly __brand: 'ISBN13' };
type ISBN = ISBN10 | ISBN13;

// Library system identity
interface LibrarySystem {
  id: LibrarySystemId;
  name: string;
  type: ILSVendor;
  region: string;
  branches: Branch[];
  adapterConfig: AdapterConfig;
  enabled: boolean;
}

// Search results
interface BookHolding {
  isbn: string;
  systemId: LibrarySystemId;
  branchId: BranchId;
  systemName: string;
  branchName: string;
  callNumber: string | null;
  status: ItemStatus;        // 'available' | 'checked_out' | 'in_transit' | 'on_hold' | 'unknown'
  materialType: MaterialType; // 'book' | 'large_print' | 'audiobook_cd' | 'ebook' | 'unknown'
  dueDate: string | null;
  holdCount: number | null;
  copyCount: number | null;
  catalogUrl: string;
  collection: string;
  fingerprint: string;       // For deduplication
}

interface SearchResult {
  searchId: string;
  isbn: string;
  normalizedISBN13: ISBN13;
  startedAt: string;
  completedAt: string | null;
  holdings: BookHolding[];
  systemsSearched: number;
  systemsSucceeded: number;
  systemsFailed: number;
  systemsTimedOut: number;
  isPartial: boolean;
  errors: SearchError[];
}

// Adapter contract
interface LibraryCatalogAdapter {
  readonly protocol: AdapterProtocol;
  search(isbn: ISBN, system: LibrarySystem, signal?: AbortSignal): Promise<AdapterSearchResult>;
  healthCheck(system: LibrarySystem): Promise<AdapterHealthStatus>;
}
```

### 3.4 Technology Choices

| Component | Choice | Rationale |
|---|---|---|
| HTTP Framework | **Hono** | TypeScript-native, ~14KB, runtime-agnostic (OpenClaw compatible) |
| Validation | **Zod** | Schema validation + branded types at compile AND runtime |
| Logging | **Pino** | Fastest Node.js JSON logger, child loggers for request context |
| Cache (memory) | **LRU in-memory** | Sub-millisecond hits, zero dependencies |
| Cache (persistent) | **SQLite** (optional) | Survives restarts, no infrastructure needed |
| Config format | **YAML** per library | Supports comments, human-maintainable, one file per system |
| Testing | **Vitest** | TypeScript-native, fast, compatible with Hono |
| MARC parsing | **@natlibfi/marc-record-js** | Native TypeScript, well-maintained |
| ISBN | **Custom** (50 lines) | Simple enough; no dependency needed |
| XML parsing | **fast-xml-parser** | Zero-dependency, fast, TypeScript support |
| HTML scraping | **cheerio** | jQuery-like, no browser needed |
| Rate limiting | **bottleneck** | Per-host limiters with clustering support |

### 3.5 Key Architecture Decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Adapter pattern | Interface + factory registry | Open-closed principle; add adapters without touching core |
| 2 | Concurrency | `Promise.allSettled` + custom pool | Partial results on failure; no external deps |
| 3 | Resilience | Circuit breaker per system + exp backoff | Protects both our service and library systems |
| 4 | Search model | Both sync + async | Sync for quick lookups; async for thorough searches |
| 5 | Database | Start with JSON + LRU; add SQLite later | Zero infrastructure for v1 |
| 6 | Monorepo | Single package | Not large enough for monorepo overhead |
| 7 | No-API libraries | WorldCat first, scrape as fallback | Maximize coverage without heroic effort |
| 8 | Digital holdings | Physical only for v1 | OverDrive/Libby doubles adapter surface area |

---

## 4. Phased Implementation Plan

### Phase 0: Research & Discovery (COMPLETE -- this document)

| Deliverable | Status |
|---|---|
| Texas Library System Registry | Done (36 systems confirmed, ~25 unconfirmed) |
| Protocol & API Reference | Done (9 protocols documented) |
| Coverage Matrix | Done (5-tier coverage model) |
| Architecture Design | Done (full interfaces + reference implementation) |
| Vendor API Key Inventory | Done (auth requirements mapped) |

### Phase 1: Foundation

**Goal:** TypeScript project with tooling, core types, adapter abstraction, running API server.

| Step | Deliverable |
|---|---|
| 1.1 | Project scaffolding (TS, ESLint, Vitest, Hono) |
| 1.2 | Core type system (ISBN, Library, Branch, Holding, SearchResult) |
| 1.3 | `LibraryCatalogAdapter` interface |
| 1.4 | Adapter registry (maps vendor+protocol to adapter) |
| 1.5 | Configuration system (YAML library registry + Zod validation) |
| 1.6 | Error hierarchy (`BookFinderError` tree) |
| 1.7 | ISBN utility module (validate, convert, normalize) |
| 1.8 | API server skeleton (Hono, route stubs, /health endpoint) |

**Definition of Done:** `npm run build` compiles clean, `GET /health` returns 200.

### Phase 2: Protocol Implementations (Priority Order)

| Priority | Adapter | TX Libraries | Auth | Rationale |
|---|---|---|---|---|
| **1** | OCLC WorldCat v2 | ~400-600 | WSKey | Single query, highest leverage |
| **2** | Koha SRU | 48 | **None** | Free, no auth, quickest win |
| **3** | SirsiDynix SWS | 211 | Vendor | Largest single ILS vendor |
| **4** | Polaris PAPI | 89 | HMAC | Strong API, good TX coverage |
| **5** | Sierra REST | 5 | OAuth2 | Dallas, Tyler, Baytown |
| **6** | Z39.50 Generic | Varies | None | Fallback for enterprise ILS |
| **7** | BiblioCommons Scraper | 6 | None | San Antonio, Austin frontend |
| **8** | SRU Generic | Varies | None | Fallback for SRU-enabled systems |
| **9** | Apollo/Atriuum Scraper | ~387 | None | Last resort for API-less systems |

**Definition of Done:** 3+ adapters functional; search for known ISBN returns results from 3+ systems.

### Phase 3: Orchestration & Resilience

| Component | Description |
|---|---|
| Search Coordinator | Fan-out to all adapters via `Promise.allSettled` |
| Concurrency Pool | Semaphore (max 20 total, max 2 per host) |
| Circuit Breaker | Per-system: CLOSED -> OPEN after 5 failures -> HALF_OPEN after 60s |
| Timeout Cascade | Per-request (10s), per-system (15s), global (30s sync / 120s async) |
| Retry Logic | Exp backoff (500ms, 1500ms), max 2 retries, budget cap of 10 total |
| Result Aggregator | Deduplicate by fingerprint, merge multi-source holdings, sort by city |

**Definition of Done:** Fan-out search works; partial results on timeout; circuit breakers functional.

### Phase 4: Data & Caching

| Component | Implementation |
|---|---|
| Library Registry | JSON/YAML files, Zod-validated, hot-reloadable |
| Search Cache | Memory LRU (1hr TTL) + optional SQLite persistence |
| Health Tracker | In-memory per-system metrics (success rate, latency, circuit state) |
| ISBN Metadata Cache | 30-day TTL, sourced from OpenLibrary/WorldCat |

### Phase 5: API & Integration

| Endpoint | Method | Description |
|---|---|---|
| `/search?isbn=<isbn>` | GET | Synchronous search (blocks until done/timeout) |
| `/search` | POST | Async search (returns searchId for polling) |
| `/search/:searchId` | GET | Poll async search results |
| `/search/batch` | POST | Bulk search (up to 20 ISBNs) |
| `/libraries` | GET | List all TX library systems |
| `/libraries/:id` | GET | System details + branches + health |
| `/health` | GET | Service health |
| `/health/systems` | GET | Per-library-system health matrix |

### Phase 6: Testing & Quality

| Test Type | Coverage Target | What It Tests |
|---|---|---|
| Unit (adapters) | 85%+ per adapter | Fixture-based response parsing |
| Unit (orchestrator) | 90%+ | Fan-out, circuit breaker, retry, dedup |
| Contract | 100% adapters | Every adapter satisfies interface |
| Integration | Flag-gated | Real endpoints with known ISBNs |
| Load | N/A | 10 concurrent searches, 5 req/s sustained |
| E2E | N/A | Full POST->poll->results flow |

### Phase 7: Deployment & Operations

- OpenClaw deployment configuration
- Environment management (dev/staging/prod)
- Monitoring: per-adapter success rates, latency p50/p95/p99, cache hit ratio
- Alerting: >20% circuits open, p99 > 60s, error rate > 10%
- Runbooks: library unreachable, high latency, API key rotation, ILS migration

### Phase 8: Coverage Expansion (Ongoing)

| Milestone | Target |
|---|---|
| Launch | 80% of TX library systems searchable |
| 3 months | 90% coverage |
| 6 months | 95% coverage |

---

## 5. Dependency Graph

```
Phase 0 (Research) ---------> COMPLETE
    |
    v
Phase 1 (Foundation) -------> No external deps
    |
    v
Phase 2 (Adapters) ---------> Blocked by: API keys (WorldCat, Sierra, Polaris)
    |                          NOT blocked: Koha SRU (no auth), scrapers
    v
Phase 3 (Orchestration) ----> Needs: 2+ adapters from Phase 2
    |
    +---> Phase 4 (Caching) -> Can parallel with Phase 3
    |         |
    v         v
Phase 5 (API) --------------> Needs: orchestrator + cache
    |
    v
Phase 6 (Testing) ----------> Needs: functional API
    |
    v
Phase 7 (Deployment) -------> Needs: tested system
    |
    v
Phase 8 (Coverage) ---------> Ongoing post-launch
```

**Critical Path:** Phase 1 -> Koha SRU adapter -> Orchestrator -> Sync search endpoint
**First working vertical slice:** Search Koha libraries by ISBN, return results via API

---

## 6. Risk Register

| ID | Risk | Severity | Likelihood | Mitigation |
|---|---|---|---|---|
| R1 | OCLC WSKey denied/delayed | High | Medium | Apply early; build individual adapters in parallel |
| R2 | Sierra/Polaris API keys unobtainable | High | Medium | Fall back to Z39.50, then SRU, then scraping |
| R3 | Z39.50 npm packages incompatible with OpenClaw | Medium | Medium | Evaluate early; use SRU as fallback; shell out to yaz-client |
| R4 | Libraries rate-limit/block requests | High | High | 1 req/2s per host; cache aggressively; identify via User-Agent |
| R5 | Web scraper HTML changes | Medium | High | Monitor success rates; alert on empty results; monthly review |
| R6 | Fan-out resource exhaustion | High | Medium | Concurrency limits; connection pooling; load testing |
| R7 | Legal challenge for scraping | Medium | Low | Public data only; respect robots.txt; seek partnerships |
| R8 | Stale availability data | Low | High | Short TTL (1hr); `lastVerified` timestamps; disclaimer |
| R9 | ISBN edition complexity | Medium | High | ThingISBN for related ISBNs; search all variants |
| R10 | Library ILS migrations | Medium | High | Health monitoring; alerts; easy registry updates |
| R11 | OpenClaw runtime limitations | High | Medium | Investigate constraints in Phase 1; design stateless |
| R12 | Apollo (292 libraries) completely inaccessible | High | Medium | WorldCat may cover many; scrape OPAC; contact Biblionix |

---

## 7. External Dependencies Checklist

| Dependency | Blocks | Priority | Action |
|---|---|---|---|
| OCLC WSKey application | WorldCat adapter | **Critical** | Apply at oclc.org/developer ASAP |
| Sierra API keys (per library) | Sierra adapter | High | Contact Dallas, Tyler, Baytown IT |
| Polaris PAPI keys (per library) | Polaris adapter | High | Contact Fort Worth, Arlington, Fort Bend |
| SirsiDynix SWS access | Symphony adapter | High | Contact SirsiDynix partner channel |
| OpenClaw runtime docs | Phase 1 scaffolding | **Critical** | Verify: native addons? filesystem? memory? |
| Texas State Library partnership | Coverage expansion | Medium | Contact TSLAC for directory data |
| Biblionix vendor contact | Apollo API access | Medium | Ask if any API exists |

---

## 8. Success Metrics

| Metric | Target |
|---|---|
| Library system coverage (launch) | 80% of TX systems searchable |
| Library system coverage (6 months) | 95% |
| Population coverage | 90%+ of TX population served |
| Sync search latency p50 | < 5 seconds |
| Sync search latency p95 | < 15 seconds |
| Sync search latency p99 | < 30 seconds |
| Cache hit ratio (steady state) | > 40% |
| Per-adapter success rate | > 80% per system over 24 hours |
| Service uptime | 99.5% |
| False negative rate | < 2% (verified by spot-check) |

---

## 9. Open Questions

| # | Question | Needs Answer From |
|---|---|---|
| Q1 | OpenClaw runtime constraints (native addons? persistent FS? max memory?) | OpenClaw docs |
| Q2 | Does TSLAC maintain a machine-readable library directory? | TSLAC contact |
| Q3 | Do any TX consortia offer a single search endpoint? | Research follow-up |
| Q4 | OCLC WSKey timeline for non-institutional applicants? | OCLC developer support |
| Q5 | Should we support title/author search in addition to ISBN? | Product decision |
| Q6 | Budget for paid API access (OCLC, ISBNdb)? | Product decision |
| Q7 | How to handle consortium libraries (one config or many)? | Architecture decision |
| Q8 | Data retention policy for search history? | Product/legal decision |
| Q9 | Should results include distance/geolocation? | Product decision |
| Q10 | How to handle libraries requiring a library card for API access? | Research follow-up |

---

## 10. Key Reference URLs

| Resource | URL |
|---|---|
| Library Technology Guides (TX) | librarytechnology.org/libraries/search.pl?Type=Public&State=Texas |
| OCLC Developer Network | oclc.org/developer/ |
| WorldCat Search API v2 | oclc.org/developer/api/oclc-apis/worldcat-search-api.en.html |
| Library of Congress SRU | loc.gov/standards/sru/ |
| Open Library API | openlibrary.org/developers/api |
| Koha REST API | api.koha-community.org/ |
| Koha Web Services | koha-community.org/manual/23.11/en/html/webservices.html |
| IRSpy (Z39.50 Registry) | irspy.indexdata.com/ |
| OverDrive Developer Portal | developer.overdrive.com/ |
| LibraryThing ThingISBN | librarything.com/api |
| Texas State Library (TSLAC) | tsl.texas.gov/ |

---

*Plan generated by a 4-agent team: Research Agent 1 (TX library systems), Research Agent 2 (APIs & protocols), Architect Agent (TypeScript backend design), Planner Agent (project roadmap).*
