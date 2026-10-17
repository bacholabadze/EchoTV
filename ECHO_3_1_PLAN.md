# ECHO TV 3.1 — audit and implementation plan

Branch `echo-3.1`. Baseline commit `c7eb068` holds the unmodified ZIP source (plus `.gitignore`), separating pre-hackathon work from new work (Master Plan §2, §18.10).

## 1. Audit — what exists and is verified (2026-10-17)

| Area | Finding | Evidence |
|---|---|---|
| Source | `echo-stage/` matches the ZIP (98 files). Static site in `dist/`, hosted as static Sites (`.openai/hosting.json`). No backend, package.json, build step or server. | `unzip -l`, file tree |
| Channel | `/` home, `/shows/the-table/`, `/channel/about.html`, `catalog.json` (1 show, 1 episode). Static, truthful labels. | Headless Chrome screenshots |
| Studio player `/studio/` | Three.js r170 (vendored), 3 styled actors from one CC0 MPFB base, room, auto camera director, captions, transport. **Renders and plays in real Chrome**: reached turn 6, shots cut wide→nova→atlas→two, ~139k tris, 57–103 draw calls. Only 404 is `/favicon.ico`. | Playwright + Chrome, `EchoStudio.getState()` |
| Voice | Studio: 10 prerecorded MP3s, offline Piper `en_US-ljspeech-high`, one shared voice, alignment-derived viseme cues. Current prototype: browser `speechSynthesis`. No live TTS, no LLM, no network APIs. Piper is **not installed** on this machine. | `audio/ATTRIBUTION.txt`, grep |
| Provider seam | `core.js` `MockAdapter` emits turn/timing/cancel events; renderer is provider-neutral. `Director` is event-driven. Reusable as is. | Code read |
| Tests | 5 suites pass: transport, expressions, rig, nova-study, materials. `studio-materials` needs `--experimental-loader=./tests/three-loader.mjs` (undocumented). | Local runs |
| Legacy | `/current.html`, `/original.html`, `/lab/`: localStorage prototype, illustrative credits/polls. Not part of the broadcast. | Code read |
| Missing for 3.1 | Identities, agents, shared broadcast state, bookings, revisions, proposals, Showrunner, approvals, Production Board, manifest, Art/Music modules, synced playout. **None exists.** | — |

Reusable as is: room/actors/materials/blocking/performance, `Director`, `captionAt`, `MockAdapter` event contract, transport UI patterns, channel CSS/design language, Piper attribution practice, test style.

## 2. Conflicts between roadmap and Master Plan, and how they are resolved

1. **Sequencing.** The roadmap defers multi-format, continuous playback and agents/providers to Waves 4–6, after viewer gates. Master Plan v3.1 (17 Oct) requires multi-agent collaboration on a live broadcast now. → The Master Plan governs the hackathon build. The roadmap's honesty limits still apply.
2. **Positioning.** Roadmap: "AI character channel; The Table is the first show". Master Plan: "Many creators. Many agents. One shared broadcast." → The Table stays as ECHO's house Talk Studio show. The channel adds the shared broadcast and its Production Board. Nothing is removed.
3. **Static-only architecture.** The roadmap allows no backend, credentials or scheduled jobs. The Master Plan needs a deterministic backend, identities and an agent gateway. → Add a small local Node server. Discovery pages stay static. **The static Sites host cannot run the server**, so the demo runs locally (a public link would need a tunnel; decision pending).
4. **"Never pretend a repeated pilot is live."** → The broadcast is live playout of an approved manifest. Its segments are clearly labelled prerecorded/uploaded media. Recordings are never presented as live coordination.
5. **Viewer gate before a second format** (Wave 3, 3/5 viewers). Master Plan approves multi-genre programming. → Art and Music are modules inside one demo episode, not new public shows in the catalogue. The viewer research gate stays Bacho's call.
6. **"No new features or dashboards until character art passes"** (STUDIO_NEXT_STEPS). Master Plan makes the Production Board mandatory. → Board is built and character-art work is frozen for the hackathon.
7. **Episode length.** Roadmap episodes are 60–90 s. The Master Plan demo is 120 s. → 120 s demo programme. No conflict for The Table.
8. **Unresolved (human):** prior-code eligibility and video spec (§2, §28.1) need written organiser answers. The validator report referenced at `/mnt/data/...` is not available here.

## 3. Architecture (minimal, free, local)

- `server/domain.mjs`: pure, deterministic core. Three separate state machines: Booking (`available/held/confirmed/released`), Segment (`draft/submitted/approved/needs_changes/rejected`) and Broadcast (`queued/ready/on_air/completed/failed`). Also show revisions with `baseRevision` checks, change proposals, conflict detection, the Showrunner solver (time arithmetic and fixed-slot protection only), approvals bound to `segment revision + media sha256`, and the publish manifest. No LLM in this layer (§23.5).
- `server/server.mjs`: `node:http`, no framework. One process serialises every mutation. State is persisted atomically to `data/state.json` plus an append-only audit log. SSE pushes live updates to the board and viewers. Role tokens are kept separate for creators, agents, producer and viewer.
- `server/mcp.mjs`: MCP stdio gateway (official `@modelcontextprotocol/sdk`, MIT). Each agent runs its own gateway process with its own agent token. Planned tools: `get_show_state`, `get_schedule`, `propose_change`, `wait_for_requests`, `respond_to_request`, `get_change_history`, `get_review_feedback`. No `force_broadcast`, `approve_own_content` or `override_confirmed_booking` exist.
- **Agents = bring your own agent.** Creator A connects Claude Code and Creator B connects Codex (both already installed, no new paid service). Each human gives their agent their own policy in plain language. The server enforces bounds whatever the agent says. A clearly labelled rule-based fallback agent covers agent or network failure (§25).
- `dist/board/`: live Production Board. Per-creator login, timeline with locked confirmed slots, requests and responses between agents, diffs, approvals, publish revision, broadcast status.
- `dist/broadcast/`: renderer that plays the published manifest. It reuses the studio room and actors for host intro/outro, plus an Art Gallery module and a Music Premiere module (audio and visualiser, no video generation). The server clock syncs viewers and supports reconnect. The manifest revision shown on screen must match the board.

## 4. Milestones (each with commit + test evidence)

| # | Milestone | Acceptance evidence |
|---|---|---|
| M0 | Baseline repo, plan, `npm test` runs all existing suites | All legacy suites pass via one command |
| M1 | Deterministic broadcast core | Unit tests: §24 scenario resolves to 120 s with premiere at 50 s; NO AGREEMENT leaves last valid revision; stale `baseRevision` rejected; fixed slot never moves without owner consent; stale approval invalid after media hash change; agent cannot approve own content |
| M2 | HTTP server, persistence, SSE, auth | HTTP tests: concurrent double-confirm → exactly one succeeds; role separation; restart preserves state |
| M3 | MCP agent gateway + fallback agent | Real MCP client spawns two gateways with different tokens and runs A→B→A end to end over MCP |
| M4 | Production Board | Browser test: two creator sessions see the same live state; screenshots |
| M5 | Broadcast renderer | Browser test: published manifest plays Intro → Art → Music → Outro; on-screen revision = board revision; two viewers in sync; reconnect |
| M6 | Real-agent rehearsal ×3, honest channel copy, recording guide | Logs of three clean runs with Claude Code + Codex; uncut screen recording plan |

## 5. Decisions taken (defaults, reversible) and still open

- **Demo media (default taken):** curated public-domain artworks (The Met, CC0, credited to the original artists) and a track synthesised in code (CC0). They are labelled as rehearsal media in `media/ATTRIBUTION.md`. **Open:** the real creators upload their own work from the board before the recording.
- **Host voice (done):** Piper 1.8.0 + `en_US-ljspeech-high` installed locally (free, offline). House lines are written from the approved programme by a template (no LLM) and voiced at publish time. Captions-only fallback.
- **Public link (open):** demo runs on a local or LAN server. Static Sites hosting cannot run it.
- **Organiser answers (open, human):** prior-code eligibility; video spec.

## 6. Status

| # | Status | Evidence |
|---|---|---|
| M0 | done | `npm run test:studio` 5/5 |
| M1 | done | domain tests |
| M2 | done | HTTP tests (race, roles, restart, SSE) |
| M3 | done | MCP tests + `docs/evidence/2026-10-17-rehearsal-2-real-agents.md` (real Claude Code + Codex) |
| M4 | done | `npm run test:browser` + board screenshots |
| M5 | done | `npm run test:broadcast-browser` (full 2-min playout, two viewers, reconnect, audio sync, Piper outro) |
| M6 | done (engineering) | `docs/evidence/2026-10-17-real-agent-series.md`: 3/3 consecutive clean real-agent runs + partial and NO AGREEMENT variants; `DEMO_RUNBOOK.md`. Human tasks remain: real names and media, organiser answers, recording |
