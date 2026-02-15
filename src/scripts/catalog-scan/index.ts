#!/usr/bin/env tsx
import { parseArgs } from "node:util";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pLimit from "p-limit";
import {
  createPool,
  initSchema,
  upsertBook,
  upsertHoldings,
  markScanned,
  getCompletedIsbns,
  createScanRun,
  updateScanRunProgress,
  completeScanRun,
} from "./db.js";
import { searchByIsbn } from "./api-client.js";
import { loadBooks, shardBooks } from "./book-loader.js";
import { createStats, printProgress, printSummary } from "./progress.js";
import type { DbConnectOptions } from "./db.js";
import type { ScanOptions, SystemHoldings, ApiBookHolding } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..", "..", "..");

function parseCliArgs(): ScanOptions {
  const { values } = parseArgs({
    options: {
      "db-host": { type: "string", default: "localhost" },
      "db-port": { type: "string", default: "5432" },
      "db-name": { type: "string", default: "argus" },
      "api-url": { type: "string", default: "http://localhost:3010" },
      concurrency: { type: "string", default: "3" },
      delay: { type: "string", default: "2000" },
      worker: { type: "string", default: "0" },
      "total-workers": { type: "string", default: "1" },
      resume: { type: "boolean", default: true },
      "dry-run": { type: "boolean", default: false },
      timeout: { type: "string", default: "120000" },
    },
    strict: true,
  });

  return {
    dbHost: values["db-host"]!,
    dbPort: parseInt(values["db-port"]!, 10),
    dbName: values["db-name"]!,
    dbUser: process.env.DATABASE_USER ?? "postgres",
    dbPassword: process.env.DATABASE_PASSWORD ?? "",
    apiUrl: values["api-url"]!,
    concurrency: parseInt(values.concurrency!, 10),
    delay: parseInt(values.delay!, 10),
    workerId: parseInt(values.worker!, 10),
    totalWorkers: parseInt(values["total-workers"]!, 10),
    resume: values.resume!,
    dryRun: values["dry-run"]!,
    timeout: parseInt(values.timeout!, 10),
  };
}

/** Aggregate holdings by systemId */
function aggregateBySystem(
  holdings: ApiBookHolding[],
): Map<string, SystemHoldings> {
  const systems = new Map<string, SystemHoldings>();

  for (const h of holdings) {
    let sys = systems.get(h.systemId);
    if (!sys) {
      sys = {
        systemId: h.systemId,
        systemName: h.systemName,
        branchCount: 0,
        copyCount: 0,
        available: 0,
        catalogUrl: h.catalogUrl,
        holdings: [],
      };
      systems.set(h.systemId, sys);
    }
    sys.holdings.push(h);
    sys.copyCount += h.copyCount ?? 1;
    if (h.status === "available") {
      sys.available += h.copyCount ?? 1;
    }
  }

  // Count unique branches per system
  for (const sys of systems.values()) {
    const branches = new Set(sys.holdings.map((h) => h.branchId || h.branchName));
    sys.branchCount = branches.size;
  }

  return systems;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const opts = parseCliArgs();
  const booksPath = join(PROJECT_ROOT, "progressive_books.json");

  console.log("Catalog Scan - Full Book x Library Matrix");
  console.log("=========================================");
  console.log(`  API:         ${opts.apiUrl}`);
  console.log(`  Concurrency: ${opts.concurrency}`);
  console.log(`  Delay:       ${opts.delay}ms`);
  console.log(`  Worker:      ${opts.workerId + 1}/${opts.totalWorkers}`);
  console.log(`  Resume:      ${opts.resume}`);
  console.log(`  Dry run:     ${opts.dryRun}`);
  console.log(`  Timeout:     ${opts.timeout}ms`);
  console.log();

  // Load and shard books
  const allBooks = loadBooks(booksPath);
  const myBooks = shardBooks(allBooks, opts.workerId, opts.totalWorkers);
  console.log(
    `Loaded ${allBooks.length} books, this worker handles ${myBooks.length}`,
  );

  if (opts.dryRun) {
    console.log("\n--- DRY RUN: Books assigned to this worker ---");
    for (const book of myBooks) {
      console.log(`  ${book.isbn_13}  ${book.title}`);
    }
    console.log(`\nTotal: ${myBooks.length} books`);
    return;
  }

  // Connect to database
  const pool = createPool({
    host: opts.dbHost,
    port: opts.dbPort,
    database: opts.dbName,
    user: opts.dbUser,
    password: opts.dbPassword,
  });
  try {
    await initSchema(pool);
    console.log("Database schema initialized.");

    // Filter already-completed books
    let books = myBooks;
    if (opts.resume) {
      const completed = await getCompletedIsbns(pool);
      const before = books.length;
      books = books.filter((b) => !completed.has(b.isbn_13));
      if (before !== books.length) {
        console.log(
          `Resuming: skipping ${before - books.length} already-scanned books`,
        );
      }
    }

    if (books.length === 0) {
      console.log("All books already scanned. Nothing to do.");
      return;
    }

    // Create scan run
    const runId = await createScanRun(pool, {
      workerId: opts.workerId,
      totalWorkers: opts.totalWorkers,
      booksTotal: books.length,
    });
    console.log(`Scan run #${runId} started with ${books.length} books.\n`);

    const stats = createStats(books.length);
    const limit = pLimit(opts.concurrency);

    // Handle graceful shutdown
    let interrupted = false;
    const onSignal = () => {
      interrupted = true;
      console.log("\nInterrupted. Finishing current books...");
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);

    const tasks = books.map((book) =>
      limit(async () => {
        if (interrupted) return;

        try {
          // Search via argus API
          const result = await searchByIsbn(
            opts.apiUrl,
            book.isbn_13,
            opts.timeout,
          );

          // Upsert book record
          await upsertBook(pool, book);

          // Aggregate and store holdings by system
          const systems = aggregateBySystem(result.holdings);
          for (const sys of systems.values()) {
            await upsertHoldings(pool, book.isbn_13, sys);
          }

          // Mark as scanned
          await markScanned(pool, book.isbn_13, {
            systemsSearched: result.systemsSearched,
            systemsFound: systems.size,
            errorsCount: result.errors.length,
          });

          stats.scanned++;
          if (systems.size > 0) {
            stats.found++;
          } else {
            stats.notFound++;
          }

          // Update scan run progress periodically
          if (stats.scanned % 10 === 0) {
            await updateScanRunProgress(pool, runId, stats.scanned);
          }

          printProgress(stats, book.title);
        } catch (err) {
          stats.scanned++;
          stats.errors++;
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`\nError scanning ${book.isbn_13} (${book.title}): ${msg}`);
        }

        // Rate limiting delay
        if (!interrupted) {
          await sleep(opts.delay);
        }
      }),
    );

    await Promise.all(tasks);

    // Finalize
    await updateScanRunProgress(pool, runId, stats.scanned);
    await completeScanRun(
      pool,
      runId,
      interrupted ? "interrupted" : "completed",
    );

    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);

    printSummary(stats);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
