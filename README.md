# Argus

Argus is a TypeScript backend service that searches every public library system in Texas by ISBN and returns consolidated availability information. Its purpose is to identify which libraries carry books that are harmful to children, enabling parents and communities to take informed action.

Texas has 892 public library facilities across 50+ independent library systems using 9+ different ILS (Integrated Library System) vendors, but no statewide union catalog exists. Argus unifies all of them into a single search.

## How It Works

Given an ISBN, Argus fans out queries in parallel across all configured Texas library systems, normalizes the heterogeneous responses, and returns a unified result showing which branches hold copies, their availability status, and collection details.

## Supported Library Systems

Argus implements adapters for the major ILS platforms used across Texas:

| Adapter | Protocol | Example Systems |
|---------|----------|-----------------|
| **SirsiDynix Enterprise** | HTML scraping | Houston, Harris County, El Paso, Plano |
| **BiblioCommons** | HTML scraping | Austin, San Antonio |
| **Polaris PAPI** | REST/XML+JSON | Fort Worth, Arlington, Fort Bend County |
| **Koha SRU** | SRU/HTTP+XML | Carrollton, Cedar Park, Corpus Christi |
| **WorldCat** | OCLC API v2 | Broad coverage (~45-67% of TX libraries) |
| **Sierra** | REST/JSON | Select systems |
| **TLC** | Web scraping | McAllen, Waco |
| **Generic SRU** | SRU/HTTP+XML | Fallback for SRU-compatible systems |

16 library systems are currently configured, with more planned.

## Architecture

```
Client (ISBN query)
        │
        v
   Hono REST API
        │
        v
  Search Coordinator
  (fan-out, circuit breakers, rate limiting, retries)
        │
        v
  Adapter Registry
        │
        ├── SirsiDynix Scraper
        ├── BiblioCommons Scraper
        ├── Polaris PAPI
        ├── Koha SRU
        ├── WorldCat API
        ├── Sierra REST
        ├── TLC Web Scraper
        └── Generic SRU
        │
        v
  Result Aggregator
  (dedup, normalize, merge)
        │
        v
  Unified Response
```

### Resilience

- **Circuit breakers** per library system (opens after 5 consecutive failures)
- **Per-host rate limiting** (respects each library's capacity)
- **Global concurrency cap** (max 20 concurrent requests)
- **Exponential backoff retries** with budget caps
- **Timeout cascade** (per-request, per-system, global)
- **LRU cache** with TTL for search results

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/search?isbn=<isbn>` | GET | Synchronous search (blocks until complete) |
| `/search` | POST | Async search (returns `searchId` to poll) |
| `/search/:searchId` | GET | Poll for async results |
| `/libraries` | GET | List all configured library systems |
| `/libraries/:id` | GET | Single system details + branches |
| `/health` | GET | Service health |
| `/health/systems` | GET | Per-system metrics |

## Quick Start

```bash
npm install
npm run dev        # Development with hot reload (port 3000)
npm run build      # Compile TypeScript
npm start          # Production
npm test           # Run tests
```

## Configuration

Each library system is defined in a YAML file under `src/config/libraries/`. Example:

```yaml
id: houston-public
name: Houston Public Library
vendor: sirsi_dynix
region: Harris County
catalogUrl: https://halan.sdp.sirsi.net/client/en_US/hou/
enabled: true

branches:
  - id: houston-public:central
    name: Central Library
    code: central
    city: Houston

adapters:
  - protocol: sirsi_enterprise_scrape
    baseUrl: https://halan.sdp.sirsi.net
    timeoutMs: 10000
    maxConcurrency: 2
```

## Book Lists

`progressive_books.json` contains a curated list of books to search for, with full bibliographic data including ISBNs, authors, publishers, and descriptions.

## Tech Stack

- **Runtime:** Node.js + TypeScript 5.6
- **Framework:** Hono
- **Validation:** Zod (branded types for ISBN, system IDs)
- **Parsing:** Cheerio (HTML), fast-xml-parser (XML/SRU), @natlibfi/marc-record (MARC)
- **Resilience:** Bottleneck (rate limiting), p-limit (semaphore), p-retry (backoff)
- **Caching:** lru-cache
- **Logging:** Pino
- **Testing:** Vitest
