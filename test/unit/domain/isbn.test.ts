// ---------------------------------------------------------------------------
// Comprehensive tests for the ISBN domain module
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";

import {
  parseISBN,
  validateISBN10,
  validateISBN13,
  validateISBN,
  isbn10ToISBN13,
  isbn13ToISBN10,
  toISBN13,
  looksLikeISBN,
  stripFormatting,
  formatISBN10,
  formatISBN13,
} from "../../../src/domain/isbn/isbn.js";

import {
  computeISBN10CheckDigit,
  computeISBN13CheckDigit,
  verifyISBN10CheckDigit,
  verifyISBN13CheckDigit,
} from "../../../src/domain/isbn/check-digit.js";

// ── Check-digit computation ─────────────────────────────────────────────────

describe("computeISBN10CheckDigit", () => {
  it("computes correct check digit for a well-known ISBN-10", () => {
    expect(computeISBN10CheckDigit("030640615")).toBe("2");
  });

  it("returns X when the check digit is 10", () => {
    expect(computeISBN10CheckDigit("080442957")).toBe("X");
  });

  it("returns 0 when the remainder is 0", () => {
    expect(computeISBN10CheckDigit("100000006")).toBe("0");
  });

  it("throws for input that is not 9 digits", () => {
    expect(() => computeISBN10CheckDigit("12345")).toThrow();
    expect(() => computeISBN10CheckDigit("12345678X")).toThrow();
    expect(() => computeISBN10CheckDigit("1234567890")).toThrow();
  });
});

describe("computeISBN13CheckDigit", () => {
  it("computes correct check digit for a well-known ISBN-13", () => {
    expect(computeISBN13CheckDigit("978030640615")).toBe("7");
  });

  it("computes check digit 0 correctly", () => {
    expect(computeISBN13CheckDigit("978000000004")).toBe("0");
  });

  it("throws for input that is not 12 digits", () => {
    expect(() => computeISBN13CheckDigit("12345")).toThrow();
    expect(() => computeISBN13CheckDigit("1234567890123")).toThrow();
  });
});

describe("verifyISBN10CheckDigit", () => {
  it("returns true for a valid ISBN-10", () => {
    expect(verifyISBN10CheckDigit("0306406152")).toBe(true);
  });

  it("returns true for an ISBN-10 with X check digit", () => {
    expect(verifyISBN10CheckDigit("080442957X")).toBe(true);
  });

  it("returns false for wrong check digit", () => {
    expect(verifyISBN10CheckDigit("0306406153")).toBe(false);
  });

  it("returns false for wrong length", () => {
    expect(verifyISBN10CheckDigit("030640615")).toBe(false);
  });
});

describe("verifyISBN13CheckDigit", () => {
  it("returns true for a valid ISBN-13", () => {
    expect(verifyISBN13CheckDigit("9780306406157")).toBe(true);
  });

  it("returns false for wrong check digit", () => {
    expect(verifyISBN13CheckDigit("9780306406158")).toBe(false);
  });

  it("returns false for wrong length", () => {
    expect(verifyISBN13CheckDigit("978030640615")).toBe(false);
  });

  it("returns false for non-numeric input", () => {
    expect(verifyISBN13CheckDigit("978030640615X")).toBe(false);
  });
});

// ── ISBN-10 validation ──────────────────────────────────────────────────────

describe("validateISBN10", () => {
  it("validates a correct ISBN-10", () => {
    expect(validateISBN10("0306406152")).toBe("0306406152");
  });

  it("validates an ISBN-10 with X check digit", () => {
    expect(validateISBN10("080442957X")).toBe("080442957X");
  });

  it("handles lowercase x check digit", () => {
    expect(validateISBN10("080442957x")).toBe("080442957X");
  });

  it("strips hyphens before validating", () => {
    expect(validateISBN10("0-306-40615-2")).toBe("0306406152");
  });

  it("strips spaces before validating", () => {
    expect(validateISBN10("0 306 40615 2")).toBe("0306406152");
  });

  it("returns null for wrong check digit", () => {
    expect(validateISBN10("0306406153")).toBeNull();
  });

  it("returns null for wrong length", () => {
    expect(validateISBN10("03064061")).toBeNull();
  });

  it("returns null for non-numeric characters", () => {
    expect(validateISBN10("030640615A")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(validateISBN10("")).toBeNull();
  });
});

// ── ISBN-13 validation ──────────────────────────────────────────────────────

describe("validateISBN13", () => {
  it("validates a correct ISBN-13", () => {
    expect(validateISBN13("9780306406157")).toBe("9780306406157");
  });

  it("validates a 979-prefix ISBN-13", () => {
    expect(validateISBN13("9791034304660")).toBe("9791034304660");
  });

  it("strips hyphens before validating", () => {
    expect(validateISBN13("978-0-306-40615-7")).toBe("9780306406157");
  });

  it("returns null for wrong check digit", () => {
    expect(validateISBN13("9780306406158")).toBeNull();
  });

  it("returns null for wrong length", () => {
    expect(validateISBN13("978030640615")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(validateISBN13("")).toBeNull();
  });
});

// ── ISBN-10 <-> ISBN-13 conversion ──────────────────────────────────────────

describe("isbn10ToISBN13", () => {
  it("converts a standard ISBN-10 to ISBN-13", () => {
    const isbn10 = validateISBN10("0306406152")!;
    expect(isbn10ToISBN13(isbn10)).toBe("9780306406157");
  });

  it("converts ISBN-10 with X check digit", () => {
    const isbn10 = validateISBN10("080442957X")!;
    expect(isbn10ToISBN13(isbn10)).toBe("9780804429573");
  });
});

describe("isbn13ToISBN10", () => {
  it("converts a 978-prefix ISBN-13 to ISBN-10", () => {
    const isbn13 = validateISBN13("9780306406157")!;
    expect(isbn13ToISBN10(isbn13)).toBe("0306406152");
  });

  it("returns null for a 979-prefix ISBN-13", () => {
    const isbn13 = validateISBN13("9791034304660")!;
    expect(isbn13ToISBN10(isbn13)).toBeNull();
  });

  it("round-trips correctly: ISBN-13 -> ISBN-10 -> ISBN-13", () => {
    const original = validateISBN13("9780306406157")!;
    const isbn10 = isbn13ToISBN10(original)!;
    expect(isbn10ToISBN13(isbn10)).toBe(original);
  });
});

// ── toISBN13 normalisation ──────────────────────────────────────────────────

describe("toISBN13", () => {
  it("returns ISBN-13 unchanged", () => {
    expect(toISBN13("9780306406157")).toBe("9780306406157");
  });

  it("converts ISBN-10 to ISBN-13", () => {
    expect(toISBN13("0306406152")).toBe("9780306406157");
  });

  it("returns null for invalid input", () => {
    expect(toISBN13("not-an-isbn")).toBeNull();
  });

  it("handles hyphenated ISBN-10", () => {
    expect(toISBN13("0-306-40615-2")).toBe("9780306406157");
  });
});

// ── looksLikeISBN ───────────────────────────────────────────────────────────

describe("looksLikeISBN", () => {
  it("returns true for 13-digit numeric string", () => {
    expect(looksLikeISBN("9780306406157")).toBe(true);
  });

  it("returns true for ISBN-10 with X", () => {
    expect(looksLikeISBN("080442957X")).toBe(true);
  });

  it("returns true for hyphenated ISBN", () => {
    expect(looksLikeISBN("978-0-306-40615-7")).toBe(true);
  });

  it("returns false for wrong length", () => {
    expect(looksLikeISBN("12345")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(looksLikeISBN("")).toBe(false);
  });
});

// ── parseISBN (top-level) ───────────────────────────────────────────────────

describe("parseISBN", () => {
  it("parses a valid ISBN-13", () => {
    const result = parseISBN("9780306406157");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.isbn13).toBe("9780306406157");
      expect(result.isbn10).toBe("0306406152");
    }
  });

  it("parses a valid ISBN-10 and converts to ISBN-13", () => {
    const result = parseISBN("0306406152");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.isbn10).toBe("0306406152");
      expect(result.isbn13).toBe("9780306406157");
    }
  });

  it("parses ISBN-10 with X check digit", () => {
    const result = parseISBN("080442957X");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.isbn10).toBe("080442957X");
    }
  });

  it("parses a 979-prefix ISBN-13 with null isbn10", () => {
    const result = parseISBN("9791034304660");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.isbn13).toBe("9791034304660");
      expect(result.isbn10).toBeNull();
    }
  });

  it("returns failure for empty string", () => {
    const result = parseISBN("");
    expect(result.ok).toBe(false);
  });

  it("returns failure for wrong length", () => {
    const result = parseISBN("12345");
    expect(result.ok).toBe(false);
  });

  it("returns failure for invalid check digit", () => {
    const result = parseISBN("9780306406158");
    expect(result.ok).toBe(false);
  });

  it("handles ISBN with leading/trailing whitespace", () => {
    const result = parseISBN("  9780306406157  ");
    expect(result.ok).toBe(true);
  });

  it("handles hyphenated ISBN-13", () => {
    const result = parseISBN("978-0-306-40615-7");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.isbn13).toBe("9780306406157");
    }
  });
});

// ── stripFormatting ─────────────────────────────────────────────────────────

describe("stripFormatting", () => {
  it("removes hyphens", () => {
    expect(stripFormatting("978-0-306-40615-7")).toBe("9780306406157");
  });

  it("removes spaces", () => {
    expect(stripFormatting("978 0 306 40615 7")).toBe("9780306406157");
  });

  it("trims whitespace", () => {
    expect(stripFormatting("  9780306406157  ")).toBe("9780306406157");
  });
});
