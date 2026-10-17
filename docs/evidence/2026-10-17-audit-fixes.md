# Fixes for the independent release audit of 64d1dc5 (verdict: NOT READY, 10 PASS / 3 FAIL)

The audit findings were received as text from the project owner. Codex's QA worktree was not read or modified. Each finding was reproduced independently in this repository before fixing.

`cec5fb2` (demo prep: launcher and docs) changed no server or player logic, so it resolved none of the findings. All were reproduced on it.

## Reproduction before the fix (HEAD `cec5fb2`)

| Finding | Reproduction |
|---|---|
| P0-1 published asset | published `art-1` URL: 200 → **404** after the owner uploaded a newer draft |
| P0-2 stale approvals | B approved v2, then B's intro media changed, and the proposal still **committed r2** using the old approvals |
| P0-3 audio stall | browser: a hung audio request left the label on "Live" (no detection existed) |
| P1 booking intervals | accepted −5+10, 0+0, 0−3, 115+30, 1.5+10, 0+9999 |
| P1 publication numbers | two different manifests both published as **r1** |
| P1 go-live precondition | went live with `publishRevision: 999, hash: "not-the-manifest"` → 200 |
| P1 retry identity | the same proposal retried → `409 busy` (no way to recognise a retry) |
| P1 undecodable media | a text file named `.mp3` uploaded, approved, **published** |
| P1 SSE skew | old player with SSE delayed 1.5 s: **1.53 s** behind the server clock |
| P1 Piper-dependent tests | the playout test asserted a voiced outro unconditionally |

## Fixes

- **P0-1:** an append-only media index (`state.media`, keyed by SHA-256) serves `/media/<hash>`, so it no longer depends on the current segment assets. Uploads are never deleted. The index survives restarts and rehearsal resets.
- **P0-2:** replacing media is a content change. It creates a new programme revision, rebases open proposals, bumps the proposal version and voids every approval already given. Every decision and commit also checks that the touched segments' revisions match the version the people saw (defence in depth). The changed segment needs editorial approval again before publishing.
- **P0-3:** a player watchdog for required audio. Decoded progress must continue; the player's own seeks don't count. Stuck for 2.5 s → **"Live · audio interrupted"**, a banner, and up to 3 reloads. Stuck for 8 s → **"Live · audio unavailable"**, a banner, a **Retry audio** button, and the programme continues without sound. Each segment that needs audio starts a fresh watch.
- **Booking intervals:** whole seconds only, inside the episode, within the segment's bounds, and no overlap with a confirmed slot.
- **Publication identity:** `publicationId` increases monotonically and survives resets. A media change is a new revision. The board and broadcast show `#id · rN · hash`.
- **Go-live:** requires the exact `publicationId` and hash shown to the producer, refuses if the programme has moved on, and accepts a delay of 0–600 s only (no backdating).
- **Retries:** `Idempotency-Key` per identity. The same key and same request replay the first outcome (refusals included, and replays survive a restart). The same key with a different request returns 422. The board, MCP gateway and fallback agent send one key per action and retry once on network failure. Retry records are not exposed in the public state.
- **Media validation:** file signature, plus an ffprobe decode when ffprobe is available. Images can't go into audio slots or vice versa, and audio shorter than its slot (offset + duration) blocks publishing.
- **Viewer clock:** viewers sync to a round-trip-corrected `/api/time` (lowest-RTT sample), not SSE delivery times.
- **Piper optional:** the playout test asserts the captions-only path when Piper is missing (`ECHO_HOST_VOICE=off` forces it).

## Evidence after the fix

- `node --test tests/broadcast/regression.test.mjs`: **9/9 pass**. The same file run against the audited code (`git archive 64d1dc5`) fails **9/9**, each for the reported reason: the 404, approvals kept, no exception, and so on.
- `npm test`: **36/36** broadcast tests and **5/5** studio suites.
- `npm run test:audio-stall` (Chrome):
  - hung request → "interrupted" at 2.6 s, then "unavailable" at 8.1 s;
  - exactly 3 retries, with the banner and the Retry button shown;
  - no plain "Live" while stuck;
  - 2 failed requests → recovered automatically to "Live";
  - the gallery continues with no fault shown.
- `npm run test:broadcast-browser`, full 2-minute playout, three configurations, all PASS:

| Configuration | Intro audio (expected / actual) | Premiere audio | Outro |
|---|---|---|---|
| Normal | 43.01 / 42.99 s | 20.00 / 19.98 s | Piper speech, peak 0.72 |
| SSE delayed 1.5 s | 43.00 / 43.00 s | 20.00 / 19.97 s | Piper speech; both viewers within 350 ms of server time |
| `ECHO_HOST_VOICE=off` | 42.98 / 42.98 s | 19.99 / 19.97 s | captions only, caption visible |

- SSE skew, measured directly: old player **1.53 s** behind, fixed player **0.02 s**.
- `npm run test:browser`: PASS. A real-agent rehearsal (Claude Code + Codex) after the fixes: RUN CLEAN, with A→B→A, r2 committed with the premiere at 0:50, and a manifest published.

Two regressions in my own new code were caught by these tests and fixed before commit:
1. The watchdog counted the player's own drift-correction seeks as progress.
2. The watchdog carried state from the intro into the premiere (same audio file, paused in between) and marked the premiere failed.

## Not claimed

Demo readiness is not claimed until an independent regression run passes. Not addressed here: the Playwright 1.49.1 dev-dependency advisory (only the unused `playwright install` path is affected).
