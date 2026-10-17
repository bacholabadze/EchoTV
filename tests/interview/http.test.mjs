// Creator interviews and private library over HTTP (3.2). Test answers are fixtures, not a real creator.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createEchoServer} from '../../server/server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PNG = readFileSync(join(ROOT, 'tests/fixtures/swatch.png')), MP3 = readFileSync(join(ROOT, 'tests/fixtures/tone-62s.mp3'));
const SECRET = 'ზღვის ხმამ შთამაგონა — სატესტო პასუხი';

export async function start() {
  const echo = createEchoServer({dataDir: mkdtempSync(join(tmpdir(), 'echo-iv-')), quiet: true, hostVoiceEnabled: false});
  await new Promise(r => echo.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${echo.server.address().port}`, s = echo.desk.state;
  const T = {A: s.people['creator-a'].token, B: s.people['creator-b'].token, P: s.people.producer.token, a: s.agents['agent-a'].token, b: s.agents['agent-b'].token};
  const req = async (method, path, token, body, headers = {}) => {
    const r = await fetch(base + path, {method, headers: {...(token ? {authorization: `Bearer ${token}`} : {}), ...(Buffer.isBuffer(body) ? {} : {'content-type': 'application/json'}), ...headers}, body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body)});
    const type = r.headers.get('content-type') || '';
    return {status: r.status, body: type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer())};
  };
  const upload = (token, bytes, filename, title = filename) => req('POST', '/api/library/media', token, bytes, {'x-filename': encodeURIComponent(filename), 'x-title': encodeURIComponent(title)});
  return {echo, base, T, req, upload, stop: () => new Promise(r => { echo.server.closeAllConnections(); echo.server.close(r); })};
}
export async function completeInterview(x, token, mediaId) {
  const iv = (await x.req('POST', '/api/interviews', token)).body, act = (a, body) => x.req('POST', `/api/interviews/${iv.id}/${a}`, token, body);
  await act('answer', {stepId: 'who', text: 'მუსიკოსი ვარ.', fields: {displayName: 'ტესტ შემქმნელი', workTitle: 'სატესტო სიმღერა', category: 'music'}});
  await act('answer', {stepId: 'inspiration', text: SECRET});
  await act('answer', {stepId: 'process', text: 'ყველაფერი თავად ჩავწერე.', fields: {aiInvolvement: 'none'}});
  await act('answer', {stepId: 'focus', text: 'რეფრენი.', fields: {preferredFormat: 'premiere', desiredAirtimeSec: 60}});
  await act('answer', {stepId: 'media', text: 'ეს ტრეკი.', fields: {mediaIds: mediaId ? [mediaId] : []}});
  if (!mediaId) await act('answer', {stepId: 'media', text: ''});
  const last = await act('answer', {stepId: 'notes', text: ''});
  return {id: iv.id, act, view: last.body};
}

test('private by default: no interview text, library item or private activity in the public state', async () => {
  const x = await start();
  try {
    const m = (await x.upload(x.T.B, MP3, 'track.mp3')).body;
    await x.req('POST', `/api/library/media/${m.id}/rights`, x.T.B, {publicBroadcast: true, confirm: true});
    await completeInterview(x, x.T.B, m.id);
    const pub = JSON.stringify((await x.req('GET', '/api/state')).body);
    assert.ok(!pub.includes(SECRET), 'answer text not public'); assert.ok(!pub.includes('"interviews"') && !pub.includes('"library"'));
    assert.ok(!pub.includes('library_media_added') && !pub.includes('rights_declared') && !pub.includes('interview_started'), 'private activity not in the public feed');
    assert.equal((await x.req('GET', `/media/${m.sha256}`)).status, 404, 'a library file is not publicly served');
    assert.equal((await x.req('GET', `/api/library/media/${m.id}/file`, x.T.B)).status, 200, 'its owner can fetch it');
    assert.equal((await x.req('GET', `/api/library/media/${m.id}/file`, x.T.A)).status, 404, 'another creator cannot');
  } finally { await x.stop(); }
});

test('owner scope: other creators, the producer and other agents see "not found"; the owner\'s agent can read and answer', async () => {
  const x = await start();
  try {
    const {id} = await completeInterview(x, x.T.B, null);
    for (const t of [x.T.A, x.T.P, x.T.a]) assert.equal((await x.req('GET', `/api/interviews/${id}`, t)).status, 404);
    assert.equal((await x.req('GET', `/api/interviews/${id}`)).status, 401, 'no token');
    assert.equal((await x.req('POST', `/api/interviews/${id}/answer`, x.T.a, {stepId: 'notes', text: 'x'})).status, 404, 'agent of another creator');
    const viaAgent = await x.req('POST', `/api/interviews/${id}/answer`, x.T.b, {stepId: 'notes', text: 'ჩემი აგენტის დამატება.'});
    assert.equal(viaAgent.status, 200); assert.equal(viaAgent.body.answers.notes.source, 'agent');
    assert.deepEqual((await x.req('GET', '/api/interviews', x.T.A)).body, [], 'A lists nothing of B');
    assert.equal((await x.req('POST', '/api/interviews', x.T.P)).status, 403, 'producer cannot start a creator interview');
  } finally { await x.stop(); }
});

test('agents prepare but never decide: approve, withdraw, quotes, uploads and rights are human-only', async () => {
  const x = await start();
  try {
    const {id} = await completeInterview(x, x.T.B, null);
    const brief = (await x.req('POST', `/api/interviews/${id}/review`, x.T.b)).body.brief;
    assert.equal((await x.req('POST', `/api/interviews/${id}/approve`, x.T.b, {version: brief.version, hash: brief.hash})).status, 403);
    assert.equal((await x.req('POST', `/api/interviews/${id}/withdraw`, x.T.b, {})).status, 403);
    assert.equal((await x.req('POST', `/api/interviews/${id}/quotes`, x.T.b, {quotes: []})).status, 403);
    assert.equal((await x.upload(x.T.b, PNG, 'x.png')).status, 403);
    const m = (await x.upload(x.T.B, PNG, 'cover.png')).body;
    assert.equal((await x.req('POST', `/api/library/media/${m.id}/rights`, x.T.b, {publicBroadcast: true, confirm: true})).status, 403);
    const ok = await x.req('POST', `/api/interviews/${id}/approve`, x.T.B, {version: brief.version, hash: brief.hash});
    assert.equal(ok.status, 200); assert.equal(ok.body.brief.status, 'approved'); assert.equal(ok.body.brief.approval.by, 'creator-b');
    assert.ok((await x.req('GET', '/api/state')).body.audit.some(e => e.action === 'brief_approved'), 'the approval itself is a public, content-free event');
  } finally { await x.stop(); }
});

test('media pipeline: acceptance, technical check, rights declaration and broadcast permission are separate', async () => {
  const x = await start(), dir = mkdtempSync(join(tmpdir(), 'echo-media-'));
  try {
    spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=160x90:rate=10', '-pix_fmt', 'yuv420p', join(dir, 'clip.mp4')]);
    const mp4 = readFileSync(join(dir, 'clip.mp4'));
    const cases = [['cover.png', PNG, 'image', true], ['broken.png', PNG.subarray(0, 33), 'image', false], ['track.mp3', MP3, 'audio', true],
      ['clip.mp4', mp4, 'video', true], ['cut.mp4', mp4.subarray(0, 600), 'video', false], ['press.pdf', Buffer.from('%PDF-1.4\n%test\n'), 'document', true], ['fake.pdf', Buffer.from('hello'), 'document', false]];
    for (const [name, bytes, kind, ok] of cases) {
      const r = await x.upload(x.T.B, bytes, name);
      assert.equal(r.status, 200, name); assert.equal(r.body.kind, kind, name); assert.equal(r.body.technical.decodable, ok, `${name}: ${r.body.technical.reason}`);
      assert.equal(r.body.rights, null, `${name}: no rights until the creator declares them`);
    }
    assert.equal((await x.upload(x.T.B, Buffer.from('MZ'), 'tool.exe')).status, 422);
    const m = (await x.upload(x.T.B, MP3, 'song.mp3')).body;
    assert.equal((await x.req('POST', `/api/library/media/${m.id}/rights`, x.T.B, {publicBroadcast: true})).status, 422, 'explicit confirmation required');
    const r = await x.req('POST', `/api/library/media/${m.id}/rights`, x.T.B, {publicBroadcast: true, editing: false, replays: true, promoExcerpts: false, confirm: true, statement: 'ჩემი ნამუშევარია'});
    assert.deepEqual([r.body.rights.publicBroadcast, r.body.rights.editing, r.body.rights.replays, r.body.rights.promoExcerpts, r.body.rights.verified], [true, false, true, false, false]);
    const lib = (await x.req('GET', '/api/library', x.T.B)).body;
    assert.equal(lib.media.length, 8); assert.ok(lib.media.every(i => i.file === undefined), 'storage paths not exposed');
  } finally { await x.stop(); }
});

test('the approved brief carries the media and its declared uses; the lifecycle shows the creator approval', async () => {
  const x = await start();
  try {
    const m = (await x.upload(x.T.B, MP3, 'track.mp3')).body;
    await x.req('POST', `/api/library/media/${m.id}/rights`, x.T.B, {publicBroadcast: true, replays: true, confirm: true});
    const {id, act} = await completeInterview(x, x.T.B, m.id);
    const b = (await act('review')).body.brief;
    assert.deepEqual(b.missing, []); assert.equal(b.media[0].rights.publicBroadcast, true); assert.equal(b.media[0].technical, 'passed');
    await act('approve', {version: b.version, hash: b.hash});
    const life = (await x.req('GET', '/api/library', x.T.B)).body.briefs.find(i => i.interviewId === id).lifecycle;
    assert.deepEqual(life.steps.filter(s => s.done).map(s => s.step), ['interview', 'draft', 'creator_approved']);
  } finally { await x.stop(); }
});
