#!/usr/bin/env bash
# ECHO demo launcher for the founder. Orchestrates the existing server; changes no product behaviour.
#   scripts/demo.sh start "<Creator A name>" "<Creator B name>" [--lan] [--fresh] [--port N]
#   scripts/demo.sh links      # print every URL and agent command again
#   scripts/demo.sh reset      # rehearsal reset (same people, same agent tokens)
#   scripts/demo.sh stop
# Nothing here edits ~/.claude or ~/.codex: agent launch commands are written to data/demo/.
set -eo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; DATA="$ROOT/data"; DEMO="$DATA/demo"
cmd="${1:-help}"; shift || true
PORT=8787; LAN=0; FRESH=0; NAMES=()
while [ $# -gt 0 ]; do case "$1" in --lan) LAN=1;; --fresh) FRESH=1;; --port) PORT="$2"; shift;; *) NAMES+=("$1");; esac; shift; done
[ -f "$DEMO/port" ] && [ "$cmd" != start ] && PORT="$(cat "$DEMO/port")"
json() { node -e "process.stdout.write(JSON.stringify(process.argv[1]))" "$1"; }

host_url() { if [ -f "$DEMO/lan" ]; then echo "http://$(cat "$DEMO/lan"):$PORT"; else echo "http://127.0.0.1:$PORT"; fi; }
token_of() { grep -F -- "$1" "$DATA/credentials.txt" | head -1 | sed -E 's/.*(#token=|ECHO_AGENT_TOKEN=)//'; }

write_agent_files() {
  local url; url="$(host_url)"; mkdir -p "$DEMO"; chmod 700 "$DEMO"
  local ta tb; ta="$(token_of "$(sed -n 1p "$DEMO/names")'s agent:")"; tb="$(token_of "$(sed -n 2p "$DEMO/names")'s agent:")"
  cat > "$DEMO/agent-a.mcp.json" <<JSON
{"mcpServers":{"echo":{"command":"node","args":["$ROOT/server/mcp.mjs"],"env":{"ECHO_URL":"$url","ECHO_AGENT_TOKEN":"$ta","ECHO_AGENT_CLIENT":"Claude Code"}}}}
JSON
  cat > "$DEMO/agent-a.sh" <<SH
#!/usr/bin/env bash
# Creator A's own agent: Claude Code, with only the ECHO tools connected and pre-allowed.
cd "$DEMO" && exec claude --mcp-config "$DEMO/agent-a.mcp.json" --strict-mcp-config --allowedTools "mcp__echo__*" "\$@"
SH
  cat > "$DEMO/agent-b.sh" <<SH
#!/usr/bin/env bash
# Creator B's own agent: Codex, with the ECHO tools added for this session only (interactive by default;
# "agent-b.sh exec <prompt>" runs it unattended).
FLAGS=(-s read-only -c 'mcp_servers.echo.command="node"' -c 'mcp_servers.echo.args=["$ROOT/server/mcp.mjs"]'
  -c 'mcp_servers.echo.default_tools_approval_mode="approve"' -c 'mcp_servers.echo.tool_timeout_sec=70'
  -c 'mcp_servers.echo.env={ECHO_URL="$url",ECHO_AGENT_TOKEN="$tb",ECHO_AGENT_CLIENT="Codex"}')
cd "$DEMO"
if [ "\$1" = exec ]; then shift; exec codex exec --skip-git-repo-check "\${FLAGS[@]}" "\$@"; fi
exec codex "\${FLAGS[@]}" "\$@"
SH
  cat > "$DEMO/fallback-b.sh" <<SH
#!/usr/bin/env bash
# Only if Creator B's AI agent fails: labelled rule-based stand-in ("ECHO fallback (rule-based)" on the board).
ECHO_URL="$url" ECHO_AGENT_TOKEN="$tb" ECHO_POLICY='{"concede":{"intro":5},"adapt":true}' exec node "$ROOT/server/fallback-agent.mjs"
SH
  chmod 700 "$DEMO"/*.sh; chmod 600 "$DEMO/agent-a.mcp.json"
}

links() {
  local url; url="$(host_url)"
  local a b; a="$(sed -n 1p "$DEMO/names")"; b="$(sed -n 2p "$DEMO/names")"
  cat <<TXT

ECHO demo — $url   (private links: do not project or share the token URLs)

  ECHO home (anyone)             $url/
  TV viewer (projector, anyone)  $url/broadcast/
  Production Board (read-only)   $url/board/
  Producer: home / board         $url/#token=$(token_of '(producer) board')
  $a (Creator A): home    $url/#token=$(token_of "$a (creator) board")
  $a: interview / board   $url/interview/#token=$(token_of "$a (creator) board")
  $b (Creator B): home    $url/#token=$(token_of "$b (creator) board")
  $b: interview / board   $url/interview/#token=$(token_of "$b (creator) board")

  $a's agent (Claude Code):  $DEMO/agent-a.sh
  $b's agent (Codex):        $DEMO/agent-b.sh
  Fallback for $b, only if Codex fails:  $DEMO/fallback-b.sh

TXT
}

case "$cmd" in
start)
  node -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)' || { echo "Node 22+ required"; exit 1; }
  [ -d "$ROOT/node_modules/@modelcontextprotocol" ] || (cd "$ROOT" && npm install)
  [ ${#NAMES[@]} -eq 2 ] || { echo 'Usage: scripts/demo.sh start "<Creator A name>" "<Creator B name>" [--lan] [--fresh] [--port N]'; exit 1; }
  if curl -sf "http://127.0.0.1:$PORT/api/state" >/dev/null; then echo "Something is already running on port $PORT (scripts/demo.sh stop, or --port N)"; exit 1; fi
  if [ -f "$DATA/state.json" ]; then
    if [ "$FRESH" = 1 ]; then mv "$DATA" "$ROOT/data.$(date +%Y%m%d-%H%M%S)"; echo "Previous data kept in $(ls -d "$ROOT"/data.* | tail -1)";
    elif [ -f "$DEMO/names" ] && [ "$(cat "$DEMO/names")" != "$(printf '%s\n%s' "${NAMES[0]}" "${NAMES[1]}")" ]; then echo "Existing demo uses other names: $(tr '\n' '/' < "$DEMO/names"). Add --fresh to start over (old data is kept, not deleted)."; exit 1; fi
  fi
  mkdir -p "$DEMO"; printf '%s\n%s\n' "${NAMES[0]}" "${NAMES[1]}" > "$DEMO/names"; echo "$PORT" > "$DEMO/port"
  BIND=127.0.0.1; rm -f "$DEMO/lan"
  if [ "$LAN" = 1 ]; then BIND=0.0.0.0; ipconfig getifaddr en0 > "$DEMO/lan" || ipconfig getifaddr en1 > "$DEMO/lan"; fi
  [ -x "$ROOT/.venv/bin/python" ] && [ -f "$ROOT/voices/en_US-ljspeech-high.onnx" ] || echo "Note: Piper voice not installed — the outro will show captions only (see DEMO_RUNBOOK.md §1)."
  PEOPLE="{\"a\":{\"name\":$(json "${NAMES[0]}"),\"specialty\":\"Art\"},\"b\":{\"name\":$(json "${NAMES[1]}"),\"specialty\":\"Music\"}}"
  cd "$ROOT"
  ECHO_PEOPLE="$PEOPLE" HOST=$BIND PORT=$PORT nohup node server/server.mjs </dev/null > "$DEMO/server.log" 2>&1 &
  echo $! > "$DEMO/server.pid"
  for _ in $(seq 1 40); do curl -sf "http://127.0.0.1:$PORT/api/state" >/dev/null && break; sleep .25; done
  curl -sf "http://127.0.0.1:$PORT/api/state" >/dev/null || { echo "Server did not start:"; cat "$DEMO/server.log"; exit 1; }
  write_agent_files; links
  echo "  Server log: $DEMO/server.log   Stop: scripts/demo.sh stop"
  ;;
links) write_agent_files; links ;;
reset)
  curl -sf -X POST -H "authorization: Bearer $(token_of '(producer) board')" "http://127.0.0.1:$PORT/api/reset" >/dev/null && echo "Reset to the seeded programme (r1). People and agent tokens unchanged." ;;
stop)
  if [ -f "$DEMO/server.pid" ] && kill "$(cat "$DEMO/server.pid")" 2>/dev/null; then echo "Stopped."; else echo "Not running."; fi; rm -f "$DEMO/server.pid" ;;
*) sed -n 2,8p "$0" ;;
esac
