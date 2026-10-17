#!/usr/bin/env bash
# N consecutive clean runs with real agents (Master Plan §17: three clean runs before "demo ready").
# Usage: scripts/rehearse-series.sh <out-dir> [runs=3] [expect=agreement]
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; OUT="${1:?out dir}"; RUNS="${2:-3}"; EXPECT="${3:-agreement}"
mkdir -p "$OUT"; clean=0
for i in $(seq 1 "$RUNS"); do
  RUN="$OUT/run-$i"; PORT=$((8800 + i))
  echo "=== run $i ($EXPECT) $(date '+%H:%M:%S')"
  "$ROOT/scripts/rehearse-agents.sh" "$RUN" "$PORT" > "$RUN.agents.txt" 2>&1
  if node "$ROOT/scripts/verify-rehearsal.mjs" "http://127.0.0.1:$PORT" "$RUN/data/credentials.txt" "--expect=$EXPECT" > "$RUN.verify.txt" 2>&1; then clean=$((clean+1)); fi
  cat "$RUN.verify.txt"
  kill "$(cat "$RUN/server.pid")" 2>/dev/null
done
echo "=== $clean / $RUNS clean"
[ "$clean" -eq "$RUNS" ]
