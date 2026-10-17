// Hardening (3.2 I8): findings from an independent audit of the interview work, each reproduced here first.
// Every test failed on bbadac7. People's actions are test calls; no paid provider is used.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {start, completeInterview} from './helpers.mjs';
import {createVoiceService} from '../../server/voice/index.mjs';
import {createLedger} from '../../server/voice/store.mjs';
import {elevenLabsStt} from '../../server/voice/stt.mjs';
import {voiceServiceFromEnv} from '../../server/voice/index.mjs';
import {probeMedia} from '../../server/server.mjs';
import {startMockElevenLabs} from '../voice/mock-elevenlabs.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MP3 = readFileSync(join(ROOT, 'tests/fixtures/tone-62s.mp3'));
async function approvedWith(x, rights) {
  const m = (await x.upload(x.T.B, MP3, 'track.mp3')).body;
  await x.req('POST', `/api/library/media/${m.id}/rights`, x.T.B, {...rights, confirm: true});
  const {id, act} = await completeInterview(x, x.T.B, m.id);
  const b = x.echo.desk.state.interviews[id].brief; await act('approve', {version: b.version, hash: b.hash});
  return {m, id, act};
}
const prepare = (x, id, m) => x.req('POST', `/api/briefs/${id}/prepare`, x.T.B, {segmentId: 'premiere', assets: {track: m.id}});
const review = x => x.req('POST', '/api/segments/premiere/review', x.T.P, {revision: x.echo.desk.state.segments.premiere.revision, decision: 'approved'});

test('H1: airing only part of a file (60 of 62 s) needs the creator\'s "editing" permission', async () => {
  const x = await start();
  try {
    const {m, id} = await approvedWith(x, {publicBroadcast: true, editing: false});
    const r = await prepare(x, id, m);
    assert.equal(r.status, 422, JSON.stringify(r.body)); assert.equal(r.body.error, 'rights_required'); assert.match(r.body.message, /editing/);
    const y = await start();
    try { const z = await approvedWith(y, {publicBroadcast: true, editing: true}); assert.equal((await prepare(y, z.id, z.m)).status, 200, 'with editing permission it is allowed'); }
    finally { await y.stop(); }
  } finally { await x.stop(); }
});

test('H2: correcting an approved brief during the Starting countdown cancels the start (before air)', async () => {
  const x = await start();
  try {
    const {m, id, act} = await approvedWith(x, {publicBroadcast: true, editing: true});
    await prepare(x, id, m); await review(x);
    const pub = (await x.req('POST', '/api/publish', x.T.P)).body;
    const live = (await x.req('POST', '/api/golive', x.T.P, {delayMs: 5000, publicationId: pub.publicationId, hash: pub.hash})).body;
    await act('answer', {stepId: 'who', fields: {displayName: 'სხვა სახელი'}});
    const b = x.echo.desk.state.broadcast;
    assert.equal(b.state, 'queued', 'start cancelled'); assert.equal(b.withdrawn?.cancelledStartAt, live.onAirAt);
    const a = await (await fetch(`${x.base}/api/broadcast/activation?publicationId=${pub.publicationId}&hash=${pub.hash}&onAirAt=${live.onAirAt}`)).json();
    assert.equal(a.permitted, false);
  } finally { await x.stop(); }
});

test('H3: changing a file\'s declared uses after approval reopens the brief and withdraws a ready publication', async () => {
  const x = await start();
  try {
    const {m, id} = await approvedWith(x, {publicBroadcast: true, editing: true, replays: true});
    await prepare(x, id, m); await review(x);
    await x.req('POST', '/api/publish', x.T.P);
    await x.req('POST', `/api/library/media/${m.id}/rights`, x.T.B, {publicBroadcast: true, editing: true, replays: false, confirm: true});
    assert.equal(x.echo.desk.state.interviews[id].status, 'review', 'brief approval no longer counts: its rights changed');
    assert.equal(x.echo.desk.state.interviews[id].brief.media[0].rights.replays, false, 'the brief shows the current uses');
    assert.equal(x.echo.desk.state.broadcast.state, 'queued', 'ready publication withdrawn');
    assert.match((await x.req('POST', '/api/publish', x.T.P)).body.message, /brief changed since this segment was prepared/);
  } finally { await x.stop(); }
});

test('H4: an answer\'s text can be explicitly cleared; an empty follow-up still keeps it', async () => {
  const x = await start();
  try {
    const {id, act} = await approvedWith(x, {publicBroadcast: true});
    await act('answer', {stepId: 'inspiration', text: ''});
    assert.ok(x.echo.desk.state.interviews[id].answers.inspiration.text, 'empty text without clear: kept');
    await act('answer', {stepId: 'inspiration', text: '', clear: true});
    assert.equal(x.echo.desk.state.interviews[id].answers.inspiration.text, '', 'explicit clear removes it');
    assert.equal(x.echo.desk.state.interviews[id].brief.story.inspiration, null);
  } finally { await x.stop(); }
});

test('H5: concurrent paid calls cannot exceed the budget; identical in-flight requests are rendered once', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'echo-budget-'));
  let sent = 0;
  const slow = {name: 'paid', paid: true, model: 'm', available: () => true, voiceIdsFor: () => ({}), billedChars: lines => lines.reduce((n, l) => n + l.text.length, 0),
    render: async ({outPath}) => { sent++; await new Promise(r => setTimeout(r, 150)); throw new Error('test provider: no audio'); }};
  const captions = {name: 'captions', paid: false, model: null, available: () => true, voiceIdsFor: () => ({}), billedChars: () => 0, render: async () => ({captions: [], cues: [], turns: [], duration: 1, requestIds: [], approximateTiming: true})};
  const voice = createVoiceService({providers: {paid: slow, captions}, cacheDir: join(dir, 'c'), ledger: createLedger(join(dir, 'l.json'), 5), probe: () => ({decodable: false})});
  await Promise.all([voice.synthesize({lines: [{text: 'aaaaa'}], lang: 'en', order: ['paid', 'captions']}), voice.synthesize({lines: [{text: 'bbbbb'}], lang: 'en', order: ['paid', 'captions']})]);
  assert.equal(sent, 1, 'the second call was refused before sending'); assert.ok(voice.budget().billedChars <= 5, `billed ${voice.budget().billedChars} of 5`);
  sent = 0;
  const v2 = createVoiceService({providers: {paid: slow, captions}, cacheDir: join(dir, 'c2'), ledger: createLedger(join(dir, 'l2.json'), 100), probe: () => ({decodable: false})});
  await Promise.all([1, 2, 3].map(() => v2.synthesize({lines: [{text: 'same'}], lang: 'en', order: ['paid', 'captions']})));
  assert.equal(sent, 1, 'identical concurrent requests share one render');
});

test('H6/H7: spoken questions need the creator and voice consent; transcripts are not kept in the retry cache', async () => {
  const mock = await startMockElevenLabs(), dataDir = mkdtempSync(join(tmpdir(), 'echo-h6-'));
  const voice = voiceServiceFromEnv({root: '/nonexistent', dataDir, probe: p => { const {reason, ...o} = probeMedia(p); return {...o, reason}; }, env: {ELEVENLABS_API_KEY: 'k', ELEVENLABS_BASE_URL: mock.url, ECHO_VOICE_BUDGET_CHARS: '2000', ECHO_ELEVENLABS_VOICES: JSON.stringify({interviewer: 'v'})}});
  const stt = {provider: elevenLabsStt({apiKey: 'k', baseUrl: mock.url}), ledger: createLedger(join(dataDir, 's.json'), 100, {unit: 'seconds'})};
  const x = await start({dataDir, voice, stt});
  try {
    const iv = (await x.req('POST', '/api/interviews', x.T.B)).body;
    const agent = await x.req('GET', `/api/interviews/${iv.id}/question-audio`, x.T.b);
    const noConsent = await x.req('GET', `/api/interviews/${iv.id}/question-audio`, x.T.B);
    assert.equal(agent.body.audio ?? null, null); assert.equal(noConsent.body.audio, null); assert.equal(noConsent.body.text, 'ვინ ხარ და რა შექმენი?');
    assert.equal(mock.calls.length, 0, 'no paid render without the creator\'s voice consent');
    await x.req('POST', `/api/interviews/${iv.id}/consent`, x.T.B, {voice: true});
    assert.match((await x.req('GET', `/api/interviews/${iv.id}/question-audio`, x.T.B)).body.audio, /^\/voice\//);
    const d = mkdtempSync(join(tmpdir(), 'echo-h7-')); spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=2', '-c:a', 'libopus', join(d, 'a.webm')]);
    const r = await x.req('POST', `/api/interviews/${iv.id}/transcribe`, x.T.B, readFileSync(join(d, 'a.webm')), {'content-type': 'audio/webm', 'idempotency-key': 'transcribe-key-0001'});
    assert.equal(r.status, 200);
    assert.ok(!JSON.stringify(x.echo.desk.state.idempotency || {}).includes(r.body.recognised), 'the recognised text is not persisted for retries');
  } finally { await x.stop(); await mock.close(); }
});

test('H8: a prepared library file is not public before publication (owner and producer can preview it)', async () => {
  const x = await start();
  try {
    const {m, id} = await approvedWith(x, {publicBroadcast: true, editing: true});
    await prepare(x, id, m);
    assert.equal((await fetch(`${x.base}/media/${m.sha256}`)).status, 404, 'not public before publication');
    for (const t of [x.T.B, x.T.P]) assert.equal((await fetch(`${x.base}/media/${m.sha256}`, {headers: {authorization: `Bearer ${t}`}})).status, 200);
    assert.equal((await fetch(`${x.base}/media/${m.sha256}`, {headers: {authorization: `Bearer ${x.T.A}`}})).status, 404, 'another creator cannot');
    await review(x); await x.req('POST', '/api/publish', x.T.P);
    assert.equal((await fetch(`${x.base}/media/${m.sha256}`)).status, 200, 'public once published');
  } finally { await x.stop(); }
});

test('H9: a rehearsal reset keeps creators\' private interviews and libraries', async () => {
  const x = await start();
  try {
    const {m, id} = await approvedWith(x, {publicBroadcast: true});
    await x.req('POST', '/api/reset', x.T.P);
    const lib = (await x.req('GET', '/api/library', x.T.B)).body;
    assert.deepEqual(lib.media.map(i => i.id), [m.id]); assert.equal(lib.briefs[0].interviewId, id); assert.equal(lib.briefs[0].status, 'approved');
    const next = (await x.req('POST', '/api/interviews', x.T.B)).body;
    assert.notEqual(next.id, id, 'ids are not reused after a reset');
  } finally { await x.stop(); }
});
