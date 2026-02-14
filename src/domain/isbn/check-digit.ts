// ---------------------------------------------------------------------------
// ISBN check-digit computation
// ---------------------------------------------------------------------------

/**
 * Compute the ISBN-10 check digit for a string of exactly 9 digits.
 * Returns a single character: '0'-'9' or 'X'.
 */
export function computeISBN10CheckDigit(first9: string): string {
  if (first9.length !== 9 || !/^\d{9}$/.test(first9)) {
    throw new Error(`Expected 9 digits, got "${first9}"`);
  }

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += (10 - i) * Number(first9[i]);
  }

  const remainder = (11 - (sum % 11)) % 11;
  return remainder === 10 ? "X" : String(remainder);
}

/**
 * Compute the ISBN-13 check digit for a string of exactly 12 digits.
 * Returns a single digit character: '0'-'9'.
 */
export function computeISBN13CheckDigit(first12: string): string {
  if (first12.length !== 12 || !/^\d{12}$/.test(first12)) {
    throw new Error(`Expected 12 digits, got "${first12}"`);
  }

  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const weight = i % 2 === 0 ? 1 : 3;
    sum += weight * Number(first12[i]);
  }

  const remainder = (10 - (sum % 10)) % 10;
  return String(remainder);
}

/**
 * Verify that an ISBN-10 string (10 characters, last may be 'X') has a valid
 * check digit.
 */
export function verifyISBN10CheckDigit(isbn10: string): boolean {
  if (isbn10.length !== 10) return false;
  const body = isbn10.slice(0, 9);
  if (!/^\d{9}$/.test(body)) return false;
  const expected = computeISBN10CheckDigit(body);
  return isbn10[9].toUpperCase() === expected;
}

/**
 * Verify that an ISBN-13 string (13 digits) has a valid check digit.
 */
export function verifyISBN13CheckDigit(isbn13: string): boolean {
  if (isbn13.length !== 13 || !/^\d{13}$/.test(isbn13)) return false;
  const expected = computeISBN13CheckDigit(isbn13.slice(0, 12));
  return isbn13[12] === expected;
}
