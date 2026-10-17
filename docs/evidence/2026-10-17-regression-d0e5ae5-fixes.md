# Fix for Codex's independent regression run of d0e5ae5 (verdict: AUTOMATED QA FAIL, one P1/N04 blocker)

Source: `../echo-stage-qa/qa/REGRESSION-d0e5ae5.md`, read-only at the owner's request. Codex's QA worktree was not modified and its scripts were not run. All other gates on `d0e5ae5` passed in Codex's run. The finding was reproduced independently here first, on the unchanged `d0e5ae5` tree. Old-commit runs of the new tests used `git archive d0e5ae5` in a scratch directory.

These are **implementer results**. They are not Codex's independent validation and not a human rehearsal. DEMO READY is not claimed.

## Finding and reproduction

Codex: with the live-update stream (SSE) delayed by 1,500 ms for one viewer, the producer rejected the gallery 493 ms before the scheduled start. The server withdrew the publication (queued, `cancelledStartAt`), but the delayed viewer still held the earlier `on_air` state, went Live at the scheduled time and played native audio for 1,022 ms until the withdrawal event arrived.

Reproduced on `d0e5ae5` with `tests/browser/activation-race.mjs`. One viewer is direct and one sits behind a proxy that delays (or cuts) only `/api/events`; native `playing` events are recorded in each page:

| Scenario | d0e5ae5 |
|---|---|
| exact: SSE +1,500 ms, rejection 493 ms before start | **FAIL**: delayed viewer 23 Live samples from +38 ms |
| boundary: SSE +1,500 ms, rejection 40 ms before start | **FAIL**: 33 Live samples from +27 ms |
| disconnected: live updates cut after "Starting", rejection 493 ms before | **FAIL**: 66 Live samples from +33 ms |
| unverified: start check unreachable | **FAIL**: plays without any server confirmation |
| normal (no rejection) | fails only the new latency check (old code sends no start confirmation) |
| on-air rejection +400 ms; reconnect mid-show | pass (controls) |

## Root cause

The player turned "Starting" into live rendering and native audio at `onAirAt` on its own clock, using whatever state the event stream had last delivered. Delivery can be late or missing, so playback authorisation depended on SSE timing. The server's N04 decision (withdraw if rejected before `onAirAt`) was correct, but the player never asked for it.

## Fix: the server authorises each start, at the start

- **Server**, `GET /api/broadcast/activation?publicationId&hash&onAirAt` (public, read-only, like the event stream). The answer is given only once the **server's** clock has reached `onAirAt`. Before that a rejection can still withdraw the publication; after it, N04 no longer withdraws. So the answer is final, decided in the same serialised process as rejections. Asked up to 5 s early, the request is held until `onAirAt`; earlier asks get `pending`. It answers `permitted` only for the exact publication, hash and start time while the broadcast is on air. Otherwise it answers `not permitted` with the reason (withdrawn before air / stopped by the producer / not scheduled).
- **Player**: no scheduled publication renders or plays until that exact start is `permitted`.
  - The check is sent about 2 s before `onAirAt`, so the answer arrives right at the start.
  - **Waiting** while the answer is due. **Unable to verify** (visible slate, "Nothing plays until the start is confirmed; retrying") on timeout (`onAirAt` + 2 s) or network error, retried every 1 s. **Off air** ("withdrawn before air") when not permitted, whatever the event stream still says.
  - A permitted start is remembered for that exact publication, so a running programme is never re-checked or interrupted. N04 on air is unchanged: a rejection after the start does not stop playback; only the producer's Stop does.
- Late joiners and reconnecting viewers ask after `onAirAt` and get an immediate answer.

**Added start latency (measured):** the start confirmation arrives 3–4 ms after `onAirAt` on this machine (resource timing). Native audio was playing at +32 to +34 ms both with and without the 1.5 s SSE delay, against +33 ms on `d0e5ae5` without the gate. Over a real network the answer arrives one network trip after `onAirAt`, and playback joins at the correct programme position.

## New tests (fail on d0e5ae5)

| Test | d0e5ae5 | Now |
|---|---|---|
| `tests/broadcast/activation.test.mjs` (4, injected server clock: held until `onAirAt` with a rejection at −493 ms; permitted exactly at `onAirAt` and not revoked by an on-air rejection; late joiner / wrong publication, hash, start / stopped / early ask; denied after restart) | 0/4 | 4/4 |
| `tests/browser/activation-race.mjs` (`npm run test:activation-race`, 7 scenarios above) | 2/7 (controls only) | 7/7 |

## Results on the fix commit

All runs are on the committed code. The code fingerprint was checked unchanged before and after the run, 2026-10-17 ~22:20–22:35 Tbilisi, Node 22.22.3, Chrome via Playwright 1.49.1, ffmpeg 8.1. Implementer evidence only.

| Command | Result |
|---|---|
| `npm test` | **54/54** broadcast (incl. 4 new activation tests) + **5/5** studio suites |
| `npm run test:activation-race` (new) | **7/7**: exact −493 ms / boundary −39 ms / cut live updates −493 ms: 0 Live samples and 0 native playing events in both viewers, both Off air; on-air rejection +401 ms: both kept playing; normal: start confirmed +3 / +3 ms, native audio +26 ms (direct) / +30 ms (SSE +1,500 ms); unverified 2.5 s: "Unable to verify", nothing played, joined in sync 720 ms after recovery; reconnect at +3 s: rejoined in sync (Δ 9 ms) |
| `npm run test:browser` | PASS (three sessions, approvals, publish, board rejection withdraws before air) |
| `npm run test:board-lan` | PASS |
| `npm run test:audio-stall` | PASS ("interrupted" 2.6 s, "unavailable" 8.1 s, recovery) |
| `npm run test:art-fault` / `test:art-display-fault` | PASS / PASS |
| `npm run test:countdown-reject` | PASS (rejected through the board 4,610 ms before start; never Live) |
| `npm run test:broadcast-browser` | PASS, onsets +13 / +13 / +11 / +7 ms |
| `ECHO_SSE_DELAY_MS=1500 npm run test:broadcast-browser` | PASS, onsets +25 / +24 / +23 / +19 ms |
| `ECHO_HOST_VOICE=off npm run test:broadcast-browser` | PASS, onsets +11 / +11 / +10 / +6 ms |
| `scripts/rehearse-series.sh <dir> 1` (real Claude Code + Codex over MCP) | **RUN CLEAN**: B accept 5s: “Accept shortening Music intro from 10s to 5s: the Art gallery extension needs exactly 5s after the offered 10s of house time. This meets my owner's 5s minimum and gives only the time needed; Music premiere must retain its confirmed 50s start and full 60s duration.”; A adapted to 45 s at 15/15/15; premiere at 50 s, 120 s total; r2 published. **Approvals issued by the script as stand-ins for the people.** |

Not covered: the observed two-human rehearsal, venue/device access, physical sound and the recording. Codex's independent validation of this SHA is pending.
