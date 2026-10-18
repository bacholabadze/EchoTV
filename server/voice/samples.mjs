// Fixed, previously generated voice samples (ECHO unified build, 2026-10-18).
// The eight Georgian ElevenLabs samples were rendered once in a founder-approved paid test and are reused here as
// immutable files. This provider never calls a network, never pays, and only answers a script whose text matches a
// sample exactly (after normalisation). Everything else is refused, so a line that has no sample falls through to
// the next provider (a real ElevenLabs key, Piper, or captions). The samples carry no character alignment, so timing
// is approximate: captions and viseme cues are spread evenly over the measured duration (approximateTiming: true).
// This is NOT dynamic conversational TTS and is labelled as such on air and in the asset's provenance.
import {existsSync, readFileSync, copyFileSync} from 'node:fs';
import {join} from 'node:path';
import {normalizeText, approximateTiming} from './providers.mjs';

export const ALIASES = {echo: 'presenter-1', host: 'presenter-1', interviewer: 'presenter-1', nova: 'presenter-3', atlas: 'presenter-2'};

export function loadSampleManifest(dir) {
  const file = join(dir, 'manifest.json');
  if (!existsSync(file)) return null;
  const m = JSON.parse(readFileSync(file, 'utf8'));
  m.dir = dir;
  for (const item of m.items) item.key = normalizeText(item.text);
  return m;
}

export function sampleProvider({dir, manifest = loadSampleManifest(dir)} = {}) {
  const items = manifest?.items || [], voices = manifest?.voices || {};
  const presenterOf = p => ALIASES[p] || p;
  const find = line => items.find(i => i.presenter === presenterOf(line.presenter) && i.key === normalizeText(line.text)) || null;
  return {
    name: 'elevenlabs-sample', paid: false, model: manifest?.model_id ? `${manifest.model_id} (fixed samples)` : 'fixed samples',
    manifest,
    // Public, credential-free catalogue of the approved sample scripts (text, presenter, duration). No file paths.
    catalogue: () => items.map(i => ({id: i.id, presenter: i.presenter, voiceName: i.voice_name, text: i.text, duration: i.duration_s, derived: /derived/.test(i.source || '')})),
    available({lines, lang}) {
      if (!manifest) return 'no voice samples installed';
      if (lang !== manifest.language) return `samples exist only for "${manifest.language}"`;
      const missing = lines.filter(l => !find(l));
      return missing.length ? `no approved sample for this exact script (${missing.map(l => `${l.presenter}: “${l.text.slice(0, 24)}…”`).join('; ')})` : true;
    },
    voiceIdsFor: lines => Object.fromEntries([...new Set(lines.map(l => presenterOf(l.presenter)))].map(p => [p, voices[p]?.voice_id || null])),
    billedChars: () => 0,
    async render({lines, outPath}) {
      const hits = lines.map(find);
      if (hits.some(h => !h)) throw new Error('no sample for one of the lines');
      if (hits.length === 1) {
        copyFileSync(join(manifest.dir, hits[0].file), outPath);
        const t = approximateTiming(lines, hits[0].duration_s);
        return {...t, requestIds: [`sample:${hits[0].id}`], approximateTiming: true, sampleIds: [hits[0].id]};
      }
      // Several lines: the samples are concatenated as-is (same codec and rate: 44.1 kHz mono 128 kbps MP3 frames).
      const buffers = hits.map(h => readFileSync(join(manifest.dir, h.file)));
      const {writeFileSync} = await import('node:fs');
      writeFileSync(outPath, Buffer.concat(buffers));
      let at = 0; const turns = [], captions = [], cues = [];
      lines.forEach((l, i) => { const t = approximateTiming([l], hits[i].duration_s); for (const x of t.captions) captions.push({...x, start: x.start + at, end: x.end + at}); for (const x of t.cues) cues.push({...x, start: x.start + at, end: x.end + at}); turns.push({presenter: l.presenter, line: i, start: at, end: at + hits[i].duration_s}); at += hits[i].duration_s; });
      return {duration: at, turns, captions, cues, requestIds: hits.map(h => `sample:${h.id}`), approximateTiming: true, sampleIds: hits.map(h => h.id)};
    },
  };
}
