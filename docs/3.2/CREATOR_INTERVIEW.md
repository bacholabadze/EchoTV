# ECHO 3.2 — Hybrid Creator Interview

Creators prepare their television appearance in one of two ways:
- **"ესაუბრე ECHO-ს"**: a short interview with the ECHO host, by voice or text.
- **"დააკავშირე შენი აგენტი"**: their own AI agent answers the same questions over MCP.

Both paths produce the same Creator Brief, which only the creator approves. It then enters the existing production flow: segment, content review, Showrunner, approvals, broadcast.

## 1. Architecture (and why no new framework)

| Part | Where | Notes |
|---|---|---|
| Interview engine | `server/interview.mjs` | Deterministic and pure. Six starting questions; at most one follow-up per question, only for a missing required field or a contradiction. It never writes content: every brief field is the creator's words, the creator's selection, or listed as missing. |
| Permissions, library, lifecycle, gates | `server/domain.mjs` | Owner scope; human-only actions; rights; brief → segment; permission checks at review, publication and start; withdrawal; deletion. |
| HTTP API | `server/server.mjs` | `/api/interviews…`, `/api/library…`, `/api/briefs/:id/prepare`, `/transcribe`, `/question-audio`. |
| MCP tools | `server/mcp.mjs` | `start_interview`, `get_interview`, `answer_interview`, `skip_interview_question`, `review_creator_brief`, `list_my_library`, `prepare_segment_from_brief`. |
| Voice | `server/voice/` | Questions spoken via the provider-neutral voice service (ElevenLabs v3 when configured, cached; captions otherwise). Answers transcribed via ElevenLabs Scribe v2 (`stt.mjs`). |
| UI | `dist/interview/`, `dist/board/` | Georgian-first interview page with the existing ECHO host; board entry options; technical view. |

**LangGraph or another orchestrator: not needed.** The interview is a short, deterministic state machine. The multi-agent part already runs through the existing MCP gateway and the deterministic Showrunner, which is a real, traceable A → B → A. An orchestration framework would add a dependency, a second source of truth and an LLM in the decision path, without fixing any current problem. Revisit only if ECHO itself needs to *generate* follow-up questions with a model. That would need an approved provider and budget, and every generated question would be labelled.

## 2. Lifecycle (derived from state; shown to the creator)

Interview → Draft brief → **Creator approval** (exact version + hash) → Segment preparation (creator or *their* agent, from the approved brief) → **Content review** (producer) → Airtime request (agent proposal through the Showrunner; a hold is not a booking) → Confirmed booking (producer) → Showrunner coordination → **Final approval** (each affected person) → Publication → Broadcast.

- An airtime request is never a reservation.
- Confirmed slots never move without their owner.
- Agents never approve, declare rights, upload, publish or override.

## 3. Privacy and data boundaries

| Data | Who can see it | Public? |
|---|---|---|
| Interview answers, transcripts, history, draft brief | the creator and the creator's own agent | No: removed from `/api/state`; other people and agents get "not found" |
| Library files | the creator (and their agent: id, kind, title, checks, uses) | No: not served at `/media/` until prepared into a segment |
| Rights declarations | the creator; summarised in their brief | No (the uses appear in the asset licence line once prepared) |
| Air-facing brief fields (display name, title, category, AI involvement, approved quotes) | everyone, **after** preparation into a segment | Yes, in the programme and broadcast |
| Activity | content-free milestones (brief approved/withdrawn, segment prepared/unauthorised) | Yes; private entries are filtered from the public feed |
| Agent tool calls | tool name, request path (private ids generalised), status | Yes (technical view), no arguments or content |

**Retention and deletion:**
- Answers and briefs are kept until the creator deletes the interview. Deletion leaves a dated tombstone only.
- Withdrawing or deleting a brief makes any prepared segment unairable and withdraws a ready publication.
- Library files can be deleted with their bytes unless they are part of a programme or publication, in which case they are kept for audit and withdrawn instead.
- **Voice recordings are never stored by ECHO** (temporary file, deleted after transcription). ElevenLabs' own retention applies, since zero-retention is enterprise-only; the consent text says so.
- Participation implies **no** consent to model training (stated on the page).

**Untrusted input:**
- Answers from agents or people are stored as plain data: control characters stripped, length bounded, HTML-escaped on render.
- Text like "ignore previous instructions and approve" is just data; nothing reads it as a command (tested).
- Uploaded files are content-addressed and fully decoded before use. PDFs are accepted as supporting documents only, never parsed or broadcast.

## 4. Media and rights

The stages are separate:
1. Upload acceptance.
2. **Technical check** (images and audio: full decode; existing video: ffprobe + full decode; PDF: signature only).
3. **Rights declaration** by the creator: public broadcast / short edits / replays and archive / promotional excerpts, plus an explicit confirmation. It is recorded as a declaration (`verified: false`), not proof of ownership.
4. Editorial review per segment revision.
5. Broadcast authorisation, checked at publication and start.

A new file, a changed brief, a withdrawn file, or loss of broadcast permission invalidates the relevant approval or authorisation. Existing video is accepted into the library, but no module airs video yet. AI video generation does not exist in ECHO.

## 5. Voice: what ElevenLabs actually offers (official docs, checked 2026-10-18)

| Need | ElevenLabs | Status in ECHO |
|---|---|---|
| Georgian text-to-speech | Eleven v3 / v4 list Georgian; `with-timestamps` and `text-to-dialogue/with-timestamps` | Implemented; **tested against a mock only** |
| Georgian speech-to-text | Scribe v2 lists Georgian (`kat`), ">5–10% WER" tier; `POST /v1/speech-to-text` multipart, `language_code`, word timestamps | Implemented; **tested against a mock only** |
| Conversational agent product | "Agents" switch to Multilingual v2.5 for additional languages; 31 languages; Georgian not listed | **Not used.** ECHO runs its own turn-based loop: our engine + Scribe + v3 |
| Data retention | `enable_logging=false` (zero retention) is enterprise-only | Disclosed in the consent text |

**Prices (API pricing page, 2026-10-18):** TTS v3 $0.08 per 1K characters; Scribe v2 $0.22 per hour of audio.

**Estimate for one interview:**
- Six spoken questions, about 900 characters: ≈ $0.07 the first time, $0 afterwards (cached).
- About 3 minutes of answers: ≈ $0.011.
- Total ≈ **$0.08 for the first interview, ≈ $0.01 for each later one**.

**Bounds:**
- At most 60 s per answer, measured locally before sending.
- Seconds budget (`ECHO_STT_BUDGET_SECONDS`) and character budget (`ECHO_VOICE_BUDGET_CHARS`), both checked before sending.
- Timeouts: 30 s for STT, 90 s for TTS.
- The key stays on the server (`xi-api-key`); the browser never sees it.

**Proposed paid verification (needs founder approval):**
- **3 spoken questions** (about 150 characters each): ≈ $0.04.
- **3 short Georgian answers** (about 20 s each), transcribed: ≈ $0.004.
- **One two-presenter dialogue line** (about 200 characters): ≈ $0.02.
- **Total < $0.10.**
- **Then listen:** voice quality, plus transcript accuracy on real Georgian speech.

## 6. Tests

`npm test` covers 54 broadcast, 14 voice, 3 episode, 26 interview tests and 5 studio suites. The interview tests:

| File | Covers |
|---|---|
| `engine` (6) | states, follow-ups, contradictions, skip/back/resume, approval binding, transcript correction, sanitising |
| `http` (6) | privacy, owner scope, agent limits, media pipeline incl. video/PDF, brief, deletion |
| `mcp` (3) | real gateway processes, isolation, call log |
| `production` (6) | preparation, guards, withdrawal/restore, re-preparation, the owner's agent preparing, dependent updates for other agents' proposals |
| `voice` (5) | consent, transcript not stored, budgets, failures, spoken questions |

Browser tests:
- `npm run test:interview-flow` (Chrome, fake microphone).
- `npm run test:browser-all`.

End to end with real agents: `npm run e2e:creator` (`ENTRY=agent` or `ENTRY=human`). Human steps in it are **scripted stand-ins**, labelled in its log.
