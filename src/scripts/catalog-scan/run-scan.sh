#!/usr/bin/env bash
# Launch parallel catalog scan workers.
# Usage: ./src/scripts/catalog-scan/run-scan.sh [TOTAL_WORKERS] [CONCURRENCY] [DELAY_MS]
#
# Defaults: 3 workers, concurrency 5, delay 500ms
# Logs go to /tmp/scan-worker-N.log

set -euo pipefail
cd "$(dirname "$0")/../../.."

TOTAL_WORKERS="${1:-3}"
CONCURRENCY="${2:-5}"
DELAY="${3:-500}"

# Extract credentials safely (password contains $ characters)
DB_USER=$(grep "^DATABASE_USER" /srv/rufus/.env | head -1 | cut -d= -f2)
DB_PASS=$(grep "^DATABASE_PASSWORD" /srv/rufus/.env | head -1 | cut -d= -f2)

echo "=== Catalog Scan ==="
echo "  Workers:     ${TOTAL_WORKERS}"
echo "  Concurrency: ${CONCURRENCY} per worker"
echo "  Delay:       ${DELAY}ms between searches"
echo "  Logs:        /tmp/scan-worker-*.log"
echo ""

# Clear the already-scanned book so we start fresh (optional — remove if resuming)
# PGPASSWORD="$DB_PASS" psql -h localhost -U "$DB_USER" -d argus -c "DELETE FROM scan_progress; DELETE FROM holdings; DELETE FROM books;" 2>/dev/null

PIDS=()
for ((i=0; i<TOTAL_WORKERS; i++)); do
  echo "Starting worker $((i+1))/${TOTAL_WORKERS}..."
  DATABASE_USER="$DB_USER" DATABASE_PASSWORD="$DB_PASS" \
    npx tsx src/scripts/catalog-scan/index.ts \
      --worker "$i" \
      --total-workers "$TOTAL_WORKERS" \
      --concurrency "$CONCURRENCY" \
      --delay "$DELAY" \
    > "/tmp/scan-worker-${i}.log" 2>&1 &
  PIDS+=($!)
done

echo ""
echo "All ${TOTAL_WORKERS} workers launched. PIDs: ${PIDS[*]}"
echo ""
echo "Monitor:"
echo "  tail -f /tmp/scan-worker-0.log"
echo "  tail -f /tmp/scan-worker-1.log"
echo "  tail -f /tmp/scan-worker-2.log"
echo ""
echo "Check progress:"
echo "  PGPASSWORD=\"\$DB_PASS\" psql -h localhost -U $DB_USER -d argus -c \"SELECT count(*) AS scanned FROM scan_progress WHERE completed; SELECT count(*) AS holdings FROM holdings;\""
echo ""
echo "Stop all:"
echo "  kill ${PIDS[*]}"
echo ""

# Wait for all workers
FAILED=0
for pid in "${PIDS[@]}"; do
  if ! wait "$pid"; then
    echo "Worker PID $pid exited with error"
    FAILED=$((FAILED+1))
  fi
done

echo ""
echo "=== All workers finished (${FAILED} failed) ==="

# Print summary from database
PGPASSWORD="$DB_PASS" psql -h localhost -U "$DB_USER" -d argus -c "
SELECT
  (SELECT count(*) FROM books) AS books,
  (SELECT count(*) FROM holdings) AS holdings,
  (SELECT count(*) FROM scan_progress WHERE completed) AS scanned,
  (SELECT count(DISTINCT system_id) FROM holdings) AS systems_with_books;
"
