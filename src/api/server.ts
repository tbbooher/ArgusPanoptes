// ---------------------------------------------------------------------------
// Hono application factory.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import type pino from "pino";
import type { LibrarySystem } from "../core/types.js";
import type { SearchCoordinator } from "../orchestrator/search-coordinator.js";
import type { HealthTracker } from "../cache/health-tracker.js";
import type { MetricsCollector } from "../metrics/metrics-collector.js";

import { requestIdMiddleware } from "./middleware/request-id.js";
import { createRequestLogger } from "../logging/context.js";
import { rateLimitMiddleware } from "./middleware/rate-limit.js";
import { errorHandler } from "./middleware/error-handler.js";

import { searchRoutes } from "./routes/search.js";
import { libraryRoutes } from "./routes/libraries.js";
import { healthRoutes } from "./routes/health.js";
import { parseISBN } from "../domain/isbn/isbn.js";
import { ISBNValidationError } from "../core/errors.js";

import type { RateLimitConfig } from "../core/types.js";

// ── Dependency bundle ──────────────────────────────────────────────────────

export interface AppDependencies {
  searchCoordinator: SearchCoordinator;
  systems: LibrarySystem[];
  healthTracker: HealthTracker;
  metricsCollector: MetricsCollector;
  logger: pino.Logger;
  rateLimitConfig: RateLimitConfig;
}

// ── App factory ────────────────────────────────────────────────────────────

/**
 * Create and configure the Hono application.
 *
 * Middleware stack (applied in order):
 * 1. Request ID generation (`X-Request-ID`).
 * 2. Request-scoped child logger attached to context.
 * 3. Per-IP rate limiting.
 * 4. Route handlers.
 * 5. Global error handler (maps domain errors to HTTP status codes).
 */
export function createApp(deps: AppDependencies): Hono {
  const app = new Hono();

  // ── Global middleware ──────────────────────────────────────────────────

  app.use("*", requestIdMiddleware());
  app.use("*", createRequestLogger(deps.logger));
  app.use("*", rateLimitMiddleware(deps.rateLimitConfig));

  // ── Routes ────────────────────────────────────────────────────────────

      app.get("/", (c) => {
    const accept = c.req.header("accept") ?? "";
    const wantsHtml = accept.includes("text/html") || accept.includes("*/*");

    if (!wantsHtml) {
      return c.json({
        name: "argus",
        service: "book-finder",
        routes: ["/health", "/libraries", "/search"],
      });
    }

    return c.html(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Argus</title>
    <style>
      :root {
        --bg: #0b0e14;
        --panel: #101726;
        --panel2: #0f1320;
        --text: #e8ecf3;
        --muted: #9aa6b2;
        --line: #1f2a3d;
        --accent: #89e4ff;
        --danger: #ff6b6b;
        --ok: #36d399;
        --warn: #ffd166;
        --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono",
          "Courier New", monospace;
        --sans: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial,
          "Apple Color Emoji", "Segoe UI Emoji";
      }

      html, body {
        height: 100%;
        background: radial-gradient(1200px 600px at 20% 10%, rgba(137, 228, 255, 0.10), transparent 55%),
          radial-gradient(900px 500px at 80% 30%, rgba(255, 209, 102, 0.08), transparent 50%),
          radial-gradient(700px 500px at 50% 90%, rgba(54, 211, 153, 0.06), transparent 60%),
          var(--bg);
        color: var(--text);
        font-family: var(--sans);
        margin: 0;
      }

      a { color: var(--accent); text-decoration: none; }
      a:hover { text-decoration: underline; }

      .wrap { max-width: 1100px; margin: 0 auto; padding: 28px 18px 60px; }
      header { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
      h1 { margin: 0; font-size: 30px; letter-spacing: 0.3px; }
      .sub { color: var(--muted); font-size: 13px; }

      .card {
        background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02));
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 16px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.22);
      }

      .search {
        display: grid;
        grid-template-columns: 1fr auto auto;
        gap: 10px;
        align-items: center;
        margin-top: 14px;
      }
      .search.title-mode {
        grid-template-columns: 2fr 1fr auto auto;
      }

      input[type="text"]{
        width: 100%;
        background: rgba(10, 14, 22, 0.55);
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 12px 12px;
        color: var(--text);
        font-size: 15px;
        outline: none;
      }
      input[type="text"]::placeholder { color: rgba(154, 166, 178, 0.75); }
      input[type="text"]:focus { border-color: rgba(137, 228, 255, 0.6); box-shadow: 0 0 0 3px rgba(137, 228, 255, 0.12); }

      button {
        background: rgba(137, 228, 255, 0.12);
        border: 1px solid rgba(137, 228, 255, 0.35);
        color: var(--text);
        border-radius: 10px;
        padding: 12px 14px;
        font-weight: 650;
        letter-spacing: 0.2px;
        cursor: pointer;
      }
      button:hover { background: rgba(137, 228, 255, 0.18); }
      button:disabled { opacity: 0.6; cursor: not-allowed; }

      .pill {
        font-family: var(--mono);
        font-size: 12px;
        color: var(--muted);
        border: 1px solid var(--line);
        border-radius: 999px;
        padding: 6px 10px;
        background: rgba(0,0,0,0.12);
      }

      .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
      .meta { margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap; }
      .err { color: var(--danger); font-family: var(--mono); font-size: 12px; white-space: pre-wrap; }

      .results { margin-top: 16px; display: grid; gap: 12px; }
      .sys { border: 1px solid var(--line); border-radius: 14px; overflow: hidden; background: rgba(0,0,0,0.10); }
      .sysHead { padding: 12px 14px; background: rgba(255,255,255,0.03); display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
      .sysName { font-weight: 720; }
      .sysCounts { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
      .count { font-family: var(--mono); font-size: 12px; color: var(--muted); border: 1px solid var(--line); border-radius: 10px; padding: 4px 8px; }

      .holdings { padding: 10px 14px 14px; display: grid; gap: 10px; }
      .branch { padding: 10px; border: 1px solid var(--line); border-radius: 12px; background: rgba(16, 23, 38, 0.35); }
      .branchHead { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
      .branchName { font-weight: 650; }
      .items { margin-top: 8px; display: grid; gap: 8px; }

      .item { border: 1px solid rgba(31, 42, 61, 0.9); border-radius: 10px; padding: 10px; background: rgba(15, 19, 32, 0.55); }
      .itemTop { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
      .status { font-family: var(--mono); font-size: 12px; padding: 3px 8px; border-radius: 999px; border: 1px solid var(--line); }
      .status.available { color: var(--ok); border-color: rgba(54, 211, 153, 0.4); background: rgba(54, 211, 153, 0.08); }
      .status.checked_out { color: var(--warn); border-color: rgba(255, 209, 102, 0.35); background: rgba(255, 209, 102, 0.07); }
      .status.unknown { color: var(--muted); }

      .kv { margin-top: 6px; display: grid; grid-template-columns: 140px 1fr; gap: 6px 10px; font-size: 13px; }
      .k { color: var(--muted); font-family: var(--mono); font-size: 12px; }
      .v { color: var(--text); overflow-wrap: anywhere; }

      details { border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; background: rgba(0,0,0,0.08); }
      summary { cursor: pointer; color: var(--muted); font-family: var(--mono); font-size: 12px; }
      pre { margin: 10px 0 0; padding: 10px; overflow: auto; border-radius: 10px; background: rgba(0,0,0,0.25); border: 1px solid rgba(31, 42, 61, 0.9); }
      pre code { font-family: var(--mono); font-size: 12px; color: #d6deeb; }

      @media (max-width: 720px) {
        .search, .search.title-mode { grid-template-columns: 1fr; }
        button { width: 100%; }
        .kv { grid-template-columns: 110px 1fr; }
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <header>
        <div>
          <h1>Argus</h1>
          <div class="sub">ISBN lookup across configured library systems</div>
        </div>
        <div class="pill">API: <span id="apiBase"></span></div>
      </header>

      <div class="card" style="margin-top:16px;">
        <div class="row" style="margin-bottom:10px;">
          <div class="pill">Mode: <span id="modeLabel">ISBN</span></div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button id="modeIsbn" type="button">ISBN</button>
            <button id="modeTitle" type="button">Title</button>
          </div>
        </div>
        <form id="form" class="search">
          <input id="isbn" type="text" inputmode="numeric" autocomplete="off" spellcheck="false"
            placeholder="ISBN-10 or ISBN-13 (digits or hyphens), e.g. 9780143127741" />
          <input id="author" type="text" autocomplete="off" spellcheck="false" style="display:none;"
            placeholder="Optional author, e.g. Orwell" />
          <button id="go" type="submit">Search</button>
          <button id="example" type="button" title="Fill a sample ISBN">Example</button>
        </form>
        <div class="meta">
          <div class="pill" id="status">Idle</div>
          <div class="pill" id="summary" style="display:none;"></div>
        </div>
        <div class="sub" style="margin-top:10px;">
          <span style="color: var(--text); font-weight: 650;">Important:</span>
          “Holdings” are real per-copy availability parsed from supported systems. If you don’t see a library here,
          it usually means we don’t have an availability adapter for that system yet (not that the library doesn’t own the book).
        </div>
        <div id="error" class="err" style="margin-top:10px; display:none;"></div>
      </div>

      <div id="results" class="results"></div>

      <details id="rawWrap" style="margin-top:12px; display:none;">
        <summary>Raw JSON</summary>
        <pre><code id="raw"></code></pre>
      </details>
    </div>

    <script>
      const apiBase = location.origin;
      document.getElementById('apiBase').textContent = apiBase;

      const form = document.getElementById('form');
      const isbnEl = document.getElementById('isbn');
      const authorEl = document.getElementById('author');
      const goBtn = document.getElementById('go');
      const exampleBtn = document.getElementById('example');
      const statusEl = document.getElementById('status');
      const summaryEl = document.getElementById('summary');
      const errorEl = document.getElementById('error');
      const resultsEl = document.getElementById('results');
      const rawWrapEl = document.getElementById('rawWrap');
      const rawEl = document.getElementById('raw');
      const modeLabelEl = document.getElementById('modeLabel');
      const modeIsbnBtn = document.getElementById('modeIsbn');
      const modeTitleBtn = document.getElementById('modeTitle');

      function setStatus(text) {
        statusEl.textContent = text;
      }

      function showError(text) {
        errorEl.style.display = 'block';
        errorEl.textContent = text;
      }

      function clearError() {
        errorEl.style.display = 'none';
        errorEl.textContent = '';
      }

      function esc(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      }

      function statusClass(status) {
        if (!status) return 'unknown';
        const s = String(status).toLowerCase();
        if (s === 'available') return 'available';
        if (s === 'checked_out') return 'checked_out';
        return 'unknown';
      }

      function groupBy(arr, keyFn) {
        const m = new Map();
        for (const x of arr) {
          const k = keyFn(x);
          if (!m.has(k)) m.set(k, []);
          m.get(k).push(x);
        }
        return m;
      }

      function renderResult(result) {
        resultsEl.innerHTML = '';

        rawWrapEl.style.display = 'block';
        rawEl.textContent = JSON.stringify(result, null, 2);

        const holdings = Array.isArray(result.holdings) ? result.holdings : [];
        const errors = Array.isArray(result.errors) ? result.errors : [];

        summaryEl.style.display = 'inline-flex';
        if (result && result.query && result.candidates) {
          const searched = (result.candidates.isbn13sSearched || []).length;
          const total = (result.candidates.isbn13sAll || []).length;
          summaryEl.textContent =
            \`Holdings: \${holdings.length} | Candidate ISBNs: \${searched}/\${total} searched\` +
            (result.isPartial ? ' | partial' : '');
        } else {
          summaryEl.textContent =
            \`Holdings: \${holdings.length} | Systems searched: \${result.systemsSearched} (\${result.systemsSucceeded} ok)\` +
            (result.isPartial ? ' | partial' : '') +
            (result.fromCache ? ' | cache' : '');
        }

        if (holdings.length === 0 && errors.length === 0) {
          resultsEl.innerHTML = '<div class="card">No holdings found.</div>';
          return;
        }

        if (errors.length) {
          // Count unique systems that failed (same system across ISBNs = 1)
          const seenSystems = new Set();
          for (const e of errors) seenSystems.add(e.systemId || e.systemName || '');
          const failCount = seenSystems.size;
          // Append a note to the summary pill instead of a separate error card
          summaryEl.textContent += \` | \${failCount} system\${failCount === 1 ? '' : 's'} unavailable\`;
        }

        if (!holdings.length) return;

        const bySystem = groupBy(holdings, (h) => h.systemId || h.systemName || 'unknown');

        for (const [, sysHoldings] of bySystem) {
          const sysName = sysHoldings[0].systemName || sysHoldings[0].systemId || 'Unknown system';
          const sysUrl = sysHoldings[0].catalogUrl || '';
          const available = sysHoldings.filter(h => String(h.status).toLowerCase() === 'available').length;

          const sysDiv = document.createElement('div');
          sysDiv.className = 'sys';

          sysDiv.innerHTML =
            \`<div class="sysHead">
              <div class="sysName">\${esc(sysName)}\${sysUrl ? \` <a href="\${esc(sysUrl)}" target="_blank" rel="noreferrer">(catalog)</a>\` : ''}</div>
              <div class="sysCounts">
                <span class="count">items: \${sysHoldings.length}</span>
                <span class="count">available: \${available}</span>
              </div>
            </div>\`;

          const holdingsWrap = document.createElement('div');
          holdingsWrap.className = 'holdings';

          const byBranch = groupBy(sysHoldings, (h) => h.branchId || h.branchName || 'unknown');
          for (const [, branchHoldings] of byBranch) {
            const bName = branchHoldings[0].branchName || branchHoldings[0].branchId || 'Unknown branch';
            const branchDiv = document.createElement('div');
            branchDiv.className = 'branch';

            branchDiv.innerHTML =
              \`<div class="branchHead">
                <div class="branchName">\${esc(bName)}</div>
                <div class="sub">\${branchHoldings.length} item(s)</div>
              </div>\`;

            const items = document.createElement('div');
            items.className = 'items';

            for (const h of branchHoldings) {
              const st = String(h.status || 'unknown').toLowerCase();
              const item = document.createElement('div');
              item.className = 'item';
              item.innerHTML =
                \`<div class="itemTop">
                  <div style="font-family:var(--mono); font-size:12px; color:var(--muted);">ISBN \${esc(h.isbn || '')}</div>
                  <div class="status \${esc(statusClass(st))}">\${esc(st)}</div>
                </div>
                <div class="kv">
                  <div class="k">callNumber</div><div class="v">\${h.callNumber ? esc(h.callNumber) : '<span class="sub">n/a</span>'}</div>
                  <div class="k">materialType</div><div class="v">\${esc(h.materialType || 'unknown')}</div>
                  <div class="k">collection</div><div class="v">\${esc(h.collection || '')}</div>
                  <div class="k">volume</div><div class="v">\${h.volume ? esc(h.volume) : '<span class="sub">n/a</span>'}</div>
                  <div class="k">dueDate</div><div class="v">\${h.dueDate ? esc(h.dueDate) : '<span class="sub">n/a</span>'}</div>
                  <div class="k">copies</div><div class="v">\${h.copyCount != null ? esc(h.copyCount) : '<span class="sub">n/a</span>'}</div>
                  <div class="k">holds</div><div class="v">\${h.holdCount != null ? esc(h.holdCount) : '<span class="sub">n/a</span>'}</div>
                  <div class="k">rawStatus</div><div class="v">\${esc(h.rawStatus || '')}</div>
                </div>\`;
              items.appendChild(item);
            }

            branchDiv.appendChild(items);
            holdingsWrap.appendChild(branchDiv);
          }

          sysDiv.appendChild(holdingsWrap);
          resultsEl.appendChild(sysDiv);
        }
      }

      function computeLikelySearchUrl(system) {
        const isbn = state.normalizedISBN13;
        const catalogUrl = String(system.catalogUrl || '');
        let u;
        try { u = new URL(catalogUrl); } catch { return catalogUrl; }
        const origin = u.origin;
        const vendor = String(system.vendor || '');

        if (vendor === 'sirsi_dynix') {
          return origin + '/client/en_US/default/search/results?qu=' + encodeURIComponent(isbn);
        }
        if (vendor === 'bibliocommons') {
          return origin + '/v2/search?query=' + encodeURIComponent(isbn) + '&searchType=smart';
        }
        if (vendor === 'tlc') {
          return origin + '/#section=search&term=' + encodeURIComponent(isbn);
        }
        if (vendor === 'koha') {
          return origin + '/cgi-bin/koha/opac-search.pl?q=' + encodeURIComponent(isbn);
        }

        return catalogUrl;
      }

      const state = { normalizedISBN13: '' };
      let mode = 'isbn';

      function setMode(next) {
        mode = next === 'title' ? 'title' : 'isbn';
        modeLabelEl.textContent = mode === 'title' ? 'Title' : 'ISBN';
        clearError();
        resultsEl.innerHTML = '';
        rawWrapEl.style.display = 'none';
        summaryEl.style.display = 'none';

        if (mode === 'title') {
          form.classList.add('title-mode');
          isbnEl.value = '';
          isbnEl.placeholder = 'Title, e.g. The Communist Manifesto';
          isbnEl.inputMode = 'text';
          authorEl.style.display = '';
          exampleBtn.textContent = 'Example';
        } else {
          form.classList.remove('title-mode');
          authorEl.value = '';
          authorEl.style.display = 'none';
          isbnEl.placeholder = 'ISBN-10 or ISBN-13 (digits or hyphens), e.g. 9780143127741';
          isbnEl.inputMode = 'numeric';
          exampleBtn.textContent = 'Example';
        }
        isbnEl.focus();
      }

      async function doSearch(raw) {
        clearError();
        resultsEl.innerHTML = '';
        rawWrapEl.style.display = 'none';
        summaryEl.style.display = 'none';

        const q = String(raw || '').trim();
        if (!q) {
          showError(mode === 'title' ? 'Enter a title.' : 'Enter an ISBN.');
          return;
        }

        if (mode !== 'title') {
          // Basic UI validation: digits/hyphens only
          if (!/^[0-9-]+$/.test(q)) {
            showError('ISBN should contain only digits and hyphens.');
            return;
          }
        }

        goBtn.disabled = true;
        setStatus('Searching...');
        try {
          const url = new URL(mode === 'title' ? '/search/title' : '/search', apiBase);
          if (mode === 'title') {
            url.searchParams.set('title', q);
            const author = String(authorEl.value || '').trim();
            if (author) url.searchParams.set('author', author);
          } else {
            url.searchParams.set('isbn', q);
          }
          const resp = await fetch(url.toString(), { headers: { 'accept': 'application/json' } });
          const text = await resp.text();
          let data;
          try { data = JSON.parse(text); } catch { data = { error: text }; }

          if (!resp.ok) {
            const msg = data && data.error ? data.error : ('HTTP ' + resp.status);
            showError(msg);
            setStatus('Error');
            return;
          }

          setStatus('Done');
          state.normalizedISBN13 = String(data.normalizedISBN13 || '');
          renderResult(data);
        } catch (e) {
          showError(String(e && e.message ? e.message : e));
          setStatus('Error');
        } finally {
          goBtn.disabled = false;
        }
      }

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        doSearch(isbnEl.value);
      });

      exampleBtn.addEventListener('click', () => {
        if (mode === 'title') {
          isbnEl.value = 'The Communist Manifesto';
          authorEl.value = 'Marx';
        } else {
          isbnEl.value = '9780143127741';
        }
        isbnEl.focus();
      });

      modeIsbnBtn.addEventListener('click', () => setMode('isbn'));
      modeTitleBtn.addEventListener('click', () => setMode('title'));

      setMode('isbn');
    </script>
  </body>
</html>`);
  });

  app.get("/search-links", (c) => {
    const rawIsbn = c.req.query("isbn");
    if (!rawIsbn) {
      return c.json({ error: "Missing required query parameter: isbn", type: "validation_error" }, 400);
    }

    const parsed = parseISBN(rawIsbn);
    if (!parsed.ok) {
      throw new ISBNValidationError(rawIsbn, parsed.reason);
    }

    const systems = deps.systems
      .filter((s) => s.enabled)
      .map((s) => ({
        id: s.id,
        name: s.name,
        vendor: s.vendor,
        region: s.region,
        catalogUrl: s.catalogUrl,
      }));

    return c.json({
      isbn: rawIsbn,
      normalizedISBN13: parsed.isbn13,
      systems,
      total: systems.length,
    });
  });

  app.route(
    "/search",
    searchRoutes({
      searchCoordinator: deps.searchCoordinator,
      logger: deps.logger,
    }),
  );

  app.route(
    "/libraries",
    libraryRoutes({
      systems: deps.systems,
      healthTracker: deps.healthTracker,
    }),
  );

  app.route(
    "/health",
    healthRoutes({
      healthTracker: deps.healthTracker,
      metricsCollector: deps.metricsCollector,
    }),
  );

  // ── Error handler ─────────────────────────────────────────────────────

  app.onError(errorHandler);

  return app;
}
