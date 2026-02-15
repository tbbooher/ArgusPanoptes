import type { AudienceKey, TopicKey } from "./taxonomy.js";

/** A book row from the database, before classification. */
export interface UncategorizedBook {
  isbn13: string;
  title: string;
  authors: string[];
  year: string | null;
  publisher: string | null;
}

/** Result from the Claude classifier for a single book. */
export interface ClassificationResult {
  isbn13: string;
  audience: AudienceKey;
  topics: TopicKey[];
  confidence: number;
  reasoning: string;
}

/** A stored book category row from the database. */
export interface BookCategory {
  isbn13: string;
  audience: AudienceKey;
  topics: TopicKey[];
  confidence: number;
  source: string;
  enriched: boolean;
  model_id: string | null;
  classified_at: Date;
}

/** Enrichment data from OpenLibrary. */
export interface OpenLibraryData {
  isbn13: string;
  subjects: string[];
  description: string | null;
}

/** A book with enrichment data attached, for re-classification. */
export interface EnrichedBook extends UncategorizedBook {
  subjects: string[];
  description: string | null;
}
