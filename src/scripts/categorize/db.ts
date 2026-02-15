import pg from "pg";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { UncategorizedBook, BookCategory, ClassificationResult } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export { createPool } from "../catalog-scan/db.js";

export async function initCategorySchema(pool: pg.Pool): Promise<void> {
  const sql = readFileSync(join(__dirname, "schema.sql"), "utf-8");
  await pool.query(sql);
}

/** Get books that haven't been categorized yet. */
export async function getUncategorizedBooks(
  pool: pg.Pool,
): Promise<UncategorizedBook[]> {
  const result = await pool.query(`
    SELECT b.isbn13, b.title, b.authors, b.year, b.publisher
    FROM books b
    LEFT JOIN book_categories bc ON bc.isbn13 = b.isbn13
    WHERE bc.isbn13 IS NULL
    ORDER BY b.title
  `);
  return result.rows.map((r) => ({
    isbn13: r.isbn13,
    title: r.title,
    authors: r.authors ?? [],
    year: r.year,
    publisher: r.publisher,
  }));
}

/** Get books with low confidence that haven't been enriched yet. */
export async function getLowConfidenceBooks(
  pool: pg.Pool,
  threshold: number = 0.7,
): Promise<UncategorizedBook[]> {
  const result = await pool.query(
    `SELECT b.isbn13, b.title, b.authors, b.year, b.publisher
     FROM books b
     JOIN book_categories bc ON bc.isbn13 = b.isbn13
     WHERE bc.confidence < $1 AND bc.enriched = FALSE
     ORDER BY bc.confidence ASC`,
    [threshold],
  );
  return result.rows.map((r) => ({
    isbn13: r.isbn13,
    title: r.title,
    authors: r.authors ?? [],
    year: r.year,
    publisher: r.publisher,
  }));
}

/** Upsert a classification result into book_categories. */
export async function upsertCategory(
  pool: pg.Pool,
  result: ClassificationResult,
  opts: { modelId: string; enriched?: boolean; rawResponse?: unknown },
): Promise<void> {
  await pool.query(
    `INSERT INTO book_categories (isbn13, audience, topics, confidence, source, enriched, model_id, raw_response, classified_at)
     VALUES ($1, $2, $3, $4, 'claude', $5, $6, $7, NOW())
     ON CONFLICT (isbn13) DO UPDATE SET
       audience = EXCLUDED.audience,
       topics = EXCLUDED.topics,
       confidence = EXCLUDED.confidence,
       enriched = EXCLUDED.enriched,
       model_id = EXCLUDED.model_id,
       raw_response = EXCLUDED.raw_response,
       classified_at = NOW()`,
    [
      result.isbn13,
      result.audience,
      result.topics,
      result.confidence,
      opts.enriched ?? false,
      opts.modelId,
      opts.rawResponse ? JSON.stringify(opts.rawResponse) : null,
    ],
  );
}

/** Bulk upsert classification results. */
export async function upsertCategories(
  pool: pg.Pool,
  results: ClassificationResult[],
  opts: { modelId: string; enriched?: boolean; rawResponse?: unknown },
): Promise<void> {
  for (const result of results) {
    await upsertCategory(pool, result, opts);
  }
}

/** Get summary stats for categories. */
export async function getCategorySummary(
  pool: pg.Pool,
): Promise<{
  total: number;
  byAudience: Record<string, number>;
  byTopic: Record<string, number>;
  avgConfidence: number;
  lowConfidenceCount: number;
}> {
  const totalResult = await pool.query(
    "SELECT COUNT(*) AS count FROM book_categories",
  );
  const total = parseInt(totalResult.rows[0].count, 10);

  const audienceResult = await pool.query(
    "SELECT audience, COUNT(*) AS count FROM book_categories GROUP BY audience ORDER BY count DESC",
  );
  const byAudience: Record<string, number> = {};
  for (const r of audienceResult.rows) {
    byAudience[r.audience] = parseInt(r.count, 10);
  }

  const topicResult = await pool.query(
    "SELECT unnest(topics) AS topic, COUNT(*) AS count FROM book_categories GROUP BY topic ORDER BY count DESC",
  );
  const byTopic: Record<string, number> = {};
  for (const r of topicResult.rows) {
    byTopic[r.topic] = parseInt(r.count, 10);
  }

  const avgResult = await pool.query(
    "SELECT AVG(confidence) AS avg, COUNT(*) FILTER (WHERE confidence < 0.7) AS low FROM book_categories",
  );

  return {
    total,
    byAudience,
    byTopic,
    avgConfidence: parseFloat(avgResult.rows[0].avg ?? "0"),
    lowConfidenceCount: parseInt(avgResult.rows[0].low, 10),
  };
}

/** Get all categories for the review report. */
export async function getAllCategories(pool: pg.Pool): Promise<BookCategory[]> {
  const result = await pool.query(`
    SELECT isbn13, audience, topics, confidence, source, enriched, model_id, classified_at
    FROM book_categories
    ORDER BY confidence ASC, isbn13
  `);
  return result.rows.map((r) => ({
    isbn13: r.isbn13,
    audience: r.audience,
    topics: r.topics,
    confidence: r.confidence,
    source: r.source,
    enriched: r.enriched,
    model_id: r.model_id,
    classified_at: r.classified_at,
  }));
}
