#!/usr/bin/env tsx
/**
 * Step 1: Extract catalog scan data from PostgreSQL into JSON files.
 *
 * Reads from the books, holdings, and scan_progress tables and writes
 * intermediate JSON files used by the Python map/chart/LaTeX pipeline.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool } from "../catalog-scan/db.js";
import { loadLibraryRegistry } from "../../config/library-registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..", "..", "..");
const OUTPUT_DIR = join(__dirname, "output", "data");

function writeJson(filename: string, data: unknown): void {
  const filePath = join(OUTPUT_DIR, filename);
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

async function main(): Promise<void> {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const pool = createPool({
    host: process.env.DB_HOST ?? "localhost",
    port: parseInt(process.env.DB_PORT ?? "5432", 10),
    database: process.env.DB_NAME ?? "argus",
    user: process.env.DATABASE_USER ?? "postgres",
    password: process.env.DATABASE_PASSWORD ?? "",
  });

  try {
    // ── Summary stats ─────────────────────────────────────────────────────
    const totalBooks = await pool.query("SELECT COUNT(*) AS count FROM books");
    const booksFound = await pool.query(
      "SELECT COUNT(DISTINCT isbn13) AS count FROM holdings",
    );
    const totalHoldings = await pool.query(
      "SELECT COUNT(*) AS count FROM holdings",
    );
    const systemCount = await pool.query(
      "SELECT COUNT(DISTINCT system_id) AS count FROM holdings",
    );

    const booksScanned = parseInt(totalBooks.rows[0].count, 10);
    const found = parseInt(booksFound.rows[0].count, 10);

    const summaryStats = {
      booksScanned,
      booksFound: found,
      booksNotFound: booksScanned - found,
      holdingsCount: parseInt(totalHoldings.rows[0].count, 10),
      systemCount: parseInt(systemCount.rows[0].count, 10),
    };
    writeJson("summary_stats.json", summaryStats);

    // ── Top books (all found, ranked by system count) ─────────────────────
    const topBooksResult = await pool.query(`
      SELECT
        b.isbn13,
        b.title,
        b.authors,
        b.year,
        b.publisher,
        COUNT(DISTINCT h.system_id) AS system_count,
        SUM(h.copy_count)           AS total_copies,
        SUM(h.available)            AS total_available
      FROM books b
      JOIN holdings h ON h.isbn13 = b.isbn13
      GROUP BY b.isbn13, b.title, b.authors, b.year, b.publisher
      ORDER BY system_count DESC, b.title
    `);

    const topBooks = topBooksResult.rows.map((r) => ({
      isbn13: r.isbn13,
      title: r.title,
      authors: r.authors,
      year: r.year,
      publisher: r.publisher,
      systemCount: parseInt(r.system_count, 10),
      totalCopies: parseInt(r.total_copies, 10),
      totalAvailable: parseInt(r.total_available, 10),
    }));
    writeJson("top_books.json", topBooks);

    // ── Top systems (all with holdings, ranked by books held) ─────────────
    const topSystemsResult = await pool.query(`
      SELECT
        h.system_id,
        h.system_name,
        COUNT(DISTINCT h.isbn13)    AS books_held,
        SUM(h.copy_count)           AS total_copies,
        SUM(h.available)            AS total_available,
        SUM(h.branch_count)         AS total_branches
      FROM holdings h
      GROUP BY h.system_id, h.system_name
      ORDER BY books_held DESC, h.system_name
    `);

    const topSystems = topSystemsResult.rows.map((r) => ({
      systemId: r.system_id,
      systemName: r.system_name,
      booksHeld: parseInt(r.books_held, 10),
      totalCopies: parseInt(r.total_copies, 10),
      totalAvailable: parseInt(r.total_available, 10),
      totalBranches: parseInt(r.total_branches, 10),
    }));
    writeJson("top_systems.json", topSystems);

    // ── System holdings (per-system book lists) ──────────────────────────
    const systemHoldingsResult = await pool.query(`
      SELECT
        h.system_id,
        h.system_name,
        b.isbn13,
        b.title,
        b.authors,
        b.year,
        h.copy_count,
        h.available,
        h.branch_count
      FROM holdings h
      JOIN books b ON b.isbn13 = h.isbn13
      ORDER BY h.system_id, b.title
    `);

    const systemHoldings: Record<
      string,
      {
        systemId: string;
        systemName: string;
        books: {
          isbn13: string;
          title: string;
          authors: string[];
          year: string | null;
          copies: number;
          available: number;
          branches: number;
        }[];
      }
    > = {};

    for (const r of systemHoldingsResult.rows) {
      if (!systemHoldings[r.system_id]) {
        systemHoldings[r.system_id] = {
          systemId: r.system_id,
          systemName: r.system_name,
          books: [],
        };
      }
      systemHoldings[r.system_id].books.push({
        isbn13: r.isbn13,
        title: r.title,
        authors: r.authors ?? [],
        year: r.year,
        copies: r.copy_count,
        available: r.available,
        branches: r.branch_count,
      });
    }
    writeJson("system_holdings.json", systemHoldings);

    // ── Not-found books ──────────────────────────────────────────────────
    const notFoundResult = await pool.query(`
      SELECT b.isbn13, b.title, b.authors, b.year, b.publisher
      FROM books b
      LEFT JOIN holdings h ON h.isbn13 = b.isbn13
      WHERE h.isbn13 IS NULL
      ORDER BY b.title
    `);

    const notFoundBooks = notFoundResult.rows.map((r) => ({
      isbn13: r.isbn13,
      title: r.title,
      authors: r.authors ?? [],
      year: r.year,
      publisher: r.publisher,
    }));
    writeJson("not_found_books.json", notFoundBooks);

    // ── System metadata (from YAML configs) ──────────────────────────────
    const configDir = join(PROJECT_ROOT, "src", "config", "libraries");
    const systems = loadLibraryRegistry(configDir);

    const systemMetadata = systems.map((sys) => ({
      id: sys.id,
      name: sys.name,
      region: sys.region,
      city: sys.branches[0]?.city ?? null,
      vendor: sys.vendor,
      enabled: sys.enabled,
      protocol: sys.adapters[0]?.protocol ?? null,
    }));
    writeJson("system_metadata.json", systemMetadata);

    console.log(
      `Extracted: ${summaryStats.booksFound} books found, ` +
        `${summaryStats.booksNotFound} not found, ` +
        `${summaryStats.holdingsCount} holdings across ` +
        `${summaryStats.systemCount} systems`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
