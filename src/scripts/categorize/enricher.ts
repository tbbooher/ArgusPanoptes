import type { UncategorizedBook, OpenLibraryData, EnrichedBook } from "./types.js";

const OL_BASE = "https://openlibrary.org";

interface OLEdition {
  works?: { key: string }[];
  subjects?: string[];
  description?: string | { value: string };
}

interface OLWork {
  subjects?: string[];
  description?: string | { value: string };
}

function extractDescription(desc: unknown): string | null {
  if (!desc) return null;
  if (typeof desc === "string") return desc;
  if (typeof desc === "object" && desc !== null && "value" in desc) {
    return (desc as { value: string }).value;
  }
  return null;
}

/** Fetch enrichment data for a single ISBN from OpenLibrary. */
async function fetchOpenLibraryData(
  isbn13: string,
): Promise<OpenLibraryData | null> {
  try {
    // Fetch edition data
    const editionRes = await fetch(`${OL_BASE}/isbn/${isbn13}.json`);
    if (!editionRes.ok) return null;

    const edition = (await editionRes.json()) as OLEdition;
    const subjects: string[] = edition.subjects ?? [];
    let description = extractDescription(edition.description);

    // If we have a work key, fetch work-level data for more subjects/description
    if (edition.works?.[0]?.key) {
      try {
        const workRes = await fetch(
          `${OL_BASE}${edition.works[0].key}.json`,
        );
        if (workRes.ok) {
          const work = (await workRes.json()) as OLWork;
          if (work.subjects) {
            for (const s of work.subjects) {
              if (!subjects.includes(s)) subjects.push(s);
            }
          }
          if (!description) {
            description = extractDescription(work.description);
          }
        }
      } catch {
        // Work fetch failed, continue with edition data
      }
    }

    return { isbn13, subjects, description };
  } catch {
    return null;
  }
}

/** Enrich a batch of books with OpenLibrary data. */
export async function enrichBooks(
  books: UncategorizedBook[],
  opts?: { onProgress?: (done: number, total: number) => void; delayMs?: number },
): Promise<EnrichedBook[]> {
  const enriched: EnrichedBook[] = [];
  const delayMs = opts?.delayMs ?? 200; // Rate limit: ~5 req/s

  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    const olData = await fetchOpenLibraryData(book.isbn13);

    enriched.push({
      ...book,
      subjects: olData?.subjects ?? [],
      description: olData?.description ?? null,
    });

    opts?.onProgress?.(i + 1, books.length);

    // Rate limiting delay
    if (i < books.length - 1 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return enriched;
}
