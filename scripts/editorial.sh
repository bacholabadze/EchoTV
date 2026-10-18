#!/usr/bin/env bash
# ECHO editorial preview ("AI-მ შექმნა. ვინ არის ავტორი?"): its own port (8810) and its own data directory
# (data-editorial/). Rehearsal label on screen unless ECHO_REHEARSAL=0 (real, authorised guest and media). So 3.1 on 8787, the unified build on 8800 and every other worktree stay untouched.
#   scripts/editorial.sh start "<Guest name>" [Music|Art]   # one guest creator, the producer, two agents
#   scripts/editorial.sh links | stop
#   scripts/editorial.sh fresh "<Guest name>" [Music|Art]   # stop, keep the old data aside, start again
set -eo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; PORT="${ECHO_EDITORIAL_PORT:-8810}"; DATA="${ECHO_EDITORIAL_DATA:-$ROOT/data-editorial}"; RUN="$DATA/run"
cmd="${1:-help}"; shift || true
url="http://127.0.0.1:$PORT"
tok() { grep -F -- "$1" "$DATA/credentials.txt" | head -1 | sed -E 's/.*(#token=|ECHO_AGENT_TOKEN=)//'; }
agents() {
  mkdir -p "$RUN"; chmod 700 "$RUN"
  local guest editor; guest="$(grep -F ECHO_AGENT_TOKEN= "$DATA/credentials.txt" | grep -vF 'რედაქციის' | head -1 | sed -E 's/.*ECHO_AGENT_TOKEN=//')"; editor="$(tok "ECHO-ს რედაქციის აგენტი:")"
  cat > "$RUN/editor.mcp.json" <<JSON
{"mcpServers":{"echo":{"command":"node","args":["$ROOT/server/mcp.mjs"],"env":{"ECHO_URL":"$url","ECHO_AGENT_TOKEN":"$editor","ECHO_AGENT_CLIENT":"Claude Code"}}}}
JSON
  cat > "$RUN/editor-agent.sh" <<EOF
#!/usr/bin/env bash
# ECHO's editorial agent (Claude Code): reads the approved packet, drafts a rundown, may shortlist viewer questions.
cd "$RUN" && exec claude --mcp-config "$RUN/editor.mcp.json" --strict-mcp-config --allowedTools "mcp__echo__*" "\$@"
EOF
  cat > "$RUN/guest-agent.sh" <<EOF
#!/usr/bin/env bash
# The guest's own agent (Codex). "guest-agent.sh exec <prompt>" runs it unattended.
FLAGS=(-s read-only -c 'mcp_servers.echo.command="node"' -c 'mcp_servers.echo.args=["$ROOT/server/mcp.mjs"]'
  -c 'mcp_servers.echo.default_tools_approval_mode="approve"' -c 'mcp_servers.echo.tool_timeout_sec=70'
  -c 'mcp_servers.echo.env={ECHO_URL="$url",ECHO_AGENT_TOKEN="$guest",ECHO_AGENT_CLIENT="Codex"}')
cd "$RUN"
if [ "\$1" = exec ]; then shift; exec codex exec --skip-git-repo-check "\${FLAGS[@]}" "\$@"; fi
exec codex "\${FLAGS[@]}" "\$@"
EOF
  chmod 700 "$RUN"/*.sh; chmod 600 "$RUN/editor.mcp.json"
}
links() {
  cat <<TXT

ECHO editorial preview — $url/   (private links: do not project or share token URLs)
  Home / viewer (anyone)   $url/   ·   $url/broadcast/
  Producer                 $url/board/#token=$(tok '(producer) board')
  Guest: interview         $url/interview/#token=$(tok '(creator) board')
  Guest: board             $url/board/#token=$(tok '(creator) board')
  Editorial agent (Claude Code)   $RUN/editor-agent.sh
  Guest's agent (Codex)           $RUN/guest-agent.sh
TXT
}
case "$cmd" in
start)
  NAME="${1:?guest name}"; SPEC="${2:-Music}"
  if curl -sf "$url/api/state" >/dev/null 2>&1; then echo "Already running on $url (scripts/editorial.sh stop)"; exit 1; fi
  [ -e "$ROOT/node_modules/@modelcontextprotocol" ] || { echo "node_modules missing in $ROOT"; exit 1; }
  mkdir -p "$DATA" "$RUN"
  PEOPLE="$(node -e 'process.stdout.write(JSON.stringify({a:{name:process.argv[1],specialty:process.argv[2]},producer:{name:"ECHO პროდიუსერი"}}))' "$NAME" "$SPEC")"
  (cd "$ROOT" && PORT="$PORT" ECHO_FORMAT=editorial ECHO_DATA_DIR="$DATA" ECHO_PEOPLE="$PEOPLE" ECHO_REHEARSAL="${ECHO_REHEARSAL:-1}" nohup node server/server.mjs < /dev/null > "$RUN/server.log" 2>&1 & echo $! > "$RUN/server.pid") > /dev/null 2>&1
  for _ in $(seq 1 40); do curl -sf "$url/api/state" >/dev/null 2>&1 && break; sleep 0.25; done
  curl -sf "$url/api/state" >/dev/null || { echo "Server did not start; see $RUN/server.log"; exit 1; }
  agents; links ;;
links) agents; links ;;
stop) [ -f "$RUN/server.pid" ] && kill "$(cat "$RUN/server.pid")" 2>/dev/null && rm -f "$RUN/server.pid" && echo stopped || echo "not running" ;;
fresh) "$0" stop || true; [ -d "$DATA" ] && mv "$DATA" "$DATA.$(date +%Y%m%d-%H%M%S)"; "$0" start "$@" ;;
*) sed -n 2,7p "$0" ;;
esac
