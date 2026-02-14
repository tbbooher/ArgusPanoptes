// ---------------------------------------------------------------------------
// Google Books resolver: map title/author queries to candidate ISBNs.
// ---------------------------------------------------------------------------

import { parseISBN } from "../isbn/isbn.js";
import type { ISBN13 } from "../../core/types.js";

export interface GoogleBooksResolveQuery {
  title: string;
  author?: string;
  maxResults?: number;
  maxIsbns?: number;
  timeoutMs?: number;
}

export interface GoogleBooksResolvedISBNs {
  source: "googlebooks";
  title: string;
  author?: string;
  isbn13s: ISBN13[];
  skipped: { raw: string; reason: string }[];
}

type GoogleBooksResponse = {
  items?: Array<{
    volumeInfo?: {
      industryIdentifiers?: Array<{ type?: string; identifier?: string }>;
    };
  }>;
};

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

export async function resolveISBN13sFromGoogleBooks(
  query: GoogleBooksResolveQuery,
): Promise<GoogleBooksResolvedISBNs> {
  const title = String(query.title || "").trim();
  const author = query.author ? String(query.author).trim() : undefined;

  const maxResults = Math.max(1, Math.min(40, query.maxResults ?? 20));
  const maxIsbns = Math.max(1, Math.min(50, query.maxIsbns ?? 25));
  const timeoutMs = Math.max(1000, Math.min(20_000, query.timeoutMs ?? 8000));

  // Use structured query; this tends to be higher-signal than plain q=.
  let q = `intitle:${title}`;
  if (author) q += `+inauthor:${author}`;

  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", q);
  url.searchParams.set("maxResults", String(maxResults));
  url.searchParams.set("printType", "books");

  const resp = await fetch(url.toString(), {
    headers: {
      "user-agent": "ArgusPanoptes/0.1 (+https://argus.theboohers.org)",
      "accept": "application/json",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!resp.ok) {
    throw new Error(`Google Books returned HTTP ${resp.status}`);
  }

  const data = (await resp.json()) as GoogleBooksResponse;
  const items = Array.isArray(data.items) ? data.items : [];

  const raw: string[] = [];
  for (const item of items) {
    const ids = item.volumeInfo?.industryIdentifiers;
    if (!Array.isArray(ids)) continue;
    for (const id of ids) {
      const v = String(id?.identifier ?? "").trim();
      if (v) raw.push(v);
    }
  }

  const skipped: { raw: string; reason: string }[] = [];
  const isbn13s: ISBN13[] = [];

  for (const r of uniq(raw)) {
    const parsed = parseISBN(r);
    if (!parsed.ok) {
      skipped.push({ raw: r, reason: parsed.reason });
      continue;
    }
    isbn13s.push(parsed.isbn13);
    if (isbn13s.length >= maxIsbns) break;
  }

  return {
    source: "googlebooks",
    title,
    author,
    isbn13s: uniq(isbn13s),
    skipped,
  };
}

