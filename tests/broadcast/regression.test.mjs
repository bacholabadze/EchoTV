// Regression tests for the independent release audit of 64d1dc5 (P0 and P1 findings).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createEchoServer} from '../../server/server.mjs';
import {BroadcastDesk, DomainError} from '../../server/domain.mjs';
import {seedState} from '../../server/seed.mjs';

const fixture = name => readFileSync(new URL(`../fixtures/${name}`, import.meta.url));
const PNG = fixture('swatch.png'), TONE = fixture('tone-62s.mp3'), SHORT = fixture('tone-4s.mp3');
const ART1 = readFileSync(new URL('../../media/art-1.jpg', import.meta.url));

async function start(dataDir = mkdtempSync(join(tmpdir(), 'echo-reg-')), options = {}) {
  const echo = createEchoServer({dataDir, quiet: true, hostVoiceEnabled: false, ...options});
  await new Promise(r => echo.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${echo.server.address().port}`, s = echo.desk.state;
  const T = {a: s.agents['agent-a'].token, b: s.agents['agent-b'].token, A: s.people['creator-a'].token, B: s.people['creator-b'].token, P: s.people.producer.token};
  const call = async (method, path, token, body, headers = {}) => {
    const r = await fetch(base + path, {method, headers: {'content-type': 'application/json', ...(token ? {authorization: `Bearer ${token}`} : {}), ...headers}, body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body)});
    return {status: r.status, body: await r.json(), replay: r.headers.get('idempotent-replay') === 'true'};
  };
  const upload = (seg, asset, token, bytes, name, headers = {}) => call('POST', `/api/segments/${seg}/media/${asset}`, token, bytes, {'content-type': 'application/octet-stream', 'x-filename': name, 'x-rights-declared': 'yes', ...headers});
  const stop = () => new Promise(r => { echo.server.closeAllConnections(); echo.server.close(r); });
  return {echo, base, T, call, upload, stop, dataDir};
}
// Drives the §24 negotiation to the point where all three people must approve v2.
async function negotiate(x) {
  const p = (await x.call('POST', '/api/proposals', x.T.a, {baseRevision: x.echo.desk.state.showRevision, changes: [{segmentId: 'gallery', duration: 45}]})).body;
  const req = Object.values(x.echo.desk.state.requests).find(r => r.proposalId === p.id && r.toAgentId === 'agent-b');
  await x.call('POST', `/api/requests/${req.id}/respond`, x.T.b, {decision: 'accept', duration: 5});
  return (await x.call('POST', `/api/proposals/${p.id}/revise`, x.T.a, {changes: [{segmentId: 'gallery', duration: 45, content: {slides: [1, 2, 3].map(i => ({assetId: `art-${i}`, seconds: 15}))}}]})).body;
}

// ---------- P0-1 ----------
test('P0-1: a published asset stays immutable and reachable after the owner uploads a newer draft', async () => {
  const x = await start();
  try {
    const m = (await x.call('POST', '/api/publish', x.T.P)).body;
    const published = m.segments.find(s => s.id === 'gallery').assets.find(a => a.id === 'art-1').url;
    const up = await x.upload('gallery', 'art-1', x.T.A, PNG, 'draft.png');
    assert.equal(up.status, 200);
    const old = await fetch(x.base + published);
    assert.equal(old.status, 200, 'published URL still served');
    assert.deepEqual(Buffer.from(await old.arrayBuffer()), ART1, 'exactly the published bytes');
    const draft = up.body.assets.find(a => a.id === 'art-1');
    assert.deepEqual(Buffer.from(await (await fetch(`${x.base}/media/${draft.sha256}`)).arrayBuffer()), PNG, 'new draft served by its own hash');
    // Survives a restart and a rehearsal reset.
    await x.stop(); const y = await start(x.dataDir);
    try {
      assert.equal((await fetch(y.base + published)).status, 200, 'after restart');
      assert.equal((await y.call('POST', '/api/reset', y.T.P)).status, 200);
      assert.equal((await fetch(`${y.base}/media/${draft.sha256}`)).status, 200, 'draft upload still reachable after reset');
      assert.equal((await fetch(`${y.base}/media/../../package.json`)).status, 404);
      assert.equal((await fetch(`${y.base}/media/${'0'.repeat(64)}`)).status, 404);
    } finally { await y.stop(); }
  } finally { await x.stop().catch(() => {}); }
});

// ---------- P0-2 ----------
test('P0-2: a media change voids approvals already given; the old version can neither be approved nor committed', async () => {
  const x = await start();
  try {
    const v2 = await negotiate(x);
    assert.equal(v2.status, 'awaiting_approval');
    assert.equal((await x.call('POST', `/api/proposals/${v2.id}/decision`, x.T.B, {version: v2.version, decision: 'approve'})).status, 200);
    assert.equal((await x.call('POST', `/api/proposals/${v2.id}/decision`, x.T.A, {version: v2.version, decision: 'approve'})).status, 200);
    // B's intro media changes after both owners approved.
    assert.equal((await x.upload('intro', 'track', x.T.B, TONE, 'new-intro.mp3')).status, 200);
    let p = x.echo.desk.state.proposals[v2.id];
    assert.deepEqual(p.approvals, {}, 'earlier approvals are void');
    assert.equal(p.version, v2.version + 1);
    const late = await x.call('POST', `/api/proposals/${v2.id}/decision`, x.T.P, {version: v2.version, decision: 'approve'});
    assert.equal(late.status, 409); assert.equal(late.body.error, 'stale_revision');
    assert.equal(x.echo.desk.state.revisions.filter(r => r.proposalId === v2.id).length, 0, 'nothing committed from the old version');
    // Everyone approves what they now see; commit happens, but the changed intro still needs editorial review to publish.
    for (const t of [x.T.A, x.T.B, x.T.P]) assert.equal((await x.call('POST', `/api/proposals/${v2.id}/decision`, t, {version: p.version, decision: 'approve'})).status, 200);
    p = x.echo.desk.state.proposals[v2.id];
    assert.equal(p.status, 'committed');
    const pub = await x.call('POST', '/api/publish', x.T.P);
    assert.equal(pub.status, 409); assert.match(pub.body.message, /Music intro not approved for its current revision/);
  } finally { await x.stop(); }
});

test('P0-2: commit re-checks the segment revisions the approvers saw (defence in depth)', () => {
  let t = 0; const d = new BroadcastDesk(seedState(), {now: () => (t += 10)});
  const A = {type: 'agent', id: 'agent-a'}, B = {type: 'agent', id: 'agent-b'};
  const p = d.proposeChange(A, {baseRevision: 1, changes: [{segmentId: 'gallery', duration: 45}]});
  d.respondToRequest(B, {requestId: Object.values(d.state.requests)[0].id, decision: 'accept', duration: 5});
  d.reviseProposal(A, {proposalId: p.id, changes: [{segmentId: 'gallery', duration: 45, content: {slides: [1, 2, 3].map(i => ({assetId: `art-${i}`, seconds: 15}))}}]});
  for (const id of ['creator-a', 'creator-b']) d.decideProposal({type: 'person', id}, {proposalId: p.id, version: 2, decision: 'approve'});
  d.state.segments.intro.revision++; // any path that changes a touched segment without going through the proposal
  assert.throws(() => d.decideProposal({type: 'person', id: 'producer'}, {proposalId: p.id, version: 2, decision: 'approve'}), e => e instanceof DomainError && e.code === 'stale_revision');
  assert.equal(d.state.showRevision, 1);
});

// ---------- P1 ----------
test('P1: invalid booking intervals are refused', async () => {
  const x = await start();
  try {
    for (const [start, duration] of [[-5, 10], [0, 0], [0, -3], [115, 30], [1.5, 10], [0, 9999], ['0', 30]])
      assert.equal((await x.call('POST', '/api/slots/hold', x.T.a, {segmentId: 'gallery', start, duration})).status, 422, `${start}+${duration}`);
    assert.equal((await x.call('POST', '/api/slots/hold', x.T.a, {segmentId: 'gallery', start: 0, duration: 50})).status, 422, 'longer than the segment allows');
    const overlap = await x.call('POST', '/api/slots/hold', x.T.a, {segmentId: 'gallery', start: 40, duration: 30});
    assert.equal(overlap.status, 409); assert.equal(overlap.body.error, 'slot_taken', 'overlaps the confirmed premiere');
    assert.equal((await x.call('POST', '/api/slots/hold', x.T.a, {segmentId: 'gallery', start: 10, duration: 30})).status, 200);
  } finally { await x.stop(); }
});

test('P1: publication numbers are never reused, across content changes and rehearsal resets', async () => {
  const x = await start();
  try {
    const m1 = (await x.call('POST', '/api/publish', x.T.P)).body;
    const up = await x.upload('premiere', 'track', x.T.B, TONE, 'take2.mp3');
    assert.equal((await x.call('POST', '/api/segments/premiere/review', x.T.P, {revision: up.body.revision, decision: 'approved'})).status, 200);
    await x.call('POST', '/api/segments/intro/review', x.T.P, {revision: x.echo.desk.state.segments.intro.revision, decision: 'approved'});
    const m2 = (await x.call('POST', '/api/publish', x.T.P)).body;
    assert.notEqual(m2.publishRevision, m1.publishRevision, 'different content, different revision');
    await x.call('POST', '/api/reset', x.T.P);
    const m3 = (await x.call('POST', '/api/publish', x.T.P)).body;
    assert.deepEqual([m1.publicationId, m2.publicationId, m3.publicationId], [1, 2, 3]);
  } finally { await x.stop(); }
});

test('P1: go-live requires the exact current publication', async () => {
  const x = await start();
  try {
    const m1 = (await x.call('POST', '/api/publish', x.T.P)).body;
    for (const body of [{}, {publicationId: m1.publicationId}, {publicationId: m1.publicationId, hash: 'x'}, {publicationId: 99, hash: m1.hash}])
      assert.equal((await x.call('POST', '/api/golive', x.T.P, {delayMs: 0, ...body})).body.error, 'stale_manifest');
    assert.equal((await x.call('POST', '/api/golive', x.T.P, {delayMs: -48000, publicationId: m1.publicationId, hash: m1.hash})).status, 422, 'no backdating');
    // A newer committed revision makes the ready publication stale.
    const v2 = await negotiate(x);
    for (const t of [x.T.A, x.T.B, x.T.P]) await x.call('POST', `/api/proposals/${v2.id}/decision`, t, {version: v2.version, decision: 'approve'});
    const stale = await x.call('POST', '/api/golive', x.T.P, {delayMs: 0, publicationId: m1.publicationId, hash: m1.hash});
    assert.equal(stale.status, 409); assert.match(stale.body.message, /now at revision 2/);
    const m2 = (await x.call('POST', '/api/publish', x.T.P)).body;
    assert.equal((await x.call('POST', '/api/golive', x.T.P, {delayMs: 0, publicationId: m2.publicationId, hash: m2.hash})).status, 200);
  } finally { await x.stop(); }
});

test('P1: retries with the same Idempotency-Key act once and replay the first outcome', async () => {
  const x = await start();
  try {
    const key = {'idempotency-key': 'retry-propose-0001'}, body = {baseRevision: 1, changes: [{segmentId: 'gallery', duration: 45}]};
    const first = await x.call('POST', '/api/proposals', x.T.a, body, key);
    const retry = await x.call('POST', '/api/proposals', x.T.a, body, key);
    assert.equal(retry.status, 200); assert.equal(retry.replay, true); assert.equal(retry.body.id, first.body.id);
    assert.equal(Object.keys(x.echo.desk.state.proposals).length, 1, 'acted once');
    assert.equal((await x.call('GET', '/api/state')).body.idempotency, undefined, 'retry records are not public');
    const misuse = await x.call('POST', '/api/proposals', x.T.a, {...body, note: 'different'}, key);
    assert.equal(misuse.body.error, 'idempotency_conflict');
    // The same key from another identity is a different request.
    const other = await x.call('POST', '/api/slots/hold', x.T.b, {segmentId: 'intro', start: 0, duration: 10}, key);
    assert.equal(other.status, 200); assert.equal(other.replay, false);
    // Refusals replay too, and replays survive a restart.
    const req = Object.values(x.echo.desk.state.requests)[0];
    const k2 = {'idempotency-key': 'retry-respond-0001'};
    const ans = await x.call('POST', `/api/requests/${req.id}/respond`, x.T.b, {decision: 'accept', duration: 5}, k2);
    await x.stop(); const y = await start(x.dataDir);
    try {
      const again = await y.call('POST', `/api/requests/${req.id}/respond`, y.T.b, {decision: 'accept', duration: 5}, k2);
      assert.equal(again.replay, true); assert.deepEqual(again.body, ans.body);
      assert.equal(y.echo.desk.state.audit.filter(e => e.action === 'request_answered').length, 1);
      const upKey = {'idempotency-key': 'retry-upload-0001'};
      const u1 = await y.upload('gallery', 'art-2', y.T.A, PNG, 'a.png', upKey), u2 = await y.upload('gallery', 'art-2', y.T.A, PNG, 'a.png', upKey);
      assert.equal(u2.replay, true); assert.equal(u2.body.revision, u1.body.revision, 'upload applied once');
    } finally { await y.stop(); }
  } finally { await x.stop().catch(() => {}); }
});

test('P1: undecodable, mismatched or too-short media never reaches publication', async () => {
  const x = await start();
  try {
    for (const [bytes, name] of [[Buffer.from('this is not audio'), 'fake.mp3'], [Buffer.concat([Buffer.from('ID3'), Buffer.alloc(4000, 7)]), 'sneaky.mp3'], [PNG, 'image.mp3'], [TONE, 'audio.png']]) {
      const r = await x.upload('premiere', 'track', x.T.B, bytes, name);
      assert.equal(r.status, 422, name); assert.equal(r.body.error, 'undecodable_media', name);
    }
    assert.equal((await x.upload('gallery', 'art-1', x.T.A, TONE, 'tone.mp3')).status, 422, 'audio in an image slot');
    assert.equal(x.echo.desk.state.segments.premiere.revision, 1, 'nothing changed');
    const short = await x.upload('premiere', 'track', x.T.B, SHORT, 'short.mp3');
    assert.equal(short.status, 200); assert.equal(short.body.assets[0].durationSec, 4);
    await x.call('POST', '/api/segments/premiere/review', x.T.P, {revision: short.body.revision, decision: 'approved'});
    await x.call('POST', '/api/segments/intro/review', x.T.P, {revision: x.echo.desk.state.segments.intro.revision, decision: 'approved'});
    const pub = await x.call('POST', '/api/publish', x.T.P);
    assert.equal(pub.status, 409); assert.match(pub.body.message, /audio is 4\.0s but the slot needs 60s/);
  } finally { await x.stop(); }
});

test('P1: /api/time gives a round-trip-correctable clock independent of SSE delivery', async () => {
  const x = await start(undefined, {sseDelayMs: 1500});
  try {
    const t0 = Date.now(), {serverTime} = (await x.call('GET', '/api/time')).body, t1 = Date.now();
    assert.ok(serverTime >= t0 && serverTime <= t1);
  } finally { await x.stop(); }
});
