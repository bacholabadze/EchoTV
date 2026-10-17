// End to end (3.2): a music creator's interview -> approved brief -> authorised music -> prepared segment ->
// another creator's agent changes the shared programme -> the Showrunner handles the confirmed premiere ->
// approvals -> publication -> broadcast. Real agents: Codex is Keti's agent, Claude Code is Bacho's (their own
// MCP gateways, own tokens). EVERY HUMAN STEP HERE IS A SCRIPTED STAND-IN (labelled in the log), not a person.
// The creator profile is a test fixture, not a real person. Media is the repo's test tone (rehearsal media).
//   ENTRY=agent (default): Keti's agent answers the interview over MCP.
//   ENTRY=human: a script types the same answers into the interview page (Chrome).
// Run: npm run e2e:creator  (ENTRY=human npm run e2e:creator). Takes 3–6 minutes. Uses the agents' existing logins.
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import {createEchoServer} from '../../server/server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..'), ENTRY = process.env.ENTRY === 'human' ? 'human' : 'agent';
const out = process.env.ECHO_E2E_OUT || mkdtempSync(join(tmpdir(), `echo-e2e-${ENTRY}-`)); mkdirSync(out, {recursive: true});
const dataDir = join(out, 'data'), PORT = +process.env.E2E_PORT || 8798, BASE = `http://127.0.0.1:${PORT}`;
const echo = createEchoServer({dataDir, quiet: true, seedOptions: {people: {a: {name: 'Bacho', specialty: 'Art'}, b: {name: 'Keti', specialty: 'Music'}}}});
await new Promise(r => echo.server.listen(PORT, '127.0.0.1', r));
const S = () => echo.desk.state, T = {A: S().people['creator-a'].token, B: S().people['creator-b'].token, P: S().people.producer.token, a: S().agents['agent-a'].token, b: S().agents['agent-b'].token};
const log = [], t0 = Date.now(), checks = [];
const note = m => { const l = `[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`; log.push(l); console.log(l); };
const check = (name, ok, detail = '') => { checks.push({name, ok, detail}); note(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) throw new Error(name); };
const stand = m => note(`SCRIPTED STAND-IN (not a person): ${m}`);
const req = async (method, path, token, body, headers = {}) => { const r = await fetch(BASE + path, {method, headers: {authorization: `Bearer ${token}`, ...(Buffer.isBuffer(body) ? {} : {'content-type': 'application/json'}), ...headers}, body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body)}); return {status: r.status, body: await r.json()}; };
const run = (name, cmd, args) => new Promise(resolve => { note(`agent run: ${name}`); const c = spawn(cmd, args, {cwd: out, stdio: ['ignore', 'pipe', 'pipe']}); const o = []; c.stdout.on('data', d => o.push(d)); c.stderr.on('data', d => o.push(d)); c.on('close', code => { writeFileSync(join(out, `${name}.log`), Buffer.concat(o)); note(`agent run ${name} exited ${code}`); resolve(code); }); });
const codex = (name, prompt) => run(name, 'codex', ['exec', '--skip-git-repo-check', '-s', 'read-only', '-c', 'mcp_servers.echo.command="node"', '-c', `mcp_servers.echo.args=["${ROOT}/server/mcp.mjs"]`,
  '-c', 'mcp_servers.echo.default_tools_approval_mode="approve"', '-c', 'mcp_servers.echo.tool_timeout_sec=70', '-c', `mcp_servers.echo.env={ECHO_URL="${BASE}",ECHO_AGENT_TOKEN="${T.b}",ECHO_AGENT_CLIENT="Codex"}`, prompt]);
const claude = (name, prompt) => run(name, 'claude', ['-p', prompt, '--mcp-config', JSON.stringify({mcpServers: {echo: {command: 'node', args: [`${ROOT}/server/mcp.mjs`], env: {ECHO_URL: BASE, ECHO_AGENT_TOKEN: T.a, ECHO_AGENT_CLIENT: 'Claude Code'}}}}), '--strict-mcp-config', '--allowedTools', 'mcp__echo__*']);
const PROFILE = {displayName: 'ქეთი (სატესტო)', workTitle: 'ზღვის სიმღერა', about: 'მუსიკოსი ვარ თბილისიდან; ეს ჩემი პირველი სინგლია.', inspiration: 'ზღვის ხმამ და ბებიის სიმღერებმა შთამაგონა.', process: 'მელოდია, ტექსტი და მიქსი თავად გავაკეთე.', focus: 'რეფრენი.'};
let browser;
try {
  note(`ENTRY=${ENTRY}; server ${BASE}; evidence ${out}`);
  // 1. The creator uploads authorised music and declares its uses (human-only actions).
  stand('Keti uploads her track and declares public broadcast, short edits and replays');
  const m = (await req('POST', '/api/library/media', T.B, readFileSync(join(ROOT, 'tests/fixtures/tone-62s.mp3')), {'x-filename': 'zghva.mp3', 'x-title': encodeURIComponent('ზღვის სიმღერა (სატესტო ჩანაწერი)')})).body;
  await req('POST', `/api/library/media/${m.id}/rights`, T.B, {publicBroadcast: true, editing: true, replays: true, confirm: true}); // 60 of 62 s airs: needs 'editing'
  check('upload passed the technical check; rights declared', m.technical.decodable === true);
  browser = await chromium.launch({channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required']});
  let interviewId;
  // 2. The interview, by the chosen entry method.
  if (ENTRY === 'agent') {
    await codex('keti-agent-interview', `You are the ECHO agent of Creator B, Keti (a TEST creator profile for an automated rehearsal). Use only the echo MCP tools.
Your owner asked you to prepare her ECHO Creator Brief. Everything she told you is below; use only this, in her own words, and skip anything not covered:
- Name on air: ${PROFILE.displayName}
- Her work: a song called "${PROFILE.workTitle}" (music). About her: "${PROFILE.about}"
- Inspiration: "${PROFILE.inspiration}"
- What she did herself: "${PROFILE.process}" AI involvement: none.
- What to present: "${PROFILE.focus}" Format: premiere. Airtime: 60 seconds.
- Media: the track in her library (call list_my_library and use its id).
- Notes for the presenter: none (skip that question).
Call start_interview, answer each question with answer_interview (follow any follow-up question), then call review_creator_brief and stop. You cannot approve anything. Summarise in two sentences.`);
    interviewId = Object.keys(S().interviews || {})[0];
    const iv = S().interviews[interviewId];
    check('Keti\'s agent completed the interview over MCP', iv?.status === 'review', `${iv?.status}; answered: ${Object.entries(iv?.answers || {}).map(([k, a]) => `${k}:${a.skipped ? 'skipped' : a.source}`).join(' ')}`);
    check('brief fields are the owner\'s words, prepared by the agent', iv.brief.creator.displayName === PROFILE.displayName && iv.brief.work.title === PROFILE.workTitle && iv.brief.prepared.includes('agent'), `${iv.brief.creator.displayName} / ${iv.brief.work.title}; missing: ${iv.brief.missing.join(',') || 'none'}`);
    stand('Keti reviews and approves her brief on ECHO');
    const b = iv.brief; check('creator approval of the exact version', (await req('POST', `/api/interviews/${interviewId}/approve`, T.B, {version: b.version, hash: b.hash})).status === 200, `v${b.version}`);
    await codex('keti-agent-prepare', `You are the ECHO agent of Creator B, Keti (TEST profile). Use only the echo MCP tools. Your owner approved her Creator Brief (interview ${interviewId}). Prepare her Music premiere segment (segmentId "premiere") from it with prepare_segment_from_brief, putting her library track (list_my_library) into the "track" slot. Then stop and summarise in one sentence.`);
  } else {
    stand('Keti answers the interview by typing in the interview page');
    const page = await (await browser.newContext({viewport: {width: 1440, height: 900}})).newPage();
    await page.goto(`${BASE}/interview/#token=${T.B}`); await page.click('#begin');
    const h1 = re => page.waitForFunction(r => new RegExp(r).test(document.querySelector('h1')?.textContent || ''), re);
    await h1('ვინ ხარ'); await page.fill('#answer', PROFILE.about); await page.fill('#f-displayName', PROFILE.displayName); await page.fill('#f-workTitle', PROFILE.workTitle); await page.selectOption('#f-category', 'music'); await page.click('#next');
    await h1('შთაგაგონა'); await page.fill('#answer', PROFILE.inspiration); await page.click('#next');
    await h1('AI-ს'); await page.fill('#answer', PROFILE.process); await page.selectOption('#f-aiInvolvement', 'none'); await page.click('#next');
    await h1('რომელი ნაწილი'); await page.fill('#answer', PROFILE.focus); await page.selectOption('#f-preferredFormat', 'premiere'); await page.fill('#f-desiredAirtimeSec', '60'); await page.click('#next');
    await h1('ფაილების'); await page.check(`input[name=media][value="${m.id}"]`); await page.click('#next');
    await h1('წამყვანმა'); await page.click('#skip');
    await page.waitForSelector('#approve'); await page.screenshot({path: join(out, 'human-review.png'), fullPage: true});
    stand('Keti approves her brief in the interview page'); await page.click('#approve');
    await page.waitForSelector('#prepare'); await page.selectOption('#seg', 'premiere'); await page.selectOption('#slot-track', m.id);
    stand('Keti prepares her premiere segment in the interview page'); await page.click('#prepare');
    await page.waitForFunction(() => /სეგმენტი: /.test(document.querySelector('#view').textContent));
    interviewId = Object.keys(S().interviews)[0];
    check('the interview page produced an approved brief from typed answers', S().interviews[interviewId].status === 'approved' && S().interviews[interviewId].brief.prepared.join() === 'typed');
  }
  const seg = S().segments.premiere;
  check('premiere prepared from the approved brief (new revision, awaiting content review)', seg.content.brief?.interviewId === interviewId && seg.state === 'submitted' && seg.assets.find(a => a.id === 'track').libraryMediaId === m.id, `r${seg.revision} ${seg.state}`);
  stand('the producer reviews the prepared premiere');
  check('content review', (await req('POST', '/api/segments/premiere/review', T.P, {revision: seg.revision, decision: 'approved'})).status === 200);
  // 3. Another independent creator's agent changes the shared programme; Keti's agent responds (A -> B -> A).
  const bWait = codex('keti-agent-negotiate', `You are the ECHO agent of Creator B, Keti (TEST profile; music). Use only the echo MCP tools. Your owner's instructions: "My Music premiere is confirmed at 50 seconds and must never move or shrink. If another creator genuinely needs time, I can shorten my 10-second Music intro, but never below 5 seconds, and only by what is actually needed." First call get_show_state. Then call wait_for_requests (45 seconds) repeatedly, up to 6 times, until a request addressed to you arrives. Answer it with respond_to_request according to your owner's instructions, with a short reason. Then stop and summarise in two sentences.`);
  await new Promise(r => setTimeout(r, 8000));
  const aDone = claude('bacho-agent-proposal', `You are the ECHO agent of Creator A, Bacho (art). Use only the echo MCP tools. Your owner's instructions: "I want my Art gallery extended from 30 to 45 seconds so each of my three works gets 15 seconds. If the full 45 seconds is not available, accept the longest time that fits and split it evenly across the three works. Never ask to move any confirmed slot." Call get_show_state, then make a proposal with propose_change (include a short note). Then call wait_for_requests (45 seconds) repeatedly, up to 6 times, until the Showrunner asks you to revise, and adapt with revise_proposal (or withdraw_proposal if your owner would not accept). Then stop and summarise in two sentences. Humans approve on the Production Board; you cannot approve.`);
  await Promise.all([aDone, bWait]);
  const p = Object.values(S().proposals).at(-1), toB = Object.values(S().requests).find(r => r.toAgentId === 'agent-b');
  check('A -> B -> A: Bacho\'s agent proposed, Keti\'s agent answered the Showrunner, Bacho\'s agent adapted', p?.status === 'awaiting_approval' && !!toB?.response, `${p?.status} v${p?.version}; Keti's agent: ${toB?.response?.decision} ${toB?.response?.duration ?? ''} — "${toB?.response?.message || ''}"`);
  check('the Showrunner kept the confirmed premiere at 50 s', p.preview.find(e => e.segmentId === 'premiere').start === 50 && p.preview.reduce((n, e) => n + e.duration, 0) === 120);
  check('an agent cannot approve', (await req('POST', `/api/proposals/${p.id}/decision`, T.a, {version: p.version, decision: 'approve'})).status === 403);
  for (const [who, t] of [['Bacho', T.A], ['Keti', T.B], ['ECHO Producer', T.P]]) { stand(`${who} approves programme version ${p.version}`); await req('POST', `/api/proposals/${p.id}/decision`, t, {version: p.version, decision: 'approve'}); }
  check('final revision committed', S().showRevision >= 3 && S().proposals[p.id].status === 'committed', `r${S().showRevision}`);
  stand('the producer publishes');
  const pub = await req('POST', '/api/publish', T.P);
  check('publication', pub.status === 200, pub.status === 200 ? `#${pub.body.publicationId} r${pub.body.publishRevision}` : pub.body.message);
  const premiere = pub.body.segments.find(s => s.id === 'premiere');
  check('the programme carries only air-facing brief fields', premiere.content.brief.displayName === PROFILE.displayName && !JSON.stringify(pub.body).includes(PROFILE.inspiration));
  // 4. Broadcast with the existing studio modules.
  const tv = await (await browser.newContext({viewport: {width: 1280, height: 720}})).newPage();
  await tv.goto(`${BASE}/broadcast/`); await tv.click('#sound');
  stand('the producer goes live');
  const live = (await req('POST', '/api/golive', T.P, {delayMs: 3000, publicationId: pub.body.publicationId, hash: pub.body.hash})).body;
  const at = async sec => { const w = live.onAirAt + sec * 1000 - Date.now(); if (w > 0) await new Promise(r => setTimeout(r, w)); };
  await at(53);
  const x = await tv.evaluate(() => ({...window.EchoBroadcast.getState(), name: document.querySelector('#music-name').textContent, credit: document.querySelector('#music-credit').textContent, badge: document.querySelector('#music-badge').textContent}));
  await tv.screenshot({path: join(out, 'broadcast-premiere.png')});
  check('broadcast: the premiere starts at 0:50 with the brief\'s title, credit and AI disclosure', x.segment === 'premiere' && Math.abs(x.onsets.premiere - 50) < .25 && x.name === PROFILE.workTitle && x.credit === `${PROFILE.displayName} · შექმნილია AI-ს გარეშე`, `onset ${x.onsets.premiere}s; "${x.name}" / "${x.credit}" / "${x.badge}"`);
  check('broadcast: authorised audio playing, labels match', x.onAirLabel === 'Live' && x.audioLevel > .02 && x.audioSrc === premiere.assets.find(a => a.id === 'track').url && x.publicationId === pub.body.publicationId, `level ${x.audioLevel?.toFixed(3)}; ${x.audioSrc}`);
  const calls = (await (await fetch(`${BASE}/api/state`)).json()).agentCalls;
  const tools = (agent, name) => calls.filter(c => c.agentId === agent && c.tool === name && c.status === 200).length;
  note(`agent tool calls (200): Keti's agent — start_interview ${tools('agent-b', 'start_interview')}, answer_interview ${tools('agent-b', 'answer_interview')}, review_creator_brief ${tools('agent-b', 'review_creator_brief')}, prepare_segment_from_brief ${tools('agent-b', 'prepare_segment_from_brief')}, respond_to_request ${tools('agent-b', 'respond_to_request')}; Bacho's agent — propose_change ${tools('agent-a', 'propose_change')}, revise_proposal ${tools('agent-a', 'revise_proposal')}`);
  if (ENTRY === 'agent') check('Keti\'s interview and preparation were real MCP tool calls', tools('agent-b', 'answer_interview') >= 5 && tools('agent-b', 'prepare_segment_from_brief') >= 1);
  note(`RESULT: ${checks.every(c => c.ok) ? 'ALL CHECKS PASS' : 'FAIL'} (${checks.length} checks). Human steps were scripted stand-ins.`);
} catch (e) { note(`ABORTED: ${e.message}`); process.exitCode = 1; }
finally {
  writeFileSync(join(out, 'e2e-log.txt'), log.join('\n') + '\n'); writeFileSync(join(out, 'checks.json'), JSON.stringify({entry: ENTRY, checks, scriptedHumanSteps: log.filter(l => l.includes('SCRIPTED STAND-IN'))}, null, 1));
  writeFileSync(join(out, 'audit.txt'), S().audit.map(e => `#${e.seq} ${e.private ? '(private) ' : ''}${e.summary}`).join('\n'));
  await browser?.close(); echo.server.closeAllConnections(); echo.server.close();
}
