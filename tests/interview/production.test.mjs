// From an approved Creator Brief to the shared programme (3.2): segment preparation, rights gates at review,
// publication and start, withdrawal, dependent updates for other agents. People's actions here are test calls.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {start, completeInterview} from './helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MP3 = readFileSync(join(ROOT, 'tests/fixtures/tone-62s.mp3')), PNG = readFileSync(join(ROOT, 'tests/fixtures/swatch.png'));

async function prepared(x) {
  const m = (await x.upload(x.T.B, MP3, 'premiere.mp3', 'სატესტო ტრეკი')).body;
  await x.req('POST', `/api/library/media/${m.id}/rights`, x.T.B, {publicBroadcast: true, replays: true, confirm: true});
  const {id, act} = await completeInterview(x, x.T.B, m.id);
  const b = (await act('review')).body.brief;
  await act('approve', {version: b.version, hash: b.hash});
  const r = await x.req('POST', `/api/briefs/${id}/prepare`, x.T.B, {segmentId: 'premiere', assets: {track: m.id}});
  return {m, id, act, r};
}
const approveContent = (x, seg) => x.req('POST', `/api/segments/${seg}/review`, x.T.P, {revision: x.echo.desk.state.segments[seg].revision, decision: 'approved'});

test('an approved brief and an authorised file become the creator\'s segment: new revision, content review, then publication', async () => {
  const x = await start();
  try {
    const before = x.echo.desk.state.segments.premiere.revision, {m, r} = await prepared(x);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const seg = x.echo.desk.state.segments.premiere;
    assert.equal(seg.revision, before + 1); assert.equal(seg.state, 'submitted'); assert.equal(seg.approval, null);
    assert.equal(seg.assets.find(a => a.id === 'track').sha256, m.sha256);
    assert.equal((await x.req('POST', '/api/publish', x.T.P)).status, 409, 'not before content review');
    assert.equal((await approveContent(x, 'premiere')).status, 200);
    const pub = await x.req('POST', '/api/publish', x.T.P);
    assert.equal(pub.status, 200, JSON.stringify(pub.body));
    const p = pub.body.segments.find(s => s.id === 'premiere');
    assert.deepEqual(Object.keys(p.content.brief).sort(), ['aiInvolvement', 'category', 'displayName', 'hash', 'interviewId', 'quotes', 'title', 'version']);
    assert.equal(p.content.brief.displayName, 'ტესტ შემქმნელი');
    assert.ok(!JSON.stringify(pub.body).includes('ზღვის ხმამ'), 'private answers (inspiration) are not in the public programme');
    assert.equal((await x.req('GET', p.assets.find(a => a.id === 'track').url)).status, 200, 'the authorised file is now served by hash');
    assert.ok(x.echo.desk.state.audit.some(e => e.action === 'segment_prepared' && !e.private));
  } finally { await x.stop(); }
});

test('guards: unapproved brief, file outside the brief, no broadcast permission, wrong kind, someone else\'s segment, another creator\'s agent', async () => {
  const x = await start();
  try {
    const m = (await x.upload(x.T.B, MP3, 'a.mp3')).body, img = (await x.upload(x.T.B, PNG, 'c.png')).body, other = (await x.upload(x.T.B, MP3, 'b2.mp3', 'other')).body;
    await x.req('POST', `/api/library/media/${img.id}/rights`, x.T.B, {publicBroadcast: true, confirm: true});
    await x.req('POST', `/api/library/media/${other.id}/rights`, x.T.B, {publicBroadcast: true, confirm: true});
    await x.req('POST', `/api/library/media/${m.id}/rights`, x.T.B, {publicBroadcast: false, replays: true, confirm: true});
    const {id, act} = await completeInterview(x, x.T.B, m.id);
    await act('answer', {stepId: 'media', fields: {mediaIds: [m.id, img.id]}});
    const prep = assets => x.req('POST', `/api/briefs/${id}/prepare`, x.T.B, {segmentId: 'premiere', assets});
    assert.equal((await prep({track: m.id})).body.error, 'brief_not_approved');
    const b = x.echo.desk.state.interviews[id].brief; await act('approve', {version: b.version, hash: b.hash});
    assert.equal((await prep({track: other.id})).body.error, 'bad_request', 'file not in the approved brief');
    assert.equal((await prep({track: m.id})).body.error, 'rights_required', 'public broadcast not declared');
    assert.match((await prep({track: img.id})).body.message, /needs an audio file/);
    assert.equal((await x.req('POST', `/api/briefs/${id}/prepare`, x.T.B, {segmentId: 'gallery', assets: {}})).status, 403, "Bacho's segment");
    assert.equal((await x.req('POST', `/api/briefs/${id}/prepare`, x.T.a, {segmentId: 'premiere', assets: {}})).status, 404, "another creator's agent");
    assert.equal(x.echo.desk.state.segments.premiere.revision, 1, 'nothing changed');
  } finally { await x.stop(); }
});

test('withdrawing broadcast permission or the brief withdraws a ready publication; restoring permission allows a new one', async () => {
  const x = await start();
  try {
    const {m, id, act} = await prepared(x);
    await approveContent(x, 'premiere');
    const pub = (await x.req('POST', '/api/publish', x.T.P)).body;
    await x.req('POST', `/api/library/media/${m.id}/rights`, x.T.B, {publicBroadcast: false, replays: true, confirm: true});
    assert.equal(x.echo.desk.state.broadcast.state, 'queued'); assert.match(x.echo.desk.state.broadcast.withdrawn.reason, /broadcast permission withdrawn/);
    const g = await x.req('POST', '/api/golive', x.T.P, {delayMs: 0, publicationId: pub.publicationId, hash: pub.hash});
    assert.equal(g.status, 409); assert.equal(g.body.error, 'withdrawn');
    const again = await x.req('POST', '/api/publish', x.T.P);
    assert.equal(again.status, 409); assert.match(again.body.message, /track has no public-broadcast permission/);
    await x.req('POST', `/api/library/media/${m.id}/rights`, x.T.B, {publicBroadcast: true, replays: true, confirm: true});
    const pub2 = await x.req('POST', '/api/publish', x.T.P);
    assert.equal(pub2.status, 200); assert.equal(pub2.body.publicationId, pub.publicationId + 1, 'a new publication number');
    // Withdrawing the brief during the countdown cancels the start (N04 path).
    await x.req('POST', '/api/golive', x.T.P, {delayMs: 5000, publicationId: pub2.body.publicationId, hash: pub2.body.hash});
    await act('withdraw', {reason: 'changed my mind'});
    assert.equal(x.echo.desk.state.broadcast.state, 'queued'); assert.ok(x.echo.desk.state.broadcast.withdrawn.cancelledStartAt);
    assert.match((await x.req('POST', '/api/publish', x.T.P)).body.message, /creator withdrew its brief/);
  } finally { await x.stop(); }
});

test('a corrected and re-approved brief must be prepared again before it can air', async () => {
  const x = await start();
  try {
    const {m, id, act} = await prepared(x);
    await approveContent(x, 'premiere');
    await act('answer', {stepId: 'who', fields: {displayName: 'ახალი სახელი'}});
    const b = x.echo.desk.state.interviews[id].brief; await act('approve', {version: b.version, hash: b.hash});
    const p = await x.req('POST', '/api/publish', x.T.P);
    assert.equal(p.status, 409); assert.match(p.body.message, /brief changed since this segment was prepared/);
    await x.req('POST', `/api/briefs/${id}/prepare`, x.T.B, {segmentId: 'premiere', assets: {track: m.id}});
    await approveContent(x, 'premiere');
    const ok = await x.req('POST', '/api/publish', x.T.P);
    assert.equal(ok.status, 200); assert.equal(ok.body.segments.find(s => s.id === 'premiere').content.brief.displayName, 'ახალი სახელი');
  } finally { await x.stop(); }
});

test('dependent updates: preparing content during a negotiation voids earlier approvals and rebases the open proposal', async () => {
  const x = await start();
  try {
    const call = (path, token, body) => x.req('POST', path, token, body);
    const p = (await call('/api/proposals', x.T.a, {baseRevision: 1, changes: [{segmentId: 'gallery', duration: 45}], note: 'test'})).body;
    const r = Object.values(x.echo.desk.state.requests).find(q => q.toAgentId === 'agent-b');
    await call(`/api/requests/${r.id}/respond`, x.T.b, {decision: 'accept', duration: 5, message: 'ok'});
    await call(`/api/proposals/${p.id}/revise`, x.T.a, {changes: [{segmentId: 'gallery', duration: 45, content: {slides: [1, 2, 3].map(i => ({assetId: `art-${i}`, seconds: 15}))}}]});
    const v = x.echo.desk.state.proposals[p.id].version;
    assert.equal((await call(`/api/proposals/${p.id}/decision`, x.T.A, {version: v, decision: 'approve'})).status, 200);
    await prepared(x);
    const after = x.echo.desk.state.proposals[p.id];
    assert.equal(after.version, v + 1, 'new version for everyone to see'); assert.deepEqual(after.approvals, {}, "Bacho's earlier approval no longer counts");
    assert.equal(after.baseRevision, x.echo.desk.state.showRevision, 'rebased on the new programme revision');
    assert.ok(x.echo.desk.state.audit.some(e => e.action === 'approvals_reset'));
    assert.equal((await call(`/api/proposals/${p.id}/decision`, x.T.A, {version: v, decision: 'approve'})).status, 409, 'the stale version cannot be approved');
  } finally { await x.stop(); }
});

test("the creator's own agent may prepare from the approved brief; the result still needs the producer's review", async () => {
  const x = await start();
  try {
    const m = (await x.upload(x.T.B, MP3, 'a.mp3')).body;
    await x.req('POST', `/api/library/media/${m.id}/rights`, x.T.B, {publicBroadcast: true, confirm: true});
    const {id, act} = await completeInterview(x, x.T.B, m.id);
    assert.equal((await x.req('POST', `/api/briefs/${id}/prepare`, x.T.b, {segmentId: 'premiere', assets: {track: m.id}})).body.error, 'brief_not_approved', 'not before the creator approves');
    const b = x.echo.desk.state.interviews[id].brief; await act('approve', {version: b.version, hash: b.hash});
    const r = await x.req('POST', `/api/briefs/${id}/prepare`, x.T.b, {segmentId: 'premiere', assets: {track: m.id}});
    assert.equal(r.status, 200); assert.equal(r.body.state, 'submitted');
    assert.ok(x.echo.desk.state.audit.some(e => e.action === 'segment_prepared' && /agent \(for /.test(e.summary)));
    assert.equal((await x.req('POST', `/api/segments/premiere/review`, x.T.b, {revision: r.body.revision, decision: 'approved'})).status, 403, 'the agent cannot review it');
  } finally { await x.stop(); }
});
