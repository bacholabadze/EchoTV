# ECHO TV 3.1 — session handoff

Written 2026-10-17 ~18:30 (Tbilisi), updated ~20:45 after Codex's 3e0c846 verdict, to continue in a fresh session. Hackathon submission deadline: **Sunday 18 Oct 2026, 12:00 Tbilisi** (internal target 11:30, Master Plan §28).

**Read first, in this order:** this file → `DEMO_RUNBOOK.md` → `docs/evidence/2026-10-17-audit-fixes.md`. The product source of truth is the Master Plan (`../ECHO_TV_3_1_Execution_Master_Plan_KA (1).md`, Georgian, v3.1). Where the older `ECHO_TV_ROADMAP.md` conflicts with it, the Master Plan wins for the hackathon (see `ECHO_3_1_PLAN.md` §2).

## 1. Where things are

| Item | Value |
|---|---|
| Repo | `/Users/apple/Bridge/Projects/Hacktoberfest/echo-stage` (git, local only, no remote) |
| Branch | `echo-3.1` (`main` = untouched baseline) |
| **Latest implementation commit (for Codex re-validation)** | the commit that adds `tests/broadcast/regression-3e0c846.test.mjs` (fixes R1/R2/R3): `git log -1 --format=%H -- tests/broadcast/regression-3e0c846.test.mjs`. Evidence: `docs/evidence/2026-10-17-regression-3e0c846-fixes.md` |
| Previously validated | `3e0c846e…` (N04): **AUTOMATED QA FAIL** (Codex, `../echo-stage-qa/qa/REGRESSION-3e0c846.md`): R1 P0, R2 P1, R3 P1/N04; all other gates PASS. Earlier: `7ee7394` AUTOMATED QA FAIL, `64d1dc5` NOT READY |
| Baseline (original ZIP, pre-hackathon code) | `c7eb068` |
| Tag | `echo-3.1-demo-candidate` → `64d1dc5` (the commit audited as NOT READY) |
| Offline bundles (parent dir) | `echo-3.1-64d1dc5.bundle`, `echo-3.1-cec5fb2.bundle`, `echo-3.1-733f3e5.bundle`, `echo-3.1-3e0c846.bundle`. Make a new one for each nominated SHA. |
| Codex QA worktree | `../echo-stage-qa`. **Never modify it or run its scripts** (they write evidence into it). Read its reports only when the owner asks. |
| Parent dir | Master Plan, `roadmap.md` (mojibake copy of `ECHO_TV_ROADMAP.md`), original ZIP |

**Running process, not ours to stop:** a demo server, `node server/server.mjs` from this repo on **port 8787**, was started at 16:53 via `scripts/demo.sh start "Bacho" "Keti"` (pid in `data/demo/server.pid`). It runs **code from before every fix wave** in memory. Before any rehearsal on the fixed code, run `scripts/demo.sh stop && scripts/demo.sh start "Bacho" "Keti"` (same names keep links and tokens), then reload all tabs and restart both agent sessions. `data/` holds live credentials (git-ignored); never print or commit them.

## 2. Product vision (unchanged; do not reduce ECHO to a production tool)

**ECHO TV — "Many creators. Many agents. One shared broadcast."** A viewer-facing, multi-genre television channel, made together by human creators and their own independent AI agents. Approved decisions (Master Plan §4, §21, §23):

- Multiple human creators and independent agents (bring your own agent).
- One shared broadcast.
- Airtime reservations; confirmed slots are protected.
- AI Showrunner coordination.
- Live Production Board.
- Creator uploads and showcases (music, film, art, competitions).
- Content governance with revision-bound approvals.
- Reusable 3D television modules.
- Show-your-sources for News and Debate.
- Audience influence only in flexible slots.
- **No AI video generation.**
- Keep the full-scale vision; the hackathon demo is a slice of it.

**Future work, not implemented:**
- Georgian-language programming and voices;
- ElevenLabs or any other cloud TTS;
- News, Debate, Film and Competition modules;
- moderation AI, fact-checking, voting, accounts, notifications, a 24/7 channel clock, OBS/RTMP output;
- public hosting.

## 3. Architecture and stack (as built)

- **Runtime:** Node 22, ESM, `node:http`, no framework. Dependencies: `@modelcontextprotocol/sdk` 1.31.0, `zod` 4.6.5, dev `playwright` 1.49.1 (all pinned, ≥2 weeks old at install). Optional Python 3.13 `.venv` with `piper-tts` 1.8.0 + `onnx` 1.23.0 and `voices/en_US-ljspeech-high.onnx` (git-ignored, downloaded). `ffmpeg`/`ffprobe` used if present.
- **`server/domain.mjs`:** deterministic rules, no LLM.
  - Three separate state machines: Booking, Segment and Broadcast.
  - Show revisions with `baseRevision`; proposals, conflicts and the Showrunner solver.
  - Approvals bound to proposal version, segment revisions and media SHA-256.
  - Content-change invalidation; manifests with a never-reused `publicationId`; go-live preconditions; audit log.
- **`server/server.mjs`:**
  - One process serialises all mutations; atomic JSON persistence in `data/state.json`.
  - Bearer tokens for each person and agent; public credential-free state; SSE `/api/events`.
  - `/api/time` for clock sync; agent inbox long-poll.
  - Upload validation (signature + ffprobe); append-only media index; `Idempotency-Key` replay.
  - Piper host voice at publish (template text, no LLM, captions-only fallback).
- **`server/seed.mjs`:** the §24 demo programme (120 s): Music intro 10 s (B) · Art gallery 30 s (A) · ECHO interstitial 10 s (house) · **Music premiere 60 s, confirmed at 0:50** (B) · Outro 10 s (house).
- **`server/mcp.mjs`:** MCP stdio gateway, one process per agent token. Tools: `get_show_state`, `propose_change`, `wait_for_requests`, `respond_to_request`, `revise_proposal`, `withdraw_proposal`, `request_slot`, `get_change_history`. No tool exists to approve, publish, force or override.
- **`server/fallback-agent.mjs`:** rule-based stand-in that follows a written owner policy and labels itself "ECHO fallback (rule-based)".
- **`dist/board/`:** live Production Board: running order with locked confirmed slots and proposed preview, people with their agents and MCP client, step-by-step negotiation, per-person Approve/Reject, segment revisions, hashes and approval validity, revision diffs, producer Publish / Go live / Reset.
- **`dist/broadcast/`:** playout of the published manifest on the server's on-air clock.
  - Reuses the studio room, cast, blocking, lighting and performance modules for the ECHO host.
  - Art Gallery module (preloaded crossfaded slides with credits) and Music module (Web Audio visualiser).
  - Slates; publication `#id · rN · hash` on screen.
  - Required-audio watchdog (interrupted, then unavailable, then Retry).
- **Pre-existing, preserved:** `/` channel (now links Broadcast and Board), `/shows/the-table/`, `/studio/` (The Table pilot, 3D, unchanged), `/current.html`, `/original.html`, `/lab/`.
- **Voice:** **Piper only** (offline, `en_US-ljspeech-high`, one shared English voice). The pilot uses prerecorded Piper clips. The broadcast outro and interstitial lines are generated at publish time, with phoneme alignment mapped to viseme cues. No ElevenLabs, no cloud TTS, no live speech.
- **Showrunner:** does exact time arithmetic per region between confirmed slots, cuts ECHO house time first, asks other creators' agents for the remainder, then asks the proposer to adapt. It never moves a confirmed slot, never approves, never decides for a silent agent (expiry = no change), and records NO AGREEMENT when needed. LLMs live only in the creators' own agents.

## 4. Implemented vs verified

| Claim | Implementer evidence (this repo) | Independent QA |
|---|---|---|
| A → B → A with two real, independent LLM agents (Claude Code + Codex) | 5 runs + 1 post-fix run, all clean (`docs/evidence/2026-10-17-real-agent-series.md`). Approvals in those runs were issued **by a script standing in for the humans**. | Not yet. The human approval rehearsal is pending. |
| Rules (bookings, approvals, revisions, publish, go-live, idempotency, media) | 50/50 `npm run test:broadcast` (domain, HTTP, MCP, regression, withdrawal) | `64d1dc5` NOT READY; `7ee7394` FAIL; `3e0c846` FAIL (R1–R3, all other gates PASS); latest: **pending** |
| Board: three separate sessions approve with their own identity | `npm run test:browser` PASS | pending |
| Full 2-minute playout, two viewers in sync, reconnect, audio sync, outro | `npm run test:broadcast-browser` PASS in 3 configs: normal / SSE delayed 1.5 s / `ECHO_HOST_VOICE=off` | pending |
| Audio stall handling (P0-3) | `npm run test:audio-stall` PASS (interrupted at 2.6 s, unavailable at 8.1 s, 3 retries, recovery) | pending |
| Studio pilot unchanged | `npm run test:studio` 5/5 | n/a |

**Fresh run at `7ee7394` (18:2x):** `npm test` → 36/36 + 5/5. `test:browser` PASS. `test:audio-stall` PASS.

**On the fix commit after Codex's 7ee7394 regression (19:0x):**
- `npm test`: 41/41 + 5/5.
- Browser: `test:browser`, `test:board-lan`, `test:audio-stall`, `test:art-fault` and `test:broadcast-browser` (normal / SSE delayed 1.5 s / no Piper) all PASS. Segment onsets were at most +31 ms.
- A real-agent run was clean. The full playout configs were last run on the committed code at about 17:3x and all passed.

Regression proof: `tests/broadcast/regression.test.mjs` passes 9/9 on `7ee7394` and **fails 9/9 on `64d1dc5`**, each for the reported defect.

**On the fix commit after Codex's 3e0c846 regression (~21:00):** `npm test` 50/50 + 5/5; all 7 browser tests PASS (incl. new `test:art-display-fault`, `test:countdown-reject`); full playout normal / SSE 1.5 s / no Piper PASS, onsets ≤ +26 ms; one real Claude Code + Codex run CLEAN (approvals scripted as stand-ins). The new tests fail on `3e0c846` for the reported defects. Details: `docs/evidence/2026-10-17-regression-3e0c846-fixes.md`.

## 5. Codex QA status

**Update (20:4x):** Codex's run on `3e0c846` = **AUTOMATED QA FAIL** with three blockers; every other gate passed (original P0s, fresh corrupt uploads, LAN, idempotency, decoder, timing, real-agent exchange and playback, three N04 cases):
- **R1 P0:** an artwork that preloaded fine but failed on screen stayed blank under plain "Live".
- **R2 P1:** retained corrupt media carrying an old `decodable:true` flag could be approved, published and started.
- **R3 P1/N04:** a rejection during the Starting countdown did not stop the start.

All three were reproduced here and fixed in the next implementation commit, each with a regression test that fails on `3e0c846` (`docs/evidence/2026-10-17-regression-3e0c846-fixes.md`). That commit is **not yet independently validated**. Rehearsal entry stays on HOLD until Codex passes it; DEMO READY additionally needs the observed two-human rehearsal.

**Update (19:20):** Codex's regression run on `7ee7394` = **AUTOMATED QA FAIL**. The three original P0s passed. New: P0 N02 (header-only PNG published, blank gallery under "Live"); P1 N01 (board actions broken on plain-HTTP LAN origins); N05 (no decoder = fail open); N03 (retry identity ignored upload metadata); P1-11 (one late outro onset, +289 ms); N04 (reject-after-publish policy). The fixes are in the next implementation commit (`docs/evidence/2026-10-17-regression-7ee7394-fixes.md`):
- N02, N01, N05, N03: FIXED.
- P1-11: mitigated, not reproduced here.
- N04: **founder approved option 1; implemented** in the next commit (see `docs/proposals/N04-withdrawing-published-content.md` → "As implemented"). Rejecting content in a ready publication withdraws it before air. Go live refuses with the reason. A corrected new revision must pass review. On air there is no automatic interruption, and Stop broadcast is API-only.

That commit is **not yet independently validated**.

Earlier history:

- `64d1dc5`: **NOT READY**, 10 PASS / 3 FAIL. P0: published asset 404 after a new draft; stale owner approvals after a media change; silent "Live" on stalled audio. P1: booking intervals, reused publication numbers, go-live precondition, retry identity, undecodable media, SSE skew, Piper-dependent tests.
- **All 10 were reproduced and fixed in `7ee7394`**; per-finding before/after is in `docs/evidence/2026-10-17-audit-fixes.md`.
- `7ee7394`: **independent regression verdict pending**. Do **not** claim demo readiness until it passes. Product implementation is frozen until then (docs-only commits were explicitly allowed).

## 6. Known limitations and open issues

- **Not done by humans yet:** an observed rehearsal with two real people approving on their own boards, the real creator names and media, and the recording.
- **Organiser answers:** prior code is **permitted** (the owner reported on 2026-10-17 that organisers allow the earlier ECHO Studio code as a reference; baseline `c7eb068` still separates old from new). The submission video spec is still unconfirmed.
- **No public link.** Cloudflare Quick Tunnels don't support SSE (official docs). The options needing owner approval are a named Cloudflare Tunnel or Tailscale Funnel (`DEPLOYMENT.md`). LAN mode is untested from a second device; venue Wi-Fi may isolate devices.
- **ffmpeg is now required to accept creator uploads** (fail closed). The shipped demo media are trusted by their recorded SHA-256 without it.
- **N04 implemented as option 1 only.** Not implemented: on-air *Pull segment*, after-air archive marking, and a board button for Stop broadcast (API only: `POST /api/broadcast/fail`).
- **P1-11:** onset lateness was not reproduced here (≤ +34 ms on 7ee7394, ≤ +31 ms now); Codex should re-measure.
- **Dev-only advisory:** Playwright 1.49.1 (fixed in 1.55.1). It only affects `playwright install`, which we don't use. The bump is deferred.
- **Platform limits:** single process, JSON state, no rate limiting, tokens in URL hash, plain HTTP on LAN.
- **Content limits:** one English synthetic voice; the cast is three styled variants of one base rig.
- **Rehearsal media are stand-ins:** public-domain Met artworks credited to their artists, and a code-synthesised CC0 track whose visualiser only fills about 0–1.5 kHz.
- **Audio watchdog is client-only:** the producer board is not told about a viewer's audio fault.
- **Not built:** moderation AI, News/fact-checking, voting, OBS output.
- `ECHO_TV_ROADMAP.md` (pre-hackathon) and Master Plan §13 ("no code audit exists") are outdated by this work. They were left unedited because they are the owner's documents.

## 7. Commands

```bash
cd /Users/apple/Bridge/Projects/Hacktoberfest/echo-stage
npm install                                   # if node_modules is missing
npm test                                      # 50 broadcast + 5 studio suites (~1 min)
npm run test:browser                          # board, 3 sessions (Chrome)
npm run test:audio-stall                      # P0-3 regression (Chrome, ~15 s)
npm run test:board-lan                        # board actions on a plain-HTTP non-localhost origin (Chrome)
npm run test:art-fault                        # broken published artwork shown as a fault (Chrome, ~45 s)
npm run test:art-display-fault                # artwork that preloaded but fails on screen: fault + automatic recovery (Chrome, ~35 s)
npm run test:countdown-reject                 # reject during the Starting countdown: never airs (Chrome, ~10 s)
npm run test:browser-all                      # all browser tests in sequence
npm run test:broadcast-browser                # full 2-min playout (Chrome)
ECHO_SSE_DELAY_MS=1500 npm run test:broadcast-browser   # skew regression
ECHO_HOST_VOICE=off   npm run test:broadcast-browser    # no-Piper path

scripts/demo.sh start "<Creator A>" "<Creator B>" [--lan] [--fresh] [--port N]   # prints all URLs
scripts/demo.sh links | reset | stop
data/demo/agent-a.sh                          # Creator A's agent (Claude Code)
data/demo/agent-b.sh                          # Creator B's agent (Codex); "exec <prompt>" for unattended
scripts/rehearse-series.sh <out-dir> 3        # real-agent series; approvals scripted as stand-ins
```

URLs: `/broadcast/` (viewer, click "Watch with sound"), `/board/` (public, read-only), `/board/#token=…` (each person's private link; the launcher prints them).

## 8. Pending human rehearsal and submission (Master Plan §25, §26, §28)

1. After the QA verdict: restart the demo server on the fixed code (§1). Pre-flight: all links load, both agents show their client on the board, publication label visible.
2. Observed two-person rehearsal (`DEMO_RUNBOOK.md` §4–§6). Creator A instructs Claude Code and Creator B instructs Codex. **Each person presses Approve on their own board**, then the producer publishes and goes live. Aim for three clean runs; use one fallback deliberately once if useful (§25).
3. Record per `RECORDING.md`: OBS for system audio, edited to 90–120 s, labelled "edited for length". Keep the uncut takes and the commit hash.
4. Submit before 12:00 (target 11:30), after confirming the video spec and prior-code rule with the organisers.
5. If live A → B → A cannot be shown, do not present upload + playlist as full Track 02 collaboration (§28 Go/No-Go).

## 9. Next priorities (in order)

1. Get Codex's verdict on the latest implementation commit (fixes R1/R2/R3 from the 3e0c846 run; the owner called this the last release-safety fix wave); for any finding, reproduce it independently, fix it minimally, and add a regression test that fails on the previous commit. No feature work, no ElevenLabs on this branch (3.2 design: `../ECHO_3_2_INTEGRATION_DESIGN.md`).
2. Restart the demo on the fixed code and run the observed two-human rehearsal; record what actually happens.
3. Recording and submission package before 11:30.
4. After the hackathon (not before):
   - bump Playwright;
   - surface viewer audio faults on the board;
   - real creator media;
   - public hosting decision;
   - Georgian voices and programming (evaluate TTS options, including ElevenLabs, with cost approval);
   - News/Debate with sources, moderation, more modules.

## 10. Continuing safely in a new session

- Start with `git status`, `git log --oneline -5` and `npm test`. Expect a clean tree at the latest implementation commit (§1).
- Never touch `../echo-stage-qa`, `data/credentials.txt` or the processes in `data/demo/server.pid` without the owner's go-ahead.
- Don't add features, dependencies or paid services while QA or rehearsal is in progress. Make docs-only changes in separate commits.
- New dependencies must be pinned to releases at least two weeks old. If `~/.npm` permissions fail, use `npm install --cache /tmp/<dir>` (never sudo).
- Make claims only with evidence. Keep implementer evidence separate from independent QA.
- Label anything scripted, simulated or a stand-in. No AI video, no fabricated media or metrics.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
