// Drives the real MCP gateway processes (one per agent identity) against a real server.
// The tool calls are scripted here; in the demo an LLM agent (Claude Code, Codex) makes them.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {createEchoServer} from '../../server/server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let echo, base, agents = {};
const connect = async (token, client) => {
  const c = new Client({name: `test-${client}`, version: '1'});
  await c.connect(new StdioClientTransport({command: process.execPath, args: [join(ROOT, 'server/mcp.mjs')], env: {...process.env, ECHO_URL: base, ECHO_AGENT_TOKEN: token, ECHO_AGENT_CLIENT: client}}));
  return c;
};
const call = async (client, name, args = {}) => { const r = await client.callTool({name, arguments: args}); return {error: !!r.isError, data: JSON.parse(r.content[0].text)}; };

before(async () => {
  echo = createEchoServer({dataDir: mkdtempSync(join(tmpdir(), 'echo-mcp-')), quiet: true});
  await new Promise(r => echo.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${echo.server.address().port}`;
  agents.a = await connect(echo.desk.state.agents['agent-a'].token, 'Claude Code');
  agents.b = await connect(echo.desk.state.agents['agent-b'].token, 'Codex');
});
after(async () => { await agents.a?.close(); await agents.b?.close(); echo.server.closeAllConnections(); await new Promise(r => echo.server.close(r)); });

test('gateway exposes collaboration tools and no privileged ones', async () => {
  const names = (await agents.a.listTools()).tools.map(t => t.name).sort();
  // 3.2 adds the creator-interview tools (answer/skip/review/read); still nothing that approves, publishes or overrides.
  assert.deepEqual(names, ['answer_interview', 'get_change_history', 'get_interview', 'get_show_state', 'list_my_library', 'propose_change', 'request_slot', 'respond_to_request', 'review_creator_brief', 'revise_proposal', 'skip_interview_question', 'start_interview', 'wait_for_requests', 'withdraw_proposal']);
  for (const forbidden of ['approve', 'force', 'override', 'publish']) assert.ok(names.every(n => !n.includes(forbidden)));
});

test('two independent identities see the same shared state', async () => {
  const [a, b] = await Promise.all([call(agents.a, 'get_show_state'), call(agents.b, 'get_show_state')]);
  assert.equal(a.data.you.agentId, 'agent-a'); assert.equal(b.data.you.agentId, 'agent-b');
  assert.equal(a.data.showRevision, b.data.showRevision);
  assert.ok(a.data.schedule.find(s => s.segmentId === 'gallery').content, 'own content visible');
  assert.equal(a.data.schedule.find(s => s.segmentId === 'intro').content, undefined, "other creator's content details hidden");
  assert.equal(b.data.schedule.find(s => s.segmentId === 'premiere').confirmedSlot, true);
});

test('A → B → A over MCP, refusals are returned as information', async () => {
  const bWaiting = call(agents.b, 'wait_for_requests', {seconds: 10});
  const refused = await call(agents.a, 'propose_change', {baseRevision: 1, changes: [{segmentId: 'premiere', duration: 50}]});
  assert.equal(refused.error, true); assert.equal(refused.data.refused, 'forbidden');
  const p = await call(agents.a, 'propose_change', {baseRevision: 1, changes: [{segmentId: 'gallery', duration: 45}], note: 'Each work needs 15 seconds'});
  assert.equal(p.error, false); assert.equal(p.data.status, 'negotiating');
  const inboxB = await bWaiting;
  const req = inboxB.data.requests[0];
  assert.equal(req.segmentId, 'intro');
  assert.match(req.message, /confirmed Music premiere at 50s/);
  assert.equal((await call(agents.b, 'respond_to_request', {requestId: req.id, decision: 'accept', duration: 5, message: 'Premiere stays at 50s; intro can be 5s'})).error, false);
  const inboxA = await call(agents.a, 'wait_for_requests', {seconds: 1});
  assert.equal(inboxA.data.requests[0].type, 'revise');
  const revised = await call(agents.a, 'revise_proposal', {proposalId: p.data.id, changes: [{segmentId: 'gallery', duration: 45, slides: [{assetId: 'art-1', seconds: 15}, {assetId: 'art-2', seconds: 15}, {assetId: 'art-3', seconds: 15}]}]});
  assert.equal(revised.data.status, 'awaiting_approval');
  const s = echo.desk.state;
  assert.equal(s.agents['agent-a'].client, 'Claude Code'); assert.equal(s.agents['agent-b'].client, 'Codex');
  assert.equal(s.showRevision, 1, 'still awaiting human approval');
});

test('rule-based fallback agent answers for an unavailable agent and labels itself', async () => {
  const d = echo.desk;
  for (const p of Object.values(d.state.proposals)) if (p.status !== 'no_agreement') d.closeProposal(p, 'no_agreement', 'test cleanup');
  const p = d.proposeChange({type: 'agent', id: 'agent-a'}, {baseRevision: d.state.showRevision, changes: [{segmentId: 'gallery', duration: 45}]});
  const child = spawn(process.execPath, [join(ROOT, 'server/fallback-agent.mjs'), '--once'], {env: {...process.env, ECHO_URL: base, ECHO_AGENT_TOKEN: d.state.agents['agent-b'].token, ECHO_POLICY: '{"concede":{"intro":7}}'}});
  await new Promise(r => child.on('exit', r));
  const answered = Object.values(d.state.requests).find(r => r.proposalId === p.id && r.toAgentId === 'agent-b');
  assert.equal(answered.response.decision, 'accept'); assert.equal(answered.response.duration, 7);
  assert.equal(d.state.agents['agent-b'].client, 'ECHO fallback (rule-based)');
  assert.equal(d.state.proposals[p.id].offer.limits[0].maxThatFits, 43, '10s house + 3s from intro');
});
