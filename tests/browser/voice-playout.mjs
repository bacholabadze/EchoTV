// 3.2 voice playout: a two-presenter Georgian script rendered through the voice service (ElevenLabs = local mock,
// whose audio is a test tone, NOT Georgian speech), approved as exact bytes, published and aired. Checks that the
// broadcast plays exactly the approved audio, shows the Georgian captions in order and labels the synthetic voice.
// Requires Google Chrome. Run: npm run test:voice-playout
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createEchoServer, probeMedia} from '../../server/server.mjs';
import {voiceServiceFromEnv} from '../../server/voice/index.mjs';
import {startMockElevenLabs} from '../voice/mock-elevenlabs.mjs';

const KA = [{presenter: 'presenter-1', text: 'გამარჯობა, ეს საცდელი ხაზია.'}, {presenter: 'presenter-2', text: 'მეორე წამყვანი პასუხობს.'}];
const out = process.env.ECHO_SHOTS || join(tmpdir(), 'echo-shots'); mkdirSync(out, {recursive: true});
const mock = await startMockElevenLabs(), dataDir = mkdtempSync(join(tmpdir(), 'echo-voice-play-'));
const voice = voiceServiceFromEnv({root: '/nonexistent', dataDir, probe: p => { const {reason, ...x} = probeMedia(p); return {...x, reason}; },
  env: {ELEVENLABS_API_KEY: 'sk_test_key', ELEVENLABS_BASE_URL: mock.url, ECHO_VOICE_BUDGET_CHARS: '5000', ECHO_ELEVENLABS_VOICES: JSON.stringify({'presenter-1': 'v1', 'presenter-2': 'v2'})}});
const echo = createEchoServer({dataDir, quiet: true, hostVoiceEnabled: false, voice});
await new Promise(r => echo.server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${echo.server.address().port}`, P = echo.desk.state.people.producer.token;
const post = async (path, body) => { const r = await fetch(base + path, {method: 'POST', headers: {authorization: `Bearer ${P}`, 'content-type': 'application/json'}, body: JSON.stringify(body || {})}); const j = await r.json(); assert.equal(r.status, 200, JSON.stringify(j)); return j; };
const browser = await chromium.launch({channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required']});
try {
  // The interstitial (40–50 s) is a house host segment: the producer voices it, approves the exact audio, publishes.
  const seg = await post('/api/segments/interstitial/voice', {lines: KA, lang: 'ka'});
  const asset = seg.assets.find(a => a.id === 'voice');
  await post('/api/segments/interstitial/review', {revision: seg.revision, decision: 'approved'});
  const m = await post('/api/publish');
  const page = await (await browser.newContext({viewport: {width: 1280, height: 720}})).newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/broadcast/`); await page.click('#sound');
  const live = await post('/api/golive', {delayMs: 1500, publicationId: m.publicationId, hash: m.hash});
  const at = async sec => { const w = live.onAirAt + sec * 1000 - Date.now(); if (w > 0) await new Promise(r => setTimeout(r, w)); };
  const captions = [];
  for (const t of [40.4, 41.2, 42, 42.8, 43.5]) {
    await at(t);
    const x = await page.evaluate(() => ({...window.EchoBroadcast.getState(), caption: document.querySelector('#caption').hidden ? '' : document.querySelector('#caption').textContent, credit: document.querySelector('#lower-credit').textContent}));
    assert.equal(x.segment, 'interstitial'); assert.equal(x.onAirLabel, 'Live', `${t}s: ${x.onAirLabel}`);
    assert.equal(x.audioSrc, `/media/${asset.sha256}`, 'plays exactly the approved bytes');
    assert.match(x.credit, /synthetic voice \(ElevenLabs\)/);
    assert.match(await page.textContent('#voice-disclosure'), /^სინთეზურია \(ElevenLabs/, 'footer names the voice actually used');
    captions.push(x.caption);
    if (t === 41.2) await page.screenshot({path: join(out, 'voice-playout-georgian-captions.png')});
  }
  assert.ok(captions.includes('გამარჯობა, ეს საცდელი ხაზია.'), `first presenter's caption shown: ${JSON.stringify(captions)}`);
  assert.ok(captions.includes('მეორე წამყვანი პასუხობს.'), `second presenter's caption shown: ${JSON.stringify(captions)}`);
  assert.ok(captions.indexOf('მეორე წამყვანი პასუხობს.') > captions.indexOf('გამარჯობა, ეს საცდელი ხაზია.'), 'in order');
  const playing = await page.evaluate(() => window.EchoBroadcast.getState().audioTime);
  assert.ok(playing > 1, `voice audio advanced (${playing}s)`);
  assert.deepEqual(errors, []);
  console.log(`PASS: Georgian two-presenter script (mock ElevenLabs, test-tone audio) approved as exact bytes and aired: audio /media/${asset.sha256.slice(0, 10)}…, captions ${JSON.stringify([...new Set(captions)])}, labelled synthetic voice. Screenshot: ${join(out, 'voice-playout-georgian-captions.png')}`);
} finally { await browser.close(); echo.server.closeAllConnections(); echo.server.close(); await mock.close(); }
