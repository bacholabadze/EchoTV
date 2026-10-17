// Regression tests for Codex's independent regression run of 7ee7394 (N02 P0, N03 and N05 P1).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync, cpSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createEchoServer, probeMedia, demoMedia} from '../../server/server.mjs';
import {seedState} from '../../server/seed.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixture = name => readFileSync(join(ROOT, 'tests/fixtures', name));
const PNG = fixture('swatch.png'), TONE = fixture('tone-62s.mp3'), JPG = readFileSync(join(ROOT, 'media/art-1.jpg'));
const corrupt = {
  'header-only.png': PNG.subarray(0, 33),                         // signature + IHDR, no pixels (Codex N02)
  'truncated.jpg': JPG.subarray(0, 2000),                          // valid JPEG start, cut mid-scan
  'zeros.mp3': Buffer.concat([Buffer.from('ID3'), Buffer.alloc(4000)]),
};

async function start(options = {}) {
  const echo = createEchoServer({dataDir: mkdtempSync(join(tmpdir(), 'echo-r7-')), quiet: true, hostVoiceEnabled: false, ...options});
  await new Promise(r => echo.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${echo.server.address().port}`, s = echo.desk.state;
  const T = {A: s.people['creator-a'].token, B: s.people['creator-b'].token, P: s.people.producer.token};
  const post = async (path, token, body, headers = {}) => {
    const r = await fetch(base + path, {method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${token}`, ...headers}, body: Buffer.isBuffer(body) ? body : JSON.stringify(body || {})});
    return {status: r.status, replay: r.headers.get('idempotent-replay') === 'true', body: await r.json()};
  };
  const upload = (seg, asset, token, bytes, name, headers = {}) => post(`/api/segments/${seg}/media/${asset}`, token, bytes, {'content-type': 'application/octet-stream', 'x-filename': name, 'x-rights-declared': 'yes', ...headers});
  return {echo, T, post, upload, stop: () => new Promise(r => { echo.server.closeAllConnections(); echo.server.close(r); })};
}

test('N02 (P0): signature-valid but undecodable media is rejected before review or publication', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'echo-corrupt-'));
  for (const [name, bytes] of Object.entries(corrupt)) {
    writeFileSync(join(dir, name), bytes);
    const p = probeMedia(join(dir, name));
    assert.equal(p.decodable, false, `${name}: ${JSON.stringify(p)}`);
  }
  const x = await start();
  try {
    for (const [name, bytes] of Object.entries(corrupt)) {
      const [seg, asset] = name.endsWith('.mp3') ? ['premiere', 'track'] : ['gallery', 'art-1'];
      const r = await x.upload(seg, asset, name.endsWith('.mp3') ? x.T.B : x.T.A, bytes, name);
      assert.equal(r.status, 422, name); assert.equal(r.body.error, 'undecodable_media', name);
    }
    assert.equal(x.echo.desk.state.segments.gallery.revision, 1, 'nothing changed');
    const ok = await x.upload('gallery', 'art-1', x.T.A, PNG, 'ok.png');
    assert.equal(ok.status, 200); assert.equal(ok.body.assets.find(a => a.id === 'art-1').width, 320);
  } finally { await x.stop(); }
});

test('N02 (P0): publication fails closed for any asset not positively verified', async () => {
  const x = await start();
  try {
    delete x.echo.desk.state.segments.gallery.assets[0].decodable; // e.g. an asset whose verification never ran
    const r = await x.post('/api/publish', x.T.P);
    assert.equal(r.status, 409); assert.match(r.body.message, /art-1 has not been verified as playable/);
  } finally { await x.stop(); }
});

test('N05 (P1): without a media decoder, uploads fail closed; only the exact shipped demo files are trusted', () => {
  const tampered = mkdtempSync(join(tmpdir(), 'echo-media-'));
  cpSync(join(ROOT, 'media'), tampered, {recursive: true});
  writeFileSync(join(tampered, 'art-2.jpg'), Buffer.concat([readFileSync(join(tampered, 'art-2.jpg')), Buffer.from('x')]));
  const script = `
    const m = await import(${JSON.stringify(join(ROOT, 'server/server.mjs'))});
    const upload = m.probeMedia(${JSON.stringify(join(ROOT, 'tests/fixtures/tone-62s.mp3'))});
    const shipped = m.demoMedia(${JSON.stringify(join(ROOT, 'media'))}), changed = m.demoMedia(${JSON.stringify(tampered)});
    console.log(JSON.stringify({upload, shipped: Object.fromEntries(Object.entries(shipped).map(([k, v]) => [k, v.decodable])), changed: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.decodable])), track: shipped.track.durationSec}));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {env: {PATH: '/usr/bin:/bin'}, encoding: 'utf8'});
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.upload.decodable, false, 'valid audio is still not accepted without a decoder');
  assert.match(out.upload.reason, /no media decoder/);
  assert.deepEqual(out.shipped, {'art-1': true, 'art-2': true, 'art-3': true, track: true}, 'shipped files trusted by their verified fingerprint');
  assert.equal(out.track, 60, 'recorded duration used');
  assert.equal(out.changed['art-2'], false, 'a changed file is not trusted');
});

test('N05 (P1): assets in state from an older version are verified on load, fail closed', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'echo-old-'));
  const old = seedState({media: Object.fromEntries(Object.entries(demoMedia(join(ROOT, 'media'))).map(([id, m]) => [id, {file: m.file, kind: m.kind, sha256: m.sha256, title: m.title}]))});
  old.segments.gallery.assets[1] = {...old.segments.gallery.assets[1], upload: true, file: 'missing.png', sha256: 'f'.repeat(64)};
  for (const seg of Object.values(old.segments)) for (const a of seg.assets) delete a.decodable;
  writeFileSync(join(dataDir, 'state.json'), JSON.stringify(old));
  const x = await start({dataDir});
  try {
    const assets = x.echo.desk.state.segments.gallery.assets;
    assert.equal(assets[0].decodable, true, 'shipped art re-verified');
    assert.equal(assets[1].decodable, false, 'missing upload is not playable');
    const r = await x.post('/api/publish', x.T.P);
    assert.equal(r.status, 409); assert.match(r.body.message, /art-2 could not be decoded/);
  } finally { await x.stop(); }
});

test('N03 (P1): retry identity covers upload metadata; changed title or rights is a conflict, not a replay', async () => {
  const x = await start();
  try {
    const h = {'idempotency-key': 'upload-meta-0001'};
    const first = await x.upload('gallery', 'art-2', x.T.A, PNG, 'a.png', {...h, 'x-title': 'First%20title'});
    assert.equal(first.status, 200);
    const same = await x.upload('gallery', 'art-2', x.T.A, PNG, 'a.png', {...h, 'x-title': 'First%20title'});
    assert.equal(same.replay, true, 'identical retry replays');
    for (const change of [{'x-title': 'Different%20title'}, {'x-title': 'First%20title', 'x-rights-declared': 'no'}, {'x-title': 'First%20title', 'x-license': 'CC-BY'}, {'x-title': 'First%20title', 'x-filename': 'b.png'}]) {
      const r = await x.upload('gallery', 'art-2', x.T.A, PNG, 'a.png', {...h, ...change});
      assert.equal(r.status, 422, JSON.stringify(change)); assert.equal(r.body.error, 'idempotency_conflict');
    }
    assert.equal(x.echo.desk.state.segments.gallery.assets.find(a => a.id === 'art-2').title, 'First title');
  } finally { await x.stop(); }
});
