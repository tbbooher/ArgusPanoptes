// ---------------------------------------------------------------------------
// ISBN parsing, validation, conversion, and formatting utilities
// ---------------------------------------------------------------------------

import type { ISBN10, ISBN13, ISBN, RawISBN, ISBNParseResult } from "../../core/types.js";
import {
  computeISBN10CheckDigit,
  computeISBN13CheckDigit,
  verifyISBN10CheckDigit,
  verifyISBN13CheckDigit,
} from "./check-digit.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Strip hyphens, spaces, and surrounding whitespace from a raw ISBN string. */
export function stripFormatting(raw: string): string {
  return raw.trim().replace(/[\s-]/g, "");
}

/** Quick heuristic: does this string look like it *could* be an ISBN? */
export function looksLikeISBN(raw: string): boolean {
  const stripped = stripFormatting(raw);
  if (stripped.length === 13 && /^\d{13}$/.test(stripped)) return true;
  if (stripped.length === 10 && /^\d{9}[\dXx]$/.test(stripped)) return true;
  return false;
}

// ── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate and return a branded ISBN10.
 * Returns `null` on invalid input.
 */
export function validateISBN10(raw: RawISBN): ISBN10 | null {
  const stripped = stripFormatting(raw).toUpperCase();
  if (stripped.length !== 10) return null;
  if (!/^\d{9}[\dX]$/.test(stripped)) return null;
  if (!verifyISBN10CheckDigit(stripped)) return null;
  return stripped as ISBN10;
}

/**
 * Validate and return a branded ISBN13.
 * Returns `null` on invalid input.
 */
export function validateISBN13(raw: RawISBN): ISBN13 | null {
  const stripped = stripFormatting(raw);
  if (stripped.length !== 13) return null;
  if (!/^\d{13}$/.test(stripped)) return null;
  if (!verifyISBN13CheckDigit(stripped)) return null;
  return stripped as ISBN13;
}

/**
 * Validate either ISBN-10 or ISBN-13.
 * Returns a branded `ISBN` or `null`.
 */
export function validateISBN(raw: RawISBN): ISBN | null {
  return validateISBN13(raw) ?? validateISBN10(raw) ?? null;
}

// ── Conversion ──────────────────────────────────────────────────────────────

/**
 * Convert a validated ISBN-10 to an ISBN-13.
 */
export function isbn10ToISBN13(isbn10: ISBN10): ISBN13 {
  const body = isbn10.slice(0, 9);
  const prefix12 = "978" + body;
  const check = computeISBN13CheckDigit(prefix12);
  return (prefix12 + check) as ISBN13;
}

/**
 * Convert a validated ISBN-13 (978-prefix only) to an ISBN-10.
 * Returns `null` if the ISBN-13 has a 979 prefix (no ISBN-10 equivalent).
 */
export function isbn13ToISBN10(isbn13: ISBN13): ISBN10 | null {
  if (!isbn13.startsWith("978")) return null;
  const body9 = isbn13.slice(3, 12);
  const check = computeISBN10CheckDigit(body9);
  return (body9 + check) as ISBN10;
}

// ── Normalisation ───────────────────────────────────────────────────────────

/**
 * Given any valid ISBN input, return the canonical ISBN-13 form.
 * Returns `null` for invalid input.
 */
export function toISBN13(raw: RawISBN): ISBN13 | null {
  const isbn13 = validateISBN13(raw);
  if (isbn13) return isbn13;

  const isbn10 = validateISBN10(raw);
  if (isbn10) return isbn10ToISBN13(isbn10);

  return null;
}

// ── Formatting ──────────────────────────────────────────────────────────────

/**
 * Naively format an ISBN-13 with hyphens.
 * Uses 3-1-4-4-1 for group 0/1, fallback 3-9-1 otherwise.
 */
export function formatISBN13(isbn13: ISBN13): string {
  const s = isbn13 as string;
  const ean = s.slice(0, 3);
  const group = s[3];
  if (group === "0" || group === "1") {
    return `${ean}-${group}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s[12]}`;
  }
  return `${ean}-${s.slice(3, 12)}-${s[12]}`;
}

/**
 * Naively format an ISBN-10 with hyphens.
 * Uses 1-4-4-1 for group 0/1, else 9-1 fallback.
 */
export function formatISBN10(isbn10: ISBN10): string {
  const s = isbn10 as string;
  const group = s[0];
  if (group === "0" || group === "1") {
    return `${group}-${s.slice(1, 5)}-${s.slice(5, 9)}-${s[9]}`;
  }
  return `${s.slice(0, 9)}-${s[9]}`;
}

// ── Top-level parse ─────────────────────────────────────────────────────────

/**
 * Parse an arbitrary string into a fully-validated ISBN result.
 */
export function parseISBN(raw: RawISBN): ISBNParseResult {
  const stripped = stripFormatting(raw);

  if (stripped.length === 0) {
    return { ok: false, raw, reason: "Empty string" };
  }

  // Try ISBN-13 first
  const isbn13 = validateISBN13(stripped);
  if (isbn13) {
    const isbn10 = isbn13ToISBN10(isbn13);
    return {
      ok: true,
      isbn10,
      isbn13,
      hyphenated: formatISBN13(isbn13),
    };
  }

  // Try ISBN-10
  const isbn10 = validateISBN10(stripped);
  if (isbn10) {
    const converted13 = isbn10ToISBN13(isbn10);
    return {
      ok: true,
      isbn10,
      isbn13: converted13,
      hyphenated: formatISBN13(converted13),
    };
  }

  // Determine a helpful reason
  const upperStripped = stripped.toUpperCase();
  if (upperStripped.length !== 10 && upperStripped.length !== 13) {
    return {
      ok: false,
      raw,
      reason: `Invalid length: expected 10 or 13 characters, got ${stripped.length}`,
    };
  }

  if (upperStripped.length === 10 && !/^\d{9}[\dX]$/.test(upperStripped)) {
    return { ok: false, raw, reason: "ISBN-10 contains non-numeric characters" };
  }

  if (upperStripped.length === 13 && !/^\d{13}$/.test(upperStripped)) {
    return { ok: false, raw, reason: "ISBN-13 contains non-numeric characters" };
  }

  return { ok: false, raw, reason: "Invalid check digit" };
}
