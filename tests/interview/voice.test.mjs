// Spoken Creator Interview (3.2): consent, speech-to-text (ElevenLabs Scribe = local mock; no paid call),
// creator confirmation of the transcript, failure recovery, spoken questions with caption fallback.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {start} from './helpers.mjs';
import {elevenLabsStt} from '../../server/voice/stt.mjs';
import {createLedger} from '../../server/voice/store.mjs';
import {voiceServiceFromEnv} from '../../server/voice/index.mjs';
import {probeMedia} from '../../server/server.mjs';
import {startMockElevenLabs} from '../voice/mock-elevenlabs.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..'), KEY = 'sk_test_stt_key_never_leaves';
const dir = mkdtempSync(join(tmpdir(), 'echo-rec-'));
spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:a', 'libopus', '-f', 'webm', join(dir, 'answer.webm')]);
const WEBM = readFileSync(join(dir, 'answer.webm')), LONG = readFileSync(join(ROOT, 'tests/fixtures/tone-62s.mp3'));

async function setup({mode = 'ok', seconds = 600, key = KEY, voices = true} = {}) {
  const mock = await startMockElevenLabs({mode}), dataDir = mkdtempSync(join(tmpdir(), 'echo-sttd-'));
  const stt = {provider: elevenLabsStt({apiKey: key, baseUrl: mock.url, timeoutMs: 800}), ledger: createLedger(join(dataDir, 'stt-ledger.json'), seconds, {what: 'Speech-recognition budget', unit: 'seconds', unset: 'No speech-recognition budget is set'})};
  const voice = voiceServiceFromEnv({root: '/nonexistent', dataDir, probe: p => { const {reason, ...x} = probeMedia(p); return {...x, reason}; },
    env: voices ? {ELEVENLABS_API_KEY: key, ELEVENLABS_BASE_URL: mock.url, ECHO_VOICE_BUDGET_CHARS: '2000', ECHO_ELEVENLABS_VOICES: JSON.stringify({interviewer: 'voice-interviewer'})} : {}});
  const x = await start({dataDir, stt, voice});
  const iv = (await x.req('POST', '/api/interviews', x.T.B)).body;
  const send = (bytes, type = 'audio/webm', token = x.T.B) => x.req('POST', `/api/interviews/${iv.id}/transcribe`, token, bytes, {'content-type': type});
  return {x, mock, iv, send, dataDir, stop: async () => { await x.stop(); await mock.close(); }};
}

test('consent first; the transcript is returned, not stored, until the creator confirms or corrects it; no audio kept', async () => {
  const t = await setup();
  try {
    assert.equal((await t.send(WEBM)).body.error, 'consent_required');
    assert.equal(t.mock.calls.length, 0, 'nothing sent without consent');
    assert.equal((await t.x.req('POST', `/api/interviews/${t.iv.id}/consent`, t.x.T.B, {voice: true})).status, 200);
    const before = readdirSync(join(t.dataDir, 'uploads')).length;
    const r = await t.send(WEBM);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.recognised, 'ჩემი სახელია ტესტ შემქმნელი და ვწერ მუსიკას.'); assert.equal(r.body.stored, false); assert.equal(r.body.durationSec, 3);
    const call = t.mock.calls[0];
    assert.equal(call.path, '/v1/speech-to-text'); assert.equal(call.headers['xi-api-key'], KEY);
    assert.equal(call.body.model_id, 'scribe_v2'); assert.equal(call.body.language_code, 'ka'); assert.match(call.body.file, /bytes>$/);
    assert.equal(readdirSync(join(t.dataDir, 'uploads')).length, before, 'the recording is not saved by ECHO');
    assert.equal(Object.keys(t.x.echo.desk.state.interviews[t.iv.id].answers).length, 0, 'not an answer yet');
    // The creator corrects one word, then confirms.
    const corrected = 'ჩემი სახელია ტესტ შემქმნელი და ვწერ სიმღერებს.';
    const a = await t.x.req('POST', `/api/interviews/${t.iv.id}/answer`, t.x.T.B, {stepId: 'who', text: corrected, source: 'voice', transcript: {provider: 'elevenlabs', recognised: r.body.recognised}, fields: {displayName: 'ტ', workTitle: 'ს', category: 'music'}});
    assert.deepEqual(a.body.answers.who.transcript, {provider: 'elevenlabs', recognised: r.body.recognised, corrected: true});
    assert.equal(a.body.answers.who.source, 'voice'); assert.equal(a.body.answers.who.text, corrected);
    assert.equal(t.x.echo.desk.state.interviews[t.iv.id].history.filter(h => h.action === 'voice_consent_given').length, 1);
    await t.x.req('POST', `/api/interviews/${t.iv.id}/consent`, t.x.T.B, {voice: false});
    assert.equal((await t.send(WEBM)).body.error, 'consent_required', 'consent can be withdrawn');
  } finally { await t.stop(); }
});

test('bounded cost: no budget or a recording over 60 s is refused before anything is sent', async () => {
  for (const [opts, bytes, type, reason] of [[{seconds: 0}, WEBM, 'audio/webm', /No speech-recognition budget/], [{seconds: 600}, LONG, 'audio/mpeg', /up to 60 seconds/], [{seconds: 2}, WEBM, 'audio/webm', /\d+ seconds requested, 2 of 2 left/], [{key: ''}, WEBM, 'audio/webm', /no ElevenLabs API key/]]) {
    const t = await setup(opts);
    try {
      await t.x.req('POST', `/api/interviews/${t.iv.id}/consent`, t.x.T.B, {voice: true});
      const r = await t.send(bytes, type);
      assert.ok([422].includes(r.status), `${reason}: ${r.status}`); assert.match(r.body.message, reason); assert.match(r.body.message, /(Type your answer|up to 60)/);
      assert.equal(t.mock.calls.filter(c => c.path === '/v1/speech-to-text').length, 0, `${reason}: nothing sent`);
    } finally { await t.stop(); }
  }
});

test('recoverable failures: provider error or timeout -> 503 with a retry/type hint; interview unchanged; key never leaked', async () => {
  for (const mode of ['error', 'hang']) {
    const t = await setup({mode});
    try {
      await t.x.req('POST', `/api/interviews/${t.iv.id}/consent`, t.x.T.B, {voice: true});
      const r = await t.send(WEBM);
      assert.equal(r.status, 503, mode); assert.equal(r.body.error, 'transcription_failed'); assert.match(r.body.message, /Try again or type your answer/);
      assert.ok(!JSON.stringify(r.body).includes(KEY), `${mode}: key not leaked`);
      assert.equal(t.x.echo.desk.state.interviews[t.iv.id].step, 'who');
      const typed = await t.x.req('POST', `/api/interviews/${t.iv.id}/answer`, t.x.T.B, {stepId: 'who', text: 'ხელით დავწერე.', fields: {displayName: 'ტ', workTitle: 'ს', category: 'music'}});
      assert.equal(typed.status, 200, 'the text fallback always works');
    } finally { await t.stop(); }
  }
});

test('only the creator transcribes; agents and other people cannot; unsupported formats are refused', async () => {
  const t = await setup();
  try {
    await t.x.req('POST', `/api/interviews/${t.iv.id}/consent`, t.x.T.B, {voice: true});
    assert.equal((await t.send(WEBM, 'audio/webm', t.x.T.b)).status, 403, 'agent');
    assert.equal((await t.send(WEBM, 'audio/webm', t.x.T.A)).status, 404, 'another creator');
    assert.equal((await t.send(WEBM, 'video/mp4')).status, 422);
    assert.equal(t.mock.calls.length, 0);
  } finally { await t.stop(); }
});

test('spoken questions: rendered once and cached when a voice is configured; captions only otherwise', async () => {
  const t = await setup();
  try {
    await t.x.req('POST', `/api/interviews/${t.iv.id}/consent`, t.x.T.B, {voice: true}); // spoken questions start with voice consent (H6)
    const q1 = (await t.x.req('GET', `/api/interviews/${t.iv.id}/question-audio`, t.x.T.B)).body;
    assert.equal(q1.text, 'ვინ ხარ და რა შექმენი?'); assert.match(q1.audio, /^\/voice\/[0-9a-f]{64}\.mp3$/); assert.equal(q1.provider, 'elevenlabs');
    assert.ok(q1.captions.length >= 1); assert.equal(t.mock.calls[0].body.language_code, 'ka'); assert.equal(t.mock.calls[0].path, '/v1/text-to-speech/voice-interviewer/with-timestamps');
    await t.x.req('GET', `/api/interviews/${t.iv.id}/question-audio`, t.x.T.B);
    assert.equal(t.mock.calls.length, 1, 'the same question is never rendered twice');
    assert.equal((await t.x.req('GET', q1.audio)).status, 200);
  } finally { await t.stop(); }
  const n = await setup({voices: false});
  try {
    await n.x.req('POST', `/api/interviews/${n.iv.id}/consent`, n.x.T.B, {voice: true});
    const q = (await n.x.req('GET', `/api/interviews/${n.iv.id}/question-audio`, n.x.T.B)).body;
    assert.equal(q.audio, null); assert.equal(q.provider, 'captions'); assert.match(q.reason, /no ElevenLabs API key/); assert.equal(q.text, 'ვინ ხარ და რა შექმენი?');
  } finally { await n.stop(); }
});
