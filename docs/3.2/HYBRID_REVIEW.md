# ECHO 3.2 Hybrid Creator Interview — review handoff

**Branch:** `echo-3.2` (worktree `echo-stage-3.2`). **Base:** QA-passed 3.1 `d0f4bd2`, which is untouched.

**Milestones:**

| Milestone | Commit | What |
|---|---|---|
| I1 | `eaef1df` | interview engine |
| I2 | `cd2ddaf` | private library, media, rights, HTTP |
| I3 | `0061323` | MCP interview tools, agent call log |
| I4 | `8a98def` | brief → segment, rights gates |
| I5 | `122800a` | spoken interview back end |
| I6 | `fce1687` | interview page, board entries, technical view |
| I7 | `bbadac7` | agent preparation, deletion, e2e |
| I8 | the commit that adds `tests/interview/hardening.test.mjs` | audit fixes |

## 1. Independent audit findings and fixes (I8)

Another session audited I1–I5 and left `docs/3.2/HYBRID_AUDIT_2026-10-18.md` and `HYBRID_IMPLEMENTATION.md` (untracked, not mine, not modified). I reproduced each finding with my own test before fixing it. All 8 tests in `tests/interview/hardening.test.mjs` **fail on `bbadac7`** and pass after the fix.

| # | Finding (audit) | Fix |
|---|---|---|
| H1 (P1) | Trimming without the "editing" permission | A file that airs only in part (offset > 0, or longer than its slot by > 0.5 s) needs `editing`. Checked at preparation, review, publication and start |
| H2 (P0) | A brief corrected during the countdown still airs | An approved brief that stops being approved (correction, quotes, rights change) makes its segments unauthorised and withdraws a ready or counting-down publication (N04 path). Activation is then refused |
| H3 (P1) | A changed rights declaration doesn't invalidate the approved brief | Any change to a file's declared uses rebuilds the brief from the current declarations. A content change voids the approval, so it must be re-approved and the segment re-prepared |
| H4 (P2) | An answer's text can't be explicitly cleared | `clear: true` (MCP `clearText`; the UI sends it when a creator empties a previous answer). An empty follow-up still keeps earlier words |
| H5 (P1) | Concurrent paid calls can exceed the budget | `ledger.reserve()` checks and charges synchronously **before** sending. Failed paid calls still count (conservative). Identical concurrent requests share one render. Speech-to-text uses the same reservation |
| (audit) | Spoken questions could be paid for by an agent or without consent | Only for the creator, after voice consent; otherwise captions only and no provider call |
| (audit) | Transcripts cached by the retry layer | `/transcribe` responses are never stored for idempotent replay |
| (audit) | Prepared library files public before publication | Private (owner + producer) until the file is in a publication |
| (audit) | Rehearsal reset dropped interviews and libraries | Kept across resets; ids keep counting |
| (audit) | MCP agent could not prepare | Added in I7: `prepare_segment_from_brief`, owner's agent only, from the approved brief, result needs review |
| (audit) | No deletion or retention policy | Added in I7 (see `CREATOR_INTERVIEW.md` §3) |
| (audit) | PDF "validation" | Labelled as a signature check only; never parsed, never broadcast |
| (audit) | Board jargon | **Partly addressed** (guided strip in plain Georgian); the detailed panels are unchanged |

## 2. Instructions for Codex (independent review)

Review the exact SHA handed over, in a separate checkout. Do not use `echo-stage` (3.1) or port 8787.

```bash
git checkout --detach <SHA>; npm ci
npm test                       # broadcast + voice + episode + interview + studio
npm run test:browser-all       # 11 Chrome tests incl. interview-flow and guided-flow
ECHO_SSE_DELAY_MS=1500 npm run test:broadcast-browser; ECHO_HOST_VOICE=off npm run test:broadcast-browser
ENTRY=agent npm run e2e:creator   # real Codex + Claude Code; human steps are labelled scripted stand-ins
ENTRY=human npm run e2e:creator
```

Suggested adversarial checks:
- **Privacy:** any interview text, library item or private audit line reachable without the owner's token (`/api/state`, SSE, `/media/<sha>` before publication, the technical view, the retry cache, logs).
- **Scope:** another creator, another creator's agent, or the producer reading, answering or preparing someone's interview.
- **Authority:**
  - an agent approving a brief, declaring rights, uploading, reviewing, publishing or deleting;
  - an approval replayed after any change;
  - text instructions inside answers.
- **Rights:**
  - trimming without `editing`;
  - a changed declaration not invalidating the brief;
  - a withdrawn file or brief still airing, including during the countdown and with delayed SSE.
- **Cost:**
  - paid calls without key + budget;
  - concurrent overspend;
  - a paid call made without consent;
  - recordings over 60 s.
- **Failure:** STT/TTS errors, timeouts, an undecodable provider response, the text fallback.
- **UI:** Georgian rendering, labels, mobile 390 px, no fake success (every state change comes from a server response).

## 3. Demonstration

1. Start a 3.2 server on port 8790 with its own data: `cd echo-stage-3.2 && PORT=8790 ECHO_DATA_DIR=data node server/server.mjs`. Never 8787.
2. Creator (Keti) opens her board link → **ესაუბრე ECHO-ს** → answers by text, or by voice only if a speech budget and key are configured. Uploads her track, declares its uses, reviews, chooses quotes, approves, then prepares her premiere.
   - Or: **დააკავშირე შენი აგენტი** → her agent (Codex via `data/demo/agent-b.sh` adapted to port 8790) runs the interview tools. She then reviews and approves on the interview page.
3. Producer: opens the **Technical view** (agent tool calls, approvals), reviews the prepared premiere.
4. Bacho's agent asks for more gallery time. The Showrunner keeps the confirmed premiere at 0:50 and Keti's agent concedes. Each person approves in their own window; the producer publishes and goes live.
5. The broadcast shows the premiere with Keti's approved display name, title and AI disclosure.

**Labels to keep honest:** test media is a synthesised tone. Without an ElevenLabs key the interviewer speaks in captions only. Automated runs use scripted stand-ins for people.

## 4. Not verified / not built

- **No real ElevenLabs call has been made:** Georgian TTS quality, Georgian STT accuracy and real latency are unverified.
- **Two-presenter studio direction (M4):** not built.
- **Video playout module:** none (existing video is accepted into the library only).
- **Per-test paid scope:** only global budgets exist. An "exact approved test scope" is a founder decision.
- **Agent clients beyond Claude Code and Codex** (Gemini CLI, Cursor): not tested in this wave.
- **Human participation:** no person has used the interview yet. All automated approvals are stand-ins.
