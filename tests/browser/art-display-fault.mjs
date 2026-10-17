// R1 regression (Codex, 3e0c846, P0): an artwork that preloaded fine but whose on-screen image then fails to load
// must be a visible fault within seconds, never a blank frame under a plain "Live", and must recover on its own
// once the image can be fetched again (no reload). Fault injection as in Codex's probe: the preload succeeds,
// the browser cache is cleared and disabled, then the display fetch of the same approved URL is aborted.
// Requires Google Chrome. Run: npm run test:art-display-fault
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createEchoServer} from '../../server/server.mjs';

const echo = createEchoServer({dataDir: mkdtempSync(join(tmpdir(), 'echo-art-display-')), quiet: true, hostVoiceEnabled: false, ...(process.env.ECHO_STATIC_DIR ? {staticDir: process.env.ECHO_STATIC_DIR} : {})});
await new Promise(r => echo.server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${echo.server.address().port}`, P = echo.desk.state.people.producer.token;
const post = async (path, body) => (await fetch(base + path, {method: 'POST', headers: {authorization: `Bearer ${P}`, 'content-type': 'application/json'}, body: JSON.stringify(body || {})})).json();
const m = await post('/api/publish');
const art2 = m.segments.find(s => s.id === 'gallery').assets.find(a => a.id === 'art-2');
const browser = await chromium.launch({channel: 'chrome'});
const page = await (await browser.newContext({viewport: {width: 1280, height: 760}})).newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
let block = false, requests = 0, aborted = 0;
await page.route(`**${art2.url}`, route => { requests++; if (block) { aborted++; return route.abort('failed'); } return route.continue(); });
const preloaded = new Promise(r => page.on('requestfinished', req => req.url().endsWith(art2.url) && r()));
await page.goto(`${base}/broadcast/`);
await preloaded;                                                   // the preload fetched and decoded art-2
const cdp = await page.context().newCDPSession(page);
await cdp.send('Network.enable'); await cdp.send('Network.clearBrowserCache'); await cdp.send('Network.setCacheDisabled', {cacheDisabled: true});
block = true;
const state = () => page.evaluate(() => ({...window.EchoBroadcast.getState(), shown: (i => i && {src: i.getAttribute('src'), w: i.naturalWidth, complete: i.complete})(document.querySelector('#art img.on'))}));
try {
  const live = await post('/api/golive', {delayMs: 1500, publicationId: m.publicationId, hash: m.hash});
  const at = async sec => { const w = live.onAirAt + sec * 1000 - Date.now(); if (w > 0) await new Promise(r => setTimeout(r, w)); };
  await at(15);                                                    // art-1, healthy
  let x = await state();
  assert.equal(x.onAirLabel, 'Live'); assert.equal(x.faultVisible, false);
  // art-2 is on screen 20–30 s. Its display fetch fails: a visible fault within 1 s, kept while it keeps failing.
  const samples = [];
  for (const t of [20.6, 21.5, 22.5, 23.5, 24.5, 25.5]) {
    await at(t); x = await state();
    samples.push(`${t}s:${x.onAirLabel}`);
    assert.equal(x.segment, 'gallery'); assert.equal(x.shown.src, art2.url, 'the approved URL is what is displayed');
    assert.notEqual(x.onAirLabel, 'Live', `plain "Live" over a failed displayed artwork at ${t}s (naturalWidth ${x.shown.w})`);
    assert.equal(x.faultVisible, true, `fault banner at ${t}s`);
    assert.equal(x.artFault?.assetId, 'art-2');
    assert.equal(await page.isVisible('#art-missing'), true, `credits card instead of a blank frame at ${t}s`);
  }
  assert.ok(aborted >= 2, `display fetches were aborted (${aborted}) and retried`);
  // The network recovers: the same approved image appears again on the same page, without a reload.
  block = false;
  await at(29.5); x = await state();
  assert.equal(x.onAirLabel, 'Live', `recovered by 29.5 s (${JSON.stringify(x.shown)})`);
  assert.equal(x.faultVisible, false); assert.equal(await page.isVisible('#art-missing'), false);
  assert.ok(x.shown.w > 0, 'the displayed image has pixels'); assert.equal(x.shown.src, art2.url);
  assert.deepEqual(errors, []);
  console.log(`PASS: preloaded artwork whose display fetch failed was shown as a fault (${samples.join(' ')}); ${aborted} aborted display fetches of ${requests} requests; recovered to "Live" with the same approved image (${x.shown.w}px wide) without reload.`);
} finally { await browser.close(); echo.server.closeAllConnections(); echo.server.close(); }
