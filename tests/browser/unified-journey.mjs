// Unified build, real Chrome against the HTTP-served app (own isolated server): the creator-to-broadcast journey as
// the founder would click it, plus the two UI defects of the independent audit (Q3 correction dead end at 390 px,
// Q4 explicit media selection). Every person is a SCRIPTED STAND-IN. Run: node tests/browser/unified-journey.mjs
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {createEchoServer} from '../../server/server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = process.env.ECHO_SHOTS || join(tmpdir(), 'echo-shots-unified'); mkdirSync(out, {recursive: true});
const echo = createEchoServer({dataDir: mkdtempSync(join(tmpdir(), 'echo-unified-')), quiet: true, hostVoiceEnabled: false, seedOptions: {people: {a: {name: 'Bacho', specialty: 'Art'}, b: {name: 'Keti', specialty: 'Music'}}}});
await new Promise(r => echo.server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${echo.server.address().port}`, S = () => echo.desk.state, T = {B: S().people['creator-b'].token, P: S().people.producer.token};
const req = async (method, path, token, body, headers = {}) => { const r = await fetch(base + path, {method, headers: {authorization: `Bearer ${token}`, ...(Buffer.isBuffer(body) ? {} : {'content-type': 'application/json'}), ...headers}, body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body)}); return {status: r.status, body: await r.json()}; };
const browser = await chromium.launch({channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio']});
const errors = [];
const newPage = async (viewport) => { const page = await (await browser.newContext({viewport})).newPage(); page.on('pageerror', e => errors.push(`${page.url()}: ${e.message}`)); return page; };
const shot = (page, name) => page.screenshot({path: join(out, `${name}.png`), fullPage: false});
const results = [];
const check = (name, ok, detail = '') => { results.push({name, ok, detail}); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); if (!ok) throw new Error(name); };
try {
  // Home: anonymous, then with Keti's private link; desktop and phone.
  let page = await newPage({width: 1440, height: 900});
  await page.goto(`${base}/`); await shot(page, 'u1-home-anon');
  check('home has Create / Produce / Watch', await page.evaluate(() => ['#step-create', '#step-produce', 'a[href="/broadcast/"]'].every(s => !!document.querySelector(s))));
  check('home without a link locks Create', await page.evaluate(() => document.querySelector('#step-create').classList.contains('locked')));
  await page.goto(`${base}/?who=keti#token=${T.B}`); await page.waitForSelector("#me.on"); await shot(page, 'u2-home-keti');
  check('home greets the creator by name and hands the session on', (await page.textContent('#me')).includes('Keti') && !(await page.evaluate(() => location.hash)));
  const mobile = await newPage({width: 390, height: 844});
  await mobile.goto(`${base}/`); await shot(mobile, 'u3-home-mobile');
  check('home: no sideways scroll at 390 px', await mobile.evaluate(() => document.documentElement.scrollWidth <= 390));
  // Creator: library + interview on the page (scripted typing), approve, explicit media selection (Q4), prepare.
  const m = (await req('POST', '/api/library/media', T.B, readFileSync(join(ROOT, 'tests/fixtures/tone-62s.mp3')), {'x-filename': 'zghva.mp3', 'x-title': encodeURIComponent('ზღვის სიმღერა')})).body;
  await req('POST', `/api/library/media/${m.id}/rights`, T.B, {publicBroadcast: true, editing: true, replays: true, confirm: true});
  await page.click('#step-create'); await page.waitForURL(/\/interview\//); await page.click('#begin');
  const h1 = re => page.waitForFunction(r => new RegExp(r).test(document.querySelector('h1')?.textContent || ''), re);
  await h1('ვინ ხარ'); await page.fill('#answer', 'მუსიკოსი ვარ თბილისიდან.'); await page.fill('#f-displayName', 'ქეთი'); await page.fill('#f-workTitle', 'ზღვის სიმღერა'); await page.selectOption('#f-category', 'music'); await page.click('#next');
  await h1('შთაგაგონა'); await page.fill('#answer', 'ზღვის ხმამ.'); await page.click('#next');
  await h1('AI-ს'); await page.fill('#answer', 'ყველაფერი თავად.'); await page.selectOption('#f-aiInvolvement', 'none'); await page.click('#next');
  await h1('ECHO-მ ეთერში'); await page.fill('#answer', 'რეფრენი.'); await page.selectOption('#f-preferredFormat', 'premiere'); await page.fill('#f-desiredAirtimeSec', '60'); await page.click('#next');
  await h1('ფაილების'); await page.check(`input[name=media][value="${m.id}"]`); await page.click('#next');
  await h1('წამყვანმა'); await page.click('#next');
  await page.waitForSelector('#approve'); await page.click('#approve');
  await page.waitForSelector('#prepare'); await shot(page, 'u4-approved-select-media');
  check('Q4 UI: prepare is disabled until a file is chosen; no "unchanged" option', await page.evaluate(() => document.querySelector('#prepare').disabled && ![...document.querySelectorAll('[data-slot] option')].some(o => /უცვლელ/.test(o.textContent))));
  await page.selectOption('#seg', 'premiere'); await page.selectOption('[data-slot="track"]', m.id);
  check('Q4 UI: the final title, credit and file are previewed before preparing', await page.evaluate(() => !document.querySelector('#prepare').disabled && /ზღვის სიმღერა/.test(document.querySelector('#final').textContent) && /ქეთი/.test(document.querySelector('#final').textContent)));
  await shot(page, 'u5-final-preview'); await page.click('#prepare');
  await page.waitForFunction(() => /შემდეგი ნაბიჯები გადაცემის დაფაზე/.test(document.querySelector('#view')?.textContent || '') || (document.querySelector('#error') && !document.querySelector('#error').hidden));
  const seg = S().segments.premiere; check('segment prepared from the brief with the creator\'s own file', !!seg.content.brief?.interviewId && seg.assets[0].libraryMediaId === m.id && seg.assets[0].sha256 === m.sha256, `${JSON.stringify(seg.content.brief)} ${JSON.stringify(seg.assets.map(a => [a.id, a.libraryMediaId]))} error=${await page.evaluate(() => document.querySelector('#error')?.textContent)}`);
  await shot(page, 'u6-prepared');
  // Q3: correction on a phone. Edit the title, reapprove, see the explicit update action, update, no dead end.
  const ph = await newPage({width: 390, height: 844});
  await ph.goto(`${base}/interview/#token=${T.B}`);
  await ph.waitForSelector('#edit'); await ph.click('#edit');
  await ph.waitForSelector('#f-workTitle'); await ph.fill('#f-workTitle', 'ზღვის სიმღერა (სწორი)'); await ph.click('#next');
  await ph.waitForSelector('#approve'); await ph.click('#approve');
  await ph.waitForSelector('#prepare');
  await shot(ph, 'u7-correction-update-mobile');
  const txt = await ph.textContent('#view');
  check('Q3 UI: after a correction the page offers "update prepared segment" and marks it not done', /განახლება/.test(txt) && await ph.evaluate(() => !document.querySelector('.life li:nth-child(4)').classList.contains('done')));
  check('Q3 UI: the previous own file is offered as "keep (same file)" and preselected', await ph.evaluate(() => /^keep:/.test(document.querySelector('[data-slot="track"]').value)));
  check('Q3 UI: no sideways scroll at 390 px', await ph.evaluate(() => document.documentElement.scrollWidth <= 390));
  await ph.click('#prepare'); await ph.waitForFunction(() => /გადაცემის დაფა/.test(document.querySelector('#view')?.textContent || ''));
  check('Q3: updated segment carries the corrected brief', S().segments.premiere.content.brief.title === 'ზღვის სიმღერა (სწორი)');
  await shot(ph, 'u8-updated-mobile');
  // Producer: board voice panel, Georgian samples for both house segments, approvals, publish.
  const prod = await newPage({width: 1440, height: 900});
  await prod.goto(`${base}/board/#token=${T.P}`); await prod.waitForSelector('#voice-panel:not([hidden]) [data-voice="interstitial"]');
  await prod.selectOption('[data-voice-for="interstitial"]', 'sample-analyst-two-sentences'); await prod.click('[data-voice="interstitial"]');
  await prod.waitForFunction(() => /elevenlabs-sample/.test(document.querySelector('#voice-panel').textContent));
  await prod.selectOption('[data-voice-for="outro"]', 'dialogue-2'); await prod.click('[data-voice="outro"]');
  await prod.waitForFunction(() => (document.querySelector('#voice-panel').textContent.match(/elevenlabs-sample/g) || []).length >= 2);
  await shot(prod, 'u9-board-voice-panel');
  check('board: too-long samples are disabled for a 10 s slot', await prod.evaluate(() => [...document.querySelectorAll('[data-voice-for="outro"] option')].some(o => o.disabled && /არ ჯდება/.test(o.textContent))));
  for (const id of ['interstitial', 'outro', 'premiere']) { const b = await prod.waitForSelector(`[data-review="${id}"]`); await b.click(); await prod.waitForFunction(i => /approved r/.test(document.querySelector(`[data-review="${i}"]`)?.closest('tr')?.textContent || '') || !document.querySelector(`[data-review="${i}"]`), id); }
  await prod.waitForSelector('#publish-btn:not([disabled])'); await prod.click('#publish-btn');
  await prod.waitForFunction(() => /#1/.test(document.querySelector('#publish').textContent));
  await shot(prod, 'u10-board-published');
  const man = S().broadcast.manifest;
  check('published manifest carries Keti\'s file and both Georgian house voices', man.segments.find(s => s.id === 'premiere').assets[0].sha256 === m.sha256 && /ElevenLabs/.test(man.segments.find(s => s.id === 'interstitial').content.host.credit) && /ElevenLabs/.test(man.segments.find(s => s.id === 'outro').content.host.credit));
  // Watch page loads with the 3D studio, desktop and phone framing.
  const tv = await newPage({width: 1280, height: 720});
  await tv.goto(`${base}/broadcast/`); await tv.click('#sound');
  await tv.waitForFunction(() => window.EchoBroadcast.getState().studioReady, null, {timeout: 60000});
  await tv.waitForFunction(() => window.EchoBroadcast.getState().module === 'slate');
  await shot(tv, 'u11-broadcast-ready-desktop');
  const tvm = await newPage({width: 390, height: 844}); await tvm.goto(`${base}/broadcast/`); await tvm.waitForTimeout(1500); await shot(tvm, 'u12-broadcast-mobile');
  check('broadcast: no sideways scroll at 390 px', await tvm.evaluate(() => document.documentElement.scrollWidth <= 390));
  check('no page errors on home, interview, board, broadcast', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(`PASS unified journey: ${results.length} checks. Screenshots in ${out}`);
} finally {
  await browser.close(); echo.server.closeAllConnections(); echo.server.close();
}
