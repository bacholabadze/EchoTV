# Fixes for Codex's independent regression run of 7ee7394 (verdict: AUTOMATED QA FAIL)

Source: `../echo-stage-qa/qa/REGRESSION-7ee7394.md`, read-only at the owner's request. Codex's QA worktree was not modified and its scripts were not run (they write evidence into it). Every finding was reproduced independently here first (`git archive 7ee7394` in scratch, isolated data, random ports).

## Reproduction on 7ee7394

| Finding | Independent reproduction |
|---|---|
| P0-4 / N02 header-only PNG | `probeMedia` → `{decodable:true, probed:true, width:0, height:0}`; upload 200 → review → publish 200. Player (art-fault test on 7ee7394 pages): plain **"Live"** over the broken artwork at 20.4 s |
| P1-8 / N01 plain-HTTP LAN board | `board-lan` test on 7ee7394 pages at `http://echo-lan.test:<port>` (isSecureContext=false): approvals never applied (`crypto.randomUUID` missing), timeout waiting for r2 |
| P1-9 / N05 no decoder | `probeMedia` with `PATH=/usr/bin:/bin` → `{decodable:true, probed:false}` for `ID3NOT_AN_AUDIO_STREAM` |
| P1-10 / N03 retry metadata | same key + bytes, different title/rights → 200 `idempotent-replay: true`, original title |
| N04 reject after publish | reject gallery r1 after publishing → go-live with that publication 200 (policy question, see below) |
| P1-11 onset timing | **Not reproduced here:** 7ee7394 pages switched at +24…+34 ms (premiere and outro, 2 runs). Codex observed +289 ms at the outro and a seek at 50.009 s |

## Fixes

- **N02 (server):** uploads are fully decoded (`ffmpeg -v error -xerror … -f null -`, which must exit 0 with no decoder errors) after the ffprobe stream check. Images with zero width or height fail.
- **N02 (publish):** publishing fails closed. Every asset must be positively verified (`decodable === true`).
- **N02 (player):** each slide's image must load and decode. Still loading after 1.5 s → "Live · artwork loading". Failed, or undecided after 8 s → "Live · artwork unavailable", a banner, and a credits card instead of a blank frame. The programme continues, and the fault clears with the segment.
- **N05:** no ffmpeg/ffprobe means uploads are refused ("no media decoder…"). The shipped demo files are trusted only if their bytes match the SHA-256 recorded when they were verified (`media/media.json` → `verified`). Assets in state from older versions are re-verified on load (fail closed).
- **N01:** the board's request key uses `crypto.randomUUID` where it exists, otherwise 16 bytes from `crypto.getRandomValues` (available on insecure origins). Same 128-bit identity, same authorization.
- **N03:** retry identity = method, path, `content-type`, `x-filename`, `x-title`, `x-credit`, `x-license`, `x-rights-declared` and the body. Any change → 422 `idempotency_conflict`; an identical retry still replays.
- **P1-11 (mitigation):**
  - 1.5 s before a segment, the player pre-seeks the next segment's audio and pre-renders the 3D studio.
  - Studio shaders are compiled at load.
  - A paused element starts the moment its segment begins, instead of waiting for the drift-check interval.
  - Onset instrumentation (`onsets`, `playing`) added, with permanent ±250 ms assertions in the playout test.
- **N04:** **not implemented.** Policy proposal in `docs/proposals/N04-withdrawing-published-content.md`, awaiting the owner's decision.

## Evidence after the fix

- `tests/broadcast/regression-7ee7394.test.mjs`: **5/5 pass**; the same file on 7ee7394 fails **5/5**.
- `npm test`: **41/41** broadcast tests and **5/5** studio suites. The domain unit fixtures now declare their media verified, as the server's decoder does for real uploads.
- Browser tests (Chrome), all PASS:

| Test | Result |
|---|---|
| `test:browser` (board) | PASS |
| `test:board-lan` (new) | `isSecureContext=false`, no `randomUUID`: 3 approvals, a reject, an upload, a review, publish and go-live all PASS. Fails on 7ee7394 pages |
| `test:audio-stall` | interrupted 2.6 s, unavailable 8.1 s, 3 retries, recovery |
| `test:art-fault` (new) | corrupt and hung published artwork → "Live · artwork unavailable", banner and credits card at every sample 20.4–39.5 s; no fault outside the gallery. Fails on 7ee7394 pages (plain "Live" at 20.4 s) |
| `test:broadcast-browser`, normal | onsets +17/+16/+14/+10 ms; premiere audio playing +17 ms; Piper outro |
| `test:broadcast-browser`, SSE delayed 1.5 s | onsets ≤ +31 ms; premiere audio +16 ms; viewers within 350 ms of server time |
| `test:broadcast-browser`, `ECHO_HOST_VOICE=off` | onsets ≤ +18 ms; premiere audio +21 ms; captions-only outro |

- External onset probe, same method for both builds (2 runs each):

| Build | Premiere switch | Premiere audio advancing | Outro switch |
|---|---|---|---|
| 7ee7394 | +27 / +32 ms | +30 / +34 ms | +24 / +28 ms |
| fixed | +14 / +11 ms | +16 / +13 ms | +13 / +8 ms |

- Real agents (Claude Code + Codex) on the fixed code: **RUN CLEAN**. A→B→A, r2 committed with the premiere at 0:50, publication r2 · b55e93b8a1b3. Approvals were scripted stand-ins.

## Status per finding

| Finding | Status |
|---|---|
| P0-4 / N02 | FIXED (server, publish and player), regression tests fail on 7ee7394 |
| P1-8 / N01 | FIXED, real insecure-origin browser test |
| P1-9 / N05 | FIXED (fail closed; recorded-fingerprint trust for shipped files only) |
| P1-10 / N03 | FIXED |
| P1-11 | MITIGATED, **not reproduced** in this environment; permanent ±250 ms onset assertions added. Codex should re-measure in its environment |
| N04 | BLOCKED on the product decision; proposal written, nothing implemented |

Not claimed: demo readiness. That requires Codex's independent validation of this commit and the observed two-human rehearsal.
