#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/output"
VENV_PYTHON="$SCRIPT_DIR/.venv/bin/python3"

# ── Preflight checks ────────────────────────────────────────────────────────
if [ ! -f "$VENV_PYTHON" ]; then
  echo "Error: Python venv not found. Run 'npm run report:setup' first."
  exit 1
fi

if ! command -v xelatex &> /dev/null; then
  echo "Error: xelatex not found. Run 'npm run report:setup' first."
  exit 1
fi

# ── Load DB credentials from shared .env ─────────────────────────────────────
ENV_FILE="/srv/rufus/.env"
if [ -f "$ENV_FILE" ] && [ -z "${DATABASE_USER:-}" ]; then
  DATABASE_USER=$(grep '^DATABASE_USER=' "$ENV_FILE" | head -1 | cut -d= -f2-)
  DATABASE_PASSWORD=$(grep '^DATABASE_PASSWORD=' "$ENV_FILE" | head -1 | cut -d= -f2-)
  export DATABASE_USER DATABASE_PASSWORD
fi

echo "=== Texas Library Holdings Report — Full Pipeline ==="
echo ""

# ── Step 1: Data extraction (PostgreSQL → JSON) ─────────────────────────────
echo "[Step 1/5] Extracting data from PostgreSQL..."
npx tsx "$SCRIPT_DIR/extract-data.ts"
echo "  ✓ JSON data files written to $OUTPUT_DIR/data/"
echo ""

# ── Step 2: Geocoding libraries ─────────────────────────────────────────────
echo "[Step 2/5] Geocoding library locations..."
npx tsx "$SCRIPT_DIR/geocode-libraries.ts"
echo "  ✓ Geocoded library data written"
echo ""

# ── Step 3: Map generation (Python + matplotlib) ────────────────────────────
echo "[Step 3/5] Generating Texas maps..."
"$VENV_PYTHON" "$SCRIPT_DIR/generate_maps.py"
echo "  ✓ Map figures written to $OUTPUT_DIR/figures/"
echo ""

# ── Step 4: Chart generation (Python + matplotlib) ──────────────────────────
echo "[Step 4/5] Generating analytics charts..."
"$VENV_PYTHON" "$SCRIPT_DIR/generate_charts.py"
echo "  ✓ Chart figures written to $OUTPUT_DIR/figures/"
echo ""

# ── Step 5: LaTeX rendering (Jinja2 → .tex) ─────────────────────────────────
echo "[Step 5/5] Rendering LaTeX templates..."
"$VENV_PYTHON" "$SCRIPT_DIR/render_latex.py"
echo "  ✓ TeX files written to $OUTPUT_DIR/tex/"
echo ""

# ── Step 6: XeLaTeX compilation (two passes for TOC/refs) ────────────────────
echo "[Compile] Running XeLaTeX (pass 1 of 2)..."
cd "$OUTPUT_DIR/tex"
xelatex -interaction=nonstopmode -halt-on-error report.tex > /dev/null 2>&1

echo "[Compile] Running XeLaTeX (pass 2 of 2)..."
xelatex -interaction=nonstopmode -halt-on-error report.tex > /dev/null 2>&1

# Move final PDF to output root
mv report.pdf "$OUTPUT_DIR/report.pdf"

echo ""
echo "=== Done! ==="
echo "Report: $OUTPUT_DIR/report.pdf"
