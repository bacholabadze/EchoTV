// N04 activation race (Codex, d0e5ae5, P1): a viewer whose live updates (SSE) are delayed must never start a
// publication that the producer withdrew before its scheduled start. One viewer connects directly, the other through
// a proxy that delays (or cuts) only /api/events; API requests and media are not delayed. Native audio "playing"
// events are recorded in each page. Scenarios:
//   exact         SSE +1500 ms, rejection 493 ms before onAirAt (Codex's reproduction)
//   boundary      SSE +1500 ms, rejection 40 ms before onAirAt
//   disconnected  live updates cut after "Starting", rejection 493 ms before onAirAt
//   on-air        SSE +1500 ms, rejection 400 ms after onAirAt: plays and keeps playing (N04: no interruption)
//   normal        SSE +1500 ms, no rejection: both play; start latency measured
//   unverified    the start check fails (network) for 2.5 s: visible "Unable to verify", nothing plays; then joins
//   reconnect     a viewer reloads mid-show and rejoins in sync
// Requires Google Chrome. Run: npm run test:activation-race   (ECHO_SCENARIOS=exact,normal to pick)
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createEchoServer} from '../../server/server.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async at => { const w = at - Date.now(); if (w > 0) await sleep(w); };

// Forwards everything; /api/events chunks are written `delay` ms late, or dropped once `cut` is set.
function eventProxy(port, delay) {
  const ctl = {cut: false};
  const server = http.createServer((req, res) => {
    const events = req.url.startsWith('/api/events');
    const up = http.request({host: '127.0.0.1', port, path: req.url, method: req.method, headers: req.headers}, r => {
      res.writeHead(r.statusCode, r.headers);
      if (!events) return r.pipe(res);
      r.on('data', chunk => setTimeout(() => ctl.cut || res.writableEnded || res.write(chunk), delay));
      r.on('end', () => setTimeout(() => res.end(), delay));
    });
    up.on('error', () => res.destroy());
    req.pipe(up);
  });
  ctl.server = server;
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({...ctl, ctl, port: server.address().port, close: () => { server.closeAllConnections(); server.close(); }})));
}

async function scenario(browser, name, {rejectAt = null, cut = false, blockCheckMs = 0, reloadAt = null, delay = 1500} = {}) {
  const echo = createEchoServer({dataDir: mkdtempSync(join(tmpdir(), `echo-race-${name}-`)), quiet: true, hostVoiceEnabled: false, ...(process.env.ECHO_STATIC_DIR ? {staticDir: process.env.ECHO_STATIC_DIR} : {})});
  await new Promise(r => echo.server.listen(0, '127.0.0.1', r));
  const port = echo.server.address().port, P = echo.desk.state.people.producer.token, proxy = await eventProxy(port, delay);
  const api = async (path, body) => (await fetch(`http://127.0.0.1:${port}${path}`, {method: 'POST', headers: {authorization: `Bearer ${P}`, 'content-type': 'application/json'}, body: JSON.stringify(body || {})})).json();
  const errors = [], pages = {};
  const open = async (who, origin) => {
    const ctx = await browser.newContext({viewport: {width: 960, height: 600}});
    await ctx.addInitScript(() => {
      window.__playing = [];
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () { if (!this.__hooked) { this.__hooked = true; this.addEventListener('playing', () => window.__playing.push(Date.now())); } return play.call(this); };
    });
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push(`${who}: ${e.message}`));
    if (who === 'direct' && blockCheckMs) { pages.block = true; await page.route('**/api/broadcast/activation**', route => pages.block ? route.abort('failed') : route.continue()); }
    await page.goto(`${origin}/broadcast/`); await page.click('#sound');
    return page;
  };
  try {
    const m = await api('/api/publish');
    pages.direct = await open('direct', `http://127.0.0.1:${port}`);
    pages.delayed = await open('delayed', `http://127.0.0.1:${proxy.port}`);
    const live = await api('/api/golive', {delayMs: 5000, publicationId: m.publicationId, hash: m.hash});
    const onAirAt = live.onAirAt;
    for (const p of [pages.direct, pages.delayed]) await p.waitForFunction(() => window.EchoBroadcast.getState().onAirLabel === 'Starting');
    if (cut) proxy.ctl.cut = true;
    let rejection = null;
    const reject = rejectAt === null ? null : (async () => { await until(onAirAt + rejectAt); rejection = {at: Date.now(), body: await fetch(`http://127.0.0.1:${port}/api/segments/gallery/review`, {method: 'POST', headers: {authorization: `Bearer ${P}`, 'content-type': 'application/json'}, body: JSON.stringify({revision: 1, decision: 'rejected', note: `race ${name}`})}).then(r => r.json())}; })();
    if (blockCheckMs) setTimeout(() => { pages.block = false; }, onAirAt + blockCheckMs - Date.now());
    const samples = {direct: [], delayed: []};
    const end = onAirAt + (reloadAt ? 8000 : blockCheckMs ? blockCheckMs + 3000 : 3000);
    let reloaded = false;
    while (Date.now() < end) {
      if (reloadAt && !reloaded && Date.now() >= onAirAt + reloadAt) { reloaded = true; await pages.delayed.reload(); await pages.delayed.click('#sound'); }
      for (const who of ['direct', 'delayed']) {
        const x = await pages[who].evaluate(() => ({...window.EchoBroadcast.getState(), at: Date.now(), playing: window.__playing.slice()})).catch(() => null);
        if (x) samples[who].push(x);
      }
      await sleep(40);
    }
    await reject;
    // When each viewer received the start answer (absolute ms), to measure the latency the check adds.
    const final = {}; for (const who of ['direct', 'delayed']) final[who] = await pages[who].evaluate(() => ({...window.EchoBroadcast.getState(), playing: window.__playing.slice(),
      answers: performance.getEntriesByType('resource').filter(e => e.name.includes('/api/broadcast/activation')).map(e => Math.round(performance.timeOrigin + e.responseEnd))}));
    return {name, onAirAt, rejection, samples, final, server: echo.desk.state.broadcast, errors};
  } finally { for (const p of Object.values(pages)) if (p?.context) await p.context().close().catch(() => {}); proxy.close(); echo.server.closeAllConnections(); echo.server.close(); }
}

const liveSamples = list => list.filter(x => x.live || x.onAirLabel.startsWith('Live'));
const firstPlaying = x => x.playing[0] ?? null;
const checks = {
  async exact(browser) { return withdrawnNeverPlays(await scenario(browser, 'exact', {rejectAt: -493})); },
  async boundary(browser) { return withdrawnNeverPlays(await scenario(browser, 'boundary', {rejectAt: -40})); },
  async disconnected(browser) { return withdrawnNeverPlays(await scenario(browser, 'disconnected', {rejectAt: -493, cut: true}), {cut: true}); },
  async 'on-air'(browser) {
    const r = await scenario(browser, 'on-air', {rejectAt: 400});
    assert.equal(r.server.state, 'on_air', 'a rejection after the start does not stop the show');
    for (const who of ['direct', 'delayed']) {
      assert.ok(firstPlaying(r.final[who]), `${who}: authorised show plays`);
      assert.equal(r.final[who].onAirLabel, 'Live', `${who}: still live 3 s after the start`);
      assert.ok(r.final[who].audioTime > 42.5, `${who}: intro audio (from 40 s) kept playing after the rejection (${r.final[who].audioTime}s)`);
    }
    return `rejected +${r.rejection.at - r.onAirAt} ms after the start; both viewers kept playing (audio at ${r.final.direct.audioTime.toFixed(2)} / ${r.final.delayed.audioTime.toFixed(2)} s)`;
  },
  async normal(browser) {
    const r = await scenario(browser, 'normal');
    const lat = {};
    for (const who of ['direct', 'delayed']) {
      const p = firstPlaying(r.final[who]);
      assert.ok(p, `${who}: plays`); lat[who] = p - r.onAirAt;
      assert.ok(lat[who] < 250, `${who}: audio started ${lat[who]} ms after onAirAt`);
      assert.ok(r.final[who].onsets.intro < .25, `${who}: intro onset ${r.final[who].onsets.intro}s`);
    }
    const answered = who => r.final[who].answers.at(-1) - r.onAirAt;
    for (const who of ['direct', 'delayed']) assert.ok(answered(who) >= 0 && answered(who) < 100, `${who}: start confirmed ${answered(who)} ms after onAirAt`);
    return `no rejection: start confirmed at +${answered('direct')} / +${answered('delayed')} ms, native audio playing at +${lat.direct} ms (direct) / +${lat.delayed} ms (SSE +1500 ms) after onAirAt; intro onsets ${r.final.direct.onsets.intro}s / ${r.final.delayed.onsets.intro}s`;
  },
  async unverified(browser) {
    const r = await scenario(browser, 'unverified', {blockCheckMs: 2500});
    const during = r.samples.direct.filter(x => x.at >= r.onAirAt + 300 && x.at < r.onAirAt + 2400);
    assert.ok(during.length > 5);
    for (const x of during) {
      assert.equal(x.live, false, `nothing plays while the start cannot be verified (${x.onAirLabel})`);
      assert.match(x.onAirLabel, /Unable to verify|Waiting/);
      assert.equal(x.playing.length, 0, 'no native audio while unverified');
    }
    assert.ok(during.some(x => /Unable to verify/.test(x.onAirLabel)), 'the failure is shown as "Unable to verify"');
    const joined = r.samples.direct.find(x => x.live && x.at >= r.onAirAt + 2500);
    assert.ok(joined, 'joins once the start is verified');
    assert.ok(joined.at - (r.onAirAt + 2500) < 2000, `joined ${joined.at - r.onAirAt - 2500} ms after the network recovered`);
    assert.ok(Math.abs(r.final.direct.programmeTime - r.final.delayed.programmeTime) < .5, 'in sync with the other viewer');
    return `start check failing for 2.5 s: "${[...new Set(during.map(x => x.onAirLabel))].join('" / "')}", nothing played; joined in sync ${joined.at - r.onAirAt - 2500} ms after recovery`;
  },
  async reconnect(browser) {
    const r = await scenario(browser, 'reconnect', {reloadAt: 3000});
    const after = r.samples.delayed.find(x => x.at > r.onAirAt + 3000 && x.live);
    assert.ok(after, 'the reloaded viewer rejoins');
    assert.ok(r.final.delayed.playing.length, 'audio resumes after reload');
    assert.ok(Math.abs(r.final.direct.programmeTime - r.final.delayed.programmeTime) < .5, 'in sync after reload');
    return `viewer reloaded at +3 s (SSE +1500 ms) rejoined live at +${after.at - r.onAirAt} ms, in sync (Δ ${Math.round(Math.abs(r.final.direct.programmeTime - r.final.delayed.programmeTime) * 1000)} ms)`;
  },
};

function withdrawnNeverPlays(r, {cut = false} = {}) {
  assert.equal(r.server.state, 'queued', 'server withdrew the publication');
  assert.ok(r.server.withdrawn?.cancelledStartAt, 'start cancelled');
  const lead = r.onAirAt - r.rejection.at;
  for (const who of ['direct', 'delayed']) {
    const live = liveSamples(r.samples[who]);
    assert.equal(live.length, 0, `${who}: ${live.length} Live samples of a withdrawn publication (first at +${live[0] && live[0].at - r.onAirAt} ms)`);
    assert.equal(r.final[who].playing.length, 0, `${who}: native audio played ${r.final[who].playing.map(t => t - r.onAirAt).join(',')} ms after onAirAt`);
    assert.equal(r.final[who].onAirLabel, 'Off air', `${who}: shows Off air (${r.final[who].onAirLabel})`);
  }
  assert.deepEqual(r.errors, []);
  return `rejected ${lead} ms before onAirAt${cut ? ', live updates cut' : ', SSE +1500 ms'}: 0 Live samples, 0 native playing events in both viewers; both Off air`;
}

const wanted = (process.env.ECHO_SCENARIOS || Object.keys(checks).join(',')).split(',');
const browser = await chromium.launch({channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required']});
const results = [], failures = [];
try {
  for (const name of wanted) {
    try { results.push(`${name}: ${await checks[name](browser)}`); }
    catch (e) { failures.push(`${name}: ${e.message.split('\n')[0]}`); }
  }
} finally { await browser.close(); }
for (const line of results) console.log(`  ok   ${line}`);
for (const line of failures) console.log(`  FAIL ${line}`);
if (failures.length) { console.log(`FAIL: ${failures.length} of ${wanted.length} activation-race scenarios`); process.exit(1); }
console.log(`PASS: ${results.length} activation-race scenarios`);
