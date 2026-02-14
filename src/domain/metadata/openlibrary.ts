// ---------------------------------------------------------------------------
// Open Library resolver: map title/author queries to candidate ISBNs.
// ---------------------------------------------------------------------------

import { parseISBN } from "../isbn/isbn.js";
import type { ISBN13 } from "../../core/types.js";

export interface ResolveISBNsQuery {
  title: string;
  author?: string;
  /** Max docs to request from Open Library. */
  limitDocs?: number;
  /** Max works (docs) to expand into editions. */
  maxWorks?: number;
  /** Editions to request per work. */
  limitEditionsPerWork?: number;
  /** Max ISBN-13s to return after normalization/dedup. */
  maxIsbns?: number;
  /** Fetch timeout. */
  timeoutMs?: number;
}

export interface ResolvedISBNs {
  source: "openlibrary";
  title: string;
  author?: string;
  isbn13s: ISBN13[];
  skipped: { raw: string; reason: string }[];
}

type OpenLibrarySearchDoc = {
  title?: string;
  author_name?: string[];
  key?: string; // e.g. "/works/OL36109370W"
};

type OpenLibrarySearchResponse = {
  docs?: OpenLibrarySearchDoc[];
};

type OpenLibraryEditionsResponse = {
  entries?: Array<{
    isbn_13?: string[];
    isbn_10?: string[];
  }>;
};

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

/**
 * Resolve candidate ISBN-13s for a title (and optional author) using the
 * Open Library search API.
 *
 * Important: Open Library returns many editions; we cap results to avoid
 * exploding downstream library searches.
 */
export async function resolveISBN13sFromTitle(
  query: ResolveISBNsQuery,
): Promise<ResolvedISBNs> {
  const title = String(query.title || "").trim();
  const author = query.author ? String(query.author).trim() : undefined;
  if (!title) {
    return {
      source: "openlibrary",
      title,
      author,
      isbn13s: [],
      skipped: [],
    };
  }

  const limitDocs = Math.max(1, Math.min(25, query.limitDocs ?? 10));
  const maxWorks = Math.max(1, Math.min(10, query.maxWorks ?? 5));
  const limitEditionsPerWork = Math.max(
    1,
    Math.min(50, query.limitEditionsPerWork ?? 20),
  );
  const maxIsbns = Math.max(1, Math.min(25, query.maxIsbns ?? 10));
  const timeoutMs = Math.max(1000, Math.min(20_000, query.timeoutMs ?? 8000));

  const url = new URL("https://openlibrary.org/search.json");
  url.searchParams.set("title", title);
  if (author) url.searchParams.set("author", author);
  url.searchParams.set("limit", String(limitDocs));

  const resp = await fetch(url.toString(), {
    headers: {
      // Be a good citizen; some endpoints treat empty/default UA as botty.
      "user-agent": "ArgusPanoptes/0.1 (+https://argus.theboohers.org)",
      "accept": "application/json",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!resp.ok) {
    throw new Error(`Open Library returned HTTP ${resp.status}`);
  }

  const data = (await resp.json()) as OpenLibrarySearchResponse;
  const docs = Array.isArray(data.docs) ? data.docs : [];

  const skipped: { raw: string; reason: string }[] = [];
  const isbn13s: ISBN13[] = [];

  // Expand top works into editions to collect ISBNs.
  const workKeys = uniq(
    docs
      .map((d) => String(d.key || "").trim())
      .filter((k) => k.startsWith("/works/")),
  ).slice(0, maxWorks);

  for (const workKey of workKeys) {
    const workId = workKey.split("/").pop();
    if (!workId) continue;

    const editionsUrl = new URL(`https://openlibrary.org/works/${workId}/editions.json`);
    editionsUrl.searchParams.set("limit", String(limitEditionsPerWork));

    const edResp = await fetch(editionsUrl.toString(), {
      headers: {
        "user-agent": "ArgusPanoptes/0.1 (+https://argus.theboohers.org)",
        "accept": "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!edResp.ok) {
      // Don't fail the whole resolve if one work's editions endpoint is flaky.
      continue;
    }

    const edData = (await edResp.json()) as OpenLibraryEditionsResponse;
    const entries = Array.isArray(edData.entries) ? edData.entries : [];

    const rawIsbns: string[] = [];
    for (const e of entries) {
      if (Array.isArray(e.isbn_13)) rawIsbns.push(...e.isbn_13);
      if (Array.isArray(e.isbn_10)) rawIsbns.push(...e.isbn_10);
    }

    for (const raw of uniq(rawIsbns)) {
      const parsed = parseISBN(raw);
      if (!parsed.ok) {
        skipped.push({ raw, reason: parsed.reason });
        continue;
      }
      isbn13s.push(parsed.isbn13);
      if (isbn13s.length >= maxIsbns) break;
    }

    if (isbn13s.length >= maxIsbns) break;
  }

  return {
    source: "openlibrary",
    title,
    author,
    isbn13s: uniq(isbn13s),
    skipped,
  };
}
