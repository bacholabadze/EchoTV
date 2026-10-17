// Regression tests for Codex's independent regression run of 3e0c846 (R2 and R3; R1 is a browser test:
// tests/browser/art-display-fault.mjs). Each test failed on 3e0c846.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createEchoServer, demoMedia} from '../../server/server.mjs';
import {seedState} from '../../server/seed.mjs';
import * as domain from '../../server/domain.mjs';

const {BroadcastDesk, sha256} = domain, FULL_DECODE = domain.MEDIA_CHECKS?.[0] ?? 'ffmpeg-full-decode/2'; // namespace import: this file also runs on 3e0c846

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PNG = readFileSync(join(ROOT, 'tests/fixtures/swatch.png')), HEADER_ONLY = PNG.subarray(0, 33);

async function start(options = {}) {
  const echo = createEchoServer({dataDir: mkdtempSync(join(tmpdir(), 'echo-r3e-')), quiet: true, hostVoiceEnabled: false, ...options});
  await new Promise(r => echo.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${echo.server.address().port}`, s = echo.desk.state;
  const T = {A: s.people['creator-a'].token, P: s.people.producer.token};
  const post = async (path, token, body, headers = {}) => {
    const r = await fetch(base + path, {method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${token}`, ...headers}, body: Buffer.isBuffer(body) ? body : JSON.stringify(body || {})});
    return {status: r.status, replay: r.headers.get('idempotent-replay') === 'true', body: await r.json()};
  };
  const review = (seg, decision, note) => post(`/api/segments/${seg}/review`, T.P, {revision: echo.desk.state.segments[seg].revision, decision, note});
  const upload = (seg, asset, bytes, name) => post(`/api/segments/${seg}/media/${asset}`, T.A, bytes, {'content-type': 'application/octet-stream', 'x-filename': name, 'x-rights-declared': 'yes'});
  return {echo, T, post, review, upload, stop: () => new Promise(r => { echo.server.closeAllConnections(); echo.server.close(r); })};
}

// A data directory as an earlier version left it: gallery art-1 is an uploaded file whose stored verification
// says decodable (the old header-only check), with no record of which check produced that result.
function legacyDataDir(bytes, {publish = false} = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'echo-legacy-')), hash = sha256(bytes), file = `${hash}.png`;
  mkdirSync(join(dataDir, 'uploads'), {recursive: true}); writeFileSync(join(dataDir, 'uploads', file), bytes);
  const state = seedState({media: demoMedia(join(ROOT, 'media'))});
  for (const seg of Object.values(state.segments)) for (const a of seg.assets) delete a.verification;
  const gallery = state.segments.gallery, legacy = {id: 'art-1', sha256: hash, upload: true, file, kind: 'image', rightsDeclared: true, title: 'Legacy upload', decodable: true, probed: true, width: 0, height: 0};
  gallery.assets = [legacy, ...gallery.assets.filter(a => a.id !== 'art-1')];
  gallery.revision = 2; gallery.state = 'submitted'; gallery.approval = null;
  state.media[hash] = {file, upload: true, kind: 'image', at: 0};
  if (publish) {
    // Approved and published by the earlier version, which trusted the stored flag: stand in for that trust while
    // publishing, then leave the assets exactly as the earlier version stored them.
    gallery.state = 'approved'; gallery.approval = {revision: 2, assetHashes: gallery.assets.map(a => a.sha256).sort(), by: 'producer', at: 0};
    for (const seg of Object.values(state.segments)) for (const a of seg.assets) a.verification = {method: FULL_DECODE, sha256: a.sha256};
    new BroadcastDesk(state, {now: () => 0}).publish({type: 'person', id: 'producer'});
    for (const seg of Object.values(state.segments)) for (const a of seg.assets) delete a.verification;
  }
  writeFileSync(join(dataDir, 'state.json'), JSON.stringify(state));
  return dataDir;
}

test('R2 (P1): retained corrupt media marked decodable by an earlier check cannot be approved, published or started', async () => {
  const x = await start({dataDir: legacyDataDir(HEADER_ONLY)});
  try {
    const art = x.echo.desk.state.segments.gallery.assets.find(a => a.id === 'art-1');
    assert.equal(art.decodable, false, 'the stored flag is not trusted: the actual bytes are checked again at startup');
    assert.ok(x.echo.desk.state.audit.some(e => e.action === 'media_revalidated' && /art-1/.test(e.summary)), 'the overturned result is logged');
    const r = await x.review('gallery', 'approved');
    assert.equal(r.status, 422, JSON.stringify(r.body)); assert.equal(r.body.error, 'undecodable_media');
    const p = await x.post('/api/publish', x.T.P);
    assert.equal(p.status, 409); assert.match(p.body.message, /art-1 could not be decoded/);
    assert.equal(x.echo.desk.state.broadcast.state, 'queued');
  } finally { await x.stop(); }

  // A publication made by the earlier version with that file: going live re-checks the actual bytes.
  const y = await start({dataDir: legacyDataDir(HEADER_ONLY, {publish: true})});
  try {
    const m = y.echo.desk.state.broadcast.manifest;
    assert.equal(y.echo.desk.state.broadcast.state, 'ready');
    const g = await y.post('/api/golive', y.T.P, {delayMs: 0, publicationId: m.publicationId, hash: m.hash});
    assert.equal(g.status, 422, JSON.stringify(g.body)); assert.equal(g.body.error, 'undecodable_media'); assert.match(g.body.message, /art-1/);
    assert.equal(y.echo.desk.state.broadcast.state, 'ready', 'nothing starts');
  } finally { await y.stop(); }
});

test('R2 (P1): a verified file whose bytes later change on disk is refused at approval and publication', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'echo-disk-'));
  const x = await start({dataDir});
  try {
    const up = await x.upload('gallery', 'art-1', PNG, 'ok.png');
    assert.equal(up.status, 200);
    const file = join(dataDir, 'uploads', up.body.assets.find(a => a.id === 'art-1').file);
    writeFileSync(file, HEADER_ONLY); // the stored result says decodable; the bytes no longer are
    const r = await x.review('gallery', 'approved');
    assert.equal(r.status, 422); assert.equal(r.body.error, 'undecodable_media'); assert.match(r.body.message, /do not match/);
    const p = await x.post('/api/publish', x.T.P);
    assert.equal(p.status, 409);
  } finally { await x.stop(); }
});

test('R2 control: retained healthy media with old-style flags is re-verified and still publishes and airs', async () => {
  const x = await start({dataDir: legacyDataDir(PNG)});
  try {
    const art = x.echo.desk.state.segments.gallery.assets.find(a => a.id === 'art-1');
    assert.equal(art.decodable, true); assert.equal(art.width, 320, 'real dimensions from the new check, not the stored 0');
    assert.equal((await x.review('gallery', 'approved')).status, 200);
    const p = await x.post('/api/publish', x.T.P);
    assert.equal(p.status, 200, JSON.stringify(p.body));
    const g = await x.post('/api/golive', x.T.P, {delayMs: 0, publicationId: p.body.publicationId, hash: p.body.hash});
    assert.equal(g.status, 200); assert.equal(g.body.state, 'on_air');
  } finally { await x.stop(); }
});

test('R3 (P1/N04): rejecting during the Starting countdown withdraws the publication; it never goes on air, also after restart and replay', async () => {
  let clock = 1_000_000;
  const dataDir = mkdtempSync(join(tmpdir(), 'echo-r3-'));
  const x = await start({dataDir, now: () => clock});
  try {
    const m = (await x.post('/api/publish', x.T.P)).body;
    const live = await x.post('/api/golive', x.T.P, {delayMs: 5000, publicationId: m.publicationId, hash: m.hash}, {'idempotency-key': 'golive-countdown-1'});
    assert.equal(live.status, 200);
    const onAirAt = live.body.onAirAt;
    clock = onAirAt - 4920; // Codex's timing: 4,920 ms before the scheduled start
    const r = await x.review('gallery', 'rejected', 'Rights for art-2 not confirmed');
    assert.equal(r.status, 200);
    const b = x.echo.desk.state.broadcast;
    assert.equal(b.state, 'queued', 'the pending start is cancelled'); assert.equal(b.onAirAt, null);
    assert.equal(b.withdrawn.publicationId, m.publicationId); assert.equal(b.withdrawn.cancelledStartAt, onAirAt);
    const audit = x.echo.desk.state.audit.map(e => e.action);
    assert.ok(audit.includes('publication_withdrawn')); assert.ok(!audit.includes('rejected_on_air'));
    clock = onAirAt + 1000; x.echo.desk.tick();
    assert.equal(x.echo.desk.state.broadcast.state, 'queued', 'still not on air after the scheduled start');
    const again = await x.post('/api/golive', x.T.P, {delayMs: 0, publicationId: m.publicationId, hash: m.hash});
    assert.equal(again.status, 409); assert.equal(again.body.error, 'withdrawn');
    const replay = await x.post('/api/golive', x.T.P, {delayMs: 5000, publicationId: m.publicationId, hash: m.hash}, {'idempotency-key': 'golive-countdown-1'});
    assert.equal(replay.replay, true); assert.equal(x.echo.desk.state.broadcast.state, 'queued', 'replaying the old success activates nothing');
  } finally { await x.stop(); }
  const y = await start({dataDir, now: () => clock});
  try {
    assert.equal(y.echo.desk.state.broadcast.state, 'queued');
    const m = y.echo.desk.state.withdrawals[1];
    const g = await y.post('/api/golive', y.T.P, {delayMs: 0, publicationId: m.publicationId, hash: m.hash});
    assert.equal(g.status, 409); assert.equal(g.body.error, 'withdrawn');
  } finally { await y.stop(); }
});

test('R3 (P1/N04): the server clock alone decides the boundary: 1 ms before the start withdraws, at the start playback continues', async () => {
  for (const [offset, expected] of [[-1, 'queued'], [0, 'on_air']]) {
    let clock = 2_000_000;
    const x = await start({now: () => clock});
    try {
      const m = (await x.post('/api/publish', x.T.P)).body;
      const onAirAt = (await x.post('/api/golive', x.T.P, {delayMs: 5000, publicationId: m.publicationId, hash: m.hash})).body.onAirAt;
      clock = onAirAt + offset;
      assert.equal((await x.review('gallery', 'rejected', 'late decision')).status, 200);
      assert.equal(x.echo.desk.state.broadcast.state, expected, `rejection at ${offset} ms`);
      const types = x.echo.desk.state.audit.map(e => e.action);
      assert.equal(types.includes('publication_withdrawn'), expected === 'queued');
      assert.equal(types.includes('rejected_on_air'), expected === 'on_air');
    } finally { await x.stop(); }
  }
});
