import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createEchoServer} from '../../server/server.mjs';

let echo, base, dataDir, tokens;
const start = async () => {
  echo = createEchoServer({dataDir, quiet: true});
  await new Promise(r => echo.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${echo.server.address().port}`;
  const s = echo.desk.state;
  tokens = {a: s.agents['agent-a'].token, b: s.agents['agent-b'].token, creatorA: s.people['creator-a'].token, creatorB: s.people['creator-b'].token, producer: s.people.producer.token};
};
const stop = () => new Promise(r => { echo.server.closeAllConnections(); echo.server.close(r); });
const call = async (method, path, token, body) => {
  const res = await fetch(base + path, {method, headers: {'content-type': 'application/json', ...(token ? {authorization: `Bearer ${token}`} : {})}, body: body && JSON.stringify(body)});
  return {status: res.status, body: await res.json()};
};

before(async () => { dataDir = mkdtempSync(join(tmpdir(), 'echo-http-')); await start(); });
after(stop);

test('public state never exposes credentials', async () => {
  const {status, body} = await call('GET', '/api/state');
  assert.equal(status, 200);
  const text = JSON.stringify(body);
  for (const t of Object.values(tokens)) assert.ok(!text.includes(t));
  assert.equal(body.showRevision, 1);
});

test('roles: anonymous, agents and creators cannot do producer actions', async () => {
  assert.equal((await call('POST', '/api/publish')).status, 401);
  assert.equal((await call('POST', '/api/publish', 'not-a-token')).status, 401);
  assert.equal((await call('POST', '/api/publish', tokens.a)).status, 403);
  assert.equal((await call('POST', '/api/publish', tokens.creatorA)).status, 403);
  assert.equal((await call('GET', '/api/me', tokens.b)).body.id, 'agent-b');
});

test('agent inbox long-poll wakes when the Showrunner addresses that agent', async () => {
  const waiting = call('GET', '/api/agent/inbox?wait=10', tokens.b);
  await new Promise(r => setTimeout(r, 150));
  const t0 = Date.now();
  const proposal = await call('POST', '/api/proposals', tokens.a, {baseRevision: 1, changes: [{segmentId: 'gallery', duration: 45}]});
  assert.equal(proposal.status, 200, JSON.stringify(proposal.body));
  const inbox = await waiting;
  assert.ok(Date.now() - t0 < 2000, 'woke promptly');
  assert.equal(inbox.body.requests.length, 1);
  assert.equal(inbox.body.requests[0].segmentId, 'intro');
  // B answers over HTTP, A adapts, the three humans approve.
  assert.equal((await call('POST', `/api/requests/${inbox.body.requests[0].id}/respond`, tokens.b, {decision: 'accept', duration: 5, message: 'Premiere stays put'})).status, 200);
  const toA = (await call('GET', '/api/agent/inbox', tokens.a)).body.requests[0];
  assert.equal(toA.type, 'revise');
  const revised = await call('POST', `/api/proposals/${toA.proposalId}/revise`, tokens.a, {changes: [{segmentId: 'gallery', duration: 45, content: {slides: [1, 2, 3].map(i => ({assetId: `art-${i}`, seconds: 15}))}}]});
  assert.equal(revised.body.status, 'awaiting_approval');
  for (const who of ['creatorA', 'creatorB', 'producer']) {
    const r = await call('POST', `/api/proposals/${toA.proposalId}/decision`, tokens[who], {version: revised.body.version, decision: 'approve'});
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  const state = (await call('GET', '/api/state')).body;
  assert.equal(state.showRevision, 2);
  assert.equal(state.layout.find(e => e.segmentId === 'premiere').start, 50);
});

test('concurrent double confirmation over HTTP: exactly one succeeds', async () => {
  const d = echo.desk;
  d.state.segments.rival = {...structuredClone(d.state.segments.gallery), id: 'rival', title: 'Rival', ownerId: 'creator-a'};
  d.state.segments.rival2 = {...structuredClone(d.state.segments.gallery), id: 'rival2', title: 'Rival 2', ownerId: 'creator-b'};
  assert.equal((await call('POST', '/api/slots/hold', tokens.a, {segmentId: 'rival', start: 200, duration: 30})).status, 200);
  assert.equal((await call('POST', '/api/slots/hold', tokens.b, {segmentId: 'rival2', start: 210, duration: 30})).status, 200);
  const results = await Promise.all(['rival', 'rival2'].map(segmentId => call('POST', '/api/slots/confirm', tokens.producer, {segmentId})));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(results.find(r => r.status === 409).body.error, 'slot_taken');
});

test('state survives a server restart', async () => {
  const before = (await call('GET', '/api/state')).body;
  await stop(); await start();
  const after = (await call('GET', '/api/state')).body;
  assert.equal(after.showRevision, before.showRevision);
  assert.equal(after.seq, before.seq);
  assert.equal((await call('GET', '/api/me', tokens.a)).body.id, 'agent-a', 'tokens persist');
});

test('SSE pushes the new state to viewers after publish', async () => {
  const controller = new AbortController();
  const res = await fetch(base + '/api/events', {signal: controller.signal});
  const reader = res.body.getReader(), decoder = new TextDecoder();
  let buffer = '';
  const nextState = async predicate => {
    for (;;) {
      const {value} = await reader.read(); buffer += decoder.decode(value);
      for (const block of buffer.split('\n\n').slice(0, -1)) {
        if (/^event: state$/m.test(block)) { const s = JSON.parse(block.slice(block.indexOf('data: ') + 6)); if (predicate(s)) return s; }
      }
      buffer = buffer.slice(buffer.lastIndexOf('\n\n') + 2);
    }
  };
  await nextState(() => true);
  // The race test left a confirmed slot outside the programme; publishing must refuse that until a reset.
  assert.equal((await call('POST', '/api/publish', tokens.producer)).body.error, 'not_publishable');
  assert.equal((await call('POST', '/api/reset', tokens.a)).status, 403);
  assert.equal((await call('POST', '/api/reset', tokens.producer)).status, 200);
  const published = await call('POST', '/api/publish', tokens.producer);
  assert.equal(published.status, 200, JSON.stringify(published.body));
  const s = await nextState(x => x.broadcast.state === 'ready');
  assert.equal(s.broadcast.manifest.hash, published.body.hash);
  controller.abort();
});

test('static site and range requests are served', async () => {
  const page = await fetch(base + '/studio/');
  assert.equal(page.status, 200);
  const audio = await fetch(base + '/studio/audio/01.mp3', {headers: {range: 'bytes=0-99'}});
  assert.equal(audio.status, 206);
  assert.equal((await audio.arrayBuffer()).byteLength, 100);
  assert.equal((await fetch(base + '/../package.json')).status, 404);
});

test('owner media upload: hashed, served by hash, approval invalidated until re-reviewed', async () => {
  const bytes = Buffer.from('ID3 fake audio for upload test');
  const up = await fetch(`${base}/api/segments/premiere/media/track`, {method: 'POST', body: bytes, headers: {authorization: `Bearer ${tokens.creatorB}`, 'x-filename': 'new.mp3', 'x-rights-declared': 'yes', 'x-title': 'New%20take'}});
  assert.equal(up.status, 200);
  const seg = (await up.json());
  const hash = seg.assets.find(a => a.id === 'track').sha256;
  assert.equal(seg.state, 'submitted');
  assert.equal((await call('POST', '/api/publish', tokens.producer)).body.error, 'not_publishable');
  const served = await fetch(`${base}/media/${hash}`);
  assert.equal(served.status, 200);
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), bytes);
  const wrongOwner = await fetch(`${base}/api/segments/premiere/media/track`, {method: 'POST', body: bytes, headers: {authorization: `Bearer ${tokens.creatorA}`, 'x-filename': 'x.mp3', 'x-rights-declared': 'yes'}});
  assert.equal(wrongOwner.status, 403);
  assert.equal((await call('POST', '/api/segments/premiere/review', tokens.producer, {revision: seg.revision, decision: 'approved'})).status, 200);
  assert.equal((await call('POST', '/api/publish', tokens.producer)).status, 200);
});
