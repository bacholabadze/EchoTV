// Shared test flow (editorial wave). Every human action here is a SCRIPTED STAND-IN for a person (a test creator
// and a test producer), labelled as such in logs. Media is generated rehearsal material (a test tone, test-pattern
// images), never presented as anyone's real work: the programme runs with the on-screen rehearsal label.
import {mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createEchoServer} from '../../server/server.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function startEditorial(fx, {now, rehearsal = true, dataDir} = {}) {
  const dir = dataDir || mkdtempSync(join(tmpdir(), 'echo-editorial-'));
  const echo = createEchoServer({dataDir: dir, quiet: true, ...(now ? {now} : {}), seedOptions: {format: 'editorial', rehearsal, people: {a: fx.person, producer: {name: 'ECHO პროდიუსერი'}}}});
  await new Promise(r => echo.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${echo.server.address().port}`, S = () => echo.desk.state;
  const T = {G: S().people['creator-a'].token, P: S().people.producer.token, g: S().agents['agent-a'].token, E: S().agents['agent-editor'].token};
  const req = async (method, path, token, body, headers = {}) => {
    const r = await fetch(base + path, {method, headers: {...(token ? {authorization: `Bearer ${token}`} : {}), ...(Buffer.isBuffer(body) ? {} : {'content-type': 'application/json'}), ...headers},
      body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body)});
    return {status: r.status, body: await r.json()};
  };
  const ok = async (...a) => { const r = await req(...a); if (r.status !== 200) throw new Error(`${a[0]} ${a[1]} → ${r.status} ${r.body.error}: ${r.body.message}`); return r.body; };
  return {echo, base, S, T, req, ok, dir, close: () => new Promise(r => echo.server.close(r))};
}

// Rehearsal media, generated locally: a decodable test-pattern PNG (lavfi) or the repo's test tone.
function testImage(dir, name, source) {
  const out = join(dir, name);
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `${source}=size=960x640`, '-frames:v', '1', out]);
  if (r.status !== 0) throw new Error(`ffmpeg could not make ${name}`);
  return readFileSync(out);
}

// The creator journey up to an editorial-ready state: library + rights → interview → approved brief → prepared,
// shared segment → held and confirmed airtime. Each step is the scripted stand-in named in `log`.
export async function creatorJourney(ctx, fx, {log = () => {}, share = true, confirm = true} = {}) {
  const {ok, T} = ctx, ids = {};
  for (const m of fx.media) {
    log(`SCRIPTED creator: uploads rehearsal file "${m.title}" and declares its uses`);
    const bytes = m.kind === 'audio' ? readFileSync(join(ROOT, 'tests/fixtures/tone-62s.mp3')) : testImage(ctx.dir, `${m.id}.png`, m.id === 'process-image' ? 'smptebars' : 'testsrc2');
    const item = await ok('POST', '/api/library/media', T.G, bytes, {'x-filename': m.kind === 'audio' ? `${m.id}.mp3` : `${m.id}.png`, 'x-title': encodeURIComponent(m.title)});
    await ok('POST', `/api/library/media/${item.id}/rights`, T.G, {publicBroadcast: true, editing: true, replays: true, confirm: true});
    ids[m.id] = item.id;
  }
  log('SCRIPTED creator: answers the Creator Interview (typed)');
  const iv = await ok('POST', '/api/interviews', T.G), f = fx.fields;
  const answers = [
    ['who', f.workDescription, {displayName: f.displayName, workTitle: f.workTitle, category: f.category}],
    ['inspiration', f.inspiration, {}],
    ['process', f.creationProcess, {aiInvolvement: f.aiInvolvement}],
    ['focus', f.presentationFocus, {preferredFormat: f.preferredFormat, desiredAirtimeSec: f.desiredAirtimeSec}],
    ['media', '', {mediaIds: Object.values(ids)}],
    ['notes', f.presenterNotes, {}],
  ];
  for (const [stepId, text, fields] of answers) {
    if (!text && !Object.keys(fields).length) await ok('POST', `/api/interviews/${iv.id}/skip`, T.G, {stepId});
    else await ok('POST', `/api/interviews/${iv.id}/answer`, T.G, {stepId, text: text || '', fields});
  }
  let view = await ok('GET', `/api/interviews/${iv.id}`, T.G);
  if (view.status === 'in_progress') view = await ok('POST', `/api/interviews/${iv.id}/review`, T.G);
  log('SCRIPTED creator: reviews and approves the exact brief version');
  await ok('POST', `/api/interviews/${iv.id}/approve`, T.G, {version: view.brief.version, hash: view.brief.hash});
  const assets = Object.fromEntries(ctx.S().segments.work.assets.map(a => [a.id, ids[a.id] ?? null]));
  log(`SCRIPTED creator: prepares the segment${share ? ' and shares the approved brief with the editorial desk' : ''}`);
  await ok('POST', `/api/briefs/${iv.id}/prepare`, T.G, {segmentId: 'work', assets, shareWithEditorial: share});
  log(`SCRIPTED creator: requests airtime ${fx.booking.start}s + ${fx.booking.duration}s`);
  await ok('POST', '/api/slots/hold', T.G, {segmentId: 'work', ...fx.booking});
  if (confirm) { log('SCRIPTED producer: confirms the airtime'); await ok('POST', '/api/slots/confirm', T.P, {segmentId: 'work'}); }
  return {interviewId: iv.id, media: ids};
}
