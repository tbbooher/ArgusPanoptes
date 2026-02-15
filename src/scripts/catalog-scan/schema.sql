-- Books table (keyed by ISBN-13)
CREATE TABLE IF NOT EXISTS books (
  isbn13       VARCHAR(13) PRIMARY KEY,
  isbn10       VARCHAR(10),
  title        TEXT NOT NULL,
  authors      TEXT[],
  year         VARCHAR(10),
  publisher    TEXT
);

-- Holdings: one row per book x system where the book was found
CREATE TABLE IF NOT EXISTS holdings (
  id           SERIAL PRIMARY KEY,
  isbn13       VARCHAR(13) NOT NULL REFERENCES books(isbn13),
  system_id    VARCHAR(100) NOT NULL,
  system_name  TEXT NOT NULL,
  branch_count INTEGER NOT NULL DEFAULT 0,
  copy_count   INTEGER NOT NULL DEFAULT 0,
  available    INTEGER NOT NULL DEFAULT 0,
  catalog_url  TEXT,
  raw_holdings JSONB,
  scanned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (isbn13, system_id)
);

-- Scan progress: tracks which books have been fully scanned
CREATE TABLE IF NOT EXISTS scan_progress (
  isbn13            VARCHAR(13) PRIMARY KEY,
  completed         BOOLEAN NOT NULL DEFAULT FALSE,
  systems_searched  INTEGER NOT NULL DEFAULT 0,
  systems_found     INTEGER NOT NULL DEFAULT 0,
  errors_count      INTEGER NOT NULL DEFAULT 0,
  scanned_at        TIMESTAMPTZ
);

-- Scan runs: metadata about each scan invocation
CREATE TABLE IF NOT EXISTS scan_runs (
  id             SERIAL PRIMARY KEY,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at    TIMESTAMPTZ,
  worker_id      INTEGER,
  total_workers  INTEGER,
  books_total    INTEGER,
  books_scanned  INTEGER DEFAULT 0,
  status         VARCHAR(20) DEFAULT 'running'
);

-- Useful view: book x library report
CREATE OR REPLACE VIEW book_library_report AS
SELECT
  b.title,
  b.authors,
  b.isbn13,
  h.system_id,
  h.system_name,
  h.copy_count,
  h.available,
  h.branch_count
FROM books b
JOIN holdings h ON h.isbn13 = b.isbn13
ORDER BY b.title, h.system_name;
