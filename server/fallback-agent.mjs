#!/usr/bin/env node
// Rule-based fallback agent: used only when a creator's own AI agent is unavailable.
// It identifies itself as rule-based on the board and follows a written owner policy, e.g.
//   ECHO_AGENT_TOKEN=... ECHO_POLICY='{"concede":{"intro":5},"adapt":true}' node server/fallback-agent.mjs
import {randomUUID} from 'node:crypto';
const BASE = process.env.ECHO_URL || 'http://127.0.0.1:8787', TOKEN = process.env.ECHO_AGENT_TOKEN;
const policy = JSON.parse(process.env.ECHO_POLICY || '{}');
const once = process.argv.includes('--once');

// One Idempotency-Key per action: if the network drops, the single retry cannot apply the action twice.
async function api(method, path, body) {
  const key = method === 'POST' ? randomUUID() : null;
  for (let attempt = 0; ; attempt++) {
    let res;
    try { res = await fetch(BASE + path, {method, headers: {authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', 'x-echo-client': 'ECHO fallback (rule-based)', ...(key ? {'idempotency-key': key} : {})}, body: body && JSON.stringify(body)}); }
    catch (error) { if (attempt >= 1) throw error; await new Promise(r => setTimeout(r, 1000)); continue; }
    const data = await res.json();
    if (!res.ok) throw Object.assign(new Error(data.message || data.error), {data});
    return data;
  }
}
const evenSlides = (slides, duration) => {
  const base = Math.floor(duration / slides.length), extra = duration - base * slides.length;
  return slides.map((s, i) => ({assetId: s.assetId, seconds: base + (i < extra ? 1 : 0)}));
};

export async function handle(request, state) {
  const seg = state.segments[request.segmentId];
  if (request.type === 'concede') {
    // policy.concede[segmentId] = the shortest duration the owner allows for this segment.
    const floor = policy.concede?.[request.segmentId];
    const duration = floor === undefined ? null : Math.max(floor, seg.duration - request.maxConcession);
    if (duration === null || duration >= seg.duration) return api('POST', `/api/requests/${request.id}/respond`, {decision: 'decline', message: 'Owner policy: no change to this segment'});
    return api('POST', `/api/requests/${request.id}/respond`, {decision: 'accept', duration, message: `Owner policy allows ${seg.title} down to ${floor}s`});
  }
  const proposal = state.proposals[request.proposalId];
  if (!policy.adapt) return api('POST', `/api/proposals/${proposal.id}/withdraw`, {note: 'Owner policy: do not accept a smaller change'});
  const changes = request.limits.map(l => {
    const own = state.segments[l.segmentId], duration = Math.min(l.requested, l.maxThatFits);
    return {segmentId: l.segmentId, duration, ...(own.content?.slides ? {content: {slides: evenSlides(own.content.slides, duration)}} : {})};
  });
  return api('POST', `/api/proposals/${proposal.id}/revise`, {changes, note: 'Adapted to the available time (rule-based fallback)'});
}

async function main() {
  if (!TOKEN) { console.error('ECHO_AGENT_TOKEN is required'); process.exit(1); }
  const me = await api('GET', '/api/me');
  console.log(`Fallback agent running as ${me.label} with policy ${JSON.stringify(policy)}`);
  for (;;) {
    const inbox = await api('GET', '/api/agent/inbox?wait=45').catch(e => (console.error(e.message), {requests: []}));
    if (!inbox.requests.length) { if (once) return; continue; }
    const state = await api('GET', '/api/state');
    for (const request of inbox.requests) {
      try { await handle(request, state); console.log(`Answered ${request.id} (${request.type})`); } catch (e) { console.error(`Could not answer ${request.id}: ${e.message}`); }
    }
    if (once) return;
  }
}
if (process.argv[1] === new URL(import.meta.url).pathname) main();
