# ECHO 3.2 — Georgian Television: integration design

**Status:** design only, approved in direction by the founder on 2026-10-17. **No application code has been written and no paid API call has been made.** It is kept outside the repo, so release candidate `3e0c846` and the `echo-3.1` branch stay untouched while Codex runs QA. It becomes the first commit on `echo-3.2` once the 3.1 submission is secured.

**Priorities (founder, in order):** A. ElevenLabs Georgian voices · B. ECHO Premiere #001 produced through real MCP agent contributions · C. Provider-independent MCP compatibility (Gemini CLI, Cursor and others).

**Unchanged:** the ECHO TV vision ("Many creators. Many agents. One shared broadcast."), the studio, booking engine, Showrunner, Production Board, revision- and hash-bound approvals, N04 withdrawal policy, no AI video generation. Nothing that works is rewritten; 3.2 adds beside it.

---

## 1. Facts, checked on 2026-10-17 (and what is still unverified)

| Topic | Verified | Source | Still to verify (by test, after approval) |
|---|---|---|---|
| ElevenLabs Georgian | Georgian (`ka`) is listed for **Eleven v3**, **Eleven v3 Conversational**, **Eleven v4**, **Eleven v4 Turbo**. **Not** in Multilingual v2 (29 langs) or Flash v2.5 (32). Char limits: v3 5,000, v4 10,000 per request. | elevenlabs.io/docs/overview/models | Pronunciation quality of real Georgian scripts; which voices sound natural in Georgian |
| Single-voice timestamps | `POST /v1/text-to-speech/{voice_id}/with-timestamps` returns `audio_base64` + character-level `alignment` and `normalized_alignment`. Body: `text`, `model_id`, `language_code`, `seed` (best effort), `previous_text`/`next_text`, `voice_settings`. | elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps | **Whether v3/v4 return alignment for Georgian** (docs do not say per model) |
| Two-voice dialogue | `POST /v1/text-to-dialogue/with-timestamps`: `inputs[{text, voice_id}]` (≤10 voices), default `model_id` `eleven_v3`, `language_code`, `seed`; response has `audio_base64`, `alignment` and `voice_segments[{voice_id, start/end_time_seconds, character_start/end_index, dialogue_input_index}]`. Docs recommend ≤2,000 chars per request. | elevenlabs.io/docs/api-reference/text-to-dialogue/convert-with-timestamps.md | Same as above for Georgian |
| Output format | Default `mp3_44100_128`; higher bitrates / PCM depend on plan tier. | same | Account plan, price per character, licence terms for broadcast use on that plan |
| Piper Georgian | A `ka_GE` voice folder **`natia`** exists in `rhasspy/piper-voices`. | huggingface.co/rhasspy/piper-voices/tree/main/ka/ka_GE | Quality level, licence of the training data, whether alignment works with piper-tts 1.8.0 |
| Gemini CLI | **0.24.0 installed.** Has `gemini mcp add/remove/list`, `--allowed-mcp-server-names`, `--allowed-tools`, `--approval-mode`, `-o json/stream-json`. | `gemini --help` (local) | Project-scoped `.gemini/settings.json` format in this version; how to exclude built-in shell/file tools; sign-in |
| Cursor | **Cursor.app installed; no `cursor-agent` CLI.** Project MCP config `.cursor/mcp.json`, `{"mcpServers": {"echo": {"type": "stdio", "command", "args", "env"}}}`, `${env:NAME}` interpolation, `envFile` supported. | cursor.com/docs/context/mcp | CLI MCP support (undocumented); GUI run needs a human |
| Others on this Mac | Claude Code 2.1.302, Codex CLI 0.160.1 (both already verified in 3.1). Not installed: opencode, goose, aider, VS Code. | local | — |

Rule carried over: **a client is "compatible" only after a recorded test on a named version.** Anything else is "expected (stdio MCP), untested".

## 2. Isolation and branching

- Created **only after the 3.1 submission is secured** (Codex PASS, rehearsal and recording done, `echo-3.1-submission` tag + bundle):
  `git worktree add ../echo-stage-3.2 -b echo-3.2 <accepted 3.1 SHA>`.
- Own `node_modules`, own `data/` (git-ignored, so separate tokens and state), own port **8790**. Port 8787 stays the 3.1 demo. `echo-stage-qa` is never touched.
- `echo-3.1` receives only fixes for blockers Codex confirms, which are merged **forward** into `echo-3.2`. Nothing flows back.
- ElevenLabs key: environment variable or `data/secrets/elevenlabs.key` (mode 600, git-ignored). Never printed, logged, committed or sent to an agent.

## 3. A — Provider-neutral voice service

### 3.1 Interface (`server/voice/index.mjs`)

```js
// One call per spoken unit. Pure data in, files + timing out. No provider details leak to callers.
synthesize({lines: [{id, presenter, text}], lang: 'ka' | 'en', mode: 'single' | 'dialogue'})
  → {audio: '/voice/<sha256>.mp3', sha256, duration,
     captions: [{start, end, text, presenter}],      // phrase-level, for the caption track
     cues:     [{start, end, key, presenter}],       // viseme keys the studio rig already uses
     turns:    [{presenter, start, end}],            // who speaks when (drives camera + blocking)
     provenance: {provider, model, voiceIds, requestIds, chars, cacheHit, at}}
```

Presenters are configuration: `presenters.json` maps `presenter id → {name, castActor, voices: {elevenlabs: <voice_id>, piper: <model>}}`. At least two Georgian presenters (founder chooses the voices after the listening test, §7 M3).

### 3.2 Providers (`server/voice/providers/*.mjs`)

| Provider | What it wraps | Notes |
|---|---|---|
| `piper` | existing `tools/host-voice.py` unchanged | M1 proves byte-identical output for the current English outro/interstitial |
| `elevenlabs` | direct `fetch` to the two `with-timestamps` endpoints | No SDK dependency. `ELEVENLABS_BASE_URL` override so tests hit a local mock |
| `captions` | no audio | timing estimated from text length, labelled "captions only" (as today) |

**Fallback chain**, decided per line, always shown on the board and in the lower third: ElevenLabs → cache → Piper (Georgian `natia` if it passes M3, otherwise captions for Georgian lines) → captions only. The broadcast never shows a voice label that is not the voice actually playing.

### 3.3 Cache

- Key = `sha256(provider | model | voiceIds | settings | lang | seed | normalised text)`. Files: `data/voice-cache/<key>.mp3` + `<key>.json` (timing + provenance).
- A cache hit makes no network call. Regenerating identical text never pays twice.
- The served audio is content-addressed by **audio bytes** (`sha256`), like every other ECHO media file, and recorded in the append-only media index.

### 3.4 Cost guard (no surprise spend)

- Provider is **off** unless both an API key and `ECHO_VOICE_BUDGET_CHARS` are set.
- `scripts/voice-estimate.mjs <programme>`: dry run, prints characters per line, cache hits, chars that would be billed. No network.
- A persistent ledger `data/voice-ledger.json` counts billed characters; a call that would exceed the budget is refused before it is sent.
- Every paid call is written to the audit log: actor, line ids, model, voice ids, characters, ElevenLabs request id.
- **Renders only happen after a human has approved the script text** (§4.3), so rejected drafts cost nothing.
- Automated tests use the mock server only; CI-style runs can never make a paid call.

### 3.5 Georgian timing, captions and lip-sync

- Captions: group the character `alignment` into words, then into caption phrases (≤ ~42 chars, break at punctuation). Georgian Mkhedruli has no case, so no case logic.
- Visemes: Georgian spelling is close to phonemic, so letters map directly to the rig's existing keys. Approximate, like the Piper mapping, and labelled as such:

| Rig key | Georgian letters |
|---|---|
| `aa` / `E` / `I` / `O` / `U` | ა / ე / ი / ო / უ |
| `PP` | ბ პ ფ მ |
| `FF` | ვ |
| `DD` | დ ტ თ |
| `nn` | ნ ლ |
| `SS` | ს ზ ც ძ წ |
| `CH` | შ ჟ ჩ ჯ ჭ |
| `kk` | კ ქ გ ყ ღ ხ ჰ |
| `RR` | რ |

- Two presenters: dialogue mode returns `voice_segments`, which become `turns`. The broadcast reuses the studio's Director/blocking and performance modules (as The Table pilot does) to cut to whoever is speaking; the other presenter gets listening behaviour. No new rig work.
- Georgian font for captions, lower thirds and slates: bundled Noto Sans Georgian (OFL), served locally, no CDN.

### 3.6 Files touched (A)

New: `server/voice/index.mjs`, `server/voice/cache.mjs`, `server/voice/providers/{piper,elevenlabs,captions}.mjs`, `server/voice/georgian.mjs`, `scripts/voice-estimate.mjs`, `tests/voice/*.test.mjs`, `tests/voice/mock-elevenlabs.mjs`.
Changed (small): `server/server.mjs` `hostVoice()` calls the service instead of spawning Piper directly; `dist/broadcast/broadcast.js` `playHost` accepts `turns` and two actors.

## 4. B — ECHO Premiere #001

### 4.1 Running order (proposal; durations are the founder's call)

| # | Segment | Module | Owner (human) | Written by (agent) | Approves |
|---|---|---|---|---|---|
| 1 | Georgian presenter introduction | `talk` (2 presenters) | Producer | house writer agent (producer's) | Producer |
| 2 | Creator art showcase, with presenter voice-over | `art` + `talk` lines | Creator A | Creator A's agent | Creator A, Producer |
| 3 | **Music premiere (confirmed slot)** | `music` | Creator B | Creator B's agent writes its intro line | Creator B, Producer |
| 4 | Short Georgian presenter discussion about both works | `talk` (2 presenters) | Producer | **both creators' agents contribute lines about their own work**; house writer agent joins them | A, B, Producer |
| 5 | Closing | `talk` | Producer | house writer agent | Producer |

- Content rule: presenters talk about the works, the creators and the process. **No factual news claims** (the News/sources module does not exist yet). Anything that sounds factual is cut or labelled opinion.
- Media: real art and real music from real creators, rights declared at upload. No AI video. The studio is real-time 3D, as in 3.1.

### 4.2 New pieces in the domain (additive)

- Module `talk`: `content = {presenters: [...], scriptAssetId, voiceAssetId}`.
- Asset kind `script`: UTF-8 Georgian text, stored and hashed like any media file. The existing approval rule (`segment revision + sorted asset hashes`) then covers **the exact words and the exact audio** with no new approval mechanism.
- Script lines carry attribution: `{presenter, text, authorAgentId, ownerId}`. A line may only be written by an agent whose owner owns the segment, or for the shared discussion, only about that owner's own work. The server enforces this; the agent's claims do not.
- A `premiere-001` seed next to the existing §24 seed. The 3.1 seed and its tests stay as they are.

### 4.3 Flow (every step traceable on the board)

1. Agent calls **`propose_script`** (new MCP tool) with lines for its segment. Board shows the script, author agent and a diff against the previous version.
2. Owner(s) **approve the text** on their own board (humans only, as today).
3. Server renders the voice (A), within budget, after text approval only. Audio becomes the segment's `voice` asset; the segment revision bumps.
4. Owners and producer **listen and approve** the rendered revision. The approval binds script hash + audio hash.
5. Any later edit (text or re-render) voids those approvals, exactly like a media change in 3.1. N04 withdrawal applies unchanged.
6. Producer publishes; the manifest lists every line's author agent, owner, approver, model and voice. The broadcast credits "Georgian voices: ElevenLabs (synthetic)" per ElevenLabs' attribution terms for the plan used.

New MCP tools: `propose_script`, `revise_script`, `get_script_feedback`. Still no tool to approve, publish, render on demand or override.

## 5. C — Open agent ecosystem

### 5.1 Gateway changes (small)

- Record the client's **self-reported** MCP `clientInfo` (name + version, from the initialize handshake) and send it alongside the launcher label. The board shows e.g. "Gemini CLI 0.24.0 (reported by client)". Identity and permissions still come **only** from the agent token.
- Keep stdio as the supported transport. A Streamable HTTP transport (for remote-only clients) is out of scope until public hosting is decided.

### 5.2 Per-client launchers (never edit global configs)

Each agent gets its own folder `data/demo/agent-<x>/` (mode 700) holding only its config, so no client reads the repo or the other agent's token.

| Client | Launch | Restriction to ECHO tools |
|---|---|---|
| Claude Code | existing `agent-a.sh` (`--mcp-config … --strict-mcp-config --allowedTools "mcp__echo__*"`) | verified in 3.1 |
| Codex CLI | existing `agent-b.sh` | verified in 3.1 |
| Gemini CLI | `cd data/demo/agent-g && gemini --allowed-mcp-server-names echo …` with project `.gemini/settings.json` | **to verify:** excluding built-in shell/file tools in 0.24.0 |
| Cursor (GUI) | open `data/demo/agent-c/` as a workspace containing only `.cursor/mcp.json` (`type: stdio`, token via `envFile`) | Cursor Agent tool allow-list in the GUI; human-run |

### 5.3 Test protocol (per client, per version)

1. Connects; lists exactly the ECHO tools; `get_show_state` works.
2. Plays role **A** against a different real agent as B, then role **B**: full A → B → A, approvals by humans (or, labelled, by a script).
3. Negative: no approve/publish tool exists; direct API approve with its token returns 403; it cannot act on the other creator's segment.
4. Evidence file `docs/evidence/clients/<client>-<version>-<date>.md`: version, model used, transcript excerpt, board screenshot, verdict.

Compatibility table levels: **Verified** (full A→B→A on that version) · **Partial** (connects/uses tools, negotiation incomplete) · **Untested**. No "works with any MCP client" wording.

## 6. Dependencies

```
3.1 secured ─► M0 worktree ─► M1 Piper behind interface ─► M2 ElevenLabs provider + cache + guard (mock)
                                                               │
                                          founder: key + budget ┘─► M3 live verification (2–3 calls)
                                                                       │
                                     M4 Georgian captions/visemes + 2-presenter playout
                                                                       │
                                     M5 talk module + script assets + script MCP tools
                                                                       │
                                     M6 Premiere #001 produced with real agents and humans
M0 ─► C1 clientInfo + Gemini/Cursor launchers ─► C2 client test matrix   (parallel to M1–M5)
All ─► M7 Codex independent acceptance on exact SHAs
```

## 7. Milestones and acceptance (each = one commit + evidence)

| # | Milestone | Acceptance (implementer); Codex re-runs independently |
|---|---|---|
| M0 | Worktree `echo-3.2`, port 8790, baseline | `npm test` 45/45 + 5/5 on the branch point |
| M1 | Piper behind the voice interface | For the §24 programme, publish output (cues, captions, duration; audio bytes if Piper proves deterministic run-to-run, otherwise within a measured tolerance) matches the old code path on the same machine; all 3.1 tests pass |
| M2 | ElevenLabs provider, cache, budget guard | Mock-server tests: alignment → captions/cues/turns; cache hit = 0 calls; over-budget refused before send; key never in logs/state/SSE; timeout and 4xx/5xx fall back with a visible label |
| M3 | **Paid; needs founder approval** verification | `voice-estimate` shown first. 2–3 short Georgian calls: v3 vs v4, single vs dialogue, alignment present? Founder picks two presenter voices by ear. Results and spend recorded |
| M4 | Georgian timing + two presenters on air | Browser test: caption phrases track audio (≤150 ms), speaker turns cut to the right actor, Georgian glyphs render, fallback paths labelled |
| M5 | `talk` module, `script` assets, script tools | Domain/HTTP/MCP tests: only owners' agents can script their segments; text approval before render; edit voids approvals; manifest attribution; agents cannot approve (403) |
| M6 | Premiere #001 | Real creators' media; real agents write lines; humans approve on their own boards; full playout; uncut recording + SHA |
| C1 | Client identity + launchers | MCP test asserts recorded `clientInfo`; launcher files never touch `~/.gemini`, `~/.cursor`, `~/.claude`, `~/.codex` |
| C2 | Client matrix | One evidence file per client/version; table updated only from evidence |
| M7 | Independent acceptance | Codex gets each SHA + this table; "pass" only from Codex's report |

## 8. Coordination with Codex

- Hand over **exact SHAs** with a written acceptance list per milestone; never "latest".
- Codex's findings are reproduced independently, fixed minimally, and each fix gets a regression test that fails on the previous SHA.
- Implementer test results and independent verdicts are recorded in separate columns, as in 3.1.

## 9. Decisions needed from the founder before 3.2 code starts

1. ElevenLabs account, plan tier and a **character/currency budget cap**; confirmation that the plan's licence allows broadcast use and what attribution it requires.
2. Who supplies Premiere #001's art and music, and the creators' names.
3. Presenter names and personalities (two minimum), and final voice choice after M3.
4. Approval to download the free Piper `ka_GE-natia` voice for the offline fallback.
5. Who signs in to Gemini CLI for the test, and who runs the Cursor GUI test.

## 10. Risks

- **Georgian quality** of synthetic voices may be uneven → M3 listening test before any production render; Piper `natia` or captions-only as a labelled fallback.
- **Timestamps may not be returned for v3/v4 Georgian** → fallback: forced timing from text length + audio duration (labelled "approximate"), or ElevenLabs' separate forced-alignment product if it supports Georgian (unverified).
- **Cost overrun** → ledger + hard cap + render-after-approval + cache.
- **Client drift** (Gemini/Cursor versions change MCP behaviour) → compatibility claims tied to exact versions and dates.
- **Scope creep before submission** → no 3.2 code until 3.1 is secured.
