#!/usr/bin/env tsx
/**
 * Quick test: scan a single book against all libraries and display results.
 * Usage: DATABASE_USER=x DATABASE_PASSWORD=y npx tsx src/scripts/catalog-scan/test-one-book.ts
 */
import { createPool, initSchema, upsertBook, upsertHoldings, markScanned } from "./db.js";
import { searchByIsbn } from "./api-client.js";
import type { SystemHoldings } from "./types.js";

const pool = createPool({
  host: "localhost",
  port: 5432,
  database: "argus",
  user: process.env.DATABASE_USER ?? "postgres",
  password: process.env.DATABASE_PASSWORD ?? "",
});
try {
  await initSchema(pool);
  console.log("Schema initialized.\n");

  const book = {
    title: "Gender queer",
    authors: ["Kobabe, Maia"],
    isbn_13: "9781549304002",
    isbn_10: "1549304003",
    year: 2019,
    publisher: "Oni Press",
  };

  console.log(`Searching: "${book.title}" (${book.isbn_13})`);
  console.log("This fans out to ~260 library systems...\n");

  const result = await searchByIsbn("http://localhost:3010", book.isbn_13, 120_000);

  console.log(`Systems searched: ${result.systemsSearched}`);
  console.log(`Holdings found:   ${result.holdings.length}`);
  console.log(`Errors:           ${result.errors.length}`);

  // Upsert book
  await upsertBook(pool, book);

  // Aggregate by system
  const systems = new Map<string, SystemHoldings>();
  for (const h of result.holdings) {
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
    if (h.status === "available") sys.available += h.copyCount ?? 1;
  }
  for (const sys of systems.values()) {
    const branches = new Set(sys.holdings.map((h) => h.branchId || h.branchName));
    sys.branchCount = branches.size;
  }

  // Store holdings
  for (const sys of systems.values()) {
    await upsertHoldings(pool, book.isbn_13, sys);
  }

  // Mark scanned
  await markScanned(pool, book.isbn_13, {
    systemsSearched: result.systemsSearched,
    systemsFound: systems.size,
    errorsCount: result.errors.length,
  });

  console.log(`\nStored ${systems.size} system holdings in database.\n`);
  console.log("=== Systems holding this book ===");
  const sorted = [...systems.values()].sort((a, b) => a.systemName.localeCompare(b.systemName));
  for (const sys of sorted) {
    const avail = sys.available > 0 ? `${sys.available} available` : "none available";
    console.log(`  ${sys.systemName}: ${sys.copyCount} copies (${avail}) across ${sys.branchCount} branch(es)`);
  }

  // Query back from DB to verify
  console.log("\n=== Database verification ===");
  const bookRow = await pool.query("SELECT * FROM books WHERE isbn13 = $1", [book.isbn_13]);
  console.log(`books table: ${bookRow.rowCount} row(s)`);

  const holdingsRows = await pool.query("SELECT system_name, copy_count, available, branch_count FROM holdings WHERE isbn13 = $1 ORDER BY system_name", [book.isbn_13]);
  console.log(`holdings table: ${holdingsRows.rowCount} row(s)`);

  const progressRow = await pool.query("SELECT * FROM scan_progress WHERE isbn13 = $1", [book.isbn_13]);
  console.log(`scan_progress: systems_searched=${progressRow.rows[0].systems_searched}, systems_found=${progressRow.rows[0].systems_found}, errors=${progressRow.rows[0].errors_count}`);

  console.log("\n=== book_library_report view (sample) ===");
  const report = await pool.query("SELECT title, system_name, copy_count, available FROM book_library_report LIMIT 10");
  for (const r of report.rows) {
    console.log(`  ${r.title} | ${r.system_name} | copies: ${r.copy_count} | avail: ${r.available}`);
  }

  console.log("\nDone.");
} finally {
  await pool.end();
}
