// M1: Piper behind the voice interface gives the same result as the 3.1 path (tools/host-voice.py called directly)
// for the 3.1 house lines. Piper is not deterministic: two runs of the unchanged 3.1 path differ in audio bytes and in
// timing (measured 2026-10-17: durations 7.60 s vs 7.43 s, cue starts up to 0.23 s apart) while the phoneme/viseme
// sequence and captions are identical. So equality is asserted on the sequence and text, and timing within that
// measured spread. Exact bytes are what the cache and approvals pin (same request = same cached file).
// Skipped (with a reason) when Piper is not installed in this checkout.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createVoiceService} from '../../server/voice/index.mjs';
import {piperProvider, captionsProvider} from '../../server/voice/providers.mjs';
import {createLedger} from '../../server/voice/store.mjs';
import {probeMedia, hostLines} from '../../server/server.mjs';
import {seedState} from '../../server/seed.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const installed = existsSync(join(ROOT, '.venv/bin/python')) && existsSync(join(ROOT, 'voices/en_US-ljspeech-high.onnx'));
const sha = b => createHash('sha256').update(b).digest('hex');

test('Piper through the voice service = the 3.1 direct path (viseme sequence, captions, duration within the measured spread; cache pins bytes)', {skip: !installed && 'Piper not installed (.venv, voices/)'}, async () => {
  const lines = hostLines(seedState({people: {a: {name: 'Bacho'}, b: {name: 'Keti'}}}));
  assert.deepEqual(lines.map(l => l.id), ['interstitial', 'outro']);
  const dir = mkdtempSync(join(tmpdir(), 'echo-m1-'));
  const old = spawnSync(join(ROOT, '.venv/bin/python'), ['-I', join(ROOT, 'tools/host-voice.py')], {input: JSON.stringify({outDir: join(dir, 'old'), lines}), encoding: 'utf8', timeout: 120000});
  assert.equal(old.status, 0, old.stderr);
  const before = JSON.parse(old.stdout);
  const voice = createVoiceService({providers: {piper: piperProvider({root: ROOT}), captions: captionsProvider()}, cacheDir: join(dir, 'cache'), ledger: createLedger(join(dir, 'ledger.json'), 0),
    probe: path => { const {reason, ...p} = probeMedia(path); return {...p, reason}; }});
  for (const l of lines) {
    const now = await voice.synthesize({lines: [{presenter: 'echo', text: l.text}], lang: 'en', order: ['piper', 'captions']});
    assert.equal(now.provider, 'piper');
    const b = before[l.id];
    assert.deepEqual(now.cues.map(c => c.key), b.cues.map(c => c.key), `${l.id}: same viseme sequence`);
    assert.deepEqual(now.captions.map(c => c.text), b.captions.map(c => c.text), `${l.id}: same captions`);
    assert.ok(Math.abs(now.duration - b.duration) / b.duration < .08, `${l.id}: duration ${now.duration} vs ${b.duration} (Piper varies ~2% run to run)`);
    assert.ok(now.captions.every(c => c.end <= now.duration + .05) && now.cues.at(-1).end <= now.duration + .05, `${l.id}: timing inside the audio`);
    const again = await voice.synthesize({lines: [{presenter: 'echo', text: l.text}], lang: 'en', order: ['piper', 'captions']});
    assert.equal(again.cacheHit, true); assert.equal(sha(readFileSync(again.audioFile)), sha(readFileSync(now.audioFile)), `${l.id}: the cache pins the exact bytes`);
  }
});
