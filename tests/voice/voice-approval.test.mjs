// Approval of the exact generated audio (3.2): a rendered voice is a segment asset; people approve those bytes;
// publication airs them by hash; any re-render voids the approval. ElevenLabs is the local mock (no paid call).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createEchoServer, probeMedia} from '../../server/server.mjs';
import {voiceServiceFromEnv} from '../../server/voice/index.mjs';
import {startMockElevenLabs} from './mock-elevenlabs.mjs';

const KA = [{presenter: 'presenter-1', text: 'გამარჯობა, ეს საცდელი ხაზია.'}, {presenter: 'presenter-2', text: 'და ეს მეორე წამყვანის საცდელი ხაზია.'}];

async function start(mock, {budget = '5000'} = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'echo-va-'));
  const voice = voiceServiceFromEnv({root: '/nonexistent', dataDir, probe: p => { const {reason, ...x} = probeMedia(p); return {...x, reason}; },
    env: {ELEVENLABS_API_KEY: 'sk_test_key', ELEVENLABS_BASE_URL: mock.url, ECHO_VOICE_BUDGET_CHARS: budget, ECHO_ELEVENLABS_VOICES: JSON.stringify({'presenter-1': 'v1', 'presenter-2': 'v2'})}});
  const echo = createEchoServer({dataDir, quiet: true, hostVoiceEnabled: false, voice});
  await new Promise(r => echo.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${echo.server.address().port}`, s = echo.desk.state;
  const T = {P: s.people.producer.token, A: s.people['creator-a'].token, a: s.agents['agent-a'].token};
  const post = async (path, token, body) => { const r = await fetch(base + path, {method: 'POST', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'}, body: JSON.stringify(body || {})}); return {status: r.status, body: await r.json()}; };
  const get = async path => { const r = await fetch(base + path); return {status: r.status, bytes: Buffer.from(await r.arrayBuffer())}; };
  return {echo, T, post, get, dataDir, stop: () => new Promise(r => { echo.server.closeAllConnections(); echo.server.close(r); })};
}
const sha = b => createHash('sha256').update(b).digest('hex');

test('a rendered Georgian dialogue needs approval of its exact audio; publication airs those bytes', async () => {
  const mock = await startMockElevenLabs(), x = await start(mock);
  try {
    const before = x.echo.desk.state.segments.outro.revision;
    const r = await x.post('/api/segments/outro/voice', x.T.P, {lines: KA, lang: 'ka'});
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(mock.calls.length, 1); assert.equal(mock.calls[0].body.language_code, 'ka');
    const seg = x.echo.desk.state.segments.outro, voice = seg.assets.find(a => a.id === 'voice');
    assert.equal(seg.revision, before + 1); assert.equal(seg.state, 'submitted'); assert.equal(seg.approval, null);
    assert.equal(voice.voice.provider, 'elevenlabs'); assert.equal(voice.verification.method, 'ffmpeg-full-decode/2');
    assert.deepEqual(voice.voice.turns.map(t => t.presenter), ['presenter-1', 'presenter-2']);
    assert.ok(x.echo.desk.state.audit.some(e => e.action === 'voice_rendered'));
    // Not approved yet: cannot publish.
    const early = await x.post('/api/publish', x.T.P);
    assert.equal(early.status, 409); assert.match(early.body.message, /Outro not approved/);
    // The producer approves this revision, bound to these exact bytes.
    assert.equal((await x.post('/api/segments/outro/review', x.T.P, {revision: seg.revision, decision: 'approved'})).status, 200);
    assert.ok(x.echo.desk.state.segments.outro.approval.assetHashes.includes(voice.sha256));
    const m = (await x.post('/api/publish', x.T.P)).body;
    const outro = m.segments.find(s => s.id === 'outro');
    assert.equal(outro.content.host.audio, `/media/${voice.sha256}`); assert.match(outro.content.host.credit, /synthetic voice \(ElevenLabs\)/);
    assert.equal(outro.content.host.turns.length, 2);
    const served = await x.get(outro.content.host.audio);
    assert.equal(served.status, 200); assert.equal(sha(served.bytes), voice.sha256, 'viewers receive exactly the approved bytes');
  } finally { await x.stop(); await mock.close(); }
});

test('a new render (different text) is a new revision: the earlier approval no longer counts', async () => {
  const mock = await startMockElevenLabs(), x = await start(mock);
  try {
    await x.post('/api/segments/outro/voice', x.T.P, {lines: KA, lang: 'ka'});
    const rev = x.echo.desk.state.segments.outro.revision;
    await x.post('/api/segments/outro/review', x.T.P, {revision: rev, decision: 'approved'});
    const again = await x.post('/api/segments/outro/voice', x.T.P, {lines: [KA[0], {...KA[1], text: KA[1].text + ' დამატებით.'}], lang: 'ka'});
    assert.equal(again.status, 200);
    const seg = x.echo.desk.state.segments.outro;
    assert.equal(seg.revision, rev + 1); assert.equal(seg.approval, null);
    assert.equal((await x.post('/api/publish', x.T.P)).status, 409, 'publication refused until the new audio is approved');
    // Same text again: served from cache, no second paid call.
    await x.post('/api/segments/outro/voice', x.T.P, {lines: KA, lang: 'ka'});
    assert.equal(mock.calls.length, 2, 'the first script was cached; only the changed one rendered');
  } finally { await x.stop(); await mock.close(); }
});

test('only the owner (or producer for house segments) can voice; agents and other creators are refused before any render', async () => {
  const mock = await startMockElevenLabs(), x = await start(mock);
  try {
    const agent = await x.post('/api/segments/outro/voice', x.T.a, {lines: KA, lang: 'ka'});
    assert.equal(agent.status, 403);
    const creator = await x.post('/api/segments/outro/voice', x.T.A, {lines: KA, lang: 'ka'});
    assert.equal(creator.status, 403);
    const wrongModule = await x.post('/api/segments/gallery/voice', x.T.A, {lines: KA, lang: 'ka'});
    assert.equal(wrongModule.status, 422); assert.match(wrongModule.body.message, /no spoken part/);
    assert.equal(mock.calls.length, 0, 'nothing was rendered or paid for');
  } finally { await x.stop(); await mock.close(); }
});

test('no budget: nothing is sent and nothing changes; the reason is returned', async () => {
  const mock = await startMockElevenLabs(), x = await start(mock, {budget: '0'});
  try {
    const rev = x.echo.desk.state.segments.outro.revision;
    const r = await x.post('/api/segments/outro/voice', x.T.P, {lines: KA, lang: 'ka', order: ['elevenlabs', 'captions']});
    assert.equal(r.status, 422); assert.equal(r.body.error, 'voice_unavailable'); assert.match(r.body.message, /No voice budget is set/);
    assert.equal(mock.calls.length, 0); assert.equal(x.echo.desk.state.segments.outro.revision, rev);
  } finally { await x.stop(); await mock.close(); }
});

test('approved voice whose bytes change on disk is refused at publication (R2 media check applies)', async () => {
  const mock = await startMockElevenLabs(), x = await start(mock);
  try {
    await x.post('/api/segments/outro/voice', x.T.P, {lines: KA, lang: 'ka'});
    const seg = x.echo.desk.state.segments.outro, voice = seg.assets.find(a => a.id === 'voice');
    await x.post('/api/segments/outro/review', x.T.P, {revision: seg.revision, decision: 'approved'});
    writeFileSync(join(x.dataDir, 'uploads', voice.file), readFileSync(join(x.dataDir, 'uploads', voice.file)).subarray(0, 500));
    const p = await x.post('/api/publish', x.T.P);
    assert.equal(p.status, 409); assert.match(p.body.message, /voice could not be decoded/);
  } finally { await x.stop(); await mock.close(); }
});
