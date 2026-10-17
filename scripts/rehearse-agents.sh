#!/usr/bin/env bash
# Rehearsal with two real, independent LLM agents over MCP:
#   Creator A's agent = Claude Code (headless), Creator B's agent = Codex (exec).
# Each agent receives only its owner's policy in plain language. Humans still approve on the board.
# Usage: scripts/rehearse-agents.sh <run-dir> [port]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; RUN="${1:?run dir}"; PORT="${2:-8790}"; URL="http://127.0.0.1:$PORT"
mkdir -p "$RUN"
if ! curl -sf "$URL/api/state" >/dev/null; then
  ECHO_DATA_DIR="$RUN/data" PORT="$PORT" node "$ROOT/server/server.mjs" > "$RUN/server.log" 2>&1 &
  echo $! > "$RUN/server.pid"; sleep 1
fi
CRED="$RUN/data/credentials.txt"
TOKEN_A=$(grep "Creator A's agent" "$CRED" | sed 's/.*ECHO_AGENT_TOKEN=//'); TOKEN_B=$(grep "Creator B's agent" "$CRED" | sed 's/.*ECHO_AGENT_TOKEN=//')

DEFAULT_B="My Music premiere is confirmed at 50 seconds and must never move or shrink. If another creator genuinely needs time, I can shorten my 10-second Music intro, but never below 5 seconds, and only by what is actually needed."
DEFAULT_A="I want my Art gallery extended from 30 to 45 seconds so each of my three works gets 15 seconds. If the full 45 seconds is not available, accept the longest time that fits and split it evenly across the three works. Never ask to move any confirmed slot."
POLICY_B="${POLICY_B:-$DEFAULT_B}"; POLICY_A="${POLICY_A:-$DEFAULT_A}"

cat > "$RUN/b-prompt.txt" <<P
You are the ECHO agent of Creator B (music). Use only the echo MCP tools.
Your owner's instructions: "$POLICY_B"
First call get_show_state. Then call wait_for_requests (45 seconds) repeatedly, up to 6 times, until a request addressed to you arrives.
Decide how to answer it according to your owner's instructions and answer with respond_to_request, explaining your reasoning briefly in the message.
Then stop and summarise what you did in two sentences.
P
cat > "$RUN/a-prompt.txt" <<P
You are the ECHO agent of Creator A (art). Use only the echo MCP tools.
Your owner's instructions: "$POLICY_A"
Call get_show_state, then make a proposal for your owner with propose_change (include a short note for the other creators).
Then call wait_for_requests (45 seconds) repeatedly, up to 6 times, until the Showrunner asks you to revise. Adapt according to your owner's instructions using revise_proposal (or withdraw_proposal if your owner would not accept the offer).
Then stop and summarise what you did in two sentences. Humans approve on the Production Board; you cannot approve.
P

( cd "$RUN" && codex exec --skip-git-repo-check -s read-only \
    -c "mcp_servers.echo.command=\"node\"" -c "mcp_servers.echo.args=[\"$ROOT/server/mcp.mjs\"]" \
    -c "mcp_servers.echo.default_tools_approval_mode=\"approve\"" -c "mcp_servers.echo.tool_timeout_sec=70" \
    -c "mcp_servers.echo.env={ECHO_URL=\"$URL\",ECHO_AGENT_TOKEN=\"$TOKEN_B\",ECHO_AGENT_CLIENT=\"Codex\"}" \
    "$(cat b-prompt.txt)" > "$RUN/agent-b-codex.log" 2>&1 ) &
B=$!
sleep 8
MCP_A=$(printf '{"mcpServers":{"echo":{"command":"node","args":["%s/server/mcp.mjs"],"env":{"ECHO_URL":"%s","ECHO_AGENT_TOKEN":"%s","ECHO_AGENT_CLIENT":"Claude Code"}}}}' "$ROOT" "$URL" "$TOKEN_A")
( cd "$RUN" && claude -p "$(cat a-prompt.txt)" --mcp-config "$MCP_A" --strict-mcp-config --allowedTools "mcp__echo__*" > "$RUN/agent-a-claude.log" 2>&1 ) &
A=$!
wait $A; echo "Agent A (Claude Code) exited $?"
wait $B; echo "Agent B (Codex) exited $?"
curl -s "$URL/api/state" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const x=JSON.parse(s);for(const e of x.audit)console.log("#"+e.seq,e.summary)})' | tee "$RUN/audit.txt"
