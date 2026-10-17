// 3.2 Creator Interview in a real browser: entry from the board, one spoken answer (fake microphone; speech-to-text
// and question voice = local ElevenLabs mock, no paid call), typed answers, a contradiction follow-up, upload with an
// explicit rights declaration, review, quotes, approval, segment preparation. The "creator" here is this script.
// Requires Google Chrome. Run: npm run test:interview-flow
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {createEchoServer, probeMedia} from '../../server/server.mjs';
import {voiceServiceFromEnv} from '../../server/voice/index.mjs';
import {elevenLabsStt} from '../../server/voice/stt.mjs';
import {createLedger} from '../../server/voice/store.mjs';
import {startMockElevenLabs} from '../voice/mock-elevenlabs.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = process.env.ECHO_SHOTS || join(tmpdir(), 'echo-shots'); mkdirSync(out, {recursive: true});
const mock = await startMockElevenLabs(), dataDir = mkdtempSync(join(tmpdir(), 'echo-ivui-'));
const voice = voiceServiceFromEnv({root: '/nonexistent', dataDir, probe: p => { const {reason, ...x} = probeMedia(p); return {...x, reason}; },
  env: {ELEVENLABS_API_KEY: 'sk_test', ELEVENLABS_BASE_URL: mock.url, ECHO_VOICE_BUDGET_CHARS: '3000', ECHO_ELEVENLABS_VOICES: JSON.stringify({interviewer: 'voice-interviewer'})}});
const stt = {provider: elevenLabsStt({apiKey: 'sk_test', baseUrl: mock.url}), ledger: createLedger(join(dataDir, 'stt.json'), 300, {unit: 'seconds'})};
const echo = createEchoServer({dataDir, quiet: true, hostVoiceEnabled: false, voice, stt, seedOptions: {people: {a: {name: 'ბაჩო'}, b: {name: 'ქეთი'}}}});
await new Promise(r => echo.server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${echo.server.address().port}`, S = echo.desk.state;
const browser = await chromium.launch({channel: 'chrome', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required']});
const errors = [];
try {
  const ctx = await browser.newContext({viewport: {width: 1440, height: 900}, permissions: ['microphone']});
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/board/#token=${S.people['creator-b'].token}`);
  await page.waitForSelector('#guide .primary-link');
  assert.match(await page.textContent('#guide'), /ესაუბრე ECHO-ს/); assert.match(await page.textContent('#guide'), /დააკავშირე შენი აგენტი/);
  await page.click('#guide .g-agent summary');
  assert.match(await page.textContent('#guide .g-agent'), /ბრიფს, ფაილებს და უფლებებს მაინც შენ ადასტურებ/);
  await page.screenshot({path: join(out, 'interview-0-board-entry.png')});
  await page.click('#guide .primary-link');                       // same tab: the private session carries over
  await page.waitForSelector('#begin');
  assert.equal(page.url(), `${base}/interview/`, 'no token in the address bar');
  await page.click('#begin');
  await page.waitForFunction(() => /ვინ ხარ/.test(document.querySelector('h1')?.textContent || ''));
  assert.match(await page.textContent('h1'), /ვინ ხარ და რა შექმენი\?/);
  await page.waitForFunction(() => window.EchoInterview.state().caption === 'ვინ ხარ და რა შექმენი?');
  // ---- Q1 spoken: consent, record, transcript, correction ----
  await page.click('[data-mode="voice"]');
  assert.match(await page.textContent('#view'), /ECHO ჩანაწერს არ ინახავს/);
  await page.click('#allow'); await page.waitForSelector('#error:not([hidden])'); // consent box not ticked: refused
  await page.check('#consent'); await page.click('#allow'); await page.waitForSelector('#rec');
  await page.click('#rec'); await page.waitForTimeout(1800); await page.click('#rec');
  await page.waitForSelector('#transcript', {timeout: 20000});
  assert.equal(await page.inputValue('#transcript'), 'ჩემი სახელია ტესტ შემქმნელი და ვწერ მუსიკას.');
  await page.waitForFunction(() => window.EchoInterview.state().studioReady, null, {timeout: 20000});
  assert.equal(await page.isVisible('#studio-fallback'), false, 'the ECHO host renders (no fallback card)');
  await page.screenshot({path: join(out, 'interview-1-transcript-review.png')});
  await page.fill('#transcript', 'ჩემი სახელია ტესტ შემქმნელი და ვწერ სიმღერებს.');
  await page.fill('#f-displayName', 'ტესტ შემქმნელი'); await page.fill('#f-workTitle', 'სატესტო სიმღერა'); await page.selectOption('#f-category', 'music');
  await page.click('#next');
  await page.waitForFunction(() => /რამ შთაგაგონა/.test(document.querySelector('h1').textContent));
  const iv = Object.values(echo.desk.state.interviews)[0];
  assert.deepEqual([iv.answers.who.source, iv.answers.who.transcript.corrected, iv.answers.who.text], ['voice', true, 'ჩემი სახელია ტესტ შემქმნელი და ვწერ სიმღერებს.']);
  assert.equal(mock.calls.filter(c => c.path === '/v1/speech-to-text').length, 1);
  // ---- typed answers, contradiction follow-up ----
  await page.click('[data-mode="text"]');
  await page.fill('#answer', 'ზღვის ხმამ შთამაგონა. ბავშვობაში ზღვასთან ვცხოვრობდი.'); await page.click('#next');
  await page.waitForFunction(() => /AI-ს/.test(document.querySelector('h1').textContent));
  await page.fill('#answer', 'მელოდია მე დავწერე, ბითი Suno-თი გავაკეთე.'); await page.selectOption('#f-aiInvolvement', 'none'); await page.click('#next');
  await page.waitForSelector('.tag:has-text("დამატებითი კითხვა")');
  assert.match(await page.textContent('h1'), /Suno/);
  await page.selectOption('#f-aiInvolvement', 'assisted'); await page.click('#next');
  await page.waitForFunction(() => /რომელი ნაწილი/.test(document.querySelector('h1').textContent));
  await page.fill('#answer', 'რეფრენი.'); await page.selectOption('#f-preferredFormat', 'premiere'); await page.fill('#f-desiredAirtimeSec', '60'); await page.click('#next');
  // ---- media: upload, technical check, explicit rights ----
  await page.waitForSelector('#upload');
  await page.setInputFiles('#upload', join(ROOT, 'tests/fixtures/tone-62s.mp3'));
  await page.waitForSelector('input[name=media]');
  assert.match(await page.textContent('.media'), /ტექნიკური შემოწმება გაიარა/);
  const mid = await page.getAttribute('input[name=media]', 'value');
  await page.check(`[data-use="publicBroadcast"][data-media="${mid}"]`); await page.check(`[data-use="replays"][data-media="${mid}"]`);
  await page.click(`[data-save-rights="${mid}"]`); await page.waitForSelector('#error:not([hidden])'); // not confirmed: refused
  await page.check(`[data-use="publicBroadcast"][data-media="${mid}"]`); await page.check(`[data-use="replays"][data-media="${mid}"]`); await page.check(`[data-confirm="${mid}"]`);
  await page.click(`[data-save-rights="${mid}"]`);
  await page.waitForFunction(() => /დაშვებული: საჯარო ეთერი, განმეორებითი ჩვენება და არქივი/.test(document.querySelector('.media').textContent));
  await page.check('input[name=media]'); await page.fill('#answer', 'მხოლოდ ეს ტრეკი.');
  await page.screenshot({path: join(out, 'interview-2-media-rights.png')});
  await page.click('#next');
  await page.waitForFunction(() => /წამყვანმა/.test(document.querySelector('h1').textContent));
  await page.click('#skip');
  // ---- review, quotes, approval ----
  await page.waitForSelector('#approve');
  assert.match(await page.textContent('#view'), /ტესტ შემქმნელი/); assert.match(await page.textContent('#view'), /AI დამეხმარა/);
  await page.check('input[name=quote][value="ზღვის ხმამ შთამაგონა."]'); await page.click('#quotes');
  await page.waitForFunction(() => document.querySelector('input[name=quote]:checked'));
  await page.screenshot({path: join(out, 'interview-3-review.png'), fullPage: true});
  await page.click('#approve');
  await page.waitForSelector('#prepare');
  assert.match(await page.textContent('#view'), /ბრიფი დადასტურებულია/);
  await page.selectOption('#seg', 'premiere'); await page.selectOption('#slot-track', mid);
  await page.click('#prepare');
  await page.waitForFunction(() => /სეგმენტი: /.test(document.querySelector('#view').textContent));
  await page.screenshot({path: join(out, 'interview-4-approved-prepared.png')});
  const seg = echo.desk.state.segments.premiere;
  assert.equal(seg.state, 'submitted'); assert.equal(seg.content.brief.displayName, 'ტესტ შემქმნელი'); assert.deepEqual(seg.content.brief.quotes, ['ზღვის ხმამ შთამაგონა.']);
  assert.ok(mock.calls.some(c => c.path === '/v1/text-to-speech/voice-interviewer/with-timestamps'), 'questions were spoken (mock voice)');
  // ---- accessibility basics, phone width ----
  const unlabeled = await page.evaluate(() => [...document.querySelectorAll('input:not([type=hidden]),select,textarea')].filter(e => !(e.labels?.length || e.getAttribute('aria-label') || e.closest('label'))).length);
  assert.equal(unlabeled, 0, 'every control has a label');
  const mobile = await (await browser.newContext({viewport: {width: 390, height: 844}})).newPage();
  await mobile.goto(`${base}/interview/#token=${S.people['creator-a'].token}`); await mobile.waitForSelector('#begin'); await mobile.click('#begin'); await mobile.waitForSelector('#answer');
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(overflow <= 0, `no sideways scroll on a phone (${overflow}px)`);
  await mobile.screenshot({path: join(out, 'interview-5-mobile.png'), fullPage: true});
  // ---- technical view on the producer board ----
  const prod = await (await browser.newContext({viewport: {width: 1440, height: 900}})).newPage();
  await prod.goto(`${base}/board/#token=${S.people.producer.token}`); await prod.waitForSelector('#tech');
  await prod.click('#tech summary'); await prod.waitForSelector('#tech-body h3');
  assert.match(await prod.textContent('#tech-body'), /brief_approved/); assert.match(await prod.textContent('#tech-body'), /segment_prepared/);
  assert.ok(!(await prod.textContent('#tech-body')).includes('ზღვის ხმამ'), 'private answers never in the technical view');
  assert.deepEqual(errors, []);
  console.log(`PASS: creator interview in Chrome: board entry (same-tab session), spoken answer with consent + corrected transcript (mock STT), typed answers, contradiction follow-up, upload + explicit rights, review + quotes + approval, segment prepared (submitted for review), questions voiced (mock), labelled controls, no sideways scroll at 390 px, technical view without private content. Screenshots in ${out}`);
} finally { await browser.close(); echo.server.closeAllConnections(); echo.server.close(); await mock.close(); }
