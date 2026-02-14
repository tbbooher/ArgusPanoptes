// ---------------------------------------------------------------------------
// MARC XML parsing utilities for fast-xml-parser output.
//
// fast-xml-parser can return either a single object or an array for repeated
// XML elements.  Every helper in this module handles both cases transparently.
//
// Expected parsed structure (with ignoreAttributes: false):
//   record.datafield  -> array | single object, each with @_tag, subfield(s)
//   record.controlfield -> array | single object, each with @_tag, #text
//   subfield -> array | single object, each with @_code, #text
// ---------------------------------------------------------------------------

/**
 * Normalise a value that may be a single object or an array into an array.
 */
function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

// ── Data-field helpers ────────────────────────────────────────────────────

/**
 * Extract the text content of a specific subfield from the *first* matching
 * MARC data field.
 *
 * @param record  Parsed MARC record object from fast-xml-parser.
 * @param tag     MARC field tag (e.g. "245", "020").
 * @param subfield  Subfield code (e.g. "a", "b").
 * @returns  The subfield text, or `null` if not found.
 */
export function extractDataField(
  record: any,
  tag: string,
  subfield: string,
): string | null {
  const fields = extractAllDataFields(record, tag);
  if (fields.length === 0) return null;

  const subs = toArray(fields[0].subfield);
  for (const sub of subs) {
    if (sub?.["@_code"] === subfield) {
      return typeof sub["#text"] === "string"
        ? sub["#text"]
        : sub["#text"] != null
          ? String(sub["#text"])
          : null;
    }
  }
  return null;
}

/**
 * Return *all* data-field objects for the given MARC tag.
 *
 * Each returned object retains the shape produced by fast-xml-parser,
 * including `@_tag`, `@_ind1`, `@_ind2`, and a `subfield` property.
 */
export function extractAllDataFields(record: any, tag: string): any[] {
  if (!record?.datafield) return [];
  const allFields = toArray(record.datafield);
  return allFields.filter((f: any) => f?.["@_tag"] === tag);
}

// ── Control-field helpers ─────────────────────────────────────────────────

/**
 * Extract the text of a MARC control field (001–009).
 *
 * @param record  Parsed MARC record object.
 * @param tag     Control-field tag (e.g. "001", "008").
 * @returns  The field text, or `null` if not found.
 */
export function extractControlField(
  record: any,
  tag: string,
): string | null {
  if (!record?.controlfield) return null;
  const fields = toArray(record.controlfield);
  for (const cf of fields) {
    if (cf?.["@_tag"] === tag) {
      return typeof cf["#text"] === "string"
        ? cf["#text"]
        : cf["#text"] != null
          ? String(cf["#text"])
          : null;
    }
  }
  return null;
}

// ── Subfield extraction helpers ───────────────────────────────────────────

/**
 * Given a single data-field object, return all subfield text values that
 * match the given code.
 */
export function extractSubfieldValues(
  datafield: any,
  code: string,
): string[] {
  if (!datafield?.subfield) return [];
  const subs = toArray(datafield.subfield);
  const results: string[] = [];
  for (const sub of subs) {
    if (sub?.["@_code"] === code) {
      const text =
        typeof sub["#text"] === "string"
          ? sub["#text"]
          : sub["#text"] != null
            ? String(sub["#text"])
            : null;
      if (text !== null) results.push(text);
    }
  }
  return results;
}

// ── ISBN helpers ──────────────────────────────────────────────────────────

/**
 * Parse ISBNs from MARC field 020$a.  Strips qualifiers such as
 * "(pbk.)" or "(hardcover)".
 *
 * @param record  Parsed MARC record object.
 * @returns  Array of cleaned ISBN strings (may be ISBN-10 or ISBN-13).
 */
export function parseISBNFromMarc(record: any): string[] {
  const fields020 = extractAllDataFields(record, "020");
  const isbns: string[] = [];

  for (const field of fields020) {
    const values = extractSubfieldValues(field, "a");
    for (const raw of values) {
      // Strip qualifiers in parentheses and trailing text after a space
      const cleaned = raw
        .replace(/\s*\(.*?\)\s*/g, "")
        .replace(/\s+.*$/, "")
        .replace(/[^0-9Xx]/g, "");

      if (cleaned.length === 10 || cleaned.length === 13) {
        isbns.push(cleaned);
      }
    }
  }

  return isbns;
}
