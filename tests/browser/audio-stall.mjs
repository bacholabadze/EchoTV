// P0-3 regression: when required audio stalls, the player shows it within a bounded time, retries a bounded
// number of times, then shows a visible "audio unavailable" state. It never displays a plain "Live" while stuck.
// Requires Google Chrome. Run: npm run test:audio-stall
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createEchoServer} from '../../server/server.mjs';

const echo = createEchoServer({dataDir: mkdtempSync(join(tmpdir(), 'echo-stall-')), quiet: true, hostVoiceEnabled: false});
await new Promise(r => echo.server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${echo.server.address().port}`, producer = echo.desk.state.people.producer.token;
const post = async (path, body) => (await fetch(base + path, {method: 'POST', headers: {authorization: `Bearer ${producer}`, 'content-type': 'application/json'}, body: JSON.stringify(body || {})})).json();
const browser = await chromium.launch({channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required']});
const errors = [];
async function viewer(name, handler) {
  const page = await (await browser.newContext()).newPage();
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  await page.route(`**/media/${track}**`, handler);
  await page.goto(`${base}/broadcast/`);
  await page.click('#sound');
  return page;
}
const state = page => page.evaluate(() => window.EchoBroadcast.getState());
const sleepUntil = async ms => { const w = ms - Date.now(); if (w > 0) await new Promise(r => setTimeout(r, w)); };

const m = await post('/api/publish');
const track = m.segments.find(s => s.id === 'intro').assets[0].sha256;
let served = 0;
try {
  const hanging = await viewer('hang', () => {});                       // the network never answers
  const flaky = await viewer('flaky', route => (++served <= 2 ? route.abort('failed') : route.continue()));
  const live = await post('/api/golive', {delayMs: 1500, publicationId: m.publicationId, hash: m.hash});
  const onAir = live.onAirAt, labels = [];
  // Sample the hanging viewer through the 10-second intro (music required).
  let stalledAt = null, failedAt = null;
  while (Date.now() < onAir + 9800) {
    const x = await state(hanging), t = (Date.now() - onAir) / 1000;
    if (x.segment === 'intro' && t > 0) {
      labels.push([t.toFixed(1), x.onAirLabel, x.audioHealth.state]);
      if (x.audioHealth.state === 'stalled' && stalledAt === null) stalledAt = t;
      if (x.audioHealth.state === 'failed' && failedAt === null) failedAt = t;
      if (stalledAt !== null) assert.notEqual(x.onAirLabel, 'Live', `plain "Live" while audio is stuck at t=${t.toFixed(1)}`);
      if (x.audioHealth.state !== 'ok') assert.equal(x.faultVisible, true, 'fault banner visible');
    }
    await new Promise(r => setTimeout(r, 200));
  }
  assert.ok(stalledAt !== null && stalledAt < 4, `stall detected within 4s (at ${stalledAt}s)`);
  assert.ok(failedAt !== null && failedAt < 9.5, `bounded failure within 9.5s (at ${failedAt}s)`);
  const final = await state(hanging);
  assert.equal(final.onAirLabel, 'Live · audio unavailable');
  assert.equal(final.audioHealth.retries, 3, 'bounded: exactly 3 recovery attempts');
  assert.equal(await hanging.isVisible('#fault-retry'), true, 'manual retry offered');
  assert.match(await hanging.textContent('#fault-text'), /Audio unavailable for “Music intro” — the programme continues without sound/);
  await hanging.screenshot({path: join(process.env.ECHO_SHOTS || tmpdir(), 'audio-stall-unavailable.png')});

  const f = await state(flaky);
  assert.equal(f.audioHealth.state, 'ok', 'transient failure recovered automatically');
  assert.ok(f.audioHealth.recoveries >= 1, 'recovery recorded');
  assert.equal(f.onAirLabel, 'Live');
  assert.ok(served >= 3, 'retried after two failed requests');

  // The programme continues: in the gallery no audio is required, so no fault is shown.
  await sleepUntil(onAir + 12000);
  const g = await state(hanging);
  assert.equal(g.segment, 'gallery'); assert.equal(g.faultVisible, false); assert.equal(g.onAirLabel, 'Live');
  assert.deepEqual(errors, []);
  console.log(`PASS: hang → "interrupted" at ${stalledAt.toFixed(1)}s, 3 bounded retries, "unavailable" at ${failedAt.toFixed(1)}s with visible banner and Retry; never plain "Live" while stuck; transient failures (2 aborted requests) recovered automatically; gallery continued without a fault.`);
} finally { await browser.close(); echo.server.closeAllConnections(); echo.server.close(); }
