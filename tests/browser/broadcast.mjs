// Browser check of playout: committed revision → publish → live; two viewers stay in sync; reconnect lands in sync.
// Runs a full 2-minute programme. Requires Google Chrome. Run: npm run test:broadcast-browser
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createEchoServer} from '../../server/server.mjs';

const out = process.env.ECHO_SHOTS || join(tmpdir(), 'echo-shots'); mkdirSync(out, {recursive: true});
// ECHO_SSE_DELAY_MS simulates a slow/buffering network path for live updates; ECHO_HOST_VOICE=off forces captions-only.
const sseDelayMs = +(process.env.ECHO_SSE_DELAY_MS || 0);
const echo = createEchoServer({dataDir: mkdtempSync(join(tmpdir(), 'echo-play-')), quiet: true, sseDelayMs});
await new Promise(r => echo.server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${echo.server.address().port}`, s = echo.desk.state;
const post = async (path, token, body) => { const r = await fetch(base + path, {method: 'POST', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'}, body: JSON.stringify(body || {})}); const j = await r.json(); assert.ok(r.ok, `${path}: ${j.message}`); return j; };

// The §24 agreement (agents act over the API exactly as their MCP gateways do), then human approvals.
const p = await post('/api/proposals', s.agents['agent-a'].token, {baseRevision: 1, changes: [{segmentId: 'gallery', duration: 45}]});
await post(`/api/requests/${Object.values(echo.desk.state.requests)[0].id}/respond`, s.agents['agent-b'].token, {decision: 'accept', duration: 5});
const v = await post(`/api/proposals/${p.id}/revise`, s.agents['agent-a'].token, {changes: [{segmentId: 'gallery', duration: 45, content: {slides: [1, 2, 3].map(i => ({assetId: `art-${i}`, seconds: 15}))}}]});
for (const who of ['creator-a', 'creator-b', 'producer']) await post(`/api/proposals/${p.id}/decision`, s.people[who].token, {version: v.version, decision: 'approve'});
const manifest = await post('/api/publish', s.people.producer.token);
assert.equal(manifest.publishRevision, 2);
const outro = manifest.segments.find(x => x.id === 'outro'), voiced = !!outro.content.host?.audio;
// Piper is optional: with it the outro is voiced, without it the same programme airs with captions only.
if (voiced) assert.ok(outro.content.host.duration < outro.duration, 'host line fits its slot');
else assert.ok(outro.content.host?.text && !outro.content.host.audio, 'captions-only host line when Piper is unavailable');
console.log(`host voice: ${voiced ? 'Piper' : 'unavailable → captions only'}; SSE delay ${sseDelayMs}ms`);

const browser = await chromium.launch({channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal']});
const errors = [];
const viewer = async name => {
  const page = await (await browser.newContext({viewport: {width: 1280, height: 760}})).newPage();
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  await page.goto(`${base}/broadcast/`);
  return page;
};
const state = page => page.evaluate(() => window.EchoBroadcast.getState());
try {
  const one = await viewer('viewer-1'), two = await viewer('viewer-2');
  await one.click('#sound');
  await one.waitForFunction(() => window.EchoBroadcast.getState().studioReady, null, {timeout: 60000});
  // First state may arrive late (delayed SSE); wait for the standby slate rather than assuming it.
  await one.waitForFunction(() => window.EchoBroadcast.getState().module === 'slate', null, {timeout: 15000});
  await post('/api/golive', s.people.producer.token, {delayMs: 2000 + sseDelayMs, publicationId: manifest.publicationId, hash: manifest.hash});
  const onAir = echo.desk.state.broadcast.onAirAt;
  const at = async seconds => { const wait = onAir + seconds * 1000 - Date.now(); if (wait > 0) await new Promise(r => setTimeout(r, wait)); };
  const checks = [[3, 'intro', 'music'], [12, 'gallery', 'art'], [24, 'gallery', 'art'], [40, 'gallery', 'art'], [70, 'premiere', 'music'], [113, 'outro', 'host']];
  const slideAt = {12: 'art-1', 24: 'art-2', 40: 'art-3'};
  for (const [t, segment, module] of checks) {
    await at(t);
    const [a, b] = await Promise.all([state(one), state(two)]);
    for (const x of [a, b]) { assert.equal(x.segment, segment, `t=${t}`); assert.equal(x.module, module); assert.equal(x.publishRevision, 2); assert.equal(x.hash, manifest.hash); }
    assert.ok(Math.abs(a.programmeTime - b.programmeTime) < .25, `viewers within 250ms at t=${t}`);
    const truth = (Date.now() - onAir) / 1000;
    for (const x of [a, b]) assert.ok(Math.abs(x.programmeTime - truth) < .35, `viewer within 350ms of server time at t=${t} (SSE delay ${sseDelayMs}ms): ${x.programmeTime} vs ${truth}`);
    assert.ok(a.clockSynced && b.clockSynced, 'clock synced from /api/time');
    if (module === 'music') {
      const seg = manifest.segments.find(x => x.id === segment), expected = seg.content.offset + a.programmeTime - seg.start;
      assert.ok(Math.abs(a.audioTime - expected) < .6, `audio in sync at t=${t}: ${a.audioTime} vs ${expected}`);
      assert.ok(a.viz.live && a.viz.peak > .2, `visualiser driven by decoded audio at t=${t}: ${JSON.stringify(a.viz)}`);
      assert.ok(a.viz.active >= 16, `visualiser spreads across bars at t=${t}: ${a.viz.active}/64 active`);
      console.log(`t=${t} ${segment}: audio ${a.audioTime.toFixed(2)}s (expected ${expected.toFixed(2)}s), visualiser ${a.viz.active}/64 bars active, peak ${a.viz.peak}`);
    }
    if (module === 'art') {
      const img = await one.evaluate(() => { const i = document.querySelector('#art img.on'); return {src: new URL(i.src).pathname, loaded: i.complete && i.naturalWidth > 0, opacity: +getComputedStyle(i).opacity}; });
      assert.equal(img.src, manifest.segments.find(x => x.id === 'gallery').assets.find(a => a.id === slideAt[t]).url, `${slideAt[t]} shown at ${t}s`);
      assert.ok(img.loaded && img.opacity === 1, 'slide image loaded and fully visible');
    }
    await one.screenshot({path: join(out, `broadcast-t${t}-${segment}.png`)});
    if (t === 24) { await two.reload(); await two.waitForFunction(() => window.EchoBroadcast.getState().segment === 'gallery'); }
  }
  const outroState = await state(one);
  if (voiced) {
    assert.ok(outroState.audioSrc.startsWith('/host/'), 'host voice playing in the outro');
    let speech = 0; for (let i = 0; i < 10; i++) { speech = Math.max(speech, (await state(one)).audioLevel); await new Promise(r => setTimeout(r, 100)); }
    assert.ok(speech > .02, `outro speech signal present: peak ${speech}`);
    console.log(`outro: ${outroState.audioSrc}, speech signal peak ${speech.toFixed(3)}`);
  } else {
    assert.equal(outroState.audioHealth.needed, false, 'no audio is required in a captions-only outro');
    assert.equal(outroState.onAirLabel, 'Live');
    assert.match(await one.textContent('#caption'), /Made by/);
    assert.match(await one.textContent('#lower-credit'), /captions only/);
    console.log('outro: captions only (no Piper), caption visible');
  }
  assert.equal(outroState.faultVisible, false, 'no audio fault during a healthy run');
  await at(121.5);
  const end = await state(one);
  assert.equal(end.module, 'slate'); assert.equal(end.live, false);
  await one.screenshot({path: join(out, 'broadcast-end.png')});
  assert.deepEqual(errors, []);
  console.log(`PASS (${voiced ? 'Piper voice' : 'captions-only'}, SSE delay ${sseDelayMs}ms): r2 published and aired; intro → gallery → premiere → outro in two viewers (<250ms apart); viewer reload rejoined in sync; music audio within 0.6s of the clock; viewers within 350ms of server time; ${voiced ? 'Piper host voice in the outro' : 'captions-only outro'}. Screenshots in ${out}`);
} finally { await browser.close(); echo.server.closeAllConnections(); echo.server.close(); }
