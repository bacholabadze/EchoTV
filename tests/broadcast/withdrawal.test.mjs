// N04 policy (approved, option 1): turning down content in a ready publication withdraws it before air.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createEchoServer} from '../../server/server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PNG = readFileSync(join(ROOT, 'tests/fixtures/swatch.png'));

async function start() {
  const echo = createEchoServer({dataDir: mkdtempSync(join(tmpdir(), 'echo-n04-')), quiet: true, hostVoiceEnabled: false});
  await new Promise(r => echo.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${echo.server.address().port}`, s = echo.desk.state;
  const T = {a: s.agents['agent-a'].token, b: s.agents['agent-b'].token, A: s.people['creator-a'].token, B: s.people['creator-b'].token, P: s.people.producer.token};
  const post = async (path, token, body, headers = {}) => {
    const r = await fetch(base + path, {method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${token}`, ...headers}, body: Buffer.isBuffer(body) ? body : JSON.stringify(body || {})});
    return {status: r.status, body: await r.json()};
  };
  const review = (seg, decision, note, token = T.P) => post(`/api/segments/${seg}/review`, token, {revision: echo.desk.state.segments[seg].revision, decision, note});
  const goLive = m => post('/api/golive', T.P, {delayMs: 0, publicationId: m.publicationId, hash: m.hash});
  const snapshot = () => JSON.parse(JSON.stringify({layout: echo.desk.layout(), bookings: echo.desk.state.bookings,
    others: Object.fromEntries(Object.entries(echo.desk.state.segments).filter(([id]) => id !== 'gallery').map(([id, x]) => [id, {revision: x.revision, approval: x.approval, assets: x.assets}]))}));
  return {echo, T, post, review, goLive, snapshot, stop: () => new Promise(r => { echo.server.closeAllConnections(); echo.server.close(r); })};
}

test('rejecting content in the ready publication withdraws it; go-live refuses with the reason; everything is logged', async () => {
  const x = await start();
  try {
    const m = (await x.post('/api/publish', x.T.P)).body;
    const before = x.snapshot();
    assert.equal((await x.review('gallery', 'rejected', 'Rights for art-2 not confirmed')).status, 200);
    const s = x.echo.desk.state;
    assert.equal(s.broadcast.state, 'queued'); assert.equal(s.broadcast.manifest, null);
    const w = s.withdrawals[m.publicationId];
    assert.deepEqual({publicationId: w.publicationId, publishRevision: w.publishRevision, hash: w.hash, segmentId: w.segmentId, decision: w.decision, reason: w.reason, by: w.by},
      {publicationId: m.publicationId, publishRevision: 1, hash: m.hash, segmentId: 'gallery', decision: 'rejected', reason: 'Rights for art-2 not confirmed', by: 'producer'});
    assert.ok(Number.isFinite(w.at), 'timestamp');
    const entry = s.audit.find(e => e.action === 'publication_withdrawn');
    assert.ok(entry && entry.actor.id === 'producer' && entry.publicationId === m.publicationId && entry.revision === 1 && entry.reason === w.reason && Number.isFinite(entry.at));
    const live = await x.goLive(m);
    assert.equal(live.status, 409); assert.equal(live.body.error, 'withdrawn');
    assert.match(live.body.message, /Publication #1 was withdrawn before air by ECHO Producer .*Rights for art-2 not confirmed/);
    assert.deepEqual(x.snapshot(), before, 'confirmed airtime, the running order and other creators’ segments are unchanged');
  } finally { await x.stop(); }
});

test('republishing requires corrected content that passes review; the withdrawn publication stays withdrawn', async () => {
  const x = await start();
  try {
    const m1 = (await x.post('/api/publish', x.T.P)).body;
    await x.review('gallery', 'rejected', 'Wrong artwork');
    const retry = await x.post('/api/publish', x.T.P);
    assert.equal(retry.status, 409); assert.match(retry.body.message, /Art gallery not approved/);
    const reapprove = await x.review('gallery', 'approved');
    assert.equal(reapprove.status, 409); assert.equal(reapprove.body.error, 'rejected_revision', 'the rejected revision cannot simply be re-approved');
    // The owner corrects the content (new revision), the producer reviews it, the producer publishes again.
    const fixed = await x.post('/api/segments/gallery/media/art-2', x.T.A, PNG, {'content-type': 'application/octet-stream', 'x-filename': 'fixed.png', 'x-rights-declared': 'yes'});
    assert.equal(fixed.status, 200);
    assert.equal((await x.review('gallery', 'approved')).status, 200);
    const m2 = (await x.post('/api/publish', x.T.P)).body;
    assert.equal(m2.publicationId, m1.publicationId + 1); assert.notEqual(m2.publishRevision, m1.publishRevision);
    assert.equal((await x.goLive(m1)).body.error, 'withdrawn', 'old publication still refused');
    assert.equal((await x.goLive(m2)).status, 200);
    assert.ok(x.echo.desk.state.withdrawals[m1.publicationId], 'withdrawal kept in history');
  } finally { await x.stop(); }
});

test('"needs changes" also withdraws; turning down content that is not in the ready publication changes nothing', async () => {
  const x = await start();
  try {
    await x.post('/api/publish', x.T.P);
    await x.review('premiere', 'needs_changes', 'Fade-out too abrupt');
    assert.equal(x.echo.desk.state.broadcast.state, 'queued');
    assert.equal(x.echo.desk.state.broadcast.withdrawn.decision, 'needs_changes');
  } finally { await x.stop(); }
  const y = await start();
  try {
    // Agree r2 (interstitial cut to 0 s, so it is not part of the publication), publish, then turn the interstitial down.
    const p = (await y.post('/api/proposals', y.T.a, {baseRevision: 1, changes: [{segmentId: 'gallery', duration: 45}]})).body;
    await y.post(`/api/requests/${Object.values(y.echo.desk.state.requests)[0].id}/respond`, y.T.b, {decision: 'accept', duration: 5});
    const v = (await y.post(`/api/proposals/${p.id}/revise`, y.T.a, {changes: [{segmentId: 'gallery', duration: 45, content: {slides: [1, 2, 3].map(i => ({assetId: `art-${i}`, seconds: 15}))}}]})).body;
    for (const t of [y.T.A, y.T.B, y.T.P]) await y.post(`/api/proposals/${p.id}/decision`, t, {version: v.version, decision: 'approve'});
    const m = (await y.post('/api/publish', y.T.P)).body;
    assert.ok(!m.segments.some(s => s.id === 'interstitial'));
    assert.equal((await y.review('interstitial', 'rejected', 'Not needed')).status, 200);
    assert.equal(y.echo.desk.state.broadcast.state, 'ready', 'publication unaffected');
    assert.equal(y.echo.desk.state.withdrawals, undefined);
    assert.equal((await y.goLive(m)).status, 200);
  } finally { await y.stop(); }
});

test('on air, rejection never interrupts playback; Stop broadcast still works; only the producer can reject', async () => {
  const x = await start();
  try {
    const m = (await x.post('/api/publish', x.T.P)).body;
    assert.equal((await x.goLive(m)).status, 200);
    for (const t of [x.T.a, x.T.A, x.T.B]) assert.equal((await x.review('gallery', 'rejected', 'x', t)).status, 403);
    assert.equal((await x.review('gallery', 'rejected', 'Late rights complaint')).status, 200);
    const s = x.echo.desk.state;
    assert.equal(s.broadcast.state, 'on_air'); assert.equal(s.broadcast.manifest.hash, m.hash, 'playback continues with the same publication');
    assert.equal(s.withdrawals, undefined);
    const logged = s.audit.find(e => e.action === 'rejected_on_air');
    assert.ok(logged && /Playback continues; use Stop broadcast/.test(logged.summary));
    assert.equal((await x.post('/api/broadcast/fail', x.T.P, {reason: 'rights complaint'})).body.state, 'failed', 'Stop broadcast');
  } finally { await x.stop(); }
});
