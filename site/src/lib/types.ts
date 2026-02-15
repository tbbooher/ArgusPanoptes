// ── Static data types (loaded from public/data/*.json) ──

export interface SummaryStats {
  booksScanned: number;
  booksFound: number;
  booksNotFound: number;
  holdingsCount: number;
  systemCount: number;
  categorizedCount: number;
}

export interface BookEntry {
  isbn13: string;
  title: string;
  authors: string[];
  year: string | null;
  publisher: string | null;
  systemCount: number;
  totalCopies: number;
  totalAvailable: number;
  audience: string | null;
  topics: string[];
  confidence: number | null;
}

export interface LibraryEntry {
  id: string;
  name: string;
  city: string | null;
  region: string;
  vendor: string;
  enabled: boolean;
  protocol: string | null;
  lat: number | null;
  lng: number | null;
  booksHeld: number;
  totalCopies: number;
  totalAvailable: number;
}

export interface MapMarker {
  id: string;
  name: string;
  city: string | null;
  lat: number;
  lng: number;
  booksHeld: number;
  totalCopies: number;
  vendor: string;
  region: string;
}

export interface AudienceDistribution {
  audience: string;
  label: string;
  count: number;
}

export interface TopicDistribution {
  topic: string;
  label: string;
  count: number;
}

export interface CategorySummary {
  slug: string;
  label: string;
  type: "audience" | "topic";
  count: number;
}

export interface BookHolding {
  isbn13: string;
  title: string;
  authors: string[];
  year: string | null;
  copies: number;
  available: number;
  branches: number;
}

export interface LibraryDetail extends LibraryEntry {
  books: BookHolding[];
}

export interface BookDetail extends BookEntry {
  libraries: {
    systemId: string;
    systemName: string;
    copies: number;
    available: number;
    branches: number;
    lat: number | null;
    lng: number | null;
    city: string | null;
  }[];
}

// ── Taxonomy constants (mirrored from main project) ──

export const AUDIENCE_LABELS: Record<string, string> = {
  young_children: "Young Children (0-8)",
  middle_grade: "Middle Grade (8-12)",
  young_adult: "Young Adult (12-18)",
  adult: "Adult (18+)",
};

export const TOPIC_LABELS: Record<string, string> = {
  lgbtq_identity: "LGBTQ+ Identity & Relationships",
  gender_identity: "Gender Identity & Expression",
  race_and_racism: "Race, Racism & Racial Justice",
  sex_education: "Sex Education & Sexuality",
  social_justice: "Social Justice & Equity",
  mental_health: "Mental Health & Suicide",
  religious_viewpoints: "Religious Viewpoints & Criticism",
  drug_and_alcohol: "Drugs, Alcohol & Substance Use",
  violence_and_abuse: "Violence, Abuse & Trauma",
  death_and_grief: "Death, Grief & End of Life",
  family_and_divorce: "Family Structures & Divorce",
  body_image: "Body Image & Eating Disorders",
  political_activism: "Political Activism & Protest",
  witchcraft_and_occult: "Witchcraft, Occult & Supernatural",
  profanity_and_language: "Profanity & Explicit Language",
};
