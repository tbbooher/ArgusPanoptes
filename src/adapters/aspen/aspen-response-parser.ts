// ---------------------------------------------------------------------------
// Shared Aspen Discovery JSON response parsing.
//
// Extracts parsing logic so both AspenDiscoveryAdapter (direct HTTP) and
// PlaywrightAdapter (browser-context fetch) can reuse the same code.
// ---------------------------------------------------------------------------

/** Shape of a record returned by SearchAPI. */
export interface AspenSearchRecord {
  id: string;
  title_display?: string;
  title?: string;
  author_display?: string;
  author?: string;
  isbn?: string[];
  format?: string[];
}

/** Shape of SearchAPI JSON response. */
export interface AspenSearchResponse {
  result?: {
    success?: boolean;
    totalResults?: number;
    recordCount?: number;
    records?: AspenSearchRecord[];
  };
  success?: boolean;
  totalResults?: number;
  recordCount?: number;
  records?: AspenSearchRecord[];
}

/** Shape of a single item from ItemAPI. */
export interface AspenItemRecord {
  itemId?: string;
  locationCode?: string;
  location?: string;
  locationName?: string;
  callNumber?: string;
  shelfLocation?: string;
  statusFull?: string;
  status?: string;
  available?: boolean;
  dueDate?: string;
  holdable?: boolean;
  numHolds?: number;
  format?: string;
  collection?: string;
}

/** Shape of ItemAPI JSON response. */
export interface AspenItemResponse {
  result?: AspenItemRecord[] | { items?: AspenItemRecord[]; holdings?: AspenItemRecord[] };
  items?: AspenItemRecord[];
  success?: boolean;
}

/**
 * Extract search records from an Aspen Discovery SearchAPI response.
 * Handles both `data.result.records` and `data.records` shapes.
 */
export function parseSearchRecords(data: AspenSearchResponse): AspenSearchRecord[] {
  return data?.result?.records ?? data?.records ?? [];
}

/**
 * Extract item records from an Aspen Discovery ItemAPI response.
 * Handles multiple response shapes:
 *   - `data.result` (array)
 *   - `data.result.holdings` (array)
 *   - `data.result.items` (array)
 *   - `data.items` (array)
 */
export function parseItemRecords(data: AspenItemResponse): AspenItemRecord[] {
  if (Array.isArray(data?.result)) return data.result;
  if (Array.isArray((data?.result as any)?.holdings)) return (data.result as any).holdings;
  if (Array.isArray((data?.result as any)?.items)) return (data.result as any).items;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}
