// Regressions for the four P1 defects of the independent audit of 41b67cd (Q1–Q4), reproduced on that commit first.
// Each test fails on 41b67cd for the reported reason and passes on the unified build. Fixtures, not real creators.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, existsSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {start, SECRET} from './helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TONE = readFileSync(join(ROOT, 'tests/fixtures/tone-62s.mp3'));
const KEY = n => ({'idempotency-key': `ui-${n}`}); // the interview page and MCP send a key with every mutation
const WHO = {displayName: 'ტესტ შემქმნელი', workTitle: 'სატესტო სიმღერა', category: 'music'};

// Answers every step with Idempotency-Keys, the way the UI and MCP clients do.
async function keyedInterview(x, token, mediaId, tag, secret = SECRET) {
  const iv = (await x.req('POST', '/api/interviews', token, undefined, KEY(`${tag}-start`))).body;
  const act = (a, body, k) => x.req('POST', `/api/interviews/${iv.id}/${a}`, token, body, k ? KEY(`${tag}-${k}`) : {});
  await act('answer', {stepId: 'who', text: 'მუსიკოსი ვარ.', fields: WHO}, 'who');
  const secretResponse = await act('answer', {stepId: 'inspiration', text: secret}, 'inspiration');
  await act('answer', {stepId: 'process', text: 'ყველაფერი თავად ჩავწერე.', fields: {aiInvolvement: 'none'}}, 'process');
  await act('answer', {stepId: 'focus', text: 'რეფრენი.', fields: {preferredFormat: 'premiere', desiredAirtimeSec: 60}}, 'focus');
  await act('answer', {stepId: 'media', text: mediaId ? 'ეს ტრეკი.' : '', fields: {mediaIds: mediaId ? [mediaId] : []}}, 'media');
  if (!mediaId) await act('answer', {stepId: 'media', text: ''}, 'media2');
  await act('answer', {stepId: 'notes', text: ''}, 'notes');
  const brief = () => x.echo.desk.state.interviews[iv.id].brief;
  const approve = async k => { const b = brief(); return act('approve', {version: b.version, hash: b.hash}, k); };
  return {id: iv.id, act, approve, brief, secretReplay: () => act('answer', {stepId: 'inspiration', text: secret}, 'inspiration'), secretResponse};
}
async function authorisedTrack(x, token) {
  const m = (await x.upload(token, TONE, 'zghva.mp3', 'ზღვის სიმღერა')).body;
  await x.req('POST', `/api/library/media/${m.id}/rights`, token, {publicBroadcast: true, editing: true, replays: true, confirm: true});
  return m;
}
const persisted = x => readFileSync(join(x.echo.dataDir, 'state.json'), 'utf8');

test('Q1: deleting an interview erases its retry records; a replay returns 404, other interviews keep theirs, across a restart', async () => {
  let x = await start();
  const dataDir = x.echo.dataDir;
  const b = await keyedInterview(x, x.T.B, null, 'b'), a = await keyedInterview(x, x.T.A, null, 'a', 'სხვა შემქმნელის პასუხი, რომელიც უნდა დარჩეს');
  assert.equal(b.secretResponse.status, 200);
  assert.ok(persisted(x).includes(SECRET), 'precondition: the answer is in persisted state before deletion');
  assert.equal((await x.req('POST', `/api/interviews/${b.id}/delete`, x.T.B, undefined, KEY('b-delete'))).status, 200);
  assert.equal((await x.req('GET', `/api/interviews/${b.id}`, x.T.B)).status, 404);
  // The replay of the earlier answer must not return the deleted answer (41b67cd: 200 with the answer).
  const replay = await b.secretReplay();
  assert.equal(replay.status, 404, `replay after deletion answered ${replay.status}: ${JSON.stringify(replay.body).slice(0, 120)}`);
  assert.ok(!JSON.stringify(replay.body).includes(SECRET));
  const state = JSON.parse(persisted(x));
  assert.ok(!persisted(x).includes(SECRET), 'the deleted answer is gone from every persisted record, including retries');
  // Only the deletion receipt itself may remain (id and status, no content); every earlier record is gone.
  assert.ok(!Object.values(state.idempotency).some(e => JSON.stringify(e).includes(b.id) && e.body?.status !== 'deleted' && e.status !== 404), 'no successful retry record of the deleted interview remains (only the receipt and 404s)');
  // The other creator's retry records are intact: the same key replays the same outcome.
  const aReplay = await a.secretReplay();
  assert.equal(aReplay.status, 200); assert.ok(JSON.stringify(aReplay.body).includes(a.id));
  await x.stop();
  // Restart from disk: still 404, still no disclosure.
  x = await start({dataDir});
  const again = await x.req('POST', `/api/interviews/${b.id}/answer`, x.T.B, {stepId: 'inspiration', text: SECRET}, KEY('b-inspiration'));
  assert.equal(again.status, 404); assert.ok(!persisted(x).includes(SECRET));
  await x.stop();
});

test('Q2: rendered voice is private until published: anonymous, agent and wrong-owner GETs are 404; reviewers can preview; public after publication', async () => {
  const x = await start({hostVoiceEnabled: false});
  const lines = [{presenter: 'presenter-3', text: 'მოდით, ნუ ავჩქარდებით. აგენტები შეთანხმდნენ, მაგრამ ეთერში არაფერი არ გავა, სანამ ორივე ადამიანი ღილაკს არ დააჭერს.'}];
  const r = await x.req('POST', '/api/segments/interstitial/voice', x.T.P, {lines, lang: 'ka'});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const asset = r.body.assets.find(a => a.id === 'voice');
  assert.equal(asset.voice.provider, 'elevenlabs-sample'); assert.equal(asset.voice.approximateTiming, true);
  const cacheKey = readdirSync(join(x.echo.dataDir, 'voice-cache')).find(f => f.endsWith('.mp3')).slice(0, 64);
  for (const [who, token] of [['anonymous', null], ['agent', x.T.b], ['other creator', x.T.A]]) {
    assert.equal((await x.req('GET', `/media/${asset.sha256}`, token)).status, 404, `${who} could fetch draft voice bytes by hash`);
    assert.equal((await x.req('GET', `/voice/${cacheKey}.mp3`, token)).status, 404, `${who} could fetch draft voice bytes from the cache URL`);
  }
  assert.equal((await x.req('GET', `/media/${asset.sha256}`, x.T.P)).status, 200, 'the producer reviews the exact bytes');
  assert.equal((await x.req('GET', `/voice/${cacheKey}.mp3`, x.T.P)).status, 200);
  // Exact-hash review, publication: now the bytes are public (the viewer needs them).
  assert.equal((await x.req('POST', '/api/segments/interstitial/review', x.T.P, {revision: r.body.revision, decision: 'approved'})).status, 200);
  const pub = await x.req('POST', '/api/publish', x.T.P);
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  assert.equal(pub.body.segments.find(s => s.id === 'interstitial').content.host.audio, `/media/${asset.sha256}`);
  assert.equal((await x.req('GET', `/media/${asset.sha256}`, null)).status, 200);
  await x.stop();
});

test('Q3: a corrected and reapproved brief marks the prepared segment stale; it can be prepared again (kept by exact hash) and then publishes', async () => {
  const x = await start({hostVoiceEnabled: false});
  const m = await authorisedTrack(x, x.T.B), iv = await keyedInterview(x, x.T.B, m.id, 'b');
  assert.equal((await iv.approve('approve-1')).status, 200);
  const prep = await x.req('POST', `/api/briefs/${iv.id}/prepare`, x.T.B, {segmentId: 'premiere', assets: {track: m.id}});
  assert.equal(prep.status, 200, JSON.stringify(prep.body));
  let life = (await x.req('GET', '/api/library', x.T.B)).body.briefs.find(b => b.interviewId === iv.id).lifecycle;
  assert.equal(life.stale, false); assert.ok(life.steps.find(s => s.step === 'segment_prepared').done);
  // Correction: the creator fixes the work title, which voids the approval; then reapproves the new version.
  assert.equal((await iv.act('answer', {stepId: 'who', text: 'მუსიკოსი ვარ.', fields: {...WHO, workTitle: 'სწორი სათაური'}}, 'who-fix')).status, 200);
  assert.equal((await iv.act('review', {}, 'review2')).status, 200);
  assert.equal((await iv.approve('approve-2')).status, 200);
  life = (await x.req('GET', '/api/library', x.T.B)).body.briefs.find(b => b.interviewId === iv.id).lifecycle;
  assert.equal(life.stale, true, 'the lifecycle must say the prepared segment is stale (41b67cd: shown as done)');
  assert.equal(life.steps.find(s => s.step === 'segment_prepared').done, false);
  assert.equal(life.assets.find(a => a.id === 'track').creatorBound, true);
  await x.req('POST', '/api/segments/premiere/review', x.T.P, {revision: prep.body.revision, decision: 'approved'});
  assert.equal((await x.req('POST', '/api/publish', x.T.P)).status, 409, 'stale content must not publish');
  // The recovery the UI now offers: prepare again, keeping the same creator file by its exact hash.
  const again = await x.req('POST', `/api/briefs/${iv.id}/prepare`, x.T.B, {segmentId: 'premiere', assets: {track: {keep: m.sha256}}});
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.content.brief.title, 'სწორი სათაური');
  life = (await x.req('GET', '/api/library', x.T.B)).body.briefs.find(b => b.interviewId === iv.id).lifecycle;
  assert.equal(life.stale, false);
  assert.equal((await x.req('POST', '/api/segments/premiere/review', x.T.P, {revision: again.body.revision, decision: 'approved'})).status, 200);
  assert.equal((await x.req('POST', '/api/publish', x.T.P)).status, 200);
  await x.stop();
});

test('Q4: preparation needs an explicit final media selection: no mapping, a seeded file, or a brief without media cannot publish under the creator', async () => {
  const x = await start({hostVoiceEnabled: false});
  const seeded = x.echo.desk.state.segments.premiere.assets[0].sha256;
  // A brief without media (allowed to be approved, as unfinished briefs are) cannot be prepared with an empty mapping.
  const none = await keyedInterview(x, x.T.B, null, 'none');
  assert.ok(none.brief().missing.includes('mediaIds')); assert.equal((await none.approve('approve-1')).status, 200);
  const empty = await x.req('POST', `/api/briefs/${none.id}/prepare`, x.T.B, {segmentId: 'premiere', assets: {}});
  assert.equal(empty.status, 422, `empty mapping answered ${empty.status} (41b67cd: 200, seeded track under the creator's name)`);
  assert.equal(empty.body.error, 'media_selection_required');
  const keepSeeded = await x.req('POST', `/api/briefs/${none.id}/prepare`, x.T.B, {segmentId: 'premiere', assets: {track: {keep: seeded}}});
  assert.equal(keepSeeded.status, 422, 'the seeded demo track can never be kept under a creator brief');
  const seg = x.echo.desk.state.segments.premiere;
  assert.equal(seg.content.brief, undefined); assert.equal(seg.assets[0].sha256, seeded); assert.equal(seg.revision, 1);
  // Positive path: the brief lists an authorised file and the creator (or their agent) maps it explicitly.
  const m = await authorisedTrack(x, x.T.B), iv = await keyedInterview(x, x.T.B, m.id, 'b');
  const ap = await iv.approve('approve-1'); assert.equal(ap.status, 200, JSON.stringify(ap.body).slice(0, 300));
  const partial = await x.req('POST', `/api/briefs/${iv.id}/prepare`, x.T.b, {segmentId: 'premiere', assets: {}});
  assert.equal(partial.status, 422); assert.deepEqual(partial.body.details.slots, ['track']);
  const ok = await x.req('POST', `/api/briefs/${iv.id}/prepare`, x.T.b, {segmentId: 'premiere', assets: {track: m.id}});
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const track = ok.body.assets.find(a => a.id === 'track');
  assert.equal(track.libraryMediaId, m.id); assert.equal(track.sha256, m.sha256); assert.equal(track.credit, WHO.displayName);
  // Explicit reuse by exact hash is allowed only for that creator-bound file.
  assert.equal((await x.req('POST', `/api/briefs/${iv.id}/prepare`, x.T.B, {segmentId: 'premiere', assets: {track: {keep: m.sha256}}})).status, 200);
  assert.equal((await x.req('POST', `/api/briefs/${iv.id}/prepare`, x.T.B, {segmentId: 'premiere', assets: {track: {keep: seeded}}})).status, 422);
  await x.stop();
});

test('samples: only an exact approved script is served; bytes match the manifest; nothing else is rendered or billed', async () => {
  const x = await start({hostVoiceEnabled: false});
  const manifest = JSON.parse(readFileSync(join(ROOT, 'media/voice-samples/manifest.json'), 'utf8'));
  const cat = await x.req('GET', '/api/voice/samples', x.T.P);
  assert.equal(cat.status, 200); assert.equal(cat.body.dynamic, false); assert.equal(cat.body.samples.length, manifest.items.length);
  assert.equal((await x.req('GET', '/api/voice/samples', x.T.b)).status, 401);
  const miss = await x.req('POST', '/api/segments/outro/voice', x.T.P, {lines: [{presenter: 'presenter-2', text: 'ეს ტექსტი არასდროს არ ჩაწერილა.'}], lang: 'ka'});
  assert.equal(miss.status, 422, 'an unknown script must not be voiced (no key, no budget, no sample)');
  assert.ok(/no approved sample/.test(JSON.stringify(miss.body)));
  const item = manifest.items.find(i => i.id === 'dialogue-2');
  const hit = await x.req('POST', '/api/segments/outro/voice', x.T.P, {lines: [{presenter: item.presenter, text: item.text}], lang: 'ka'});
  assert.equal(hit.status, 200, JSON.stringify(hit.body));
  const a = hit.body.assets.find(z => z.id === 'voice');
  assert.equal(a.sha256, item.sha256, 'the served bytes are the original sample bytes');
  assert.equal(a.voice.provider, 'elevenlabs-sample'); assert.equal(a.voice.voiceIds[item.presenter], item.voice_id);
  assert.ok(Math.abs(a.voice.duration - item.duration_s) < .15);
  assert.ok(a.voice.captions.length >= 1 && a.voice.cues.length > 5);
  assert.equal((await x.req('GET', '/api/voice/status', x.T.P)).body.budget.billed, 0);
  assert.ok(!existsSync(join(x.echo.dataDir, 'voice-ledger.json')) || JSON.parse(readFileSync(join(x.echo.dataDir, 'voice-ledger.json'), 'utf8')).billedChars === 0);
  await x.stop();
});
