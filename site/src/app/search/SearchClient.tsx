"use client";

import { useState, useCallback, useRef } from "react";

// ── Types ──────────────────────────────────────────────────────────────

interface HoldingItem {
  isbn?: string;
  systemId?: string;
  systemName?: string;
  branchId?: string;
  branchName?: string;
  status?: string;
  rawStatus?: string;
  callNumber?: string;
  materialType?: string;
  collection?: string;
  volume?: string;
  dueDate?: string;
  copyCount?: number;
  holdCount?: number;
  catalogUrl?: string;
}

interface SearchError {
  systemId?: string;
  systemName?: string;
  isbn13?: string;
  error?: string;
}

interface SearchResult {
  searchId?: string;
  query?: { title?: string; author?: string };
  candidates?: {
    isbn13sAll?: string[];
    isbn13sSearched?: string[];
    sources?: { googlebooks?: number; openlibrary?: number };
    resolveErrors?: string[];
  };
  normalizedISBN13?: string;
  holdings: HoldingItem[];
  errors: SearchError[];
  systemsSearched?: number;
  systemsSucceeded?: number;
  isPartial?: boolean;
  fromCache?: boolean;
}

type Mode = "isbn" | "title";

// ── Helpers ────────────────────────────────────────────────────────────

function groupBy<T>(arr: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(x);
  }
  return m;
}

function statusClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "available") return "text-green-400 border-green-500/40 bg-green-500/10";
  if (s === "checked_out") return "text-yellow-400 border-yellow-500/35 bg-yellow-500/10";
  return "text-gray-400 border-gray-600";
}

// ── Component ──────────────────────────────────────────────────────────

export function SearchClient() {
  const [mode, setMode] = useState<Mode>("isbn");
  const [query, setQuery] = useState("");
  const [author, setAuthor] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState("Idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const switchMode = useCallback((next: Mode) => {
    setMode(next);
    setQuery("");
    setAuthor("");
    setError(null);
    setResult(null);
    setShowRaw(false);
    setStatusText("Idle");
  }, []);

  const doSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) {
      setError(mode === "title" ? "Enter a title." : "Enter an ISBN.");
      return;
    }

    if (mode === "isbn" && !/^[0-9-]+$/.test(q)) {
      setError("ISBN should contain only digits and hyphens.");
      return;
    }

    // Abort any in-flight search
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    setResult(null);
    setShowRaw(false);
    setStatusText("Searching...");

    try {
      const params = new URLSearchParams();
      let url: string;
      if (mode === "title") {
        params.set("title", q);
        if (author.trim()) params.set("author", author.trim());
        url = `/api/search/title?${params.toString()}`;
      } else {
        params.set("isbn", q);
        url = `/api/search?${params.toString()}`;
      }

      const resp = await fetch(url, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });

      const text = await resp.text();
      let data: SearchResult;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(text || `HTTP ${resp.status}`);
      }

      if (!resp.ok) {
        throw new Error(
          (data as unknown as { error?: string }).error || `HTTP ${resp.status}`,
        );
      }

      setResult(data);
      setStatusText("Done");
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : String(e));
      setStatusText("Error");
    } finally {
      setLoading(false);
    }
  }, [mode, query, author]);

  const fillExample = useCallback(() => {
    if (mode === "title") {
      setQuery("The Communist Manifesto");
      setAuthor("Marx");
    } else {
      setQuery("9780143127741");
    }
  }, [mode]);

  // ── Summary line ─────────────────────────────────────────────────────

  function summaryLine(): string | null {
    if (!result) return null;
    const holdings = result.holdings?.length ?? 0;
    const errors = result.errors ?? [];

    if (result.query && result.candidates) {
      const searched = result.candidates.isbn13sSearched?.length ?? 0;
      const total = result.candidates.isbn13sAll?.length ?? 0;
      let s = `Holdings: ${holdings} | Candidate ISBNs: ${searched}/${total} searched`;
      if (result.isPartial) s += " | partial";
      if (errors.length) {
        const systems = new Set(errors.map((e) => e.systemId || e.systemName || ""));
        s += ` | ${systems.size} system${systems.size === 1 ? "" : "s"} unavailable`;
      }
      return s;
    }

    let s = `Holdings: ${holdings} | Systems searched: ${result.systemsSearched ?? 0} (${result.systemsSucceeded ?? 0} ok)`;
    if (result.isPartial) s += " | partial";
    if (result.fromCache) s += " | cache";
    if (errors.length) {
      const systems = new Set(errors.map((e) => e.systemId || e.systemName || ""));
      s += ` | ${systems.size} system${systems.size === 1 ? "" : "s"} unavailable`;
    }
    return s;
  }

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white">Search</h1>
        <p className="mt-1 text-sm text-gray-400">
          Look up real-time availability across 260+ Texas public library systems
        </p>
      </div>

      {/* Search card */}
      <div className="rounded-xl border border-gray-800 bg-gradient-to-b from-white/[0.04] to-white/[0.02] p-5 shadow-lg">
        {/* Mode toggle */}
        <div className="mb-4 flex items-center justify-between">
          <span className="rounded-full border border-gray-700 bg-black/20 px-3 py-1 font-mono text-xs text-gray-400">
            Mode: {mode === "title" ? "Title" : "ISBN"}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => switchMode("isbn")}
              className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                mode === "isbn"
                  ? "border-cyan-400/50 bg-cyan-400/20 text-white"
                  : "border-gray-700 bg-gray-800/50 text-gray-300 hover:bg-gray-700/50"
              }`}
            >
              ISBN
            </button>
            <button
              type="button"
              onClick={() => switchMode("title")}
              className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                mode === "title"
                  ? "border-cyan-400/50 bg-cyan-400/20 text-white"
                  : "border-gray-700 bg-gray-800/50 text-gray-300 hover:bg-gray-700/50"
              }`}
            >
              Title
            </button>
          </div>
        </div>

        {/* Search form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            doSearch();
          }}
          className={`grid gap-3 ${mode === "title" ? "grid-cols-1 sm:grid-cols-[2fr_1fr_auto_auto]" : "grid-cols-1 sm:grid-cols-[1fr_auto_auto]"}`}
        >
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              mode === "title"
                ? "Title, e.g. The Communist Manifesto"
                : "ISBN-10 or ISBN-13, e.g. 9780143127741"
            }
            inputMode={mode === "isbn" ? "numeric" : "text"}
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-lg border border-gray-700 bg-black/40 px-3 py-3 text-white placeholder-gray-500 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
          />

          {mode === "title" && (
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="Optional author, e.g. Orwell"
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-lg border border-gray-700 bg-black/40 px-3 py-3 text-white placeholder-gray-500 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
            />
          )}

          <button
            type="submit"
            disabled={loading}
            className="rounded-lg border border-cyan-400/35 bg-cyan-400/15 px-4 py-3 font-semibold text-white transition-colors hover:bg-cyan-400/25 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Searching..." : "Search"}
          </button>

          <button
            type="button"
            onClick={fillExample}
            className="rounded-lg border border-gray-700 bg-gray-800/50 px-4 py-3 font-semibold text-gray-300 transition-colors hover:bg-gray-700/50"
          >
            Example
          </button>
        </form>

        {/* Status + summary */}
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-full border border-gray-700 bg-black/20 px-3 py-1 font-mono text-xs text-gray-400">
            {statusText}
          </span>
          {summaryLine() && (
            <span className="rounded-full border border-gray-700 bg-black/20 px-3 py-1 font-mono text-xs text-gray-400">
              {summaryLine()}
            </span>
          )}
        </div>

        {/* Important note */}
        <p className="mt-3 text-xs text-gray-400">
          <span className="font-semibold text-white">Important:</span>{" "}
          &quot;Holdings&quot; are real per-copy availability parsed from supported
          systems. If you don&apos;t see a library here, it usually means we
          don&apos;t have an availability adapter for that system yet (not that the
          library doesn&apos;t own the book).
        </p>

        {/* Error */}
        {error && (
          <div className="mt-3 whitespace-pre-wrap font-mono text-xs text-red-400">
            {error}
          </div>
        )}
      </div>

      {/* Results */}
      {result && <ResultsView result={result} />}

      {/* Raw JSON */}
      {result && (
        <div className="mt-4 rounded-xl border border-gray-800 bg-black/10 p-3">
          <button
            type="button"
            onClick={() => setShowRaw(!showRaw)}
            className="cursor-pointer font-mono text-xs text-gray-400 hover:text-gray-200"
          >
            {showRaw ? "Hide" : "Show"} Raw JSON
          </button>
          {showRaw && (
            <pre className="mt-3 max-h-96 overflow-auto rounded-lg border border-gray-800 bg-black/30 p-3">
              <code className="font-mono text-xs text-blue-200">
                {JSON.stringify(result, null, 2)}
              </code>
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ── Results view ─────────────────────────────────────────────────────────

function ResultsView({ result }: { result: SearchResult }) {
  const holdings = result.holdings ?? [];

  if (holdings.length === 0) {
    return (
      <div className="mt-4 rounded-xl border border-gray-800 bg-black/10 p-5 text-center text-gray-400">
        No holdings found.
      </div>
    );
  }

  const bySystem = groupBy(
    holdings,
    (h) => h.systemId || h.systemName || "unknown",
  );

  return (
    <div className="mt-4 grid gap-3">
      {Array.from(bySystem.entries()).map(([sysKey, sysHoldings]) => (
        <SystemCard key={sysKey} holdings={sysHoldings} />
      ))}
    </div>
  );
}

function SystemCard({ holdings }: { holdings: HoldingItem[] }) {
  const sysName = holdings[0].systemName || holdings[0].systemId || "Unknown system";
  const catalogUrl = holdings[0].catalogUrl || "";
  const available = holdings.filter(
    (h) => h.status?.toLowerCase() === "available",
  ).length;

  const byBranch = groupBy(
    holdings,
    (h) => h.branchId || h.branchName || "unknown",
  );

  return (
    <div className="overflow-hidden rounded-xl border border-gray-800 bg-black/10">
      {/* System header */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white/[0.03] px-4 py-3">
        <div className="font-bold text-white">
          {sysName}
          {catalogUrl && (
            <>
              {" "}
              <a
                href={catalogUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-normal text-cyan-400 hover:underline"
              >
                (catalog)
              </a>
            </>
          )}
        </div>
        <div className="flex gap-2">
          <span className="rounded-lg border border-gray-700 px-2 py-1 font-mono text-xs text-gray-400">
            items: {holdings.length}
          </span>
          <span className="rounded-lg border border-gray-700 px-2 py-1 font-mono text-xs text-gray-400">
            available: {available}
          </span>
        </div>
      </div>

      {/* Branches */}
      <div className="grid gap-3 p-3">
        {Array.from(byBranch.entries()).map(([branchKey, branchHoldings]) => (
          <BranchCard key={branchKey} holdings={branchHoldings} />
        ))}
      </div>
    </div>
  );
}

function BranchCard({ holdings }: { holdings: HoldingItem[] }) {
  const bName =
    holdings[0].branchName || holdings[0].branchId || "Unknown branch";

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-3">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="font-semibold text-white">{bName}</span>
        <span className="text-xs text-gray-400">
          {holdings.length} item(s)
        </span>
      </div>
      <div className="grid gap-2">
        {holdings.map((h, i) => (
          <ItemCard key={i} item={h} />
        ))}
      </div>
    </div>
  );
}

function ItemCard({ item }: { item: HoldingItem }) {
  const st = (item.status || "unknown").toLowerCase();
  return (
    <div className="rounded-lg border border-gray-800/90 bg-gray-950/60 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <span className="font-mono text-xs text-gray-400">
          ISBN {item.isbn || ""}
        </span>
        <span
          className={`rounded-full border px-2 py-0.5 font-mono text-xs ${statusClass(st)}`}
        >
          {st}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 text-sm">
        <KV label="callNumber" value={item.callNumber} />
        <KV label="materialType" value={item.materialType || "unknown"} />
        <KV label="collection" value={item.collection} />
        <KV label="volume" value={item.volume} />
        <KV label="dueDate" value={item.dueDate} />
        <KV label="copies" value={item.copyCount?.toString()} />
        <KV label="holds" value={item.holdCount?.toString()} />
        <KV label="rawStatus" value={item.rawStatus} />
      </div>
    </div>
  );
}

function KV({ label, value }: { label: string; value?: string | null }) {
  return (
    <>
      <span className="font-mono text-xs text-gray-500">{label}</span>
      <span className="break-all text-gray-200">
        {value || <span className="text-gray-600">n/a</span>}
      </span>
    </>
  );
}
