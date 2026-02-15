#!/usr/bin/env tsx
/**
 * Generate a markdown report of book classifications for human review.
 * Focuses on low-confidence classifications that may need manual correction.
 */
import { createPool } from "./db.js";
import { Audience, Topic } from "./taxonomy.js";
import type { AudienceKey, TopicKey } from "./taxonomy.js";

async function main(): Promise<void> {
  const pool = createPool({
    host: process.env.DB_HOST ?? "localhost",
    port: parseInt(process.env.DB_PORT ?? "5432", 10),
    database: process.env.DB_NAME ?? "argus",
    user: process.env.DATABASE_USER ?? "postgres",
    password: process.env.DATABASE_PASSWORD ?? "",
  });

  try {
    // Get all categories with book titles
    const result = await pool.query(`
      SELECT bc.isbn13, bc.audience, bc.topics, bc.confidence, bc.enriched,
             b.title, b.authors
      FROM book_categories bc
      JOIN books b ON b.isbn13 = bc.isbn13
      ORDER BY bc.confidence ASC, b.title
    `);

    const lowConfidence = result.rows.filter(
      (r: { confidence: number }) => r.confidence < 0.7,
    );
    const allRows = result.rows;

    const lines: string[] = [];
    lines.push("# Book Classification Review Report");
    lines.push("");
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`Total classified: ${allRows.length}`);
    lines.push(`Low confidence (< 0.7): ${lowConfidence.length}`);
    lines.push("");

    // Low confidence section
    if (lowConfidence.length > 0) {
      lines.push("## Low Confidence Classifications");
      lines.push("");
      lines.push(
        "These books need manual review. Confidence < 0.7 indicates the classifier was uncertain.",
      );
      lines.push("");

      for (const r of lowConfidence) {
        const audienceLabel = Audience[r.audience as AudienceKey] ?? r.audience;
        const topicLabels = (r.topics as string[])
          .map((t) => Topic[t as TopicKey] ?? t)
          .join(", ");

        lines.push(`### ${r.title}`);
        lines.push("");
        lines.push(`- **ISBN**: ${r.isbn13}`);
        lines.push(`- **Authors**: ${(r.authors ?? []).join(", ") || "Unknown"}`);
        lines.push(`- **Audience**: ${audienceLabel}`);
        lines.push(`- **Topics**: ${topicLabels}`);
        lines.push(`- **Confidence**: ${r.confidence.toFixed(2)}`);
        lines.push(`- **Enriched**: ${r.enriched ? "Yes" : "No"}`);
        lines.push("");
      }
    }

    // Audience distribution
    lines.push("## Audience Distribution");
    lines.push("");
    const audienceCounts: Record<string, number> = {};
    for (const r of allRows) {
      audienceCounts[r.audience] = (audienceCounts[r.audience] ?? 0) + 1;
    }
    lines.push("| Audience | Count |");
    lines.push("|----------|-------|");
    for (const [key, count] of Object.entries(audienceCounts)) {
      const label = Audience[key as AudienceKey] ?? key;
      lines.push(`| ${label} | ${count} |`);
    }
    lines.push("");

    // Topic distribution
    lines.push("## Topic Distribution");
    lines.push("");
    const topicCounts: Record<string, number> = {};
    for (const r of allRows) {
      for (const t of r.topics as string[]) {
        topicCounts[t] = (topicCounts[t] ?? 0) + 1;
      }
    }
    lines.push("| Topic | Count |");
    lines.push("|-------|-------|");
    for (const [key, count] of Object.entries(topicCounts).sort(
      (a, b) => b[1] - a[1],
    )) {
      const label = Topic[key as TopicKey] ?? key;
      lines.push(`| ${label} | ${count} |`);
    }
    lines.push("");

    console.log(lines.join("\n"));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
