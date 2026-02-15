#!/bin/sh
set -e

# Start the Hono backend on internal port 3010
echo "[start.sh] Starting Hono backend on port 3010..."
PORT=3010 node /app/backend/dist/node.js &
HONO_PID=$!

# Wait briefly for Hono to be ready
sleep 2

# Start the Next.js site on port 3000 (exposed)
echo "[start.sh] Starting Next.js site on port 3000..."
HOSTNAME=0.0.0.0 PORT=3000 HONO_BACKEND_URL=http://127.0.0.1:3010 node /app/site/server.js &
NEXT_PID=$!

echo "[start.sh] Both processes started (Hono PID=$HONO_PID, Next PID=$NEXT_PID)"

# Trap signals and forward to both processes
trap 'kill $HONO_PID $NEXT_PID 2>/dev/null; exit 0' SIGTERM SIGINT

# Wait for either process to exit — if one dies, kill the other
wait -n $HONO_PID $NEXT_PID 2>/dev/null || true
echo "[start.sh] A process exited, shutting down..."
kill $HONO_PID $NEXT_PID 2>/dev/null || true
wait
