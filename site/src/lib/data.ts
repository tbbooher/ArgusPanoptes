import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  SummaryStats,
  BookEntry,
  LibraryEntry,
  MapMarker,
  BookDetail,
  LibraryDetail,
  CategorySummary,
} from "./types";

const DATA_DIR = join(process.cwd(), "public", "data");

function loadJson<T>(filename: string): T {
  return JSON.parse(readFileSync(join(DATA_DIR, filename), "utf-8")) as T;
}

export function getSummaryStats(): SummaryStats {
  return loadJson<SummaryStats>("summary-stats.json");
}

export function getAllBooks(): BookEntry[] {
  return loadJson<BookEntry[]>("books.json");
}

export function getBook(isbn13: string): BookDetail | null {
  const books = loadJson<BookDetail[]>("book-details.json");
  return books.find((b) => b.isbn13 === isbn13) ?? null;
}

export function getAllLibraries(): LibraryEntry[] {
  return loadJson<LibraryEntry[]>("libraries.json");
}

export function getLibrary(systemId: string): LibraryDetail | null {
  const libraries = loadJson<LibraryDetail[]>("library-details.json");
  return libraries.find((l) => l.id === systemId) ?? null;
}

export function getMapMarkers(): MapMarker[] {
  return loadJson<MapMarker[]>("map-markers.json");
}

export function getCategories(): CategorySummary[] {
  return loadJson<CategorySummary[]>("categories.json");
}

export function getCategoryBooks(slug: string): BookEntry[] {
  const allBooks = getAllBooks();
  return allBooks.filter(
    (b) => b.audience === slug || b.topics.includes(slug),
  );
}
