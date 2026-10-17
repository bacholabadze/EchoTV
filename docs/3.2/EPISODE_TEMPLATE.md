# ECHO Premiere #001 — technical episode template (no creative content)

**Status:** structure, contracts and checks only. The founder supplies the ideas, Georgian copy direction and visual references. No script is written here.

- File: `episodes/premiere-001.template.json` (schema `echo.episode/1`).
- Check: `node scripts/check-episode.mjs episodes/premiere-001.template.json`. Today it reports "structure OK, 29 inputs still missing".

## 1. Running order (structure only)

| # | Segment | Module (exists today) | Owner | Lines written by (agent) | Approves |
|---|---|---|---|---|---|
| 1 | `intro`: Georgian presenter introduction | `host`, 2 presenters | Producer (house) | house agent (producer's) | Producer |
| 2 | `art-intro`: presenter line about the art | `host` | Creator (Art) | Art creator's agent | Art creator, producer |
| 3 | `art`: creator art showcase | `art` (gallery, credits) | Creator (Art) | (no speech) | Art creator, producer |
| 4 | `premiere-intro`: presenter line before the music | `host` | Creator (Music) | Music creator's agent | Music creator, producer |
| 5 | `premiere`: music premiere, **confirmed slot** | `music` (audio, visualiser) | Creator (Music) | (no speech) | Music creator, producer |
| 6 | `discussion`: short Georgian presenter discussion | `host`, 2 presenters | Producer (house) | house agent + both creators' agents, each only about its own creator's work | everyone affected |
| 7 | `closing` | `host` | Producer (house) | house agent | Producer |

**Why the presenter lines sit in separate host segments:** voice can only be attached to `host` segments today. A voice-over *during* the gallery or the music would need player work, so it is not in this template.

**No AI video:** the checker refuses video modules and video assets.

## 2. Asset requirements

| Asset | Who | Requirements (enforced today) |
|---|---|---|
| Artworks (`art`, 1–6 images) | Art creator uploads on their board | PNG/JPEG/WebP that fully decode; rights declared; title, credit, licence; approved as exact SHA-256 |
| Premiere track (`premiere`, 1 audio) | Music creator uploads | MP3/WAV/OGG/M4A that fully decode; length ≥ slot duration; rights declared; exact SHA-256 |
| Presenter voices (`voice` asset on each host segment) | Rendered by the segment's owner (house: producer) via `POST /api/segments/:id/voice` | Fully decoded; exact bytes approved; provider and model recorded; credited as synthetic |
| Presenter identities | Founder | names, which studio actor each one is, ElevenLabs voice id each (after the M3 listening test) |

## 3. Agent tool contracts (to implement in 3.2 milestone M5; not built yet)

These follow the existing MCP gateway rules: one token per agent; the server enforces ownership whatever the agent claims; no tool can approve, publish, render or override.

```ts
propose_script({segmentId: string, baseRevision: number,
  lines: Array<{presenter: string, text: string}>,   // Georgian text, ≤ segment spoken.maxChars
  note?: string})
  → {scriptId, version: 1, status: 'awaiting_owner'}
  // Refused: segment not owned by the agent's owner (house segments: only writers listed for it), unknown
  // presenter, over maxChars, stale baseRevision.

revise_script({scriptId: string, lines: [...], note?: string})
  → {scriptId, version: n + 1, status: 'awaiting_owner'}   // earlier text approvals are void

get_script_feedback({scriptId?: string})
  → {scripts: [{scriptId, segmentId, version, status, lines, feedback: [{by, note, at}]}]}

wait_for_requests(...)   // existing tool; also wakes on script feedback
```

**People (board, HTTP), not agents:**
1. Approve the text of an exact script version.
2. Render it (`POST /api/segments/:id/voice`, built), which creates the voice asset.
3. Listen and approve the audio (existing editorial review, bound to the audio's SHA-256).

**Traceability:** every line keeps `{writtenBy: agentId, ownerId, scriptId, version}`. The board shows a per-line diff between versions, and the manifest carries line attribution.

## 4. Runtime checks before production

| Check | How |
|---|---|
| Episode file complete and consistent | `node scripts/check-episode.mjs <filled episode>` → "ready for production" |
| Voice cost before any paid render | `node scripts/voice-estimate.mjs <script.json>` (no network) |
| Budget and key present (never printed) | `GET /api/voice/status` → `{budget: {limitChars, billedChars, remainingChars}}` |
| Media decode | automatic: every upload and render is fully decoded, and re-checked before approval, publication and Go live |
| Approvals bound to exact bytes | board: segment revision approved; publish refuses otherwise |
| Viewers start only on the server's word | automatic (N04 activation check) |
| Tests | `npm test` (broadcast, voice, studio), `npm run test:browser-all` |

## 5. Founder inputs still missing

`node scripts/check-episode.mjs episodes/premiere-001.template.json` lists them all (29 today):
- title;
- total and per-segment durations;
- people's names;
- each agent's client;
- presenter names, studio actors and voices;
- the number of artworks;
- the Georgian segment titles.

Beyond the file:
- the creative direction and copy for each spoken segment;
- the real artworks and track, with rights;
- the ElevenLabs plan, key and budget.
