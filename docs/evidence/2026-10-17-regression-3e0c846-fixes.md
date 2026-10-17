# Fixes for Codex's independent regression run of 3e0c846 (verdict: AUTOMATED QA FAIL)

Source: `../echo-stage-qa/qa/REGRESSION-3e0c846.md`, read-only at the owner's request. Codex's QA worktree was not modified and its scripts were not run. Every finding was reproduced independently here first, on the unchanged `3e0c846` tree, with isolated data directories and random ports. Old-commit runs of the new tests used `git archive 3e0c846` in a scratch directory (no git metadata touched).

These are **implementer results**. They do not replace Codex's independent validation of the new SHA, and they are not a human rehearsal. DEMO READY is not claimed.

## Reproduction on 3e0c846

| Finding | Independent reproduction |
|---|---|
| R1 (P0) displayed artwork fails after a successful preload | `tests/browser/art-display-fault.mjs`: art-2's preload completes, then the browser cache is cleared and disabled (CDP) and the display fetch of the same approved URL is aborted. On 3e0c846: plain **"Live"** at 20.6 s with the displayed image at naturalWidth 0, no fault. |
| R2 (P1) retained corrupt media with an old "decodable" flag | A data directory shaped like the 7ee-era state: gallery art-1 = the 33-byte header-only PNG (SHA-256 `32744d63…b110b`, the same file as Codex's) stored with `decodable:true, probed:true, width:0, height:0`. On 3e0c846: review **200**, publish **200**, go live **200** → `on_air`. |
| R3 (P1/N04) rejection during the Starting countdown | Server: publish → go live with a 5 s countdown → reject the gallery 4,920 ms before `onAirAt` (injected clock) → broadcast stays `on_air`, audit `rejected_on_air`, the publication starts. Browser (`tests/browser/countdown-reject.mjs`, board Go live + board Reject during "Starting"): the viewer turns **Live** after the scheduled start. |

## Root causes and fixes

**R1 — the player judged the screen by the preload.** Image health was cached per URL from a separate preload `Image` (`checkImage`); the element actually on screen made its own fetch, and its failure was never observed.
- The displayed element is now the authority (`showImage` / `displayedStatus` in `dist/broadcast/broadcast.js`): every assignment is judged by that element's own `decode()` result, bounded (pending > 1.5 s → "Live · artwork loading"; failed, or pending > 8 s → "Live · artwork unavailable", banner and credits card).
- A failed slide is retried automatically on the same page with the same approved URL (up to 3 times, every 2 s); the fault clears when the image decodes with pixels.
- The preload still counts, but only towards a fault: shown = display decoded; failed = display failed, or display pending while the preload failed (keeps the existing hung-image behaviour).

**R2 — stored verification flags were trusted without looking at the bytes.** Startup skipped any asset whose `decodable` was already set (including false positives from the old header-only check), and the domain trusted that Boolean at publication.
- A verification result is now a record bound to the check and the bytes: `verification: {method, sha256}`. The domain (`playable()` in `server/domain.mjs`) accepts an asset only if `decodable === true`, the record's SHA-256 equals the asset's, and the method is a current one (`ffmpeg-full-decode/2`, or `recorded-fingerprint/1` for shipped demo files when no decoder is present). Bare flags count for nothing.
- The domain enforces it at **approval** (`422 undecodable_media`), **publication** (`409 not_publishable`) and **Go live** (`422 undecodable_media`).
- The server (`verifyAssets` in `server/server.mjs`) re-reads and re-hashes the actual bytes of every asset at startup and before every approval, publication and Go live, then re-runs the full decode. Decode results are cached by content hash and extension (same bytes, same check, same answer). A missing file, or bytes that no longer match the fingerprint, are unplayable with that reason.
- When a stored "decodable" is overturned, the audit records `media_revalidated` with the asset and SHA-256. Nothing is deleted. The file, the media index and earlier manifests stay as they were (immutable evidence).
- Healthy legacy media are re-verified and keep working (control test: real 320 px width instead of the stored 0; review, publish and Go live 200).

**R3 — a scheduled start was treated as already on air.** Go live sets `on_air` with a future `onAirAt`, and the N04 withdrawal only handled `ready`.
- `withdrawIfPublished` now treats `on_air` with `now < onAirAt` (server clock) as **before air**. The rejection cancels the start: broadcast → `queued` with no manifest, withdrawal record with `cancelledStartAt`, audit `publication_withdrawn` ("cancelling its start in N s"). Go live with that publication returns 409 `withdrawn`, before and after restart. Replaying the old Go live idempotency key returns its recorded response and activates nothing.
- The boundary is decided by the single server clock inside the serialised mutation: 1 ms before `onAirAt` → withdrawn; at `onAirAt` → on-air rejection (playback continues; Stop broadcast unchanged).
- Board: the Reject prompt says "This cancels the start and withdraws the publication before air" during the countdown.
- **Residual (viewer projection):** a viewer learns of a withdrawal through SSE. If a rejection is processed within the SSE delivery delay before `onAirAt`, that viewer can show Live for at most that delay before switching to Off air. The server never starts the publication.

## Tests that changed (and why)

- `tests/broadcast/domain.test.mjs`: the "already verified" fixture now carries the verification record the server produces (`{method, sha256}`); bare `decodable:true` no longer counts.
- `tests/broadcast/regression-7ee7394.test.mjs`, "publication fails closed for any asset not positively verified": over HTTP the server now always checks the real bytes before publishing, so a deleted flag self-heals. The fail-closed rule is asserted on the domain directly, with four spoiled cases: no check ran, bare flag from an earlier check, a result for other bytes, an unknown check. Plus a control that publishes.

## New regression tests (each fails on 3e0c846)

| Test | On 3e0c846 | Now |
|---|---|---|
| `tests/broadcast/regression-3e0c846.test.mjs` (5 tests: R2 legacy corrupt, R2 bytes changed on disk, R2 healthy legacy control, R3 countdown + restart + replay, R3 boundary) | 0/5 | 5/5 |
| `tests/browser/art-display-fault.mjs` (`npm run test:art-display-fault`) | FAIL: plain "Live" at 20.6 s, naturalWidth 0 | PASS |
| `tests/browser/countdown-reject.mjs` (`npm run test:countdown-reject`) | FAIL: "a rejected publication must not begin when its countdown expires" | PASS |

## Results on the fix commit

All runs below are on the committed code (code fingerprint checked unchanged before and after the run), 2026-10-17 ~20:50–21:05 Tbilisi, Node 22.22.3, Chrome via Playwright 1.49.1, ffmpeg 8.1. Implementer evidence only.

| Command | Result |
|---|---|
| `npm test` | **50/50** broadcast (domain, HTTP, MCP, regression, withdrawal, regression-3e0c846) + **5/5** studio suites |
| `npm run test:browser` | PASS: three sessions, per-person approvals, r2 committed and published; producer rejection through the board withdrew #1 before air |
| `npm run test:board-lan` | PASS: plain-HTTP non-localhost origin, approvals, rejection, upload, review, publish, go live |
| `npm run test:audio-stall` | PASS: "interrupted" at 2.6 s, 3 bounded retries, "unavailable" at 8.1 s, recovery |
| `npm run test:art-fault` | PASS: corrupt and hung artworks shown as "Live · artwork unavailable" with banner and credits card |
| `npm run test:art-display-fault` (new, R1) | PASS: fault at every sample 20.6–25.5 s; 3 aborted display fetches of 5 requests; recovered to "Live" with the same approved image (1920 px) without reload |
| `npm run test:countdown-reject` (new, R3) | PASS: rejected through the board 4,609 ms before the scheduled start; viewer Off air, never Live through +3 s; board shows withdrawn; Go live 409 `withdrawn` |
| `npm run test:broadcast-browser` | PASS, onsets intro +7 ms, gallery +8, premiere +23, outro +20; Piper outro |
| `ECHO_SSE_DELAY_MS=1500 npm run test:broadcast-browser` | PASS, onsets +25 / +26 / +24 / +22 ms |
| `ECHO_HOST_VOICE=off npm run test:broadcast-browser` | PASS, onsets +15 / +14 / +13 / +12 ms; captions-only outro |
| `scripts/rehearse-series.sh <dir> 1` (real Claude Code + Codex over MCP) | **RUN CLEAN**: A proposed, B accepted 5 s in its own words ("conceding exactly the 5 seconds needed … respecting my owner's minimum"), A adapted to 45 s at 15/15/15, premiere still at 50 s, 120 s total, r2 published. **Approvals were issued by the script as stand-ins for the people.** |

Not covered here: the observed two-human rehearsal, venue/device access, physical sound and the recording. Codex's independent validation of this SHA is pending.
