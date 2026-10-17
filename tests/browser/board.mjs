// Browser check: three separate signed-in sessions see one live board and approve with their own identity.
// Requires Google Chrome. Run: npm run test:browser
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createEchoServer} from '../../server/server.mjs';

const out = process.env.ECHO_SHOTS || join(tmpdir(), 'echo-shots'); mkdirSync(out, {recursive: true});
const echo = createEchoServer({dataDir: mkdtempSync(join(tmpdir(), 'echo-board-')), quiet: true});
await new Promise(r => echo.server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${echo.server.address().port}`, s = echo.desk.state;
const browser = await chromium.launch({channel: 'chrome'});
const errors = [];
const open = async who => {
  const page = await (await browser.newContext({viewport: {width: 1440, height: 1000}})).newPage();
  page.on('pageerror', e => errors.push(`${who}: ${e.message}`));
  await page.goto(`${base}/board/#token=${s.people[who].token}`);
  await page.waitForSelector('#people li');
  assert.ok(!page.url().includes('token='), 'token removed from the address bar');
  return page;
};
try {
  const [a, b, producer] = await Promise.all(['creator-a', 'creator-b', 'producer'].map(open));
  assert.match(await a.textContent('#who'), /Creator A/);
  assert.equal(await producer.isVisible('#producer-actions'), true);
  assert.equal(await a.isVisible('#producer-actions'), false);
  // Agents act through the API (as their MCP gateways would).
  const agent = id => ({type: 'agent', id});
  const call = async (path, token, body) => (await fetch(base + path, {method: 'POST', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'}, body: JSON.stringify(body)})).json();
  const p = await call('/api/proposals', s.agents['agent-a'].token, {baseRevision: 1, changes: [{segmentId: 'gallery', duration: 45}], note: 'Fifteen seconds per work'});
  const req = Object.values(echo.desk.state.requests).find(r => r.toAgentId === 'agent-b');
  await call(`/api/requests/${req.id}/respond`, s.agents['agent-b'].token, {decision: 'accept', duration: 5, message: 'Premiere stays at 50s'});
  await call(`/api/proposals/${p.id}/revise`, s.agents['agent-a'].token, {changes: [{segmentId: 'gallery', duration: 45, content: {slides: [1, 2, 3].map(i => ({assetId: `art-${i}`, seconds: 15}))}}]});
  for (const page of [a, b, producer]) await page.waitForSelector('#approve');
  await producer.screenshot({path: join(out, 'board-awaiting-approval.png'), fullPage: true});
  assert.match(await b.textContent('#negotiation'), /Premiere stays at 50s/);
  for (const page of [a, b, producer]) await page.click('#approve');
  for (const page of [a, b, producer]) await page.waitForFunction(() => document.querySelector('#revision').textContent === 'r2');
  assert.match(await a.textContent('#revisions'), /Art gallery: 10s\+30s → 5s\+45s/);
  await producer.click('#publish-btn');
  await producer.waitForFunction(() => /^#1 · r2 · [0-9a-f]{10}$/.test(document.querySelector('#publish').textContent));
  await producer.screenshot({path: join(out, 'board-committed-published.png'), fullPage: true});
  // N04: the producer turns down published content through the board; the publication is withdrawn before air.
  assert.equal(await a.isVisible('[data-reject="gallery"]'), false, 'creators have no reject control');
  producer.once('dialog', d => { assert.match(d.message(), /withdraws the ready publication/); d.accept('Rights for art-2 not confirmed'); });
  await producer.click('[data-reject="gallery"]');
  await producer.waitForFunction(() => document.querySelector('#publish').textContent === '#1 withdrawn');
  assert.equal(await producer.isDisabled('#live-btn'), true, 'Go live unavailable after withdrawal');
  assert.match(await producer.textContent('#feed'), /Publication #1 \(revision 2\) withdrawn before air by ECHO Producer: Rights for art-2 not confirmed/);
  assert.equal(await producer.isVisible('[data-reject="gallery"]'), false, 'the rejected revision offers no second reject');
  assert.equal(await producer.isVisible('[data-review="gallery"]'), false, 'and cannot simply be re-approved');
  assert.deepEqual(errors, []);
  console.log(`PASS: three sessions, one live board; per-person approve buttons; r2 committed and published; producer rejection through the board withdrew publication #1 before air with the reason logged. Screenshots in ${out}`);
} finally { await browser.close(); echo.server.closeAllConnections(); echo.server.close(); }
