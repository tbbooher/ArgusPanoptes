// ---------------------------------------------------------------------------
// BiblioCommons Parser – extracts BookHolding[] from BiblioCommons
// search-results / item-detail HTML pages.
//
// BiblioCommons is a discovery layer used by many large library systems.
// The HTML structure for search results typically looks like:
//
//   <div class="cp-search-result-item">
//     <h2 class="title-content">Title</h2>
//     <span class="cp-author-link">Author</span>
//     <div class="cp-availability-status">
//       <span class="cp-availability-status-text">Available</span>
//     </div>
//   </div>
//
// Item detail / availability pages may use:
//   <table class="item-list-table">
//     <tr>
//       <td class="circ-location">Branch Name</td>
//       <td class="circ-call-number">Call Number</td>
//       <td class="circ-status">Available / Due date</td>
//     </tr>
//   </table>
//
// Or the more modern layout:
//   <div class="cp-item-row">
//     <span class="cp-branch-name">Branch</span>
//     <span class="cp-call-number">Call Number</span>
//     <span class="cp-availability-status">Status</span>
//   </div>
// ---------------------------------------------------------------------------

import * as cheerio from "cheerio";

import type {
  BookHolding,
  BranchId,
  ItemStatus,
  LibrarySystem,
} from "../../../core/types.js";

/**
 * Parse a BiblioCommons HTML page and extract holdings data.
 *
 * @param html    The full HTML source of the search results or detail page.
 * @param system  The library system this page belongs to.
 * @param isbn    The ISBN that was searched for.
 * @returns       An array of BookHolding records parsed from the HTML.
 */
export function parseBiblioCommonsResults(
  html: string,
  system: LibrarySystem,
  isbn: string,
): BookHolding[] {
  const $ = cheerio.load(html);
  const holdings: BookHolding[] = [];

  // ── Strategy 1: Item availability table (detail page) ─────────────────

  $(
    "table.item-list-table tr, table.cp-item-list tr, .cp-availability-listing tr",
  ).each((_index, element) => {
    const $row = $(element);

    // Skip header rows.
    if ($row.find("th").length > 0) return;

    const branchName =
      $row
        .find("td.circ-location, td.cp-location, td:nth-child(1)")
        .first()
        .text()
        .trim() || null;

    if (!branchName) return; // Skip empty rows.

    const callNumber =
      $row
        .find(
          "td.circ-call-number, td.cp-call-number, td:nth-child(2)",
        )
        .first()
        .text()
        .trim() || null;

    const rawStatus =
      $row
        .find("td.circ-status, td.cp-status, td:nth-child(3)")
        .first()
        .text()
        .trim() || "";

    const collection =
      $row
        .find("td.circ-collection, td.cp-collection, td:nth-child(4)")
        .first()
        .text()
        .trim() || "";

    const branchInfo = system.branches.find(
      (b) =>
        b.name.toLowerCase() === branchName.toLowerCase() ||
        b.code.toLowerCase() === branchName.toLowerCase(),
    );

    holdings.push(
      createHolding(
        isbn,
        system,
        branchInfo?.id ?? (branchName as unknown as BranchId),
        branchInfo?.name ?? branchName,
        callNumber,
        rawStatus,
        collection,
      ),
    );
  });

  // ── Strategy 2: Modern cp-item-row divs ───────────────────────────────

  if (holdings.length === 0) {
    $("div.cp-item-row, li.cp-availability-item").each(
      (_index, element) => {
        const $div = $(element);

        const branchName =
          $div
            .find(
              ".cp-branch-name, .cp-location-name, .branch-name",
            )
            .first()
            .text()
            .trim() || "Unknown";

        const callNumber =
          $div
            .find(".cp-call-number, .call-number")
            .first()
            .text()
            .trim() || null;

        const rawStatus =
          $div
            .find(
              ".cp-availability-status, .cp-status, .availability-status",
            )
            .first()
            .text()
            .trim() || "";

        const branchInfo = system.branches.find(
          (b) =>
            b.name.toLowerCase() === branchName.toLowerCase() ||
            b.code.toLowerCase() === branchName.toLowerCase(),
        );

        holdings.push(
          createHolding(
            isbn,
            system,
            branchInfo?.id ?? (branchName as unknown as BranchId),
            branchInfo?.name ?? branchName,
            callNumber,
            rawStatus,
            "",
          ),
        );
      },
    );
  }

  // ── Strategy 3: Search result cards (summary-level availability) ──────

  if (holdings.length === 0) {
    $(
      "div.cp-search-result-item, li.cp-search-result-item, div.listItem",
    ).each((_index, element) => {
      const $card = $(element);

      // Extract summary availability info from the card.
      const statusText =
        $card
          .find(
            ".cp-availability-status-text, .availability, .availableStatus",
          )
          .first()
          .text()
          .trim() || "";

      // Some cards show branch info inline.
      const branchText =
        $card
          .find(".cp-branch-name, .branch, .location")
          .first()
          .text()
          .trim() || "Unknown";

      const callNumber =
        $card.find(".cp-call-number, .callNumber").first().text().trim() ||
        null;

      if (!statusText && !branchText) return;

      const branchInfo = system.branches.find(
        (b) =>
          b.name.toLowerCase() === branchText.toLowerCase() ||
          b.code.toLowerCase() === branchText.toLowerCase(),
      );

      holdings.push(
        createHolding(
          isbn,
          system,
          branchInfo?.id ?? (branchText as unknown as BranchId),
          branchInfo?.name ?? branchText,
          callNumber,
          statusText,
          "",
        ),
      );
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
  // Extract due date from status strings like "Due Dec 15, 2025".
  let dueDate: string | null = null;
  const dueMatch = rawStatus.match(
    /due\s+(.+)/i,
  );
  if (dueMatch) {
    dueDate = dueMatch[1].replace(/\.$/, "").trim();
  }

  return {
    isbn,
    systemId: system.id,
    branchId,
    systemName: system.name,
    branchName,
    callNumber: callNumber || null,
    status: normalizeBiblioCommonsStatus(rawStatus),
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

function normalizeBiblioCommonsStatus(raw: string): ItemStatus {
  if (!raw) return "unknown";
  const lower = raw.toLowerCase().trim();

  if (
    lower === "available" ||
    lower.includes("available") ||
    lower === "on shelf" ||
    lower === "in"
  ) {
    return "available";
  }

  if (
    lower.startsWith("due") ||
    lower === "checked out" ||
    lower.includes("checked out") ||
    lower.includes("not available")
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
