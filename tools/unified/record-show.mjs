// Unified build: records the complete 120 s programme from the real HTTP-served /broadcast/ page, headless.
// Own isolated server (port 8801, throwaway data dir), never the founder's 8800 instance nor the protected 8787.
// Video: CDP screencast frames stamped with wall-clock time. Audio: tap on the page's own Web Audio graph.
// EVERY HUMAN STEP IN THIS INSTANCE IS A SCRIPTED STAND-IN (creator interview answers, creator approval, media
// selection, producer review, publication, go-live). No agent negotiation runs here (see tests/e2e for that).
// Voices: the fixed Georgian ElevenLabs samples through the 'elevenlabs-sample' provider (no paid call).
//   node tools/unified/record-show.mjs <outDir>
import {mkdirSync, writeFileSync, appendFileSync, readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execSync} from 'node:child_process';
import {chromium} from 'playwright';
import {createEchoServer} from '../../server/server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = process.argv[2] || join(ROOT, 'docs', 'unified', 'evidence', 'recording');
const RAW = join(OUT, 'raw'), FRAMES = join(RAW, 'frames'); mkdirSync(FRAMES, {recursive: true});
const log = (...a) => { const line = `[${new Date().toISOString()}] ${a.join(' ')}`; console.log(line); appendFileSync(join(OUT, 'record-show.log'), line + '\n'); };
const stand = m => log(`SCRIPTED STAND-IN (not a person): ${m}`);
const PORT = 8801;
const echo = createEchoServer({dataDir: join(RAW, 'data-isolated'), quiet: true, seedOptions: {people: {a: {name: 'Bacho', specialty: 'Art'}, b: {name: 'Keti', specialty: 'Music'}}}});
await new Promise(r => echo.server.listen(PORT, '127.0.0.1', r));
const base = `http://127.0.0.1:${PORT}`, S = () => echo.desk.state, T = {B: S().people['creator-b'].token, P: S().people.producer.token};
const req = async (method, path, token, body, headers = {}) => { const r = await fetch(base + path, {method, headers: {authorization: `Bearer ${token}`, ...(Buffer.isBuffer(body) ? {} : {'content-type': 'application/json'}), ...headers}, body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body)}); const j = await r.json(); if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${JSON.stringify(j).slice(0, 200)}`); return j; };
log('isolated server up on', base);

// 1. Creator journey (scripted stand-in): authorised music -> interview -> approved brief -> explicit media selection.
stand('Keti uploads the rehearsal track (repo test tone, not real music) and declares public broadcast, editing, replays');
const m = await req('POST', '/api/library/media', T.B, readFileSync(join(ROOT, 'tests/fixtures/tone-62s.mp3')), {'x-filename': 'zghva.mp3', 'x-title': encodeURIComponent('ზღვის სიმღერა (სატესტო ჩანაწერი)')});
await req('POST', `/api/library/media/${m.id}/rights`, T.B, {publicBroadcast: true, editing: true, replays: true, confirm: true});
stand('Keti answers the Creator Interview');
const iv = await req('POST', '/api/interviews', T.B);
const act = (a, body) => req('POST', `/api/interviews/${iv.id}/${a}`, T.B, body);
await act('answer', {stepId: 'who', text: 'მუსიკოსი ვარ თბილისიდან; ეს ჩემი პირველი სინგლია.', fields: {displayName: 'ქეთი', workTitle: 'ზღვის სიმღერა', category: 'music'}});
await act('answer', {stepId: 'inspiration', text: 'ზღვის ხმამ და ბებიის სიმღერებმა შთამაგონა.'});
await act('answer', {stepId: 'process', text: 'მელოდია, ტექსტი და მიქსი თავად გავაკეთე.', fields: {aiInvolvement: 'none'}});
await act('answer', {stepId: 'focus', text: 'რეფრენი.', fields: {preferredFormat: 'premiere', desiredAirtimeSec: 60}});
await act('answer', {stepId: 'media', text: 'ეს ტრეკი.', fields: {mediaIds: [m.id]}});
await act('answer', {stepId: 'notes', text: ''});
const b = S().interviews[iv.id].brief;
stand('Keti approves her brief (exact version and hash)');
await act('approve', {version: b.version, hash: b.hash});
stand('Keti selects her track for the premiere slot explicitly (Q4 rule) and prepares the segment');
const prem = await req('POST', `/api/briefs/${iv.id}/prepare`, T.B, {segmentId: 'premiere', assets: {track: m.id}});
log('premiere prepared r' + prem.revision, 'brief', prem.content.brief.title, 'credit', prem.assets[0].credit);

// 2. Producer gives the house segments their Georgian voices (fixed samples), reviews every revision, publishes.
const samples = (await req('GET', '/api/voice/samples', T.P)).samples;
const pick = id => { const x = samples.find(z => z.id === id); return [{presenter: x.presenter, text: x.text}]; };
const inter = await req('POST', '/api/segments/interstitial/voice', T.P, {lines: pick('sample-analyst-two-sentences'), lang: 'ka'});
const outro = await req('POST', '/api/segments/outro/voice', T.P, {lines: pick('dialogue-2'), lang: 'ka'});
log('voices:', inter.assets.find(a => a.id === 'voice').voice.provider, inter.assets.find(a => a.id === 'voice').voice.duration + 's', '/', outro.assets.find(a => a.id === 'voice').voice.duration + 's');
stand('Producer reviews the exact audio and the prepared premiere (content approval of each revision)');
for (const [id, rev] of [['interstitial', inter.revision], ['outro', outro.revision], ['premiere', prem.revision]]) await req('POST', `/api/segments/${id}/review`, T.P, {revision: rev, decision: 'approved'});
stand('Producer publishes the approved revision');
const manifest = await req('POST', '/api/publish', T.P);
log('published', `#${manifest.publicationId} r${manifest.publishRevision} ${manifest.hash}`);
for (const seg of manifest.segments) log(`  ${seg.id} ${seg.duration}s`, seg.content?.host ? `host audio ${seg.content.host.audio} · ${seg.content.host.credit}` : seg.assets.map(a => `${a.id} ${a.sha256.slice(0, 10)} ${a.credit}`).join(' '));
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));

// 3. Record the real page.
const browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--use-angle=metal']});
const context = await browser.newContext({viewport: {width: 1920, height: 1080}});
const chunks = []; const timing = {}; const frames = [];
await context.exposeFunction('__echoAudioChunk', b64 => { chunks.push(Buffer.from(b64, 'base64')); });
await context.exposeFunction('__echoAudioStarted', t => { timing.audioStartPage = t; log('in-page audio recorder started'); });
await context.addInitScript(() => {
  const orig = AudioNode.prototype.connect; let tap = null;
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = orig.call(this, dest, ...rest);
    try {
      if (dest instanceof AudioDestinationNode) {
        if (!tap) {
          tap = dest.context.createMediaStreamDestination();
          const rec = new MediaRecorder(tap.stream, {mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 192000});
          rec.ondataavailable = e => { if (!e.data.size) return; e.data.arrayBuffer().then(buf => { const u = new Uint8Array(buf); let str = ''; for (let i = 0; i < u.length; i += 8192) str += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); window.__echoAudioChunk(btoa(str)); }); };
          window.__echoRec = rec; rec.start(1000); window.__echoAudioStarted(Date.now());
        }
        orig.call(this, tap);
      }
    } catch (err) { console.error('audio tap failed', err); }
    return r;
  };
});
const errors = [];
const page = await context.newPage();
page.on('pageerror', e => errors.push(e.message)); page.on('console', msg => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });
const cdp = await context.newCDPSession(page);
cdp.on('Page.screencastFrame', f => {
  const i = frames.length; const file = `f${String(i).padStart(6, '0')}.jpg`;
  writeFileSync(join(FRAMES, file), Buffer.from(f.data, 'base64'));
  frames.push({t: f.metadata.timestamp, file});
  cdp.send('Page.screencastFrameAck', {sessionId: f.sessionId}).catch(() => {});
});
await cdp.send('Page.startScreencast', {format: 'jpeg', quality: 88, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1});
await page.goto(`${base}/broadcast/`);
await page.click('#sound');
const state = () => page.evaluate(() => window.EchoBroadcast.getState());
try { await page.waitForFunction(() => window.EchoBroadcast.getState().studioReady, null, {timeout: 60000}); log('3D studio ready'); } catch { log('WARNING: 3D studio not ready after 60 s'); }
await page.waitForFunction(() => window.EchoBroadcast.getState().module === 'slate', null, {timeout: 15000});
stand('Producer presses Go live');
await req('POST', '/api/golive', T.P, {delayMs: 3000, publicationId: manifest.publicationId, hash: manifest.hash});
timing.onAirAt = echo.desk.state.broadcast.onAirAt; timing.manifest = {publicationId: manifest.publicationId, publishRevision: manifest.publishRevision, hash: manifest.hash};
log('go live; onAirAt', new Date(timing.onAirAt).toISOString());
const samplesT = [], perf = [];
const at = async sec => { const w = timing.onAirAt + sec * 1000 - Date.now(); if (w > 0) await new Promise(r => setTimeout(r, w)); };
for (let t = 0; t <= 123; t += 3) {
  await at(t);
  const x = await state();
  samplesT.push({t, programmeTime: +(+x.programmeTime).toFixed(2), segment: x.segment, module: x.module, live: x.live, label: x.onAirLabel, caption: x.caption, audioLevel: x.audioLevel == null ? null : +x.audioLevel.toFixed(3), vizActive: x.viz?.active, studio: x.studioReady});
  if (t % 15 === 0) log(`t=${t}s ${x.segment}/${x.module} label=${x.onAirLabel} caption=${JSON.stringify(x.caption || '').slice(0, 50)} audioLevel=${x.audioLevel?.toFixed?.(3)} frames=${frames.length}`);
}
await page.evaluate(() => new Promise(r => { const rec = window.__echoRec; if (!rec) return r(); rec.onstop = () => setTimeout(r, 300); rec.stop(); }));
await new Promise(r => setTimeout(r, 1000));
await cdp.send('Page.stopScreencast').catch(() => {});
timing.samples = samplesT; timing.errors = errors; timing.frameCount = frames.length; timing.firstFrameT = frames[0]?.t; timing.lastFrameT = frames.at(-1)?.t;
await context.close(); await browser.close();
echo.server.closeAllConnections(); echo.server.close();
writeFileSync(join(RAW, 'audio-tap.webm'), Buffer.concat(chunks));
let list = 'ffconcat version 1.0\n';
for (let i = 0; i < frames.length; i++) { const d = i + 1 < frames.length ? frames[i + 1].t - frames[i].t : 0.04; list += `file 'frames/${frames[i].file}'\nduration ${Math.max(0.001, d).toFixed(6)}\n`; }
writeFileSync(join(RAW, 'frames.ffconcat'), list);
writeFileSync(join(OUT, 'timing.json'), JSON.stringify(timing, null, 1));
const span = frames.length ? (frames.at(-1).t - frames[0].t) : 0;
log('frames:', frames.length, 'span s:', span.toFixed(2), 'avg fps:', (frames.length / span).toFixed(1), 'audio chunks:', chunks.length, 'page errors:', errors.length, errors.slice(0, 3).join(' | '));
// 4. Mux: video from true frame durations; audio offset = recorder start relative to the first frame.
const delay = Math.max(0, (timing.audioStartPage / 1000) - frames[0].t);
log('audio delay s', delay.toFixed(3));
const mp4 = join(OUT, 'echo-unified-full-programme.mp4');
execSync(`ffmpeg -hide_banner -loglevel error -y -f concat -safe 0 -i "${join(RAW, 'frames.ffconcat')}" -itsoffset ${delay.toFixed(3)} -i "${join(RAW, 'audio-tap.webm')}" -map 0:v -map 1:a -c:v libx264 -preset veryfast -crf 20 -r 30 -pix_fmt yuv420p -vf "scale=1920:1080" -c:a aac -b:a 160k -shortest "${mp4}"`, {stdio: 'inherit'});
log('mp4:', mp4, execSync(`ffprobe -v error -show_entries format=duration:stream=codec_name,width,height -of csv=p=0 "${mp4}"`).toString().trim().replace(/\n/g, ' '));
log('DONE');
