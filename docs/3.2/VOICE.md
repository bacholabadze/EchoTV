# ECHO 3.2 — voice service (status and configuration)

## Verified vs not verified

| Claim | Status |
|---|---|
| Piper (offline English) behind the new interface; 3.1 house lines unchanged | **Verified locally**: same viseme sequence and captions as the 3.1 direct path. Duration is within Piper's own run-to-run spread, because Piper is not deterministic (two 3.1 runs: 7.60 s vs 7.43 s, different bytes). |
| ElevenLabs provider: request shape, dialogue and single voice, alignment → captions, cues and turns, fallbacks, cache, budget | **Verified against a local mock** shaped like the documented API (`tests/voice/mock-elevenlabs.mjs`). **No real ElevenLabs call has been made.** |
| Georgian speech quality, whether `eleven_v3` / v4 return alignment for Georgian, which voices to use | **Not verified.** Needs the founder's API key and budget, then milestone M3 (2–3 short calls). |
| Approval of the exact generated audio; publication airs those bytes | **Verified** (HTTP tests + browser playout with mock audio, which is a test tone, not speech) |
| Georgian captions render in the broadcast | **Verified on this Mac** (Chrome, system Georgian font); screenshot checked |
| Two presenters drive two different 3D actors (turns → camera/blocking) | **Not built yet** (milestone M4). Captions carry the presenter; the centre host animates. |

## How it works

- **`server/voice/index.mjs`** — `synthesize({lines: [{presenter, text}], lang, order})` returns:
  - MP3, captions (phrase-level, with presenter), viseme cues, turns;
  - provenance: provider, model, voice ids, request ids, billed characters, cache hit, fallback reasons.
- **Providers** (`server/voice/providers.mjs`):
  - `piper` wraps `tools/host-voice.py` unchanged. It has one voice and English only, unless a Piper voice for another language is installed.
  - `elevenlabs`: one presenter → `POST /v1/text-to-speech/{voice_id}/with-timestamps`; two or more → `POST /v1/text-to-dialogue/with-timestamps`. Default model `eleven_v3`, `language_code` sent, `mp3_44100_128`.
  - `captions`: no audio, with approximate timing.
- **Order (default):**
  - `en`: Piper → captions (3.1 behaviour);
  - `ka`: ElevenLabs → Piper (only if a Georgian Piper voice is installed) → captions.
- **Cache** (`data/voice-cache/`): keyed by provider, model, voices, settings, language, mode, seed and text. A hit never renders or pays. The cached bytes are re-hashed before use.
- **Spending guard** (`data/voice-ledger.json`):
  - The provider is off without a key **and** a character budget.
  - Characters are checked against the budget before sending; over budget means refused unsent, with a visible reason.
  - Every paid call is recorded (characters, model, request ids).
  - The key is sent only in the `xi-api-key` header and never stored in state, logs or cache. Tests assert this.
- **Validation:** rendered audio is fully decoded (ffprobe + ffmpeg) before it is accepted. Undecodable audio means fallback.
- **Approval of the exact audio** (`POST /api/segments/:id/voice`):
  - Allowed for the segment owner, or the producer for house segments. Agents get 403. Rights are checked **before** anything is rendered.
  - The audio becomes the segment's `voice` asset: a new revision, state `submitted`, approvals void.
  - The producer approves that revision, so the approval is bound to the audio's SHA-256.
  - Publication airs it as `/media/<sha256>`, with the credit "Approved script · synthetic voice (…)".
  - The broadcast footer names the voices actually used.
  - Re-rendering creates a new revision that needs approval again. The R2 byte check applies at publication and Go live.
  - Only `host` segments can be voiced so far.

## Configuration (nothing is paid until all three are set)

```bash
export ELEVENLABS_API_KEY=…            # or data/secrets/elevenlabs.key (mode 600, git-ignored)
export ECHO_VOICE_BUDGET_CHARS=2000    # hard cap on billed characters (ledger in data/voice-ledger.json)
export ECHO_ELEVENLABS_VOICES='{"presenter-1":"<voice_id>","presenter-2":"<voice_id>"}'
# optional: ELEVENLABS_MODEL=eleven_v3 (default) | <v4 model id after M3>, ELEVENLABS_BASE_URL
node scripts/voice-estimate.mjs script.json   # dry run: provider, cache, billed characters; no network
```

## Tests

`npm run test:voice` (mock only, zero paid calls) · `npm run test:voice-playout` (Chrome).
