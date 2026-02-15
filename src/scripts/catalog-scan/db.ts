import pg from "pg";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProgressiveBook, SystemHoldings } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface DbConnectOptions {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  connectionString?: string;
}

export function createPool(opts: DbConnectOptions): pg.Pool {
  const poolOpts: pg.PoolConfig = opts.connectionString
    ? { connectionString: opts.connectionString, max: 8 }
    : {
        host: opts.host ?? "localhost",
        port: opts.port ?? 5432,
        database: opts.database ?? "argus",
        user: opts.user,
        password: opts.password,
        max: 8,
      };
  const pool = new pg.Pool(poolOpts);
  // Prevent unhandled 'error' events from crashing the process.
  // Dead connections are automatically removed and replaced by the pool.
  pool.on("error", (err) => {
    console.error("Postgres pool background error:", err.message);
  });
  return pool;
}

export async function initSchema(pool: pg.Pool): Promise<void> {
  const sql = readFileSync(join(__dirname, "schema.sql"), "utf-8");
  await pool.query(sql);
}

export async function upsertBook(
  pool: pg.Pool,
  book: ProgressiveBook,
): Promise<void> {
  await pool.query(
    `INSERT INTO books (isbn13, isbn10, title, authors, year, publisher)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (isbn13) DO UPDATE SET
       isbn10 = EXCLUDED.isbn10,
       title = EXCLUDED.title,
       authors = EXCLUDED.authors,
       year = EXCLUDED.year,
       publisher = EXCLUDED.publisher`,
    [
      book.isbn_13,
      book.isbn_10 || null,
      book.title,
      book.authors,
      book.year ? String(book.year) : null,
      book.publisher || null,
    ],
  );
}

export async function upsertHoldings(
  pool: pg.Pool,
  isbn13: string,
  system: SystemHoldings,
): Promise<void> {
  await pool.query(
    `INSERT INTO holdings (isbn13, system_id, system_name, branch_count, copy_count, available, catalog_url, raw_holdings, scanned_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (isbn13, system_id) DO UPDATE SET
       system_name = EXCLUDED.system_name,
       branch_count = EXCLUDED.branch_count,
       copy_count = EXCLUDED.copy_count,
       available = EXCLUDED.available,
       catalog_url = EXCLUDED.catalog_url,
       raw_holdings = EXCLUDED.raw_holdings,
       scanned_at = NOW()`,
    [
      isbn13,
      system.systemId,
      system.systemName,
      system.branchCount,
      system.copyCount,
      system.available,
      system.catalogUrl,
      JSON.stringify(system.holdings),
    ],
  );
}

export async function markScanned(
  pool: pg.Pool,
  isbn13: string,
  stats: {
    systemsSearched: number;
    systemsFound: number;
    errorsCount: number;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO scan_progress (isbn13, completed, systems_searched, systems_found, errors_count, scanned_at)
     VALUES ($1, TRUE, $2, $3, $4, NOW())
     ON CONFLICT (isbn13) DO UPDATE SET
       completed = TRUE,
       systems_searched = EXCLUDED.systems_searched,
       systems_found = EXCLUDED.systems_found,
       errors_count = EXCLUDED.errors_count,
       scanned_at = NOW()`,
    [isbn13, stats.systemsSearched, stats.systemsFound, stats.errorsCount],
  );
}

export async function getCompletedIsbns(pool: pg.Pool): Promise<Set<string>> {
  const result = await pool.query(
    "SELECT isbn13 FROM scan_progress WHERE completed = TRUE",
  );
  return new Set(result.rows.map((r: { isbn13: string }) => r.isbn13));
}

export async function createScanRun(
  pool: pg.Pool,
  opts: {
    workerId: number;
    totalWorkers: number;
    booksTotal: number;
  },
): Promise<number> {
  const result = await pool.query(
    `INSERT INTO scan_runs (worker_id, total_workers, books_total, status)
     VALUES ($1, $2, $3, 'running')
     RETURNING id`,
    [opts.workerId, opts.totalWorkers, opts.booksTotal],
  );
  return result.rows[0].id as number;
}

export async function updateScanRunProgress(
  pool: pg.Pool,
  runId: number,
  booksScanned: number,
): Promise<void> {
  await pool.query(
    "UPDATE scan_runs SET books_scanned = $1 WHERE id = $2",
    [booksScanned, runId],
  );
}

export async function completeScanRun(
  pool: pg.Pool,
  runId: number,
  status: "completed" | "interrupted",
): Promise<void> {
  await pool.query(
    "UPDATE scan_runs SET finished_at = NOW(), status = $1 WHERE id = $2",
    [status, runId],
  );
}
