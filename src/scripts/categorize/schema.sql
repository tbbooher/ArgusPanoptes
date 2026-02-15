-- Book categories: audience level and topic tags for each book
CREATE TABLE IF NOT EXISTS book_categories (
  isbn13         VARCHAR(13) PRIMARY KEY REFERENCES books(isbn13),
  audience       VARCHAR(30) NOT NULL,
  topics         TEXT[] NOT NULL DEFAULT '{}',
  confidence     REAL NOT NULL DEFAULT 0.0,
  source         VARCHAR(30) NOT NULL DEFAULT 'claude',
  enriched       BOOLEAN NOT NULL DEFAULT FALSE,
  model_id       VARCHAR(80),
  raw_response   JSONB,
  classified_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_book_categories_audience ON book_categories(audience);
CREATE INDEX IF NOT EXISTS idx_book_categories_confidence ON book_categories(confidence);
