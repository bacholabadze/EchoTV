// Voice providers behind one contract:
//   {name, paid, available(request) -> true | 'reason', model, voiceIdsFor(lines), billedChars(lines),
//    render({lines, lang, mode, outPath}) -> {duration?, captions, cues, turns, requestIds, approximateTiming}}
// render writes MP3 bytes to outPath (except the captions provider, which has no audio).
import {spawn} from 'node:child_process';
import {existsSync, mkdtempSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {cuesFromAlignment, captionsFromAlignment, dialogueTiming, approximateAlignment, normalizeText} from './align.mjs';

export class ProviderError extends Error { constructor(provider, message, status) { super(`${provider}: ${message}`); this.provider = provider; this.status = status; } }

// ---------- Piper (offline, existing tools/host-voice.py, unchanged) ----------
export function piperProvider({root, models = {en: join(root, 'voices/en_US-ljspeech-high.onnx')}, timeoutMs = 60000} = {}) {
  const python = join(root, '.venv/bin/python');
  return {
    name: 'piper', paid: false, model: 'en_US-ljspeech-high',
    available({lang, lines}) {
      if (!existsSync(python)) return 'Piper is not installed (.venv)';
      if (!models[lang] || !existsSync(models[lang])) return `no Piper voice installed for "${lang}"`;
      if (new Set(lines.map(l => l.presenter)).size > 1) return 'Piper has one voice: no two-presenter dialogue';
      return true;
    },
    voiceIdsFor: () => ({piper: 'en_US-ljspeech-high'}), billedChars: () => 0,
    async render({lines, outPath}) {
      const dir = mkdtempSync(join(tmpdir(), 'echo-piper-')), text = lines.map(l => l.text).join(' ');
      try {
        const out = await new Promise((resolve, reject) => {
          const child = spawn(python, ['-I', join(root, 'tools/host-voice.py')], {stdio: ['pipe', 'pipe', 'pipe']});
          let stdout = '', stderr = '';
          child.stdout.on('data', d => stdout += d); child.stderr.on('data', d => stderr += d);
          const timer = setTimeout(() => { child.kill(); reject(new ProviderError('piper', 'timed out')); }, timeoutMs);
          child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(JSON.parse(stdout)) : reject(new ProviderError('piper', stderr.slice(-300))); });
          child.stdin.end(JSON.stringify({outDir: dir, lines: [{id: 'unit', text}]}));
        });
        writeFileSync(outPath, readFileSync(join(dir, out.unit.file)));
        const presenter = lines[0].presenter;
        return {duration: out.unit.duration, cues: out.unit.cues, captions: out.unit.captions, turns: [{presenter, line: 0, start: 0, end: out.unit.duration}], requestIds: [], approximateTiming: false};
      } finally { rmSync(dir, {recursive: true, force: true}); }
    },
  };
}

// ---------- ElevenLabs (paid; Georgian on eleven_v3 / v4 per their docs, 2026-10-17) ----------
// Single presenter: POST /v1/text-to-speech/{voice_id}/with-timestamps. Two or more: POST /v1/text-to-dialogue/with-timestamps.
// The key is sent only in the xi-api-key header and never returned, logged or stored.
export function elevenLabsProvider({apiKey, voices = {}, model = 'eleven_v3', baseUrl = 'https://api.elevenlabs.io', outputFormat = 'mp3_44100_128', seed, timeoutMs = 90000, fetchImpl = fetch} = {}) {
  const voiceFor = presenter => voices[presenter];
  return {
    name: 'elevenlabs', paid: true, model,
    available({lines}) {
      if (!apiKey) return 'no ElevenLabs API key configured';
      const missing = [...new Set(lines.map(l => l.presenter))].filter(p => !voiceFor(p));
      return missing.length ? `no ElevenLabs voice configured for presenter ${missing.join(', ')}` : true;
    },
    voiceIdsFor: lines => Object.fromEntries([...new Set(lines.map(l => l.presenter))].map(p => [p, voiceFor(p)])),
    billedChars: lines => lines.reduce((n, l) => n + [...l.text].length, 0),
    async render({lines, lang, outPath}) {
      const dialogue = new Set(lines.map(l => l.presenter)).size > 1;
      const path = dialogue ? '/v1/text-to-dialogue/with-timestamps' : `/v1/text-to-speech/${encodeURIComponent(voiceFor(lines[0].presenter))}/with-timestamps`;
      const body = dialogue
        ? {inputs: lines.map(l => ({text: l.text, voice_id: voiceFor(l.presenter)})), model_id: model, language_code: lang, ...(seed !== undefined ? {seed} : {})}
        : {text: lines.map(l => l.text).join(' '), model_id: model, language_code: lang, ...(seed !== undefined ? {seed} : {})};
      let res;
      try {
        res = await fetchImpl(`${baseUrl}${path}?output_format=${encodeURIComponent(outputFormat)}`, {method: 'POST', headers: {'xi-api-key': apiKey, 'content-type': 'application/json', accept: 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs)});
      } catch (e) { throw new ProviderError('elevenlabs', e.name === 'TimeoutError' ? 'timed out' : 'network error'); }
      const requestIds = [res.headers.get('request-id') || res.headers.get('x-request-id')].filter(Boolean);
      if (!res.ok) { const detail = (await res.text().catch(() => '')).replaceAll(apiKey, '[key]').slice(0, 200); throw new ProviderError('elevenlabs', `HTTP ${res.status} ${detail}`, res.status); }
      const x = await res.json();
      if (!x.audio_base64) throw new ProviderError('elevenlabs', 'response had no audio');
      writeFileSync(outPath, Buffer.from(x.audio_base64, 'base64'));
      const alignment = x.alignment?.characters?.length ? x.alignment : null;
      if (dialogue) {
        const segments = x.voice_segments?.length ? x.voice_segments : null;
        if (alignment && segments) return {...dialogueTiming(alignment, segments, lines), requestIds, approximateTiming: false};
        return {...approximateTiming(lines, null), requestIds, approximateTiming: true};
      }
      const presenter = lines[0].presenter;
      if (alignment) return {cues: cuesFromAlignment(alignment, {presenter}), captions: captionsFromAlignment(alignment, {presenter}), turns: [{presenter, line: 0, start: 0, end: alignment.character_end_times_seconds.at(-1)}], requestIds, approximateTiming: false};
      return {...approximateTiming(lines, null), requestIds, approximateTiming: true};
    },
  };
}

// ---------- captions only (no audio) ----------
export function captionsProvider({charsPerSecond = 14} = {}) {
  return {
    name: 'captions', paid: false, model: null, available: () => true, voiceIdsFor: () => ({}), billedChars: () => 0,
    async render({lines}) { return {...approximateTiming(lines, null, charsPerSecond), requestIds: [], approximateTiming: true}; },
  };
}

// Even timing per line (duration from audio when known, else reading speed). Used only when no alignment exists.
export function approximateTiming(lines, duration, charsPerSecond = 14) {
  const total = lines.reduce((n, l) => n + [...l.text].length, 0), seconds = duration ?? total / charsPerSecond;
  let at = 0;
  const out = {turns: [], captions: [], cues: [], duration: duration ?? Math.round(seconds * 1000) / 1000};
  lines.forEach((l, i) => {
    const d = seconds * [...l.text].length / Math.max(1, total), a = approximateAlignment(l.text, d, at);
    out.turns.push({presenter: l.presenter, line: i, start: at, end: at + d});
    out.captions.push(...captionsFromAlignment(a, {presenter: l.presenter})); out.cues.push(...cuesFromAlignment(a, {presenter: l.presenter}));
    at += d;
  });
  return out;
}
export {normalizeText};
