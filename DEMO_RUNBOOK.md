# ECHO 3.1 — demo runbook

**Many creators. Many agents. One shared broadcast.** Two people each bring their own AI agent (Claude Code, Codex or any MCP client). The agents negotiate the shared programme with the deterministic ECHO Showrunner. People approve every change, and the approved revision plays out in the ECHO studio.

## 1. One-time setup (macOS, free, offline after setup)

```bash
cd echo-stage
npm install                     # MCP SDK 1.31.0, zod 4.6.5, playwright 1.49.1 (dev)
# Host voice (optional; without it house segments show captions only):
/opt/homebrew/bin/python3.13 -m venv .venv
.venv/bin/pip install piper-tts==1.8.0 onnx==1.23.0
mkdir -p voices && for f in en_US-ljspeech-high.onnx en_US-ljspeech-high.onnx.json; do
  curl -L -o voices/$f https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ljspeech/high/$f; done
npm test                        # 26 broadcast + 5 studio suites
```

## 2. Start the server with the real participants' names

```bash
ECHO_PEOPLE='{"a":{"name":"<Creator A name>","specialty":"Art"},"b":{"name":"<Creator B name>","specialty":"Music"}}' \
HOST=0.0.0.0 PORT=8787 npm start
```

- `HOST=0.0.0.0` lets a second laptop on the same Wi-Fi connect. Use `http://<this-mac-ip>:8787` in every link below. Traffic is plain HTTP, so only use this on a trusted network.
- `data/credentials.txt` (local, mode 600, never committed) holds each person's private board link and each agent's token.
- Names apply on first start. To change them later, stop the server, delete `data/state.json`, and start again (new tokens are issued).

## 3. Connect each person's own agent

**Creator A: Claude Code**
```bash
claude mcp add echo -s local -e ECHO_URL=http://<ip>:8787 -e ECHO_AGENT_TOKEN=<agent-a token> -e ECHO_AGENT_CLIENT="Claude Code" \
  -- node /absolute/path/echo-stage/server/mcp.mjs
```

**Creator B: Codex** (`~/.codex/config.toml`)
```toml
[mcp_servers.echo]
command = "node"
args = ["/absolute/path/echo-stage/server/mcp.mjs"]
default_tools_approval_mode = "approve"   # only the echo tools
tool_timeout_sec = 70
[mcp_servers.echo.env]
ECHO_URL = "http://<ip>:8787"
ECHO_AGENT_TOKEN = "<agent-b token>"
ECHO_AGENT_CLIENT = "Codex"
```

Each person tells their agent their own policy in plain words, e.g.:
- A: *"Get my gallery to 45 seconds, 15 per work. If not possible, take the longest that fits and split evenly. Never ask to move a confirmed slot."*
- B: *"My premiere is confirmed at 0:50 and must not move. You may shorten my intro to no less than 5 seconds, only by what is needed."*

The board shows each agent's connection and the client it reported.

## 4. Live demo (about 3 minutes, two people on stage)

| Step | Who | What the audience sees | Master Plan §25 check |
|---|---|---|---|
| 1 | Producer | Board (producer link) on the projector; the broadcast tab is on standby | |
| 2 | B | Tells Codex: "wait for requests and handle them per my policy" | Separate credentials/agent sessions |
| 3 | A | Tells Claude Code: "get my gallery to 45 seconds" | |
| 4 | — | Showrunner: "15 s too long; confirmed premiere must still start at 0:50"; ECHO house time offered | Confirmed airtime never changes |
| 5 | B's agent | Accepts intro 10→5 s, with its own reasoning shown | B makes a substantive response |
| 6 | A's agent | Adapts: 45 s with 15/15/15 slides | A reacts to B |
| 7 | A, B, producer | Each presses **Approve v2** on their own board | Agents cannot approve |
| 8 | Producer | **Publish** → manifest `r2 · <hash>` → **Go live** | Manifest revision = what the studio shows |
| 9 | All | Broadcast: intro → gallery → premiere at 0:50 → ECHO outro (spoken) | Before/after diff in revision history |

Optional proofs, if time allows:
- **NO AGREEMENT:** B's policy is "do not shorten my intro" and A withdraws. The board shows NO AGREEMENT and the programme stays at r1.
- **Stale approval:** B uploads a different audio file via *Replace media*. The segment drops to `submitted` and Publish is refused until the producer approves the new hash.
- **Double booking:** covered by `tests/broadcast/http.test.mjs` (concurrent confirms → one 200, one 409).

## 5. Fallbacks (be open about them)

- **Agent unavailable:** run the labelled rule-based agent. The board then shows "ECHO fallback (rule-based)" instead of the client name:
  `ECHO_URL=... ECHO_AGENT_TOKEN=<token> ECHO_POLICY='{"concede":{"intro":5},"adapt":true}' node server/fallback-agent.mjs`
- **Agent silent for 3 minutes:** its request expires as *no change*, never as consent.
- **Piper unavailable:** house segments show captions only. The board's activity feed says so.
- **WebGL unavailable:** the host segment shows a text slate and the programme continues.
- **Rehearse again:** producer **Reset rehearsal** restores r1 and keeps identities and agent tokens.

## 6. Recording for the 12:00 submission (§26)

- Record the real screen (Shift-Command-5 or OBS): board left, broadcast right, plus each person's agent terminal.
- Keep the full uncut take separately, together with `git rev-parse HEAD`.
- Any cut that compresses time must be labelled "edited for length". Never show a staged success.
- The video's spec (length, format) is not confirmed. Check the organiser's upload form.

## 7. What is real and what is not

| Real | Not built / limits |
|---|---|
| Two independent LLM agents over MCP with separate tokens | No public hosting: the static Sites host cannot run the server |
| Deterministic Showrunner, booking protection, approvals bound to revision + SHA-256 | No moderation AI, no fact-checking module (News is not in the demo) |
| Live board over SSE; shared on-air clock; reconnect | Playout is in-browser (no OBS/RTMP output) |
| Piper host voice from the approved programme | One shared synthetic voice; English only |
| Rehearsal media: public-domain artworks (The Met, CC0), a code-synthesised track | Creators' own media must be uploaded by them, with rights declared |
