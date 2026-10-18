// 3.2 judge-facing guided flow on the real board: Choose → Request → Review → Approve → Watch. Every step comes from
// server state; the guide's buttons call the real API. Agents act through the API with their own tokens (as their
// MCP gateways would). Also checks the conflict preview never draws the confirmed premiere moving.
// Requires Google Chrome. Run: npm run test:guided-flow
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createEchoServer} from '../../server/server.mjs';

const out = process.env.ECHO_SHOTS || join(tmpdir(), 'echo-shots'); mkdirSync(out, {recursive: true});
const echo = createEchoServer({dataDir: mkdtempSync(join(tmpdir(), 'echo-guide-')), quiet: true, hostVoiceEnabled: false, seedOptions: {people: {a: {name: 'ბაჩო'}, b: {name: 'ქეთი'}}}});
await new Promise(r => echo.server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${echo.server.address().port}`, s = echo.desk.state;
const browser = await chromium.launch({channel: 'chrome'});
const errors = [];
const open = async (who, viewport = {width: 1920, height: 1080}) => {
  const page = await (await browser.newContext({viewport})).newPage();
  page.on('pageerror', e => errors.push(`${who}: ${e.message}`));
  await page.goto(`${base}/board/${who === 'public' ? '' : `#token=${s.people[who].token}`}`);
  await page.waitForSelector('#guide .g-steps');
  return page;
};
const current = page => page.$eval('#guide li.current b', el => el.textContent);
const guide = page => page.textContent('#guide');
const call = async (path, token, body) => { const r = await fetch(base + path, {method: 'POST', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'}, body: JSON.stringify(body)}); return {status: r.status, body: await r.json()}; };
try {
  const [pub, a, b, producer] = await Promise.all(['public', 'creator-a', 'creator-b', 'producer'].map(w => open(w)));
  const mobile = await open('creator-a', {width: 390, height: 844});
  // 1. Choose a segment
  assert.equal(await current(pub), '1. აირჩიე სეგმენტი');
  assert.match(await guide(a), /შენი სეგმენტები/); assert.match(await guide(a), /Art gallery · 30წმ · შეიძლება 20–45წმ/);
  assert.match(await guide(b), /Music premiere · 60წმ 🔒/);
  assert.match(await guide(pub), /🔒 Music premiere — ისევ 0:50-ზეა/);
  await pub.screenshot({path: join(out, 'guide-1-choose-public.png')});
  // 2. Request airtime: A's agent asks for 45 s; it does not fit yet. The raw request is NOT drawn as a plan.
  const p = (await call('/api/proposals', s.agents['agent-a'].token, {baseRevision: 1, changes: [{segmentId: 'gallery', duration: 45}], note: 'Fifteen seconds per work'})).body;
  await pub.waitForFunction(() => document.querySelector('#guide li.current b').textContent.startsWith('2.'));
  assert.match(await guide(pub), /აგენტები თანხმდებიან/); assert.match(await guide(pub), /ველოდებით აგენტს: ქეთი/);
  assert.equal(await pub.isVisible('#track-preview'), false, 'no proposed track before the Showrunner has a valid plan');
  assert.match(await pub.textContent('#preview-label'), /მოთხოვნა: Art gallery → 45წმ · ჯერ არ ეტევა/);
  await pub.screenshot({path: join(out, 'guide-2-request-public.png')});
  // B's agent concedes; A's agent adapts → a valid plan awaiting approval.
  const req = Object.values(echo.desk.state.requests).find(r => r.toAgentId === 'agent-b');
  await call(`/api/requests/${req.id}/respond`, s.agents['agent-b'].token, {decision: 'accept', duration: 5, message: 'Premiere stays at 50s'});
  await call(`/api/proposals/${p.id}/revise`, s.agents['agent-a'].token, {changes: [{segmentId: 'gallery', duration: 45, content: {slides: [1, 2, 3].map(i => ({assetId: `art-${i}`, seconds: 15}))}}]});
  // 3. Review: the plan is drawn, and the premiere is at 50 s in it.
  await pub.waitForFunction(() => document.querySelector('#guide li.current b').textContent.startsWith('3.'));
  const plan = await pub.$$eval('#track-preview .seg', els => els.map(e => e.getAttribute('title')));
  assert.ok(plan.some(t => /^Music premiere · 0:50–1:50$/.test(t)), `plan keeps the premiere at 50s: ${plan.join(' | ')}`);
  assert.match(await guide(pub), /Art gallery: 30წმ → 45წმ/); assert.match(await guide(pub), /დაადასტურა 0\/3/);
  // 4. Approve: each required person sees "your turn" in their own window; an agent cannot approve.
  for (const page of [a, b, producer]) { await page.waitForSelector('#guide [data-g="approve"]'); assert.equal(await current(page), '4. დაადასტურე'); }
  assert.equal(await pub.$('#guide [data-g="approve"]'), null, 'no approve button on the public board');
  assert.equal((await call(`/api/proposals/${p.id}/decision`, s.agents['agent-a'].token, {version: 2, decision: 'approve'})).status, 403, 'agents cannot approve');
  await mobile.waitForSelector('#guide [data-g="approve"]');
  const turnTop = await mobile.$eval('#guide .g-turn', el => el.getBoundingClientRect().top);
  assert.ok(turnTop < 844, `mobile: "your turn" visible without scrolling (top ${turnTop}px)`);
  await mobile.screenshot({path: join(out, 'guide-4-approve-mobile.png')});
  await a.screenshot({path: join(out, 'guide-4-approve-creatorA.png')});
  await a.click('#guide [data-g="approve"]');
  await pub.waitForFunction(() => /დაადასტურა 1\/3/.test(document.querySelector('#guide').textContent));
  await b.click('#guide [data-g="approve"]'); await producer.click('#guide [data-g="approve"]');
  // 5. Watch: committed → publish → go live → live, all from server state.
  await producer.waitForSelector('#guide [data-g="publish"]');
  assert.match(await guide(producer), /ყველამ დაადასტურა/); assert.match(await guide(producer), /🔒 Music premiere — ისევ 0:50-ზეა/);
  assert.match(await guide(pub), /ველოდებით პროდიუსერს/);
  await producer.click('#guide [data-g="publish"]');
  await producer.waitForSelector('#guide [data-g="golive"]');
  assert.equal(await producer.isDisabled('#publish-btn'), true, 'Publish disabled once the current revision is published');
  assert.match(await guide(pub), /გამოქვეყნდა #1 — ეთერისთვის მზადაა/);
  await producer.click('#guide [data-g="golive"]');
  await pub.waitForFunction(() => /ეთერამდე \d წამი/.test(document.querySelector('#guide').textContent));
  assert.equal(await pub.textContent('#broadcast-state'), 'იწყება', 'not "on air" during the countdown');
  await pub.screenshot({path: join(out, 'guide-5-countdown-public.png')});
  await pub.waitForFunction(() => /პირდაპირ ეთერში · 0:0\d/.test(document.querySelector('#guide').textContent), null, {timeout: 9000});
  await pub.screenshot({path: join(out, 'guide-5-live-public.png')});
  await pub.waitForFunction(() => document.querySelector('#broadcast-state').textContent === 'ეთერშია', null, {timeout: 3000});
  assert.deepEqual(errors, []);
  console.log(`PASS: guided flow on the real board: 1 choose (own segments, 🔒 0:50) → 2 request (no plan drawn while it does not fit) → 3 review (plan keeps the premiere at 50 s) → 4 approve (your-turn in each person's window, visible on mobile at ${Math.round(turnTop)}px; agent 403) → 5 publish → countdown ("starting") → live. Screenshots in ${out}`);
} finally { await browser.close(); echo.server.closeAllConnections(); echo.server.close(); }
