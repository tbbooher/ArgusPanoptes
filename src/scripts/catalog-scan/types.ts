// Types for the catalog scan script

export interface ProgressiveBook {
  title: string;
  authors: string[];
  isbn_13: string;
  isbn_10: string;
  year: number;
  publisher: string;
}

export interface ProgressiveBooksFile {
  list: {
    title: string;
    description: string;
    total_items: number;
  };
  books: ProgressiveBook[];
}

/** Mirrors the argus API SearchResult shape (subset we care about) */
export interface ApiSearchResult {
  searchId: string;
  isbn: string;
  normalizedISBN13: string;
  holdings: ApiBookHolding[];
  errors: ApiSearchError[];
  systemsSearched: number;
  systemsSucceeded: number;
  systemsFailed: number;
  systemsTimedOut: number;
  isPartial: boolean;
}

export interface ApiBookHolding {
  isbn: string;
  systemId: string;
  branchId: string;
  systemName: string;
  branchName: string;
  callNumber: string | null;
  status: string;
  materialType: string;
  dueDate: string | null;
  holdCount: number | null;
  copyCount: number | null;
  catalogUrl: string;
  collection: string;
  volume: string | null;
  rawStatus: string;
  fingerprint: string;
}

export interface ApiSearchError {
  systemId: string;
  systemName: string;
  protocol: string;
  errorType: string;
  message: string;
  timestamp: string;
}

export interface ScanOptions {
  dbHost: string;
  dbPort: number;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  apiUrl: string;
  concurrency: number;
  delay: number;
  workerId: number;
  totalWorkers: number;
  resume: boolean;
  dryRun: boolean;
  timeout: number;
}

export interface ScanStats {
  total: number;
  scanned: number;
  found: number;
  notFound: number;
  errors: number;
  startTime: number;
}

export interface SystemHoldings {
  systemId: string;
  systemName: string;
  branchCount: number;
  copyCount: number;
  available: number;
  catalogUrl: string;
  holdings: ApiBookHolding[];
}
