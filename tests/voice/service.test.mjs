// Voice service (3.2): providers, cache, spending guard, alignment. ElevenLabs is always the local mock.
// The Georgian strings are neutral test phrases, not programme copy.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createVoiceService} from '../../server/voice/index.mjs';
import {elevenLabsProvider, captionsProvider} from '../../server/voice/providers.mjs';
import {createLedger} from '../../server/voice/store.mjs';
import {visemeOf, cuesFromAlignment, captionsFromAlignment, GEORGIAN_LETTERS} from '../../server/voice/align.mjs';
import {probeMedia} from '../../server/server.mjs';
import {startMockElevenLabs} from './mock-elevenlabs.mjs';

const KEY = 'sk_test_never_leaves_the_header_0123456789';
const VOICES = {'presenter-1': 'voice-one', 'presenter-2': 'voice-two'};
const probe = path => { const {reason, ...p} = probeMedia(path); return {...p, reason}; };
const KA1 = 'გამარჯობა, ეს არის საცდელი ხაზი.', KA2 = 'კარგია. ახლა მეორე წამყვანი საუბრობს.';

function service({mock, budget = 10000, apiKey = KEY, dir = mkdtempSync(join(tmpdir(), 'echo-voice-')), timeoutMs} = {}) {
  const providers = {elevenlabs: elevenLabsProvider({apiKey, voices: VOICES, baseUrl: mock?.url || 'http://127.0.0.1:9', ...(timeoutMs ? {timeoutMs} : {})}), captions: captionsProvider()};
  const events = [];
  const voice = createVoiceService({providers, cacheDir: join(dir, 'cache'), ledger: createLedger(join(dir, 'ledger.json'), budget), probe, log: (e, d) => events.push([e, d])});
  return {voice, dir, events};
}

test('every Georgian letter has a mouth shape; captions break into phrases; cues merge', () => {
  assert.equal([...GEORGIAN_LETTERS].length, 33);
  for (const ch of GEORGIAN_LETTERS) assert.ok(visemeOf(ch), ch);
  assert.equal(visemeOf('ბ'), 'PP'); assert.equal(visemeOf('ა'), 'aa'); assert.equal(visemeOf('შ'), 'CH'); assert.equal(visemeOf(','), null);
  const text = `${KA1} ${KA2}`, chars = [...text];
  const a = {characters: chars, character_start_times_seconds: chars.map((_, i) => i * .05), character_end_times_seconds: chars.map((_, i) => (i + 1) * .05)};
  const caps = captionsFromAlignment(a);
  assert.deepEqual(caps.map(c => c.text), ['გამარჯობა, ეს არის საცდელი ხაზი.', 'კარგია.', 'ახლა მეორე წამყვანი საუბრობს.']);
  assert.ok(caps.every(c => c.end > c.start)); assert.equal(caps[1].start, +(chars.indexOf('კ') * .05).toFixed(4));
  const cues = cuesFromAlignment(a);
  assert.ok(cues.length > 20 && cues.every(c => c.end > c.start && c.key));
});

test('two presenters: one dialogue request with both voices, language ka; turns, captions and cues per presenter', async () => {
  const mock = await startMockElevenLabs();
  try {
    const {voice} = service({mock});
    const r = await voice.synthesize({lines: [{presenter: 'presenter-1', text: KA1}, {presenter: 'presenter-2', text: KA2}], lang: 'ka'});
    assert.equal(mock.calls.length, 1);
    const call = mock.calls[0];
    assert.equal(call.path, '/v1/text-to-dialogue/with-timestamps'); assert.equal(call.query.output_format, 'mp3_44100_128');
    assert.equal(call.headers['xi-api-key'], KEY);
    assert.deepEqual(call.body.inputs, [{text: KA1, voice_id: 'voice-one'}, {text: KA2, voice_id: 'voice-two'}]);
    assert.equal(call.body.model_id, 'eleven_v3'); assert.equal(call.body.language_code, 'ka');
    assert.equal(r.provider, 'elevenlabs'); assert.equal(r.cacheHit, false); assert.equal(r.approximateTiming, false);
    assert.deepEqual(r.turns.map(t => t.presenter), ['presenter-1', 'presenter-2']);
    assert.ok(r.turns[0].end <= r.turns[1].start + 1e-6);
    assert.deepEqual([...new Set(r.captions.map(c => c.presenter))], ['presenter-1', 'presenter-2']);
    assert.ok(r.duration > 3.9 && r.duration < 4.2, `duration from the decoded audio: ${r.duration}`);
    assert.deepEqual(r.requestIds, ['mock-1']); assert.equal(r.billedChars, [...KA1].length + [...KA2].length);
    assert.ok(!JSON.stringify(r).includes(KEY), 'the key is not in the result');
    assert.equal(readFileSync(r.audioFile).length > 1000, true);
  } finally { await mock.close(); }
});

test('one presenter: text-to-speech with that voice', async () => {
  const mock = await startMockElevenLabs();
  try {
    const r = await service({mock}).voice.synthesize({lines: [{presenter: 'presenter-2', text: KA2}], lang: 'ka'});
    assert.equal(mock.calls[0].path, '/v1/text-to-speech/voice-two/with-timestamps'); assert.equal(mock.calls[0].body.text, KA2);
    assert.equal(r.turns.length, 1); assert.equal(r.captions.at(-1).text, 'ახლა მეორე წამყვანი საუბრობს.');
  } finally { await mock.close(); }
});

test('cache: the same request is never rendered or paid twice, also after a restart of the service', async () => {
  const mock = await startMockElevenLabs();
  try {
    const s = service({mock}), req = {lines: [{presenter: 'presenter-1', text: KA1}], lang: 'ka'};
    const first = await s.voice.synthesize(req), second = await s.voice.synthesize(req);
    const again = await service({mock, dir: s.dir}).voice.synthesize(req);
    assert.equal(mock.calls.length, 1); assert.equal(second.cacheHit, true); assert.equal(again.cacheHit, true);
    assert.equal(second.sha256, first.sha256);
    assert.equal(s.voice.budget().billedChars, [...KA1].length, 'billed once');
    const changed = await s.voice.synthesize({...req, lines: [{presenter: 'presenter-1', text: KA1 + ' და კიდევ.'}]});
    assert.equal(changed.cacheHit, false); assert.equal(mock.calls.length, 2, 'different text renders again');
  } finally { await mock.close(); }
});

test('spending guard: over budget or no budget = refused before sending; no key = no call', async () => {
  const mock = await startMockElevenLabs();
  try {
    const lines = [{presenter: 'presenter-1', text: KA1}];
    const small = service({mock, budget: 10});
    const r = await small.voice.synthesize({lines, lang: 'ka'});
    assert.equal(r.provider, 'captions', 'falls back to captions only');
    assert.match(r.attempts[0].skipped, /Voice budget: \d+ characters requested, 10 of 10 left/);
    assert.equal((await service({mock, budget: 0}).voice.synthesize({lines, lang: 'ka'})).attempts[0].skipped, 'No voice budget is set (ECHO_VOICE_BUDGET_CHARS); paid voices are off');
    assert.match((await service({mock, apiKey: ''}).voice.synthesize({lines, lang: 'ka'})).attempts[0].skipped, /no ElevenLabs API key/);
    assert.equal(mock.calls.length, 0, 'nothing was sent');
    const est = service({mock}).voice.estimate({lines, lang: 'ka'});
    assert.deepEqual(est.map(e => [e.provider, e.usable, e.billedChars]), [['elevenlabs', true, [...KA1].length], ['piper', false, 0], ['captions', true, 0]]);
    assert.equal(mock.calls.length, 0, 'estimate makes no call');
  } finally { await mock.close(); }
});

test('provider errors and timeouts fall back visibly; the key never appears in errors, logs or files', async () => {
  for (const mode of ['error', 'unauthorized', 'hang']) {
    const mock = await startMockElevenLabs({mode});
    try {
      const s = service({mock, timeoutMs: 800});
      const r = await s.voice.synthesize({lines: [{presenter: 'presenter-1', text: KA1}], lang: 'ka'});
      assert.equal(r.provider, 'captions', mode); assert.equal(r.audioFile, null);
      assert.match(r.attempts[0].error, mode === 'hang' ? /timed out/ : /HTTP (500|401)/);
      const everything = JSON.stringify(r) + JSON.stringify(s.events) + readdirSync(join(s.dir, 'cache')).map(f => readFileSync(join(s.dir, 'cache', f), 'utf8')).join('');
      assert.ok(!everything.includes(KEY), `${mode}: key leaked`);
    } finally { await mock.close(); }
  }
});

test('no alignment in the response: timing spread over the decoded duration and marked approximate', async () => {
  const mock = await startMockElevenLabs({mode: 'no-alignment'});
  try {
    const r = await service({mock}).voice.synthesize({lines: [{presenter: 'presenter-1', text: KA1}, {presenter: 'presenter-2', text: KA2}], lang: 'ka'});
    assert.equal(r.approximateTiming, true); assert.ok(Math.abs(r.turns.at(-1).end - r.duration) < .01);
  } finally { await mock.close(); }
});

test('audio that does not decode is never accepted', async () => {
  const mock = await startMockElevenLabs({audio: Buffer.concat([Buffer.from('ID3'), Buffer.alloc(3000)])});
  try {
    const r = await service({mock}).voice.synthesize({lines: [{presenter: 'presenter-1', text: KA1}], lang: 'ka'});
    assert.equal(r.provider, 'captions'); assert.match(r.attempts[0].error, /does not decode/);
  } finally { await mock.close(); }
});
