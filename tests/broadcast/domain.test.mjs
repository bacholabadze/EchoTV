import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BroadcastDesk, DomainError, MEDIA_CHECKS} from '../../server/domain.mjs';
import {seedState} from '../../server/seed.mjs';

const A = {type: 'agent', id: 'agent-a'}, B = {type: 'agent', id: 'agent-b'};
const creatorA = {type: 'person', id: 'creator-a'}, creatorB = {type: 'person', id: 'creator-b'}, producer = {type: 'person', id: 'producer'};
// Domain-level fixtures stand in for media the server has already decoded and verified (see checkMedia): the
// result is stamped with the check and the exact bytes' SHA-256, as the server does.
const verified = sha => ({decodable: true, probed: true, verification: {method: MEDIA_CHECKS[0], sha256: sha}});
function verifiedSeed() { const s = seedState(); for (const seg of Object.values(s.segments)) for (const a of seg.assets) Object.assign(a, verified(a.sha256)); return s; }
function desk() { let t = 1000; const d = new BroadcastDesk(verifiedSeed(), {now: () => (t += 10)}); d.advance = ms => (t += ms); return d; }
const code = c => e => e instanceof DomainError && e.code === c;
const openRequest = (d, agentId) => Object.values(d.state.requests).find(r => r.toAgentId === agentId && r.status === 'open');
const starts = d => Object.fromEntries(d.layout().map(e => [e.segmentId, [e.start, e.duration]]));
const slides = (...s) => ({slides: s.map((seconds, i) => ({assetId: `art-${i + 1}`, seconds}))});
const approveAll = (d, p) => { let r; for (const who of [creatorA, creatorB, producer]) if (p.requiredApprovals.includes(who.id)) r = d.decideProposal(who, {proposalId: p.id, version: p.version, decision: 'approve'}); return r; };

test('seed: valid 120s programme with the premiere confirmed at 50s', () => {
  const d = desk();
  assert.deepEqual(d.violations(d.durations()), []);
  assert.deepEqual(starts(d).premiere, [50, 60]);
});

test('§24 A → B → A: gallery +15s, B concedes 5s, house gives 10s, A adapts, humans approve', () => {
  const d = desk();
  const p = d.proposeChange(A, {baseRevision: 1, changes: [{segmentId: 'gallery', duration: 45}], note: 'Need 15s per artwork'});
  assert.equal(p.status, 'negotiating');
  assert.equal(p.conflicts[0].need, 15);
  assert.equal(p.conflicts[0].protects.segmentId, 'premiere');
  assert.deepEqual(p.houseChanges.map(c => [c.segmentId, c.duration]), [['interstitial', 0]]);
  // The Showrunner asks B only for what house time cannot cover.
  const toB = openRequest(d, 'agent-b');
  assert.equal(toB.segmentId, 'intro'); assert.equal(toB.need, 5); assert.equal(toB.maxConcession, 5);
  assert.equal(d.state.showRevision, 1, 'nothing committed during negotiation');
  // B refuses to touch the premiere (it cannot anyway) and shortens its own intro.
  assert.throws(() => d.respondToRequest(B, {requestId: toB.id, decision: 'accept', duration: 4}), code('out_of_bounds'));
  d.respondToRequest(B, {requestId: toB.id, decision: 'accept', duration: 5, message: 'Premiere stays at 50s; intro can be 5s'});
  const toA = openRequest(d, 'agent-a');
  assert.equal(toA.type, 'revise');
  assert.equal(toA.limits[0].maxThatFits, 45);
  // A adapts its content to the final duration; slide timings must add up.
  assert.throws(() => d.reviseProposal(A, {proposalId: p.id, changes: [{segmentId: 'gallery', duration: 45, content: slides(10, 10, 10)}]}), code('bad_content'));
  const revised = d.reviseProposal(A, {proposalId: p.id, changes: [{segmentId: 'gallery', duration: 45, content: slides(15, 15, 15)}], note: 'Three works, 15s each'});
  assert.equal(revised.status, 'awaiting_approval');
  assert.deepEqual(new Set(revised.requiredApprovals), new Set(['creator-a', 'creator-b', 'producer']));
  // Agents can never approve.
  assert.throws(() => d.decideProposal(A, {proposalId: p.id, version: revised.version, decision: 'approve'}), code('forbidden'));
  const result = approveAll(d, revised);
  assert.equal(result.committed, true);
  assert.equal(d.state.showRevision, 2);
  assert.deepEqual(starts(d), {intro: [0, 5], gallery: [5, 45], interstitial: [50, 0], premiere: [50, 60], outro: [110, 10]});
  const manifest = d.publish(producer);
  assert.equal(manifest.publishRevision, 2);
  assert.deepEqual(manifest.segments.map(s => s.id), ['intro', 'gallery', 'premiere', 'outro']);
  assert.equal(manifest.segments.find(s => s.id === 'premiere').start, 50);
  assert.equal(manifest.segments.reduce((s, x) => s + x.duration, 0), 120);
});

test('B declines: A is told the real limit (40s) and adapts to it', () => {
  const d = desk();
  const p = d.proposeChange(A, {baseRevision: 1, changes: [{segmentId: 'gallery', duration: 45}]});
  d.respondToRequest(B, {requestId: openRequest(d, 'agent-b').id, decision: 'decline', message: 'The intro sets up the premiere'});
  assert.equal(openRequest(d, 'agent-a').limits[0].maxThatFits, 40);
  const stillTooLong = d.reviseProposal(A, {proposalId: p.id, changes: [{segmentId: 'gallery', duration: 45, content: slides(15, 15, 15)}]});
  assert.equal(stillTooLong.status, 'awaiting_proposer', 'insisting on 45s does not pass');
  assert.equal(d.state.showRevision, 1);
});

test('B declines and A withdraws: NO AGREEMENT, last valid programme unchanged', () => {
  const d = desk(), before = starts(d);
  const p = d.proposeChange(A, {baseRevision: 1, changes: [{segmentId: 'gallery', duration: 45}]});
  d.respondToRequest(B, {requestId: openRequest(d, 'agent-b').id, decision: 'decline'});
  const closed = d.withdrawProposal(A, {proposalId: p.id, note: 'Would rather keep 15s per work'});
  assert.equal(closed.status, 'no_agreement');
  assert.equal(d.state.showRevision, 1);
  assert.deepEqual(starts(d), before);
});

test('A revises down to 40s after decline: house time only, B keeps its intro', () => {
  const d = desk();
  const p = d.proposeChange(A, {baseRevision: 1, changes: [{segmentId: 'gallery', duration: 45}]});
  d.respondToRequest(B, {requestId: openRequest(d, 'agent-b').id, decision: 'decline'});
  const r = d.reviseProposal(A, {proposalId: p.id, changes: [{segmentId: 'gallery', duration: 40, content: slides(14, 13, 13)}]});
  assert.deepEqual(new Set(r.requiredApprovals), new Set(['creator-a', 'producer']), 'B is not asked to approve a change that does not touch its work');
  approveAll(d, r);
  assert.deepEqual(starts(d), {intro: [0, 10], gallery: [10, 40], interstitial: [50, 0], premiere: [50, 60], outro: [110, 10]});
});

test('A needs less than offered: unused creator time is handed back', () => {
  const d = desk();
  const p = d.proposeChange(A, {baseRevision: 1, changes: [{segmentId: 'gallery', duration: 45}]});
  d.respondToRequest(B, {requestId: openRequest(d, 'agent-b').id, decision: 'accept', duration: 5});
  const r = d.reviseProposal(A, {proposalId: p.id, changes: [{segmentId: 'gallery', duration: 38, content: slides(14, 12, 12)}]});
  assert.deepEqual(r.concessions, [], 'intro returns to 10s');
  assert.deepEqual(r.houseChanges.map(c => c.duration), [2]);
});

test('confirmed airtime is protected from agents and the Showrunner', () => {
  const d = desk();
  assert.throws(() => d.proposeChange(B, {baseRevision: 1, changes: [{segmentId: 'premiere', duration: 59}]}), code('out_of_bounds'));
  assert.throws(() => d.proposeChange(A, {baseRevision: 1, changes: [{segmentId: 'intro', duration: 5}]}), code('forbidden'), 'cannot edit another creator');
  assert.throws(() => d.releaseSlot(creatorA, {segmentId: 'premiere'}), code('forbidden'));
  assert.throws(() => d.releaseSlot(B, {segmentId: 'premiere'}), code('forbidden'), 'agents cannot release');
  // The solver never offers time from the confirmed premiere.
  const p = d.proposeChange(A, {baseRevision: 1, changes: [{segmentId: 'gallery', duration: 45}]});
  assert.ok(Object.values(d.state.requests).every(r => r.segmentId !== 'premiere'));
  assert.ok(p.houseChanges.every(c => c.segmentId !== 'premiere'));
});

test('stale base revision is rejected; only one open proposal at a time', () => {
  const d = desk();
  assert.throws(() => d.proposeChange(A, {baseRevision: 0, changes: [{segmentId: 'gallery', duration: 30}]}), code('stale_base'));
  d.proposeChange(A, {baseRevision: 1, changes: [{segmentId: 'gallery', duration: 45}]});
  assert.throws(() => d.proposeChange(B, {baseRevision: 1, changes: [{segmentId: 'intro', duration: 8}]}), code('busy'));
});

test('approval is bound to an exact proposal version', () => {
  const d = desk();
  const p = d.proposeChange(A, {baseRevision: 1, changes: [{segmentId: 'gallery', content: slides(12, 9, 9)}]});
  assert.equal(p.status, 'awaiting_approval');
  assert.throws(() => d.decideProposal(producer, {proposalId: p.id, version: 0, decision: 'approve'}), code('stale_revision'));
  assert.throws(() => d.decideProposal(creatorB, {proposalId: p.id, version: 1, decision: 'approve'}), code('forbidden'));
  d.decideProposal(producer, {proposalId: p.id, version: 1, decision: 'reject', note: 'first work needs more time'});
  assert.equal(d.state.proposals[p.id].status, 'rejected');
  assert.equal(d.state.showRevision, 1);
});

test('two simultaneous bookings of the same interval: at most one is confirmed', () => {
  const d = desk();
  d.state.segments.premiere2 = {...structuredClone(d.state.segments.gallery), id: 'premiere2', title: 'Rival premiere', ownerId: 'creator-a'};
  delete d.state.bookings.premiere;
  d.holdSlot(B, {segmentId: 'premiere', start: 50, duration: 60});
  d.holdSlot(A, {segmentId: 'premiere2', start: 60, duration: 30});
  const results = [() => d.confirmSlot(producer, {segmentId: 'premiere'}), () => d.confirmSlot(producer, {segmentId: 'premiere2'})].map(f => { try { return f().state; } catch (e) { return e.code; } });
  assert.deepEqual(results, ['confirmed', 'slot_taken']);
  assert.equal(d.confirmedBookings().length, 1);
  assert.throws(() => d.holdSlot(B, {segmentId: 'premiere', start: 0, duration: 10}), code('booking_confirmed'));
});

test('old approval does not carry over to changed media', () => {
  const d = desk();
  d.replaceAsset(creatorB, {segmentId: 'premiere', assetId: 'track', sha256: 'new-hash', meta: {rightsDeclared: true, kind: 'audio', ...verified('new-hash'), durationSec: 62}});
  assert.equal(d.approvalValid(d.state.segments.premiere), false);
  assert.throws(() => d.publish(producer), code('not_publishable'));
  assert.throws(() => d.reviewSegment(producer, {segmentId: 'premiere', revision: 1, decision: 'approved'}), code('stale_revision'));
  assert.throws(() => d.reviewSegment(B, {segmentId: 'premiere', revision: 2, decision: 'approved'}), code('forbidden'));
  d.reviewSegment(producer, {segmentId: 'premiere', revision: 2, decision: 'approved'});
  assert.equal(d.publish(producer).publishRevision, 2, 'a media change is a new programme revision');
});

test('unanswered request expires as "no change", never as consent', () => {
  const d = desk();
  const p = d.proposeChange(A, {baseRevision: 1, changes: [{segmentId: 'gallery', duration: 45}]});
  d.advance(120000); d.expireRequests(60000);
  assert.equal(d.state.proposals[p.id].offer.limits[0].maxThatFits, 40);
  assert.equal(d.state.proposals[p.id].concessions.length, 0);
  d.advance(120000); d.expireRequests(60000);
  assert.equal(d.state.proposals[p.id].status, 'no_agreement');
  assert.equal(d.state.showRevision, 1);
});

test('publish → on air → completed; every publication has its own number', () => {
  const d = desk();
  const m1 = d.publish(producer), m2 = d.publish(producer);
  assert.equal(m1.publishRevision, m2.publishRevision);
  assert.equal(m2.publicationId, m1.publicationId + 1);
  assert.notEqual(m1.hash, m2.hash);
  assert.throws(() => d.goLive(A), code('forbidden'));
  assert.throws(() => d.goLive(producer, {delayMs: 0, publicationId: m1.publicationId, hash: m1.hash}), code('stale_manifest'), 'superseded publication');
  const b = d.goLive(producer, {delayMs: 0, publicationId: m2.publicationId, hash: m2.hash});
  assert.equal(b.state, 'on_air');
  assert.throws(() => d.publish(producer), code('on_air'));
  d.advance(121000); d.tick();
  assert.equal(d.state.broadcast.state, 'completed');
});

test('every change is in the audit log with actor and sequence', () => {
  const d = desk();
  const p = d.proposeChange(A, {baseRevision: 1, changes: [{segmentId: 'gallery', duration: 45}]});
  d.respondToRequest(B, {requestId: openRequest(d, 'agent-b').id, decision: 'accept', duration: 5});
  d.reviseProposal(A, {proposalId: p.id, changes: [{segmentId: 'gallery', duration: 45, content: slides(15, 15, 15)}]});
  approveAll(d, d.state.proposals[p.id]);
  const actions = d.state.audit.map(e => e.action);
  for (const a of ['proposal_created', 'showrunner_house_change', 'request_opened', 'request_answered', 'proposal_revised', 'proposal_ready', 'proposal_approved', 'revision_committed']) assert.ok(actions.includes(a), a);
  assert.deepEqual(d.state.audit.map(e => e.seq), d.state.audit.map((_, i) => i + 1));
  assert.ok(d.state.revisions.at(-1).diff.length >= 3);
});

test('an art duration change must carry slide timings that fill it', () => {
  const d = desk();
  const p = d.proposeChange(A, {baseRevision: 1, changes: [{segmentId: 'gallery', duration: 45}]});
  d.respondToRequest(B, {requestId: openRequest(d, 'agent-b').id, decision: 'accept', duration: 5});
  assert.throws(() => d.reviseProposal(A, {proposalId: p.id, changes: [{segmentId: 'gallery', duration: 45}]}), code('bad_content'));
});
