// ---------------------------------------------------------------------------
// Tests for the MARC XML parsing utilities.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";

import {
  extractDataField,
  extractAllDataFields,
  extractControlField,
  extractSubfieldValues,
  parseISBNFromMarc,
} from "../../../src/utils/marc-parser.js";

// ── Helpers: sample MARC records ──────────────────────────────────────────

/** A record with a single data field (245$a = title). */
function singleDatafieldRecord() {
  return {
    datafield: {
      "@_tag": "245",
      "@_ind1": "1",
      "@_ind2": "0",
      subfield: { "@_code": "a", "#text": "The Great Gatsby" },
    },
  };
}

/** A record with multiple data fields (as an array). */
function multipleDatafieldRecord() {
  return {
    datafield: [
      {
        "@_tag": "245",
        subfield: { "@_code": "a", "#text": "Title One" },
      },
      {
        "@_tag": "020",
        subfield: { "@_code": "a", "#text": "9780306406157" },
      },
      {
        "@_tag": "020",
        subfield: { "@_code": "a", "#text": "0306406152" },
      },
    ],
  };
}

/** A record where a data field has multiple subfields (array). */
function multipleSubfieldRecord() {
  return {
    datafield: {
      "@_tag": "245",
      subfield: [
        { "@_code": "a", "#text": "Main Title" },
        { "@_code": "b", "#text": "Subtitle" },
        { "@_code": "c", "#text": "Author Name" },
      ],
    },
  };
}

/** A record with control fields. */
function controlFieldRecord() {
  return {
    controlfield: [
      { "@_tag": "001", "#text": "ocm12345678" },
      { "@_tag": "008", "#text": "860506s1986    nyu           000 1 eng" },
    ],
  };
}

/** A record with a single control field (not an array). */
function singleControlFieldRecord() {
  return {
    controlfield: { "@_tag": "001", "#text": "record-id-99" },
  };
}

/** A record with ISBN fields including qualifiers. */
function isbnRecord() {
  return {
    datafield: [
      {
        "@_tag": "020",
        subfield: { "@_code": "a", "#text": "9780306406157 (hardcover)" },
      },
      {
        "@_tag": "020",
        subfield: { "@_code": "a", "#text": "0306406152 (pbk.)" },
      },
    ],
  };
}

/** A record with multiple subfields in a 020 field. */
function isbnMultiSubfieldRecord() {
  return {
    datafield: {
      "@_tag": "020",
      subfield: [
        { "@_code": "a", "#text": "9780306406157" },
        { "@_code": "z", "#text": "cancelled-isbn" },
      ],
    },
  };
}

// ── extractDataField ──────────────────────────────────────────────────────

describe("extractDataField", () => {
  it("extracts a subfield from a single-object datafield", () => {
    expect(extractDataField(singleDatafieldRecord(), "245", "a")).toBe(
      "The Great Gatsby",
    );
  });

  it("extracts a subfield from an array of datafields", () => {
    expect(extractDataField(multipleDatafieldRecord(), "020", "a")).toBe(
      "9780306406157",
    );
  });

  it("returns null when the tag does not exist", () => {
    expect(extractDataField(singleDatafieldRecord(), "999", "a")).toBeNull();
  });

  it("returns null when the subfield code does not exist", () => {
    expect(extractDataField(singleDatafieldRecord(), "245", "z")).toBeNull();
  });

  it("returns null for a null/undefined record", () => {
    expect(extractDataField(null, "245", "a")).toBeNull();
    expect(extractDataField(undefined, "245", "a")).toBeNull();
  });

  it("returns null when record has no datafield property", () => {
    expect(extractDataField({}, "245", "a")).toBeNull();
  });

  it("extracts the correct subfield when there are multiple subfields", () => {
    expect(extractDataField(multipleSubfieldRecord(), "245", "b")).toBe(
      "Subtitle",
    );
  });

  it("converts numeric #text to string", () => {
    const record = {
      datafield: {
        "@_tag": "020",
        subfield: { "@_code": "a", "#text": 1234567890 },
      },
    };
    expect(extractDataField(record, "020", "a")).toBe("1234567890");
  });
});

// ── extractAllDataFields ──────────────────────────────────────────────────

describe("extractAllDataFields", () => {
  it("returns all matching fields for a given tag", () => {
    const fields = extractAllDataFields(multipleDatafieldRecord(), "020");
    expect(fields.length).toBe(2);
  });

  it("returns an empty array when no fields match", () => {
    expect(extractAllDataFields(singleDatafieldRecord(), "999")).toEqual([]);
  });

  it("returns an empty array for a null record", () => {
    expect(extractAllDataFields(null, "245")).toEqual([]);
  });

  it("wraps a single-object datafield into an array for filtering", () => {
    const fields = extractAllDataFields(singleDatafieldRecord(), "245");
    expect(fields.length).toBe(1);
  });
});

// ── extractControlField ───────────────────────────────────────────────────

describe("extractControlField", () => {
  it("extracts a control field from an array of control fields", () => {
    expect(extractControlField(controlFieldRecord(), "001")).toBe(
      "ocm12345678",
    );
  });

  it("extracts the 008 control field", () => {
    const result = extractControlField(controlFieldRecord(), "008");
    expect(result).toBe("860506s1986    nyu           000 1 eng");
  });

  it("extracts a control field from a single-object controlfield", () => {
    expect(extractControlField(singleControlFieldRecord(), "001")).toBe(
      "record-id-99",
    );
  });

  it("returns null when the control field tag does not exist", () => {
    expect(extractControlField(controlFieldRecord(), "009")).toBeNull();
  });

  it("returns null for a null record", () => {
    expect(extractControlField(null, "001")).toBeNull();
  });

  it("returns null when record has no controlfield property", () => {
    expect(extractControlField({}, "001")).toBeNull();
  });

  it("converts numeric #text to string", () => {
    const record = {
      controlfield: { "@_tag": "001", "#text": 12345 },
    };
    expect(extractControlField(record, "001")).toBe("12345");
  });
});

// ── extractSubfieldValues ─────────────────────────────────────────────────

describe("extractSubfieldValues", () => {
  it("extracts all subfield values for a given code", () => {
    const field = {
      subfield: [
        { "@_code": "a", "#text": "val1" },
        { "@_code": "b", "#text": "val2" },
        { "@_code": "a", "#text": "val3" },
      ],
    };
    expect(extractSubfieldValues(field, "a")).toEqual(["val1", "val3"]);
  });

  it("handles a single-object subfield", () => {
    const field = {
      subfield: { "@_code": "a", "#text": "only-value" },
    };
    expect(extractSubfieldValues(field, "a")).toEqual(["only-value"]);
  });

  it("returns an empty array when no subfields match", () => {
    const field = {
      subfield: { "@_code": "b", "#text": "val" },
    };
    expect(extractSubfieldValues(field, "a")).toEqual([]);
  });

  it("returns an empty array when datafield has no subfield property", () => {
    expect(extractSubfieldValues({}, "a")).toEqual([]);
  });
});

// ── parseISBNFromMarc ─────────────────────────────────────────────────────

describe("parseISBNFromMarc", () => {
  it("parses ISBNs from 020$a fields, stripping qualifiers", () => {
    const isbns = parseISBNFromMarc(isbnRecord());
    expect(isbns).toContain("9780306406157");
    expect(isbns).toContain("0306406152");
    expect(isbns.length).toBe(2);
  });

  it("extracts only the $a subfield (ignores $z)", () => {
    const isbns = parseISBNFromMarc(isbnMultiSubfieldRecord());
    expect(isbns).toEqual(["9780306406157"]);
  });

  it("returns an empty array when there are no 020 fields", () => {
    expect(parseISBNFromMarc(singleDatafieldRecord())).toEqual([]);
  });

  it("returns an empty array for a null record", () => {
    expect(parseISBNFromMarc(null)).toEqual([]);
  });

  it("ignores ISBNs with invalid lengths after cleaning", () => {
    const record = {
      datafield: {
        "@_tag": "020",
        subfield: { "@_code": "a", "#text": "12345" },
      },
    };
    expect(parseISBNFromMarc(record)).toEqual([]);
  });

  it("handles ISBN with parenthetical qualifier followed by extra text", () => {
    const record = {
      datafield: {
        "@_tag": "020",
        subfield: { "@_code": "a", "#text": "9780306406157 (v. 1)" },
      },
    };
    const isbns = parseISBNFromMarc(record);
    expect(isbns).toContain("9780306406157");
  });
});
