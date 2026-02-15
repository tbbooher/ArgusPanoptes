#!/usr/bin/env tsx
/**
 * Prebuild script: queries PostgreSQL and YAML configs to generate
 * static JSON files for the Next.js site in public/data/.
 */
import pg from "pg";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = join(__dirname, "..");
const PROJECT_ROOT = join(SITE_ROOT, "..");
const OUTPUT_DIR = join(SITE_ROOT, "public", "data");

const AUDIENCE_LABELS: Record<string, string> = {
  young_children: "Young Children (0-8)",
  middle_grade: "Middle Grade (8-12)",
  young_adult: "Young Adult (12-18)",
  adult: "Adult (18+)",
};

const TOPIC_LABELS: Record<string, string> = {
  lgbtq_identity: "LGBTQ+ Identity & Relationships",
  gender_identity: "Gender Identity & Expression",
  race_and_racism: "Race, Racism & Racial Justice",
  sex_education: "Sex Education & Sexuality",
  social_justice: "Social Justice & Equity",
  mental_health: "Mental Health & Suicide",
  religious_viewpoints: "Religious Viewpoints & Criticism",
  drug_and_alcohol: "Drugs, Alcohol & Substance Use",
  violence_and_abuse: "Violence, Abuse & Trauma",
  death_and_grief: "Death, Grief & End of Life",
  family_and_divorce: "Family Structures & Divorce",
  body_image: "Body Image & Eating Disorders",
  political_activism: "Political Activism & Protest",
  witchcraft_and_occult: "Witchcraft, Occult & Supernatural",
  profanity_and_language: "Profanity & Explicit Language",
};

function writeJson(filename: string, data: unknown): void {
  writeFileSync(join(OUTPUT_DIR, filename), JSON.stringify(data, null, 2));
  console.log(`  Wrote ${filename}`);
}

async function main(): Promise<void> {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const pool = new pg.Pool({
    host: process.env.DB_HOST ?? "localhost",
    port: parseInt(process.env.DB_PORT ?? "5432", 10),
    database: process.env.DB_NAME ?? "argus",
    user: process.env.DATABASE_USER ?? "postgres",
    password: process.env.DATABASE_PASSWORD ?? "",
    max: 4,
  });

  pool.on("error", (err) => {
    console.error("Pool error:", err.message);
  });

  try {
    console.log("Generating static data...\n");

    // ── Load geocoding data ───────────────────────────────────────────────
    const coordsPath = join(
      PROJECT_ROOT,
      "src",
      "scripts",
      "report",
      "tx_city_coords.json",
    );
    const coords: Record<string, [number, number]> = JSON.parse(
      readFileSync(coordsPath, "utf-8"),
    );

    // ── Load library configs ──────────────────────────────────────────────
    // Dynamic import since it uses the parent project's module system
    const { loadLibraryRegistry } = await import(
      join(PROJECT_ROOT, "src", "config", "library-registry.js")
    );
    const configDir = join(PROJECT_ROOT, "src", "config", "libraries");
    const systems = loadLibraryRegistry(configDir);

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

    // Check if book_categories table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'book_categories'
      ) AS exists
    `);
    const hasCategoryTable = tableCheck.rows[0].exists;

    let categorizedCount = 0;
    if (hasCategoryTable) {
      const catCount = await pool.query(
        "SELECT COUNT(*) AS count FROM book_categories",
      );
      categorizedCount = parseInt(catCount.rows[0].count, 10);
    }

    const booksScanned = parseInt(totalBooks.rows[0].count, 10);
    const found = parseInt(booksFound.rows[0].count, 10);

    writeJson("summary-stats.json", {
      booksScanned,
      booksFound: found,
      booksNotFound: booksScanned - found,
      holdingsCount: parseInt(totalHoldings.rows[0].count, 10),
      systemCount: parseInt(systemCount.rows[0].count, 10),
      categorizedCount,
    });

    // ── Books with categories ─────────────────────────────────────────────
    const booksQuery = hasCategoryTable
      ? `SELECT
           b.isbn13, b.title, b.authors, b.year, b.publisher,
           COUNT(DISTINCT h.system_id) AS system_count,
           COALESCE(SUM(h.copy_count), 0) AS total_copies,
           COALESCE(SUM(h.available), 0) AS total_available,
           bc.audience, bc.topics, bc.confidence
         FROM books b
         LEFT JOIN holdings h ON h.isbn13 = b.isbn13
         LEFT JOIN book_categories bc ON bc.isbn13 = b.isbn13
         GROUP BY b.isbn13, b.title, b.authors, b.year, b.publisher,
                  bc.audience, bc.topics, bc.confidence
         ORDER BY system_count DESC, b.title`
      : `SELECT
           b.isbn13, b.title, b.authors, b.year, b.publisher,
           COUNT(DISTINCT h.system_id) AS system_count,
           COALESCE(SUM(h.copy_count), 0) AS total_copies,
           COALESCE(SUM(h.available), 0) AS total_available,
           NULL AS audience, NULL AS topics, NULL AS confidence
         FROM books b
         LEFT JOIN holdings h ON h.isbn13 = b.isbn13
         GROUP BY b.isbn13, b.title, b.authors, b.year, b.publisher
         ORDER BY system_count DESC, b.title`;

    const booksResult = await pool.query(booksQuery);
    const books = booksResult.rows.map((r) => ({
      isbn13: r.isbn13,
      title: r.title,
      authors: r.authors ?? [],
      year: r.year,
      publisher: r.publisher,
      systemCount: parseInt(r.system_count, 10),
      totalCopies: parseInt(r.total_copies, 10),
      totalAvailable: parseInt(r.total_available, 10),
      audience: r.audience ?? null,
      topics: r.topics ?? [],
      confidence: r.confidence ? parseFloat(r.confidence) : null,
    }));
    writeJson("books.json", books);

    // ── Book detail pages (with holding libraries) ────────────────────────
    const holdingsResult = await pool.query(`
      SELECT h.isbn13, h.system_id, h.system_name,
             h.copy_count, h.available, h.branch_count
      FROM holdings h
      ORDER BY h.isbn13, h.system_name
    `);

    // Build system metadata map
    const systemMeta = new Map<
      string,
      { city: string | null; lat: number | null; lng: number | null }
    >();
    for (const sys of systems) {
      const city = sys.branches[0]?.city ?? null;
      const coordPair = city ? coords[city] ?? null : null;
      systemMeta.set(sys.id, {
        city,
        lat: coordPair ? coordPair[0] : null,
        lng: coordPair ? coordPair[1] : null,
      });
    }

    const holdingsByBook = new Map<
      string,
      {
        systemId: string;
        systemName: string;
        copies: number;
        available: number;
        branches: number;
        lat: number | null;
        lng: number | null;
        city: string | null;
      }[]
    >();

    for (const r of holdingsResult.rows) {
      const list = holdingsByBook.get(r.isbn13) ?? [];
      const meta = systemMeta.get(r.system_id);
      list.push({
        systemId: r.system_id,
        systemName: r.system_name,
        copies: r.copy_count,
        available: r.available,
        branches: r.branch_count,
        lat: meta?.lat ?? null,
        lng: meta?.lng ?? null,
        city: meta?.city ?? null,
      });
      holdingsByBook.set(r.isbn13, list);
    }

    const bookDetails = books.map((b) => ({
      ...b,
      libraries: holdingsByBook.get(b.isbn13) ?? [],
    }));
    writeJson("book-details.json", bookDetails);

    // ── Libraries ─────────────────────────────────────────────────────────
    const topSystemsResult = await pool.query(`
      SELECT h.system_id, h.system_name,
             COUNT(DISTINCT h.isbn13) AS books_held,
             COALESCE(SUM(h.copy_count), 0) AS total_copies,
             COALESCE(SUM(h.available), 0) AS total_available
      FROM holdings h
      GROUP BY h.system_id, h.system_name
      ORDER BY books_held DESC
    `);

    const statsMap = new Map(
      topSystemsResult.rows.map((r) => [
        r.system_id,
        {
          booksHeld: parseInt(r.books_held, 10),
          totalCopies: parseInt(r.total_copies, 10),
          totalAvailable: parseInt(r.total_available, 10),
        },
      ]),
    );

    const libraries = systems.map((sys: any) => {
      const city = sys.branches[0]?.city ?? null;
      const coordPair = city ? coords[city] ?? null : null;
      const stats = statsMap.get(sys.id);
      return {
        id: sys.id,
        name: sys.name,
        city,
        region: sys.region,
        vendor: sys.vendor,
        enabled: sys.enabled,
        protocol: sys.adapters[0]?.protocol ?? null,
        lat: coordPair ? coordPair[0] : null,
        lng: coordPair ? coordPair[1] : null,
        booksHeld: stats?.booksHeld ?? 0,
        totalCopies: stats?.totalCopies ?? 0,
        totalAvailable: stats?.totalAvailable ?? 0,
      };
    });
    writeJson("libraries.json", libraries);

    // ── Library detail pages (with held books) ────────────────────────────
    const systemHoldingsResult = await pool.query(`
      SELECT h.system_id, b.isbn13, b.title, b.authors, b.year,
             h.copy_count, h.available, h.branch_count
      FROM holdings h
      JOIN books b ON b.isbn13 = h.isbn13
      ORDER BY h.system_id, b.title
    `);

    const booksBySystem = new Map<
      string,
      {
        isbn13: string;
        title: string;
        authors: string[];
        year: string | null;
        copies: number;
        available: number;
        branches: number;
      }[]
    >();

    for (const r of systemHoldingsResult.rows) {
      const list = booksBySystem.get(r.system_id) ?? [];
      list.push({
        isbn13: r.isbn13,
        title: r.title,
        authors: r.authors ?? [],
        year: r.year,
        copies: r.copy_count,
        available: r.available,
        branches: r.branch_count,
      });
      booksBySystem.set(r.system_id, list);
    }

    const libraryDetails = libraries.map((lib: any) => ({
      ...lib,
      books: booksBySystem.get(lib.id) ?? [],
    }));
    writeJson("library-details.json", libraryDetails);

    // ── Map markers (only geocoded libraries) ─────────────────────────────
    const mapMarkers = libraries
      .filter((lib: any) => lib.lat !== null && lib.lng !== null && lib.enabled)
      .map((lib: any) => ({
        id: lib.id,
        name: lib.name,
        city: lib.city,
        lat: lib.lat,
        lng: lib.lng,
        booksHeld: lib.booksHeld,
        totalCopies: lib.totalCopies,
        vendor: lib.vendor,
        region: lib.region,
      }));
    writeJson("map-markers.json", mapMarkers);

    // ── Category summaries ────────────────────────────────────────────────
    const categories: { slug: string; label: string; type: string; count: number }[] = [];

    // Audience counts from books array
    const audienceCounts = new Map<string, number>();
    for (const b of books) {
      if (b.audience) {
        audienceCounts.set(b.audience, (audienceCounts.get(b.audience) ?? 0) + 1);
      }
    }
    for (const [slug, count] of audienceCounts) {
      categories.push({
        slug,
        label: AUDIENCE_LABELS[slug] ?? slug,
        type: "audience",
        count,
      });
    }

    // Topic counts
    const topicCounts = new Map<string, number>();
    for (const b of books) {
      for (const t of b.topics) {
        topicCounts.set(t, (topicCounts.get(t) ?? 0) + 1);
      }
    }
    for (const [slug, count] of topicCounts) {
      categories.push({
        slug,
        label: TOPIC_LABELS[slug] ?? slug,
        type: "topic",
        count,
      });
    }

    categories.sort((a, b) => b.count - a.count);
    writeJson("categories.json", categories);

    console.log("\nStatic data generation complete.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
