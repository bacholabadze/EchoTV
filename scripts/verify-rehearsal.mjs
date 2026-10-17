// After a real-agent rehearsal: check the agents' outcome against the rules, then (standing in for the
// three humans, and saying so) approve, publish and check the manifest. Exit code 0 only on a clean run.
// Usage: node scripts/verify-rehearsal.mjs <server-url> <credentials.txt> [--expect=agreement|no_agreement]
import {readFileSync} from 'node:fs';

const [url, credPath] = process.argv.slice(2);
const expect = (process.argv.find(a => a.startsWith('--expect=')) || '--expect=agreement').split('=')[1];
const cred = readFileSync(credPath, 'utf8');
const board = role => cred.split('\n').filter(l => l.includes(`(${role}) board:`)).map(l => l.split('#token=')[1].trim());
const [creatorA, creatorB] = board('creator'), [producer] = board('producer');
const tokenFor = {'creator-a': creatorA, 'creator-b': creatorB, producer};
const get = async path => (await fetch(url + path)).json();
const post = async (path, token, body) => { const r = await fetch(url + path, {method: 'POST', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'}, body: JSON.stringify(body || {})}); return {ok: r.ok, body: await r.json()}; };
const results = [];
const check = (name, ok, detail = '') => { results.push({name, ok, detail}); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };

let s = await get('/api/state');
const p = Object.values(s.proposals).at(-1);
check('agents used their own MCP clients', s.agents['agent-a'].client && s.agents['agent-b'].client && s.agents['agent-a'].client !== s.agents['agent-b'].client, `${s.agents['agent-a'].client} / ${s.agents['agent-b'].client}`);
check('A proposed through the Showrunner', !!p, p ? `${p.id} by ${p.agentId}` : 'no proposal');
const toB = Object.values(s.requests).find(r => r.toAgentId === 'agent-b');
check('B answered the Showrunner itself', !!toB?.response && toB.response.decision !== 'revised', toB?.response ? `${toB.response.decision}${toB.response.duration ? ' ' + toB.response.duration + 's' : ''}: “${toB.response.message || ''}”` : 'no answer');
check('premiere untouched during negotiation', s.layout.find(e => e.segmentId === 'premiere').start === 50 && s.showRevision === 1);
if (expect === 'no_agreement') {
  check('NO AGREEMENT recorded and programme unchanged', p?.status === 'no_agreement' && s.showRevision === 1, p?.status);
} else {
  check('A adapted after B (A → B → A)', p?.status === 'awaiting_approval' && p.version >= 2, `${p?.status} v${p?.version}`);
  const slides = p?.changes.find(c => c.segmentId === 'gallery')?.content?.slides;
  check('gallery content matches its new duration', slides && slides.reduce((a, x) => a + x.seconds, 0) === p.changes.find(c => c.segmentId === 'gallery').duration, slides?.map(x => x.seconds).join('/'));
  for (const id of p.requiredApprovals) {
    const r = await post(`/api/proposals/${p.id}/decision`, tokenFor[id], {version: p.version, decision: 'approve'});
    check(`approval by ${s.people[id].name} (issued by this script as a stand-in for the person)`, r.ok, r.ok ? '' : r.body.message);
  }
  s = await get('/api/state');
  check('revision committed with premiere still at 50s and 120s total', s.showRevision === 2 && s.layout.find(e => e.segmentId === 'premiere').start === 50 && s.layout.reduce((a, e) => a + e.duration, 0) === 120,
    s.revisions.at(-1).diff.map(d => `${d.segmentId} ${d.before.start}+${d.before.duration}→${d.after.start}+${d.after.duration}`).join('; '));
  const pub = await post('/api/publish', producer);
  check('manifest published for the committed revision', pub.ok && pub.body.publishRevision === s.showRevision, pub.ok ? `r${pub.body.publishRevision} · ${pub.body.hash.slice(0, 12)}` : pub.body.message);
}
const failed = results.filter(r => !r.ok).length;
console.log(failed ? `RUN FAILED (${failed} checks)` : 'RUN CLEAN');
process.exit(failed ? 1 : 0);
