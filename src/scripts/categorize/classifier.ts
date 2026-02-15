import Anthropic from "@anthropic-ai/sdk";
import {
  Audience,
  Topic,
  AUDIENCE_KEYS,
  TOPIC_KEYS,
  ClassificationBatchSchema,
} from "./taxonomy.js";
import type { UncategorizedBook, EnrichedBook, ClassificationResult } from "./types.js";

const MODEL_ID = "claude-sonnet-4-5-20250929";
const BATCH_SIZE = 15;

function buildSystemPrompt(): string {
  const audienceList = AUDIENCE_KEYS.map(
    (k) => `  - \`${k}\`: ${Audience[k]}`,
  ).join("\n");

  const topicList = TOPIC_KEYS.map(
    (k) => `  - \`${k}\`: ${Topic[k]}`,
  ).join("\n");

  return `You are a book classification expert. You categorize books that have been challenged or banned in Texas public libraries.

For each book, assign:
1. **audience** — the primary intended age group (exactly one):
${audienceList}

2. **topics** — 1-4 topic tags explaining why the book is commonly challenged:
${topicList}

3. **confidence** — a number from 0.0 to 1.0 indicating how confident you are in your classification. Use 0.9+ for well-known books you recognize. Use 0.5-0.7 for books where you're uncertain.

4. **reasoning** — a brief sentence explaining your classification.

Respond with a JSON array. Each element must have: isbn13, audience, topics, confidence, reasoning.
Do not include any text outside the JSON array.`;
}

function formatBookForPrompt(book: UncategorizedBook | EnrichedBook): string {
  const parts = [`- ISBN: ${book.isbn13}, Title: "${book.title}"`];
  if (book.authors.length > 0) {
    parts.push(`  Authors: ${book.authors.join(", ")}`);
  }
  if (book.year) {
    parts.push(`  Year: ${book.year}`);
  }
  if ("subjects" in book && book.subjects.length > 0) {
    parts.push(`  Subjects: ${book.subjects.join(", ")}`);
  }
  if ("description" in book && book.description) {
    parts.push(`  Description: ${book.description.slice(0, 300)}`);
  }
  return parts.join("\n");
}

function validateAndNormalize(
  raw: unknown,
  knownIsbns: Set<string>,
): ClassificationResult[] {
  const parsed = ClassificationBatchSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn("Batch validation failed, attempting individual parsing...");
    // Try to salvage individual results
    const results: ClassificationResult[] = [];
    if (Array.isArray(raw)) {
      for (const item of raw) {
        try {
          const single = ClassificationBatchSchema.element.parse(item);
          if (knownIsbns.has(single.isbn13)) {
            results.push({
              isbn13: single.isbn13,
              audience: single.audience,
              topics: single.topics.slice(0, 4),
              confidence: Math.max(0, Math.min(1, single.confidence)),
              reasoning: single.reasoning,
            });
          }
        } catch {
          // Skip invalid items
        }
      }
    }
    return results;
  }

  return parsed.data
    .filter((r) => knownIsbns.has(r.isbn13))
    .map((r) => ({
      isbn13: r.isbn13,
      audience: r.audience,
      topics: r.topics.slice(0, 4),
      confidence: Math.max(0, Math.min(1, r.confidence)),
      reasoning: r.reasoning,
    }));
}

/** Split an array into chunks of the given size. */
function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export interface ClassifyBatchResult {
  results: ClassificationResult[];
  rawResponse: unknown;
  modelId: string;
}

/** Classify a batch of books using Claude. */
export async function classifyBatch(
  client: Anthropic,
  books: (UncategorizedBook | EnrichedBook)[],
): Promise<ClassifyBatchResult> {
  const bookPrompts = books.map(formatBookForPrompt).join("\n\n");
  const knownIsbns = new Set(books.map((b) => b.isbn13));

  const response = await client.messages.create({
    model: MODEL_ID,
    max_tokens: 4096,
    system: buildSystemPrompt(),
    messages: [
      {
        role: "user",
        content: `Classify these ${books.length} books:\n\n${bookPrompts}`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Extract JSON from the response (handle markdown code blocks)
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.error("No JSON array found in response:", text.slice(0, 200));
    return { results: [], rawResponse: text, modelId: MODEL_ID };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(jsonMatch[0]);
  } catch {
    console.error("Failed to parse JSON:", jsonMatch[0].slice(0, 200));
    return { results: [], rawResponse: text, modelId: MODEL_ID };
  }

  const results = validateAndNormalize(raw, knownIsbns);
  return { results, rawResponse: raw, modelId: MODEL_ID };
}

/** Classify all books in batches, with progress reporting. */
export async function classifyAll(
  client: Anthropic,
  books: (UncategorizedBook | EnrichedBook)[],
  opts: { batchSize?: number; onProgress?: (done: number, total: number) => void },
): Promise<ClassifyBatchResult[]> {
  const batchSize = opts.batchSize ?? BATCH_SIZE;
  const batches = chunk(books, batchSize);
  const allResults: ClassifyBatchResult[] = [];
  let done = 0;

  for (const batch of batches) {
    try {
      const result = await classifyBatch(client, batch);
      allResults.push(result);
      done += batch.length;
      opts.onProgress?.(done, books.length);
    } catch (err) {
      console.error(
        `Error classifying batch (${batch.length} books):`,
        err instanceof Error ? err.message : err,
      );
      done += batch.length;
      opts.onProgress?.(done, books.length);
    }
  }

  return allResults;
}
