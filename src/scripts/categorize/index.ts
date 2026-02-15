#!/usr/bin/env tsx
/**
 * Book Categorization Script
 *
 * Classifies all books in the database by audience level and topic tags
 * using Claude AI, with optional OpenLibrary enrichment for low-confidence results.
 *
 * Usage:
 *   npm run categorize            # Full run
 *   npm run categorize:dry        # Dry run (preview only)
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  createPool,
  initCategorySchema,
  getUncategorizedBooks,
  getLowConfidenceBooks,
  upsertCategories,
  getCategorySummary,
} from "./db.js";
import { classifyAll } from "./classifier.js";
import { enrichBooks } from "./enricher.js";
import { Audience, Topic } from "./taxonomy.js";
import type { AudienceKey, TopicKey } from "./taxonomy.js";

const DRY_RUN = process.argv.includes("--dry-run");

async function main(): Promise<void> {
  const pool = createPool({
    host: process.env.DB_HOST ?? "localhost",
    port: parseInt(process.env.DB_PORT ?? "5432", 10),
    database: process.env.DB_NAME ?? "argus",
    user: process.env.DATABASE_USER ?? "postgres",
    password: process.env.DATABASE_PASSWORD ?? "",
  });

  try {
    // Initialize schema
    await initCategorySchema(pool);
    console.log("Category schema initialized.");

    // ── Phase A: Initial classification ───────────────────────────────────
    const uncategorized = await getUncategorizedBooks(pool);
    console.log(`\nPhase A: ${uncategorized.length} uncategorized books found.`);

    if (uncategorized.length === 0) {
      console.log("All books already categorized. Skipping Phase A.");
    } else if (DRY_RUN) {
      console.log(`[DRY RUN] Would classify ${uncategorized.length} books in ${Math.ceil(uncategorized.length / 15)} batches.`);
      console.log("Sample books:");
      for (const book of uncategorized.slice(0, 5)) {
        console.log(`  - ${book.title} (${book.isbn13})`);
      }
    } else {
      const client = new Anthropic();
      console.log("Classifying with Claude...");

      const batchResults = await classifyAll(client, uncategorized, {
        onProgress: (done, total) => {
          console.log(`  Progress: ${done}/${total} books processed`);
        },
      });

      let totalClassified = 0;
      for (const batch of batchResults) {
        if (batch.results.length > 0) {
          await upsertCategories(pool, batch.results, {
            modelId: batch.modelId,
            rawResponse: batch.rawResponse,
          });
          totalClassified += batch.results.length;
        }
      }

      console.log(`Phase A complete: ${totalClassified} books classified.`);
    }

    // ── Phase B: Enrichment pass ──────────────────────────────────────────
    if (!DRY_RUN) {
      const lowConfidence = await getLowConfidenceBooks(pool);
      console.log(`\nPhase B: ${lowConfidence.length} low-confidence books found.`);

      if (lowConfidence.length > 0) {
        console.log("Fetching OpenLibrary data...");
        const enriched = await enrichBooks(lowConfidence, {
          onProgress: (done, total) => {
            if (done % 10 === 0 || done === total) {
              console.log(`  OpenLibrary: ${done}/${total} books fetched`);
            }
          },
        });

        const withData = enriched.filter(
          (b) => b.subjects.length > 0 || b.description,
        );
        console.log(
          `  ${withData.length}/${enriched.length} books had OpenLibrary data.`,
        );

        if (withData.length > 0) {
          const client = new Anthropic();
          console.log("Re-classifying with enriched data...");

          const batchResults = await classifyAll(client, withData, {
            batchSize: 10,
            onProgress: (done, total) => {
              console.log(`  Progress: ${done}/${total} books re-classified`);
            },
          });

          let totalReClassified = 0;
          for (const batch of batchResults) {
            if (batch.results.length > 0) {
              await upsertCategories(pool, batch.results, {
                modelId: batch.modelId,
                enriched: true,
                rawResponse: batch.rawResponse,
              });
              totalReClassified += batch.results.length;
            }
          }

          console.log(
            `Phase B complete: ${totalReClassified} books re-classified with enrichment.`,
          );
        } else {
          console.log("No enrichment data found. Skipping re-classification.");
        }
      }
    }

    // ── Phase C: Summary ──────────────────────────────────────────────────
    if (!DRY_RUN) {
      const summary = await getCategorySummary(pool);
      console.log("\n── Classification Summary ──");
      console.log(`Total classified: ${summary.total}`);
      console.log(`Average confidence: ${summary.avgConfidence.toFixed(3)}`);
      console.log(`Low confidence (< 0.7): ${summary.lowConfidenceCount}`);
      console.log("\nBy audience:");
      for (const [key, count] of Object.entries(summary.byAudience)) {
        const label = Audience[key as AudienceKey] ?? key;
        console.log(`  ${label}: ${count}`);
      }
      console.log("\nBy topic:");
      for (const [key, count] of Object.entries(summary.byTopic)) {
        const label = Topic[key as TopicKey] ?? key;
        console.log(`  ${label}: ${count}`);
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
