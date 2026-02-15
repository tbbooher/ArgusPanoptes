import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { ProgressiveBook, ProgressiveBooksFile } from "./types.js";

export function loadBooks(filePath: string): ProgressiveBook[] {
  const raw = readFileSync(filePath, "utf-8");
  const data = JSON.parse(raw) as ProgressiveBooksFile;
  // Deduplicate by isbn_13
  const seen = new Set<string>();
  const books: ProgressiveBook[] = [];
  for (const book of data.books) {
    if (book.isbn_13 && !seen.has(book.isbn_13)) {
      seen.add(book.isbn_13);
      books.push(book);
    }
  }
  return books;
}

export function shardBooks(
  books: ProgressiveBook[],
  workerId: number,
  totalWorkers: number,
): ProgressiveBook[] {
  if (totalWorkers <= 1) return books;
  return books.filter((book) => {
    const hash = createHash("md5").update(book.isbn_13).digest();
    const num = hash.readUInt32BE(0);
    return num % totalWorkers === workerId;
  });
}
