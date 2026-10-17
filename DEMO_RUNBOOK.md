# ECHO 3.1 — demo runbook

**Many creators. Many agents. One shared broadcast.** Two people each bring their own AI agent (Claude Code and Codex). The agents negotiate the shared programme with the deterministic ECHO Showrunner. People approve every change, and the approved revision plays out in the ECHO studio.

The setup and launch steps were verified as written from a fresh clone of `64d1dc5` (tag `echo-3.1-demo-candidate`). The release-audit fixes in `7ee7394` changed behaviour described in §4 and §7; the automated tests pass there, but a human rehearsal on `7ee7394` is still pending. Current status and handoff: `docs/SESSION_HANDOFF.md`. Recording guide: `RECORDING.md`. Public hosting options: `DEPLOYMENT.md`.

## 0. Requirements

| Need | Version used | Check |
|---|---|---|
| macOS | 14.8 | — |
| Node.js | 22+ (22.22.3) | `node -v` |
| Google Chrome | any current | viewer and boards |
| Claude Code (Creator A's agent) | 2.1.302, signed in | `claude --version` |
| Codex CLI (Creator B's agent) | 0.160.1, signed in | `codex --version` |
| ffmpeg (includes ffprobe) | **required to accept creator uploads**: every upload is fully decoded first; without it uploads are refused (the shipped demo media still work, verified by recorded fingerprints) | `ffmpeg -version` |
| Python 3.13 | only for the spoken outro (Piper) | `python3.13 -V` |

No paid services or API keys beyond the two agent subscriptions the creators already use.

## 1. One-time setup (≈3 minutes, ≈120 MB download)

```bash
cd echo-stage
npm install                     # MCP SDK 1.31.0, zod 4.6.5, playwright 1.49.1 (tests only)
/opt/homebrew/bin/python3.13 -m venv .venv
.venv/bin/pip install piper-tts==1.8.0 onnx==1.23.0
mkdir -p voices && for f in en_US-ljspeech-high.onnx en_US-ljspeech-high.onnx.json; do
  curl -L -o voices/$f https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ljspeech/high/$f; done
npm test                        # expect: 54 broadcast tests + 5 studio suites pass
```

If `npm install` fails with an `~/.npm` permission error, run `npm install --cache /tmp/echo-npm-cache` (do not sudo).
Without the Python and voice steps, everything works, but the outro shows captions only. Without ffmpeg, creator uploads are refused (fail closed).

## 2. Launch (founder)

```bash
scripts/demo.sh start "<Creator A name>" "<Creator B name>"          # everything on this Mac (recommended)
scripts/demo.sh start "<Creator A name>" "<Creator B name>" --lan    # also reachable from other laptops on the same Wi-Fi
```

The command prints every link (example from the verification run, tokens redacted):

```
TV viewer (projector, anyone)  http://127.0.0.1:8787/broadcast/
Production Board (read-only)   http://127.0.0.1:8787/board/
Producer board (founder)       http://127.0.0.1:8787/board/#token=…
Nino board (Creator A)         http://127.0.0.1:8787/board/#token=…
Giorgi board (Creator B)       http://127.0.0.1:8787/board/#token=…
Channel home                   http://127.0.0.1:8787/
Nino's agent (Claude Code):    data/demo/agent-a.sh
Giorgi's agent (Codex):        data/demo/agent-b.sh
```

**Upgrading a running demo** (e.g. after pulling a fix): `scripts/demo.sh stop`, then `scripts/demo.sh start` with the **same two names**. State, links and agent tokens are kept. Then reload every board and broadcast tab and restart both agent sessions: the server, the pages and the MCP gateways all load code only at start. If port 8787 is busy, use `--port 8788`.

Other commands: `scripts/demo.sh links` (print again) · `scripts/demo.sh reset` (back to r1; same people and tokens) · `scripts/demo.sh stop` · `scripts/demo.sh start … --fresh` (new names or new tokens; old data is moved to `data.<timestamp>`, not deleted) · `--port N`.

Token links are private: each one is a person's identity. Open each in that person's own browser window; never project them. The token is removed from the address bar after the page loads. Tokens are stored in `data/credentials.txt` and `data/demo/` (mode 600, git-ignored).

## 3. Who opens what

| Role | Opens | Can do |
|---|---|---|
| **TV viewer** (projector, audience, judges) | `/broadcast/`. Click **Watch with sound** once (browsers require a click before audio) | Watch only |
| **Production Board, public** | `/board/` | Watch the negotiation live (read-only) |
| **Creator A** | their own `/board/#token=…` link, plus a terminal running `data/demo/agent-a.sh` (Claude Code) | Instruct their agent; approve changes that affect their work; replace their media |
| **Creator B** | their own board link, plus a terminal running `data/demo/agent-b.sh` (Codex) | Same, for their segments |
| **Producer** (founder) | the producer board link | Approve editorially; Publish; Go live; Reset rehearsal |

The agent scripts start Claude Code and Codex with only the ECHO tools attached. They do **not** edit `~/.claude` or `~/.codex`.

**Two laptops (optional).** Start with `--lan`. Creator B's laptop needs Node 22, Codex, and a clone of this repo with `npm install`. Copy `data/demo/agent-b.sh` to it and change the repo path inside. Venue Wi-Fi often isolates devices; test first, or keep everything on the founder's Mac (two terminal windows, two browser windows). That is the safer option.

## 4. How two real humans approve a change

1. The agents negotiate. When the Showrunner finds a valid plan, the board's **Negotiation** panel shows `waiting for human approval` and lists whose approval is needed, e.g. `Needs: Nino · Giorgi · ECHO Producer`.
2. Each person sees an **Approve v2** button **only on their own board**, and only if the change touches their work (or they are the producer). Pressing it records `<name> approved v2` in the live activity feed, signed by that person's token.
3. The approval is for that exact version. If an agent revises again, earlier approvals stop counting and everyone approves the new version.
4. When the last required person approves, the Showrunner re-checks every rule and commits `r2`. The revision history shows the before/after diff.
5. Agents can never approve. There is no approve tool, and the server returns 403 for agent tokens. Any person whose approval is required can press **Reject** instead; the programme then stays as it was.

**Editorial rejection after publishing (approved policy N04):** the producer's **Reject rN…** button in *Segments and editorial approval* asks for a reason. If that revision is part of the ready publication, or of one still counting down after Go live, the publication is withdrawn before air (a countdown is cancelled; viewers return to Off air): the label shows `#n withdrawn` and Go live is refused with the reason. To air, the creator corrects the content (new media or an approved change), the producer approves the new revision, and publishes again. Rejecting while on air never interrupts playback. To stop an active show, use the existing stop control. It is an API call, not a board button:

```bash
curl -X POST http://127.0.0.1:8787/api/broadcast/fail -H "authorization: Bearer $(grep '(producer) board' data/credentials.txt | sed 's/.*#token=//')" -H 'content-type: application/json' -d '{"reason":"<why>"}'
```

Viewers then see the technical-break slate.

Then the producer presses **Publish approved revision**. The board and the broadcast's top-right corner show `#<publication> · r2 · <hash>`; publication numbers are never reused. Then the producer presses **Go live** (5-second countdown on every viewer). Go live only airs the exact publication shown on the producer's board: if the programme or its media changed since, the server refuses and asks for a new Publish.

If any creator replaces media while a proposal waits for approval, every approval already given is void. The board asks everyone to approve the new version, and the changed segment needs the producer's editorial approval again before publishing. Uploads that cannot be decoded, the wrong kind of file, or audio too short for its slot are refused. The server checks the actual bytes of every file again at startup and before each approval, publication and Go live; a file that no longer decodes or no longer matches its fingerprint is refused with the reason.

## 5. What to type to the agents

Creator A, in the `agent-a.sh` session:
> You are my ECHO agent. I want my Art gallery extended from 30 to 45 seconds so each of my three works gets 15 seconds. If the full 45 seconds is not available, accept the longest time that fits and split it evenly. Never ask to move a confirmed slot. Propose it, then wait for the Showrunner's requests and adapt.

Creator B, in the `agent-b.sh` session (start this first, so it is already waiting):
> You are my ECHO agent. My Music premiere is confirmed at 0:50 and must never move. If another creator genuinely needs time, you may shorten my 10-second intro, never below 5 seconds, and only by what is needed. Wait for requests from the Showrunner (call wait_for_requests repeatedly) and answer them.

Expected (verified five times with these agents): B concedes exactly 5 s with its own reasoning, and A confirms 45 s with 15/15/15 slides. With a stricter B (e.g. "at most 3 seconds"), A adapts to what fits. If B refuses and A insists on 45 s, the board shows **NO AGREEMENT** and the programme stays at r1. That is also a valid demo.

## 6. Live demo script (≈3 minutes)

| Step | Who | What the audience sees | Master Plan §25 check |
|---|---|---|---|
| 1 | Producer | Public board on the projector; broadcast tab on standby | |
| 2 | B | Starts Codex with the instruction above | Separate credentials/agent sessions |
| 3 | A | Gives Claude Code the instruction above | |
| 4 | — | Showrunner: "15 s too long: the confirmed Music premiere must still start at 50s"; ECHO house time offered | Confirmed airtime never changes |
| 5 | B's agent | Accepts intro 10→5 s, with its reasoning shown | B makes a substantive response |
| 6 | A's agent | Adapts: 45 s with 15/15/15 slides | A reacts to B |
| 7 | A, B, producer | Each presses **Approve v2** on their own board | Agents cannot approve |
| 8 | Producer | **Publish**, then **Go live** | Manifest revision = what the studio shows |
| 9 | All | Broadcast: music intro → gallery → premiere at 0:50 → ECHO outro (spoken) | Before/after diff in revision history |

Optional proofs: **NO AGREEMENT** (see §5). **Stale approval**: B uses *Replace media* on the board, the segment drops to `submitted`, and Publish is refused until the producer approves the new file. **Double booking**: `tests/broadcast/http.test.mjs` (concurrent confirms → one 200, one 409).

## 7. Fallbacks (be open about them)

- **An AI agent fails:** run `data/demo/fallback-b.sh` (or the equivalent for A, per `server/fallback-agent.mjs`). The board shows the agent's client as "ECHO fallback (rule-based)".
- **An agent stays silent for 3 minutes:** its request expires as *no change*, never as consent.
- **Piper missing:** the outro shows captions only; the activity feed says so.
- **A viewer cannot confirm the start with the server** (network problem): it shows **Unable to verify** and plays nothing until the server confirms the exact publication, retrying every second; then it joins in sync. Each viewer asks the server at the scheduled start, so a programme withdrawn just before air never starts, even on a viewer whose live updates are late.
- **An artwork fails to display on a viewer** (even after it preloaded): within about 1.5 s the broadcast shows **Live · artwork loading** or **Live · artwork unavailable** with a banner and the work's credits card instead of a blank frame. The same approved image is retried automatically (up to 3 times, every 2 s) and the fault clears when it appears. The programme continues on time.
- **Audio stalls on a viewer:** after about 2.5 s the broadcast shows **Live · audio interrupted** and retries up to 3 times. After about 8 s it shows **Live · audio unavailable** with a **Retry audio** button, and the programme continues without sound. It never shows a plain "Live" while required audio is stuck.
- **WebGL unavailable:** the outro shows a text slate; the programme continues.
- **Rehearse again:** `scripts/demo.sh reset`, or **Reset rehearsal** on the producer board.

## 8. What is real and what is not

| Real | Not built / limits |
|---|---|
| Two independent LLM agents over MCP with separate tokens | Public hosting needs a decision, see `DEPLOYMENT.md` |
| Deterministic Showrunner, booking protection, approvals bound to revision + SHA-256 | No moderation AI, no fact-checking module (News is not in the demo) |
| Live board over SSE; shared on-air clock; reconnect | Playout is in the browser (no OBS/RTMP output) |
| Piper host voice written from the approved programme | One shared synthetic English voice |
| Rehearsal media: public-domain artworks (The Met, CC0) and a code-synthesised track | Creators' own media must be uploaded by them, with rights declared |
