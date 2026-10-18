// N02 regression (player side): an artwork that cannot be shown is a visible fault, never a blank frame under a
// plain "Live". The server already refuses corrupt uploads; this covers delivery failures of published images
// (corrupt bytes on the wire, a request that never answers). Requires Google Chrome. Run: npm run test:art-fault
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {createEchoServer} from '../../server/server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const echo = createEchoServer({dataDir: mkdtempSync(join(tmpdir(), 'echo-art-')), quiet: true, hostVoiceEnabled: false, ...(process.env.ECHO_STATIC_DIR ? {staticDir: process.env.ECHO_STATIC_DIR} : {})});
await new Promise(r => echo.server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${echo.server.address().port}`, P = echo.desk.state.people.producer.token;
const post = async (path, body) => (await fetch(base + path, {method: 'POST', headers: {authorization: `Bearer ${P}`, 'content-type': 'application/json'}, body: JSON.stringify(body || {})})).json();
const m = await post('/api/publish');
const art = id => m.segments.find(s => s.id === 'gallery').assets.find(a => a.id === id);
const headerOnly = readFileSync(join(ROOT, 'tests/fixtures/swatch.png')).subarray(0, 33);
const browser = await chromium.launch({channel: 'chrome'});
const page = await (await browser.newContext({viewport: {width: 1280, height: 760}})).newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.route(`**${art('art-2').url}**`, route => route.fulfill({status: 200, contentType: 'image/png', body: headerOnly}));  // corrupt on the wire
await page.route(`**${art('art-3').url}**`, () => {});                                                                       // never answers
await page.goto(`${base}/broadcast/`);
const state = () => page.evaluate(() => window.EchoBroadcast.getState());
try {
  const live = await post('/api/golive', {delayMs: 1500, publicationId: m.publicationId, hash: m.hash});
  const at = async sec => { const w = live.onAirAt + sec * 1000 - Date.now(); if (w > 0) await new Promise(r => setTimeout(r, w)); };
  // Gallery 10–40 s: art-1 (10–20, healthy), art-2 (20–30, corrupt), art-3 (30–40, hung).
  await at(15);
  let x = await state();
  assert.equal(x.segment, 'gallery'); assert.equal(x.onAirLabel, 'Live'); assert.equal(x.faultVisible, false, 'healthy artwork: no fault');
  const samples = [];
  for (const t of [20.4, 22, 25, 29.5, 30.4, 33, 36, 39.5]) {
    await at(t); x = await state();
    samples.push([t, x.onAirLabel, x.artFault?.assetId]);
    assert.notEqual(x.onAirLabel, 'Live', `plain "Live" over a broken artwork at ${t}s`);
    assert.equal(x.faultVisible, true, `fault banner at ${t}s`);
    if (t === 25 || t === 36) {
      assert.equal(await page.isVisible('#art-missing'), true, `credits card instead of a blank frame at ${t}s`);
      assert.match(await page.textContent('#art-missing-title'), t === 25 ? /Wheat Field with Cypresses/ : /Circus Sideshow/);
      assert.match(await page.textContent('#fault-text'), /ვერ გამოჩნდა — გადაცემა გრძელდება/);
      if (t === 25) await page.screenshot({path: join(process.env.ECHO_SHOTS || tmpdir(), 'art-fault-unavailable.png')});
    }
  }
  await at(41); x = await state();
  assert.equal(x.faultVisible, false, 'fault clears when the segment ends'); assert.equal(x.onAirLabel, 'Live');
  assert.deepEqual(errors, []);
  console.log(`PASS: corrupt and hung published artworks shown as "${samples[1][1]}" with banner and credits card; never plain "Live" (${samples.map(s => `${s[0]}s:${s[2]}`).join(' ')}); healthy artwork and the next segment unaffected.`);
} finally { await browser.close(); echo.server.closeAllConnections(); echo.server.close(); }
