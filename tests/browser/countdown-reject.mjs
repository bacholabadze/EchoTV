// R3 regression (Codex, 3e0c846, P1/N04): the producer presses Go live on the board, viewers show "Starting", and
// the producer rejects published content through the board before the countdown ends. The publication is withdrawn:
// no viewer ever shows it Live, the board says withdrawn and Go live stays refused. Requires Google Chrome.
// Run: npm run test:countdown-reject
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createEchoServer} from '../../server/server.mjs';

const echo = createEchoServer({dataDir: mkdtempSync(join(tmpdir(), 'echo-countdown-')), quiet: true, hostVoiceEnabled: false, ...(process.env.ECHO_STATIC_DIR ? {staticDir: process.env.ECHO_STATIC_DIR} : {})});
await new Promise(r => echo.server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${echo.server.address().port}`, P = echo.desk.state.people.producer.token;
const m = await (await fetch(`${base}/api/publish`, {method: 'POST', headers: {authorization: `Bearer ${P}`}})).json();
const browser = await chromium.launch({channel: 'chrome'});
const errors = [];
const page = async (url, who) => { const p = await (await browser.newContext({viewport: {width: 1280, height: 900}})).newPage(); p.on('pageerror', e => errors.push(`${who}: ${e.message}`)); await p.goto(url); return p; };
try {
  const [producer, viewer] = await Promise.all([page(`${base}/board/#token=${P}`, 'producer'), page(`${base}/broadcast/`, 'viewer')]);
  await producer.waitForSelector('#live-btn:not([disabled])');
  await producer.click('#live-btn');                                   // the board's Go live: 5-second countdown
  await viewer.waitForFunction(() => window.EchoBroadcast.getState().onAirLabel === 'Starting');
  const onAirAt = echo.desk.state.broadcast.onAirAt;
  let warning = '';
  producer.once('dialog', d => { warning = d.message(); d.accept('Rights for art-2 not confirmed'); });
  await producer.click('[data-reject="gallery"]');
  while (!echo.desk.state.audit.some(e => e.action === 'segment_reviewed')) await new Promise(r => setTimeout(r, 20));
  const rejectedBy = onAirAt - echo.desk.state.audit.findLast(e => e.action === 'segment_reviewed').at;
  assert.ok(rejectedBy > 0, `rejection confirmed ${rejectedBy} ms before the scheduled start`);
  const labels = new Set();
  while (Date.now() < onAirAt + 3000) {
    const x = await viewer.evaluate(() => window.EchoBroadcast.getState());
    labels.add(x.onAirLabel);
    assert.notEqual(x.onAirLabel, 'Live', 'a rejected publication must not begin when its countdown expires');
    assert.equal(x.live, false);
    await new Promise(r => setTimeout(r, 100));
  }
  assert.equal(await viewer.evaluate(() => window.EchoBroadcast.getState().onAirLabel), 'Off air');
  assert.equal(echo.desk.state.broadcast.state, 'queued');
  assert.match(await producer.textContent('#publish'), /withdrawn/, 'the board shows the publication withdrawn');
  assert.equal(await producer.isDisabled('#live-btn'), true, 'Go live unavailable after withdrawal');
  const again = await fetch(`${base}/api/golive`, {method: 'POST', headers: {authorization: `Bearer ${P}`, 'content-type': 'application/json'}, body: JSON.stringify({delayMs: 0, publicationId: m.publicationId, hash: m.hash})});
  assert.equal(again.status, 409); assert.equal((await again.json()).error, 'withdrawn');
  assert.match(warning, /cancels the start and withdraws the publication/, 'the board warned before rejecting');
  assert.deepEqual(errors, []);
  console.log(`PASS: rejected through the board ${rejectedBy} ms before the scheduled start; viewer showed ${[...labels].join(' → ')} and never Live through +3 s; board shows withdrawn; Go live refused (409 withdrawn).`);
} finally { await browser.close(); echo.server.closeAllConnections(); echo.server.close(); }
