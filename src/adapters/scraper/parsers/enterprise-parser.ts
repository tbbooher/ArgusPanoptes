// ---------------------------------------------------------------------------
// Enterprise Parser – extracts BookHolding[] from SirsiDynix Enterprise
// OPAC HTML pages.
//
// SirsiDynix Enterprise is a discovery layer that renders search results
// and item availability in a server-rendered HTML page.  The typical HTML
// structure for availability tables looks like:
//
//   <div class="displayDetailCopies">
//     <table class="detailItemTable">
//       <tr class="detailItemsTableRow">
//         <td class="detailItemsLibrary">Branch Name</td>
//         <td class="detailItemsCallNumber">Call Number</td>
//         <td class="detailItemsStatus">Available / Due date</td>
//         <td class="detailItemsCollection">Collection</td>
//       </tr>
//     </table>
//   </div>
//
// Some Enterprise instances also use:
//   <div class="itemSummary"> with inner <span> elements
//   <div id="detail_biblio0"> for title/author metadata
// ---------------------------------------------------------------------------

import * as cheerio from "cheerio";

import type {
  BookHolding,
  BranchId,
  ItemStatus,
  LibrarySystem,
} from "../../../core/types.js";

/**
 * Parse a SirsiDynix Enterprise HTML page and extract holdings data.
 *
 * @param html    The full HTML source of the search results / detail page.
 * @param system  The library system this page belongs to.
 * @param isbn    The ISBN that was searched for.
 * @returns       An array of BookHolding records parsed from the HTML.
 */
export function parseEnterpriseResults(
  html: string,
  system: LibrarySystem,
  isbn: string,
): BookHolding[] {
  const $ = cheerio.load(html);
  const holdings: BookHolding[] = [];

  // Try the tabular layout first (most common).
  $("tr.detailItemsTableRow, tr.detailItemTableRow").each(
    (_index, element) => {
      const $row = $(element);

      // Skip header rows.
      if ($row.find("th").length > 0) return;

      const branchName =
        $row
          .find(
            "td.detailItemsLibrary, td.detailItemLibrary, td:nth-child(1)",
          )
          .first()
          .text()
          .trim() || "Unknown";

      const callNumber =
        $row
          .find(
            "td.detailItemsCallNumber, td.detailItemCallNumber, td:nth-child(2)",
          )
          .first()
          .text()
          .trim() || null;

      const rawStatus =
        $row
          .find(
            "td.detailItemsStatus, td.detailItemStatus, td:nth-child(3)",
          )
          .first()
          .text()
          .trim() || "";

      const collection =
        $row
          .find(
            "td.detailItemsCollection, td.detailItemCollection, td:nth-child(4)",
          )
          .first()
          .text()
          .trim() || "";

      const branchInfo = system.branches.find(
        (b) =>
          b.name.toLowerCase() === branchName.toLowerCase() ||
          b.code.toLowerCase() === branchName.toLowerCase(),
      );

      const holding = createHolding(
        isbn,
        system,
        branchInfo?.id ?? (branchName as unknown as BranchId),
        branchInfo?.name ?? branchName,
        callNumber,
        rawStatus,
        collection,
      );
      holdings.push(holding);
    },
  );

  // Fallback: try the summary div layout used by some Enterprise versions.
  if (holdings.length === 0) {
    $("div.itemSummary, div.availableDiv, div.detailCopySummary").each(
      (_index, element) => {
        const $div = $(element);
        const text = $div.text().trim();
        if (!text) return;

        // Parse "Branch - Call Number - Status" pattern.
        const parts = text.split(/\s*[-|]\s*/);
        const branchName = parts[0]?.trim() || "Unknown";
        const callNumber = parts.length > 1 ? parts[1]?.trim() || null : null;
        const rawStatus = parts.length > 2 ? parts[2]?.trim() || "" : "";

        const branchInfo = system.branches.find(
          (b) =>
            b.name.toLowerCase() === branchName.toLowerCase() ||
            b.code.toLowerCase() === branchName.toLowerCase(),
        );

        const holding = createHolding(
          isbn,
          system,
          branchInfo?.id ?? (branchName as unknown as BranchId),
          branchInfo?.name ?? branchName,
          callNumber,
          rawStatus,
          "",
        );
        holdings.push(holding);
      },
    );
  }

  // Additional fallback: availability spans inside result cards.
  if (holdings.length === 0) {
    $(
      "div.displayDetailCopies span.availableLabel, div.copySummary span",
    ).each((_index, element) => {
      const text = $(element).text().trim();
      if (!text) return;

      const holding = createHolding(
        isbn,
        system,
        "unknown" as unknown as BranchId,
        "Unknown",
        null,
        text,
        "",
      );
      holdings.push(holding);
    });
  }

  return holdings;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function createHolding(
  isbn: string,
  system: LibrarySystem,
  branchId: BranchId,
  branchName: string,
  callNumber: string | null,
  rawStatus: string,
  collection: string,
): BookHolding {
  // Extract a due date from status strings like "Due 03-15-2025".
  let dueDate: string | null = null;
  const dueMatch = rawStatus.match(
    /due\s+(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/i,
  );
  if (dueMatch) {
    dueDate = dueMatch[1];
  }

  return {
    isbn,
    systemId: system.id,
    branchId,
    systemName: system.name,
    branchName,
    callNumber: callNumber || null,
    status: normalizeEnterpriseStatus(rawStatus),
    materialType: "book",
    dueDate,
    holdCount: null,
    copyCount: null,
    catalogUrl: system.catalogUrl,
    collection,
    volume: null,
    rawStatus,
    fingerprint: generateFingerprint([
      system.id,
      isbn,
      branchName,
      callNumber,
    ]),
  };
}

function normalizeEnterpriseStatus(raw: string): ItemStatus {
  if (!raw) return "unknown";
  const lower = raw.toLowerCase().trim();

  if (
    lower === "available" ||
    lower === "on shelf" ||
    lower.includes("check shelf") ||
    lower === "in library"
  ) {
    return "available";
  }

  if (
    lower.startsWith("due") ||
    lower === "checked out" ||
    lower.includes("checked out")
  ) {
    return "checked_out";
  }

  if (lower.includes("transit")) return "in_transit";
  if (lower.includes("hold")) return "on_hold";
  if (lower.includes("order")) return "on_order";
  if (lower.includes("processing") || lower.includes("cataloging"))
    return "in_processing";
  if (
    lower.includes("missing") ||
    lower.includes("lost") ||
    lower.includes("withdrawn")
  )
    return "missing";

  return "unknown";
}

function generateFingerprint(
  parts: (string | number | null | undefined)[],
): string {
  return parts
    .filter((p): p is string | number => p != null && p !== "")
    .map((p) => String(p).trim().toLowerCase())
    .join(":");
}
