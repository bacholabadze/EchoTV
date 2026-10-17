// Browser check of playout: committed revision → publish → live; two viewers stay in sync; reconnect lands in sync.
// Runs a full 2-minute programme. Requires Google Chrome. Run: npm run test:broadcast-browser
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createEchoServer} from '../../server/server.mjs';

const out = process.env.ECHO_SHOTS || join(tmpdir(), 'echo-shots'); mkdirSync(out, {recursive: true});
const echo = createEchoServer({dataDir: mkdtempSync(join(tmpdir(), 'echo-play-')), quiet: true});
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
const outro = manifest.segments.find(x => x.id === 'outro');
assert.ok(outro.content.host?.audio, 'outro voiced by Piper');
assert.ok(outro.content.host.duration < outro.duration, 'host line fits its slot');

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
  assert.equal((await state(one)).module, 'slate');
  await post('/api/golive', s.people.producer.token, {delayMs: 2000});
  const onAir = echo.desk.state.broadcast.onAirAt;
  const at = async seconds => { const wait = onAir + seconds * 1000 - Date.now(); if (wait > 0) await new Promise(r => setTimeout(r, wait)); };
  const checks = [[3, 'intro', 'music'], [24, 'gallery', 'art'], [70, 'premiere', 'music'], [113, 'outro', 'host']];
  for (const [t, segment, module] of checks) {
    await at(t);
    const [a, b] = await Promise.all([state(one), state(two)]);
    for (const x of [a, b]) { assert.equal(x.segment, segment, `t=${t}`); assert.equal(x.module, module); assert.equal(x.publishRevision, 2); assert.equal(x.hash, manifest.hash); }
    assert.ok(Math.abs(a.programmeTime - b.programmeTime) < .25, `viewers within 250ms at t=${t}`);
    if (module === 'music') {
      const seg = manifest.segments.find(x => x.id === segment), expected = seg.content.offset + a.programmeTime - seg.start;
      assert.ok(Math.abs(a.audioTime - expected) < .6, `audio in sync at t=${t}: ${a.audioTime} vs ${expected}`);
    }
    if (module === 'art') {
      const img = await one.evaluate(() => { const i = document.querySelector('#art img.on'); return {src: new URL(i.src).pathname, loaded: i.complete && i.naturalWidth > 0, opacity: +getComputedStyle(i).opacity}; });
      assert.equal(img.src, manifest.segments.find(x => x.id === 'gallery').assets.find(a => a.id === 'art-2').url, 'second slide shown at 0:24 (5s + 15s + 4s)');
      assert.ok(img.loaded && img.opacity === 1, 'slide image loaded and fully visible');
    }
    await one.screenshot({path: join(out, `broadcast-t${t}-${segment}.png`)});
    if (t === 24) { await two.reload(); await two.waitForFunction(() => window.EchoBroadcast.getState().segment === 'gallery'); }
  }
  assert.ok((await state(one)).audioSrc.startsWith('/host/'), 'host voice playing in the outro');
  await at(121.5);
  const end = await state(one);
  assert.equal(end.module, 'slate'); assert.equal(end.live, false);
  await one.screenshot({path: join(out, 'broadcast-end.png')});
  assert.deepEqual(errors, []);
  console.log(`PASS: r2 published and aired; intro → gallery → premiere → outro in two viewers (<250ms apart); viewer reload rejoined in sync; music audio within 0.6s of the clock; Piper host voice in the outro. Screenshots in ${out}`);
} finally { await browser.close(); echo.server.closeAllConnections(); echo.server.close(); }
