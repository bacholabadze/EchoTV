#!/usr/bin/env bash
# ECHO unified build: one command, one URL. Wraps scripts/demo.sh with its own port (8800) and this worktree's own
# data/ directory, so the protected 3.1 demo on 8787 and every other worktree stay untouched.
#   scripts/unified.sh start ["<Creator A>" "<Creator B>"]   # default names: Bacho, Keti
#   scripts/unified.sh links | reset | stop
set -eo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${ECHO_UNIFIED_PORT:-8800}"
cmd="${1:-start}"; shift || true
case "$cmd" in
start)
  A="${1:-Bacho}"; B="${2:-Keti}"
  if curl -sf "http://127.0.0.1:$PORT/api/state" >/dev/null 2>&1; then echo "ECHO unified is already running on http://127.0.0.1:$PORT (scripts/unified.sh stop first)"; exit 1; fi
  [ -e "$ROOT/node_modules/@modelcontextprotocol" ] || { echo "node_modules missing: run 'npm install' in $ROOT (or symlink an existing install)"; exit 1; }
  "$ROOT/scripts/demo.sh" start "$A" "$B" --port "$PORT"
  echo
  echo "ECHO unified — open ONE URL:  http://127.0.0.1:$PORT/"
  echo "Private links above (Create = /interview/#token=…, Produce = /board/#token=…). Watch = http://127.0.0.1:$PORT/broadcast/"
  ;;
links|reset|stop) "$ROOT/scripts/demo.sh" "$cmd" "$@" ;;
*) sed -n 2,6p "$0" ;;
esac
