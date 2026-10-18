// N01 regression: every Board action works on a plain-HTTP, non-localhost origin (the documented LAN setup),
// where crypto.randomUUID does not exist. Chrome maps a test hostname to the local server; no API is mocked.
// Requires Google Chrome. Run: npm run test:board-lan   (ECHO_STATIC_DIR=<dist> tests other page builds)
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {createEchoServer} from '../../server/server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const echo = createEchoServer({dataDir: mkdtempSync(join(tmpdir(), 'echo-lan-')), quiet: true, hostVoiceEnabled: false, ...(process.env.ECHO_STATIC_DIR ? {staticDir: process.env.ECHO_STATIC_DIR} : {})});
await new Promise(r => echo.server.listen(0, '127.0.0.1', r));
const port = echo.server.address().port, origin = `http://echo-lan.test:${port}`, s = echo.desk.state;
const browser = await chromium.launch({channel: 'chrome', args: [`--host-resolver-rules=MAP echo-lan.test 127.0.0.1`]});
const errors = [];
const open = async who => {
  const page = await (await browser.newContext()).newPage();
  page.on('pageerror', e => errors.push(`${who}: ${e.message}`));
  page.on('dialog', d => d.accept());
  await page.goto(`${origin}/board/#token=${s.people[who].token}`);
  await page.waitForSelector('#people li');
  return page;
};
const agent = async (path, id, body) => (await fetch(`http://127.0.0.1:${port}${path}`, {method: 'POST', headers: {authorization: `Bearer ${s.agents[id].token}`, 'content-type': 'application/json'}, body: JSON.stringify(body)})).json();
const noError = async page => assert.equal(await page.isVisible('#error'), false, `board error: ${await page.textContent('#error')}`);
try {
  const [a, b, producer] = await Promise.all(['creator-a', 'creator-b', 'producer'].map(open));
  const ctx = await producer.evaluate(() => ({secure: isSecureContext, uuid: typeof crypto.randomUUID, origin: location.origin}));
  assert.deepEqual(ctx, {secure: false, uuid: 'undefined', origin}, 'really an insecure non-localhost origin');

  // Approve (three people) on the insecure origin.
  const p = await agent('/api/proposals', 'agent-a', {baseRevision: 1, changes: [{segmentId: 'gallery', duration: 45}]});
  await agent(`/api/requests/${Object.values(echo.desk.state.requests)[0].id}/respond`, 'agent-b', {decision: 'accept', duration: 5});
  await agent(`/api/proposals/${p.id}/revise`, 'agent-a', {changes: [{segmentId: 'gallery', duration: 45, content: {slides: [1, 2, 3].map(i => ({assetId: `art-${i}`, seconds: 15}))}}]});
  for (const page of [a, b, producer]) { await page.waitForSelector('#approve'); await page.click('#approve'); }
  for (const page of [a, b, producer]) { await page.waitForFunction(() => document.querySelector('#revision').textContent === 'ვერსია 2'); await noError(page); }
  const approvals = echo.desk.state.audit.filter(e => e.action === 'proposal_approved').map(e => e.actor.id).sort();
  assert.deepEqual(approvals, ['creator-a', 'creator-b', 'producer'], 'each approval signed by its own person');

  // Reject on the insecure origin.
  const q = await agent('/api/proposals', 'agent-a', {baseRevision: 2, changes: [{segmentId: 'gallery', content: {slides: [{assetId: 'art-1', seconds: 25}, {assetId: 'art-2', seconds: 10}, {assetId: 'art-3', seconds: 10}]}}]});
  assert.equal(q.status, 'awaiting_approval');
  await producer.waitForSelector('#reject'); await producer.click('#reject');
  await producer.waitForFunction(() => /უარყოფილია/.test(document.querySelector('#negotiation').textContent)); await noError(producer);
  assert.equal(echo.desk.state.proposals[q.id].status, 'rejected');

  // Upload through the board's file picker on the insecure origin.
  await a.setInputFiles('[data-upload="gallery"]', {name: 'swatch.png', mimeType: 'image/png', buffer: readFileSync(join(ROOT, 'tests/fixtures/swatch.png'))});
  await a.waitForFunction(() => document.querySelector('#revision').textContent === 'ვერსია 3');
  assert.equal(echo.desk.state.segments.gallery.state, 'submitted', 'upload applied; editorial review required again');
  await producer.waitForSelector('[data-review="gallery"]'); await producer.click('[data-review="gallery"]');
  await producer.waitForFunction(() => !document.querySelector('[data-review="gallery"]'));

  // Publish and go live on the insecure origin.
  await producer.click('#publish-btn');
  await producer.waitForFunction(() => /^#1 · ვერსია 3 · /.test(document.querySelector('#publish').textContent)); await noError(producer);
  await producer.click('#live-btn');
  await producer.waitForFunction(() => /ეთერშია/.test(document.querySelector('#broadcast-state').textContent)); await noError(producer);
  assert.equal(echo.desk.state.broadcast.state, 'on_air');
  assert.ok(Object.keys(echo.desk.state.idempotency).length >= 7, 'every board action carried a request key');
  assert.deepEqual(errors, []);
  console.log(`PASS: plain-HTTP non-localhost origin ${origin} (isSecureContext=false, no crypto.randomUUID): three approvals, a rejection, an upload, a review, publish and go-live all worked with request keys.`);
} finally { await browser.close(); echo.server.closeAllConnections(); echo.server.close(); }
