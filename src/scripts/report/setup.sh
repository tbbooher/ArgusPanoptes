#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Texas Library Holdings Report — Environment Setup ==="

# ── System packages (TeX Live + Python) ──────────────────────────────────────
echo ""
echo "Installing TeX Live and Python build tools..."
sudo apt-get update -qq
sudo apt-get install -y -qq \
  texlive-xetex \
  texlive-latex-extra \
  texlive-fonts-extra \
  texlive-fonts-recommended \
  python3-pip \
  python3-venv \
  > /dev/null

echo "TeX Live installed: $(xelatex --version | head -1)"

# ── Python virtual environment ───────────────────────────────────────────────
VENV_DIR="$SCRIPT_DIR/.venv"

if [ ! -d "$VENV_DIR" ]; then
  echo ""
  echo "Creating Python venv at $VENV_DIR..."
  python3 -m venv "$VENV_DIR"
fi

echo "Installing Python dependencies..."
"$VENV_DIR/bin/pip" install -q -r "$SCRIPT_DIR/requirements.txt"

echo ""
echo "Setup complete."
echo "  Python: $("$VENV_DIR/bin/python3" --version)"
echo "  XeLaTeX: $(which xelatex)"
