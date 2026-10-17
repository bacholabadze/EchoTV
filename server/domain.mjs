// ECHO shared broadcast state. Deterministic rules only: time arithmetic, booking protection,
// revisions and approvals live here. Agents (LLMs) only ever create proposals and answers;
// nothing an agent sends changes the committed programme without human approval.
import {createHash} from 'node:crypto';

export class DomainError extends Error {
  constructor(code, message, details = {}) { super(message); this.code = code; this.details = details; }
}
const fail = (code, message, details) => { throw new DomainError(code, message, details); };
const clone = value => structuredClone(value);
export const sha256 = data => createHash('sha256').update(data).digest('hex');
// Canonical JSON so a manifest hash does not depend on key order.
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

export const BOOKING = ['available', 'held', 'confirmed', 'released'];
export const SEGMENT = ['draft', 'submitted', 'approved', 'needs_changes', 'rejected'];
export const BROADCAST = ['queued', 'ready', 'on_air', 'completed', 'failed'];
const OPEN_PROPOSAL = new Set(['negotiating', 'awaiting_proposer', 'awaiting_approval']);

export class BroadcastDesk {
  constructor(state, {now = () => Date.now()} = {}) { this.state = state; this.now = now; }

  // ---------- reads ----------
  get episode() { return this.state.episode; }
  segment(id) { return this.state.segments[id] || fail('not_found', `Unknown segment ${id}`); }
  agent(id) { return this.state.agents[id] || fail('not_found', `Unknown agent ${id}`); }
  person(id) { return this.state.people[id] || fail('not_found', `Unknown person ${id}`); }
  proposal(id) { return this.state.proposals[id] || fail('not_found', `Unknown proposal ${id}`); }

  // Sequential layout of the committed (or a hypothetical) set of durations.
  layout(durations = this.durations()) {
    let at = 0;
    return this.state.order.map(id => { const entry = {segmentId: id, start: at, duration: durations[id]}; at += durations[id]; return entry; });
  }
  durations() { return Object.fromEntries(this.state.order.map(id => [id, this.state.segments[id].duration])); }
  confirmedBookings() { return Object.values(this.state.bookings).filter(b => b.state === 'confirmed'); }

  // Every rule a committed schedule must satisfy. Returns a list of violations (empty = valid).
  violations(durations) {
    const out = [], layout = this.layout(durations), total = layout.reduce((s, e) => s + e.duration, 0);
    if (total !== this.episode.durationSec) out.push({rule: 'episode_length', expected: this.episode.durationSec, actual: total});
    for (const entry of layout) {
      const seg = this.state.segments[entry.segmentId];
      if (entry.duration < seg.minDuration || entry.duration > seg.maxDuration)
        out.push({rule: 'segment_bounds', segmentId: seg.id, min: seg.minDuration, max: seg.maxDuration, actual: entry.duration});
    }
    for (const booking of this.confirmedBookings()) {
      const entry = layout.find(e => e.segmentId === booking.segmentId);
      if (!entry || entry.start !== booking.start || entry.duration !== booking.duration)
        out.push({rule: 'confirmed_booking', segmentId: booking.segmentId, booked: {start: booking.start, duration: booking.duration}, actual: entry && {start: entry.start, duration: entry.duration}});
    }
    return out;
  }

  // ---------- audit ----------
  log(actor, action, summary, data = {}) {
    const entry = {seq: ++this.state.seq, at: this.now(), actor, action, summary, ...data};
    this.state.audit.push(entry);
    return entry;
  }

  // ---------- permissions ----------
  requireAgent(actor) { if (actor?.type !== 'agent') fail('forbidden', 'Only an agent identity can do this'); return this.agent(actor.id); }
  requireHuman(actor) { if (actor?.type !== 'person') fail('forbidden', 'Only a signed-in person can do this'); return this.person(actor.id); }
  requireProducer(actor) { const p = this.requireHuman(actor); if (p.role !== 'producer') fail('forbidden', 'Producer role required'); return p; }

  // ---------- bookings ----------
  holdSlot(actor, {segmentId, start, duration}) {
    const seg = this.segment(segmentId);
    const owner = actor.type === 'agent' ? this.agent(actor.id).ownerId : this.requireHuman(actor).id;
    if (seg.ownerId !== owner) fail('forbidden', 'You can only hold slots for your own segment');
    const booking = this.state.bookings[segmentId];
    if (booking?.state === 'confirmed') fail('booking_confirmed', 'This segment already has a confirmed slot');
    this.state.bookings[segmentId] = {segmentId, start, duration, state: 'held', heldBy: actor.id, heldAt: this.now()};
    this.log(actor, 'slot_held', `${seg.title}: held ${start}s–${start + duration}s (not guaranteed until confirmed)`);
    return clone(this.state.bookings[segmentId]);
  }
  // Atomic: checks overlap against every confirmed booking at the moment of confirmation.
  confirmSlot(actor, {segmentId}) {
    this.requireProducer(actor);
    const booking = this.state.bookings[segmentId];
    if (!booking || booking.state !== 'held') fail('not_held', 'Only a held slot can be confirmed');
    const clash = this.confirmedBookings().find(b => b.segmentId !== segmentId && b.start < booking.start + booking.duration && booking.start < b.start + b.duration);
    if (clash) fail('slot_taken', `Interval already confirmed for ${this.state.segments[clash.segmentId].title}`, {clash: clone(clash)});
    booking.state = 'confirmed'; booking.confirmedBy = actor.id; booking.confirmedAt = this.now();
    this.log(actor, 'slot_confirmed', `${this.state.segments[segmentId].title}: confirmed ${booking.start}s–${booking.start + booking.duration}s`);
    return clone(booking);
  }
  // A confirmed slot can only be released by its owner (consent), never by an agent or the Showrunner.
  releaseSlot(actor, {segmentId}) {
    const person = this.requireHuman(actor), seg = this.segment(segmentId), booking = this.state.bookings[segmentId];
    if (seg.ownerId !== person.id) fail('forbidden', 'Only the segment owner can release a confirmed slot');
    if (!booking) fail('not_found', 'No booking');
    booking.state = 'released';
    this.log(actor, 'slot_released', `${seg.title}: slot released by owner`);
    return clone(booking);
  }

  // ---------- segment content & editorial review ----------
  replaceAsset(actor, {segmentId, assetId, sha256: hash, meta = {}}) {
    const person = this.requireHuman(actor), seg = this.segment(segmentId);
    if (seg.ownerId !== person.id) fail('forbidden', 'Only the owner can replace media');
    if (!meta.rightsDeclared && !seg.assets.find(a => a.id === assetId)?.rightsDeclared) fail('rights_required', 'Declare distribution rights before submitting media');
    const assets = seg.assets.filter(a => a.id !== assetId);
    assets.push({id: assetId, sha256: hash, ...meta});
    seg.assets = assets; seg.revision++; seg.state = 'submitted';
    this.log(actor, 'asset_replaced', `${seg.title}: media ${assetId} replaced; revision ${seg.revision} needs review`, {segmentId, revision: seg.revision});
    return clone(seg);
  }
  reviewSegment(actor, {segmentId, revision, decision, note = ''}) {
    this.requireProducer(actor);
    const seg = this.segment(segmentId);
    if (revision !== seg.revision) fail('stale_revision', `Review is for revision ${revision}; current is ${seg.revision}`, {current: seg.revision});
    if (!['approved', 'needs_changes', 'rejected'].includes(decision)) fail('bad_request', 'Unknown review decision');
    if (decision === 'approved' && seg.assets.some(a => !a.rightsDeclared)) fail('rights_required', 'Every asset needs declared rights before approval');
    seg.state = decision;
    seg.approval = decision === 'approved' ? {revision: seg.revision, assetHashes: seg.assets.map(a => a.sha256).sort(), by: actor.id, at: this.now()} : null;
    seg.reviewNote = note;
    this.log(actor, 'segment_reviewed', `${seg.title} r${revision}: ${decision}${note ? ` — ${note}` : ''}`, {segmentId, revision});
    return clone(seg);
  }
  // Approval is bound to the exact revision and media hashes; any change invalidates it.
  approvalValid(seg) {
    const a = seg.approval;
    return !!a && seg.state === 'approved' && a.revision === seg.revision && canonical(a.assetHashes) === canonical(seg.assets.map(x => x.sha256).sort());
  }

  // ---------- proposals and the Showrunner ----------
  proposeChange(actor, {baseRevision, changes, note = ''}) {
    const agent = this.requireAgent(actor);
    if (baseRevision !== this.state.showRevision) fail('stale_base', `Your view is revision ${baseRevision}; the show is at ${this.state.showRevision}. Re-read the schedule and propose again.`, {currentRevision: this.state.showRevision});
    if (!Array.isArray(changes) || !changes.length) fail('bad_request', 'changes must be a non-empty list');
    for (const c of changes) {
      const seg = this.segment(c.segmentId);
      if (seg.ownerId !== agent.ownerId) fail('forbidden', `${agent.label} may only propose changes to its owner's segments; ask the Showrunner to negotiate ${seg.title}`);
      this.checkChange(seg, c);
    }
    const open = Object.values(this.state.proposals).find(p => OPEN_PROPOSAL.has(p.status));
    if (open) fail('busy', `Proposal ${open.id} is still open; wait for it to finish`, {openProposal: open.id});
    const id = `P${++this.state.counters.proposal}`;
    const proposal = {id, agentId: agent.id, ownerId: agent.ownerId, baseRevision, version: 1, note,
      changes: clone(changes), concessions: [], houseChanges: [], approvals: {}, status: 'negotiating', createdAt: this.now(), history: []};
    this.state.proposals[id] = proposal;
    this.log(actor, 'proposal_created', `${agent.label} proposed: ${this.describe(changes)}${note ? ` — “${note}”` : ''}`, {proposalId: id});
    this.showrunnerEvaluate(proposal);
    return clone(proposal);
  }
  checkChange(seg, change) {
    if (change.duration !== undefined) {
      if (!Number.isInteger(change.duration)) fail('bad_request', 'Durations are whole seconds');
      if (change.duration < seg.minDuration || change.duration > seg.maxDuration)
        fail('out_of_bounds', `${seg.title} must stay between ${seg.minDuration}s and ${seg.maxDuration}s`, {segmentId: seg.id});
      if (this.state.bookings[seg.id]?.state === 'confirmed' && change.duration !== seg.duration)
        fail('booking_confirmed', `${seg.title} has a confirmed slot; only its owner can release it`);
    }
    if (change.content?.slides) {
      const total = change.content.slides.reduce((s, x) => s + x.seconds, 0), duration = change.duration ?? seg.duration;
      if (total !== duration) fail('bad_content', `Slide timings add up to ${total}s but the segment is ${duration}s`);
      for (const slide of change.content.slides) if (!seg.assets.find(a => a.id === slide.assetId)) fail('bad_content', `Unknown asset ${slide.assetId} in ${seg.title}`);
    }
  }
  // A request can state intent ("I need 45s"); what humans approve must be complete content.
  requireCompleteContent(changes) {
    for (const c of changes) {
      const seg = this.segment(c.segmentId);
      if (seg.content?.slides && c.duration !== undefined && c.duration !== seg.duration && !c.content?.slides)
        fail('bad_content', `${seg.title} shows timed slides: include slide timings that add up to ${c.duration}s`);
    }
  }
  describe(changes) {
    return changes.map(c => { const seg = this.state.segments[c.segmentId]; return c.duration !== undefined && c.duration !== seg.duration ? `${seg.title} ${seg.duration}s→${c.duration}s` : `${seg.title} content update`; }).join(', ');
  }
  proposedDurations(proposal) {
    const d = this.durations();
    for (const c of [...proposal.changes, ...proposal.concessions.filter(x => x.accepted), ...proposal.houseChanges]) if (c.duration !== undefined) d[c.segmentId] = c.duration;
    return d;
  }
  // Region bounded by confirmed bookings that contains a segment: the time that region must fill.
  region(segmentId) {
    const pins = this.confirmedBookings().map(b => this.state.order.indexOf(b.segmentId)).sort((a, b) => a - b);
    const index = this.state.order.indexOf(segmentId);
    const before = pins.filter(p => p < index).pop(), after = pins.find(p => p > index);
    const startAt = before === undefined ? 0 : this.state.bookings[this.state.order[before]].start + this.state.bookings[this.state.order[before]].duration;
    const endAt = after === undefined ? this.episode.durationSec : this.state.bookings[this.state.order[after]].start;
    const ids = this.state.order.slice(before === undefined ? 0 : before + 1, after === undefined ? undefined : after);
    return {ids, length: endAt - startAt, startAt, endAt, pinnedNext: after === undefined ? null : this.state.order[after]};
  }
  // Deterministic Showrunner: computes exact need, cuts ECHO's own house time first, then asks other creators' agents.
  showrunnerEvaluate(proposal) {
    const showrunner = {type: 'system', id: 'showrunner'};
    const durations = this.proposedDurations(proposal);
    const regions = new Map();
    for (const c of proposal.changes) { const r = this.region(c.segmentId); regions.set(r.ids.join(), r); }
    proposal.conflicts = [];
    for (const r of regions.values()) {
      const used = r.ids.reduce((s, id) => s + durations[id], 0), need = used - r.length;
      if (need === 0) continue;
      const touched = new Set([...proposal.changes, ...proposal.concessions, ...proposal.houseChanges].map(c => c.segmentId));
      const flexible = r.ids.filter(id => !touched.has(id)).map(id => this.state.segments[id]);
      const slack = s => need > 0 ? s.duration - s.minDuration : s.maxDuration - s.duration;
      const pinned = r.pinnedNext && this.state.segments[r.pinnedNext];
      proposal.conflicts.push({need, region: {startAt: r.startAt, endAt: r.endAt}, protects: pinned ? {segmentId: pinned.id, title: pinned.title, start: r.endAt} : null,
        explanation: need > 0
          ? `${need}s too long: ${pinned ? `the confirmed ${pinned.title} must still start at ${r.endAt}s` : `the episode must end at ${this.episode.durationSec}s`}.`
          : `${-need}s too short: the programme would leave a gap before ${pinned ? pinned.title : 'the end'}.`});
      let remaining = Math.abs(need);
      for (const seg of flexible.filter(s => s.house && slack(s) > 0)) {
        const delta = Math.min(slack(seg), remaining); if (!delta) continue;
        const duration = seg.duration + (need > 0 ? -delta : delta);
        proposal.houseChanges.push({segmentId: seg.id, from: seg.duration, duration, offered: duration});
        remaining -= delta;
        this.log(showrunner, 'showrunner_house_change', `Showrunner offers ECHO house time: ${seg.title} ${seg.duration}s→${duration}s (needs producer approval)`, {proposalId: proposal.id});
      }
      if (remaining > 0) {
        for (const seg of flexible.filter(s => !s.house && slack(s) > 0)) {
          const agent = Object.values(this.state.agents).find(a => a.ownerId === seg.ownerId && a.active !== false);
          if (!agent) continue;
          this.openRequest(proposal, {type: 'concede', toAgentId: agent.id, segmentId: seg.id, need: remaining, maxConcession: Math.min(slack(seg), remaining), direction: need > 0 ? 'shorten' : 'extend',
            message: `${this.state.agents[proposal.agentId].label} asks for ${this.describe(proposal.changes)}. ${remaining}s ${need > 0 ? 'must be found' : 'must be filled'} before ${pinned ? `the confirmed ${pinned.title} at ${r.endAt}s` : 'the end'}. Can ${seg.title} (${seg.duration}s, your minimum ${seg.minDuration}s, maximum ${seg.maxDuration}s) ${need > 0 ? 'give up' : 'add'} time? Up to ${Math.min(slack(seg), remaining)}s would help.`});
        }
      }
    }
    if (!proposal.conflicts.length) {
      try { this.requireCompleteContent(proposal.changes); } catch (e) { return this.askProposer(proposal); }
      return this.toApproval(proposal, 'No conflict: the programme still fits and every confirmed slot is unchanged.');
    }
    if (!Object.values(this.state.requests).some(r => r.proposalId === proposal.id && r.status === 'open')) return this.askProposer(proposal);
    proposal.status = 'negotiating';
  }
  openRequest(proposal, request) {
    const id = `R${++this.state.counters.request}`;
    this.state.requests[id] = {id, proposalId: proposal.id, proposalVersion: proposal.version, status: 'open', createdAt: this.now(), ...request};
    this.log({type: 'system', id: 'showrunner'}, 'request_opened', `Showrunner → ${this.state.agents[request.toAgentId].label}: ${request.message}`, {proposalId: proposal.id, requestId: id});
    return this.state.requests[id];
  }
  // Agent answer to a Showrunner request. The answer is checked against the owner's declared bounds.
  respondToRequest(actor, {requestId, decision, duration, message = '', content}) {
    const agent = this.requireAgent(actor), request = this.state.requests[requestId] || fail('not_found', `Unknown request ${requestId}`);
    if (request.toAgentId !== agent.id) fail('forbidden', 'This request is addressed to another agent');
    if (request.status !== 'open') fail('closed', `Request ${requestId} is already ${request.status}`);
    const proposal = this.proposal(request.proposalId);
    if (request.type === 'concede') {
      if (!['accept', 'decline'].includes(decision)) fail('bad_request', 'decision must be accept or decline');
      const seg = this.segment(request.segmentId);
      if (decision === 'accept') {
        if (!Number.isInteger(duration)) fail('bad_request', 'Give the new duration in whole seconds');
        const change = {segmentId: seg.id, duration, ...(content ? {content} : {})};
        this.checkChange(seg, change);
        const delta = request.direction === 'shorten' ? seg.duration - duration : duration - seg.duration;
        if (delta <= 0) fail('bad_request', `To ${request.direction} ${seg.title}, the duration must ${request.direction === 'shorten' ? 'go below' : 'go above'} ${seg.duration}s`);
        if (delta > request.maxConcession) fail('bad_request', `Only ${request.maxConcession}s is needed`);
        proposal.concessions.push({...change, from: seg.duration, offered: duration, accepted: true, agentId: agent.id, requestId});
      }
      request.status = 'answered'; request.response = {decision, duration, message, at: this.now()};
      this.log(actor, 'request_answered', `${agent.label}: ${decision === 'accept' ? `accepts ${seg.title} ${seg.duration}s→${duration}s` : `declines to change ${seg.title}`}${message ? ` — “${message}”` : ''}`, {proposalId: proposal.id, requestId});
      if (!Object.values(this.state.requests).some(r => r.proposalId === proposal.id && r.status === 'open')) this.askProposer(proposal);
      return clone(proposal);
    }
    fail('bad_request', 'Use revise_proposal or withdraw_proposal to answer a revise request');
  }
  // After negotiation the proposer sees what is actually available and must adapt (A → B → A).
  askProposer(proposal) {
    const durations = this.proposedDurations(proposal);
    const shortfalls = this.regionShortfalls(proposal, durations);
    const offered = [...proposal.concessions, ...proposal.houseChanges].map(c => `${this.state.segments[c.segmentId].title} ${this.state.segments[c.segmentId].duration}s→${c.duration}s`).join(', ') || 'nothing';
    const declined = Object.values(this.state.requests).filter(r => r.proposalId === proposal.id && r.response?.decision === 'decline').map(r => `${this.state.agents[r.toAgentId].label} declined: “${r.response.message || 'no change'}”`);
    const fits = shortfalls.every(s => s.need === 0);
    const limits = proposal.changes.map(c => {
      const seg = this.state.segments[c.segmentId], s = shortfalls.find(x => x.ids.includes(c.segmentId));
      return {segmentId: seg.id, title: seg.title, requested: c.duration ?? seg.duration, maxThatFits: (c.duration ?? seg.duration) - (s?.need || 0)};
    });
    proposal.status = 'awaiting_proposer';
    proposal.offer = {fits, offered, declined, limits};
    this.openRequest(proposal, {type: 'revise', toAgentId: proposal.agentId, limits,
      message: fits
        ? `Space found: ${offered}. Confirm your proposal with revise_proposal (adjust your content to the final duration if needed), or withdraw.`
        : `Only partial space found (${offered}). ${declined.join(' ')} ${limits.map(l => `${l.title} can be at most ${l.maxThatFits}s`).join('; ')}. Revise to fit, or withdraw (the current programme then stays unchanged).`});
  }
  regionShortfalls(proposal, durations) {
    const seen = new Map();
    for (const c of proposal.changes) { const r = this.region(c.segmentId); seen.set(r.ids.join(), r); }
    return [...seen.values()].map(r => ({ids: r.ids, need: r.ids.reduce((s, id) => s + durations[id], 0) - r.length}));
  }
  reviseProposal(actor, {proposalId, changes, note = ''}) {
    const agent = this.requireAgent(actor), proposal = this.proposal(proposalId);
    if (proposal.agentId !== agent.id) fail('forbidden', 'Only the proposing agent can revise its proposal');
    if (proposal.status !== 'awaiting_proposer') fail('closed', `Proposal is ${proposal.status}`);
    for (const c of changes) { const seg = this.segment(c.segmentId); if (seg.ownerId !== agent.ownerId) fail('forbidden', `Cannot change ${seg.title}`); this.checkChange(seg, c); }
    this.requireCompleteContent(changes);
    for (const r of Object.values(this.state.requests)) if (r.proposalId === proposal.id && r.status === 'open') { r.status = 'answered'; r.response = {decision: 'revised', message: note, at: this.now()}; }
    proposal.history.push({version: proposal.version, changes: proposal.changes});
    proposal.changes = clone(changes); proposal.version++; proposal.approvals = {};
    this.trimToNeed(proposal);
    this.log(actor, 'proposal_revised', `${agent.label} adapted: ${this.describe(changes)}${note ? ` — “${note}”` : ''}`, {proposalId});
    const shortfalls = this.regionShortfalls(proposal, this.proposedDurations(proposal));
    if (shortfalls.some(s => s.need !== 0)) {
      const v = this.violations(this.proposedDurations(proposal));
      proposal.status = 'awaiting_proposer';
      this.openRequest(proposal, {type: 'revise', toAgentId: agent.id, limits: proposal.offer?.limits || [], message: `Still does not fit: ${v.map(x => x.rule).join(', ')}. ${proposal.offer?.limits?.map(l => `${l.title} can be at most ${l.maxThatFits}s`).join('; ') || ''}`});
      return clone(proposal);
    }
    this.toApproval(proposal, 'Fits: every confirmed slot keeps its time; episode length unchanged.');
    return clone(proposal);
  }
  // The proposer may now need less than was offered: use ECHO house time first, hand creators back the rest.
  trimToNeed(proposal) {
    const base = this.durations();
    for (const c of proposal.changes) if (c.duration !== undefined) base[c.segmentId] = c.duration;
    const offers = [...proposal.houseChanges, ...proposal.concessions];
    for (const s of this.regionShortfalls(proposal, base)) {
      let need = Math.abs(s.need);
      for (const c of offers.filter(o => s.ids.includes(o.segmentId))) {
        const current = this.state.segments[c.segmentId].duration, use = Math.min(Math.abs(current - c.offered), need);
        need -= use;
        c.duration = current - Math.sign(s.need) * use;
      }
    }
    const changed = c => c.duration !== this.state.segments[c.segmentId].duration;
    proposal.houseChanges = proposal.houseChanges.filter(changed);
    proposal.concessions = proposal.concessions.filter(changed);
  }
  withdrawProposal(actor, {proposalId, note = ''}) {
    const agent = this.requireAgent(actor), proposal = this.proposal(proposalId);
    if (proposal.agentId !== agent.id) fail('forbidden', 'Only the proposing agent can withdraw');
    if (!OPEN_PROPOSAL.has(proposal.status)) fail('closed', `Proposal is ${proposal.status}`);
    this.closeProposal(proposal, 'no_agreement', `${agent.label} withdrew${note ? ` — “${note}”` : ''}. NO AGREEMENT: programme stays at revision ${this.state.showRevision}.`, actor);
    return clone(proposal);
  }
  closeProposal(proposal, status, summary, actor = {type: 'system', id: 'showrunner'}) {
    proposal.status = status; proposal.closedAt = this.now();
    for (const r of Object.values(this.state.requests)) if (r.proposalId === proposal.id && r.status === 'open') r.status = 'expired';
    this.log(actor, `proposal_${status}`, summary, {proposalId: proposal.id});
  }
  // Agents that do not answer in time are treated as declining; nothing is decided on their behalf.
  expireRequests(maxAgeMs) {
    for (const r of Object.values(this.state.requests)) {
      if (r.status !== 'open' || this.now() - r.createdAt < maxAgeMs) continue;
      const proposal = this.state.proposals[r.proposalId];
      r.status = 'expired';
      this.log({type: 'system', id: 'showrunner'}, 'request_expired', `${this.state.agents[r.toAgentId].label} did not answer in time; treated as no change.`, {proposalId: r.proposalId, requestId: r.id});
      if (r.type === 'revise') this.closeProposal(proposal, 'no_agreement', `NO AGREEMENT: proposer did not adapt in time. Programme stays at revision ${this.state.showRevision}.`);
      else if (!Object.values(this.state.requests).some(x => x.proposalId === proposal.id && x.status === 'open')) this.askProposer(proposal);
    }
  }
  toApproval(proposal, reason) {
    const all = [...proposal.changes, ...proposal.concessions, ...proposal.houseChanges];
    const owners = new Set(all.map(c => this.state.segments[c.segmentId].ownerId).filter(id => this.state.people[id]?.role !== 'producer'));
    proposal.requiredApprovals = [...owners, ...Object.values(this.state.people).filter(p => p.role === 'producer').map(p => p.id).slice(0, 1)];
    proposal.status = 'awaiting_approval';
    proposal.preview = this.layout(this.proposedDurations(proposal));
    this.log({type: 'system', id: 'showrunner'}, 'proposal_ready', `${reason} Waiting for: ${proposal.requiredApprovals.map(id => this.state.people[id].name).join(', ')}.`, {proposalId: proposal.id});
  }
  // Humans approve an exact proposal version. The commit re-checks every invariant at that moment.
  decideProposal(actor, {proposalId, version, decision, note = ''}) {
    const person = this.requireHuman(actor), proposal = this.proposal(proposalId);
    if (proposal.status !== 'awaiting_approval') fail('closed', `Proposal is ${proposal.status}`);
    if (version !== proposal.version) fail('stale_revision', `You reviewed version ${version}; current is ${proposal.version}`);
    if (!proposal.requiredApprovals.includes(person.id)) fail('forbidden', 'Your approval is not required for this proposal');
    if (decision === 'reject') {
      this.closeProposal(proposal, 'rejected', `${person.name} rejected${note ? ` — “${note}”` : ''}. Programme stays at revision ${this.state.showRevision}.`, actor);
      return {proposal: clone(proposal), committed: false};
    }
    if (decision !== 'approve') fail('bad_request', 'decision must be approve or reject');
    proposal.approvals[person.id] = {version, at: this.now()};
    this.log(actor, 'proposal_approved', `${person.name} approved ${proposal.id} v${version}`, {proposalId});
    if (!proposal.requiredApprovals.every(id => proposal.approvals[id]?.version === proposal.version)) return {proposal: clone(proposal), committed: false};
    return {proposal: clone(proposal), committed: true, revision: this.commit(proposal)};
  }
  commit(proposal) {
    if (proposal.baseRevision !== this.state.showRevision) { this.closeProposal(proposal, 'stale', `Proposal was based on revision ${proposal.baseRevision}; show is at ${this.state.showRevision}. Nothing applied.`); fail('stale_base', 'Show changed since this proposal was made'); }
    const durations = this.proposedDurations(proposal), problems = this.violations(durations);
    if (problems.length) { this.closeProposal(proposal, 'rejected', `Commit refused: ${problems.map(p => p.rule).join(', ')}`); fail('invariant', 'Proposal violates programme rules', {problems}); }
    const before = this.layout();
    const producerApproved = proposal.requiredApprovals.some(id => this.state.people[id].role === 'producer');
    for (const c of [...proposal.changes, ...proposal.concessions, ...proposal.houseChanges]) {
      const seg = this.state.segments[c.segmentId], hadValidApproval = this.approvalValid(seg);
      if (c.duration !== undefined) seg.duration = c.duration;
      if (c.content) seg.content = {...seg.content, ...clone(c.content)};
      seg.revision++;
      // The producer approved this exact diff with unchanged media hashes: re-bind approval to the new revision.
      if (hadValidApproval && producerApproved) seg.approval = {...seg.approval, revision: seg.revision, via: proposal.id};
      else { seg.state = 'submitted'; seg.approval = null; }
    }
    const after = this.layout();
    const diff = after.map((a, i) => ({segmentId: a.segmentId, before: {start: before[i].start, duration: before[i].duration}, after: {start: a.start, duration: a.duration}})).filter(d => d.before.start !== d.after.start || d.before.duration !== d.after.duration);
    this.state.showRevision++;
    this.state.revisions.push({revision: this.state.showRevision, baseRevision: proposal.baseRevision, proposalId: proposal.id, at: this.now(), schedule: after, diff});
    proposal.status = 'committed'; proposal.committedRevision = this.state.showRevision;
    this.log({type: 'system', id: 'showrunner'}, 'revision_committed', `Revision ${this.state.showRevision} committed from ${proposal.id}: ${diff.map(d => `${this.state.segments[d.segmentId].title} ${d.before.start}+${d.before.duration}s → ${d.after.start}+${d.after.duration}s`).join('; ')}`, {proposalId: proposal.id, revision: this.state.showRevision, diff});
    return this.state.showRevision;
  }

  // ---------- publish & broadcast ----------
  publish(actor, {assetUrl = id => `/media/${id}`} = {}) {
    this.requireProducer(actor);
    if (Object.values(this.state.proposals).some(p => OPEN_PROPOSAL.has(p.status))) fail('busy', 'Finish or withdraw open proposals before publishing');
    if (this.state.broadcast.state === 'on_air') fail('on_air', 'A broadcast is on air');
    const problems = this.violations(this.durations());
    const unapproved = this.layout().filter(e => e.duration > 0 && !this.approvalValid(this.state.segments[e.segmentId])).map(e => this.state.segments[e.segmentId].title);
    if (problems.length || unapproved.length) fail('not_publishable', `Cannot publish: ${[...problems.map(p => p.rule), ...unapproved.map(t => `${t} not approved for its current revision`)].join('; ')}`, {problems, unapproved});
    const segments = this.layout().filter(e => e.duration > 0).map(e => {
      const seg = this.state.segments[e.segmentId];
      return {id: seg.id, module: seg.module, title: seg.title, owner: this.state.people[seg.ownerId].name, ownerId: seg.ownerId, start: e.start, duration: e.duration, revision: seg.revision,
        confirmed: this.state.bookings[seg.id]?.state === 'confirmed', content: clone(seg.content || {}),
        assets: seg.assets.map(a => ({id: a.id, sha256: a.sha256, url: assetUrl(a.id), title: a.title, credit: a.credit, license: a.license, kind: a.kind}))};
    });
    const body = {episodeId: this.episode.id, title: this.episode.title, durationSec: this.episode.durationSec, publishRevision: this.state.showRevision, segments};
    const manifest = {...body, hash: sha256(canonical(body)), publishedAt: this.now(), publishedBy: actor.id};
    this.state.broadcast = {state: 'ready', publishRevision: this.state.showRevision, manifest, onAirAt: null};
    this.log(actor, 'published', `Manifest for revision ${this.state.showRevision} published (${manifest.hash.slice(0, 12)})`, {revision: this.state.showRevision});
    return clone(manifest);
  }
  goLive(actor, {delayMs = 3000} = {}) {
    this.requireProducer(actor);
    const b = this.state.broadcast;
    if (b.state !== 'ready') fail('not_ready', `Broadcast is ${b.state}; publish an approved revision first`);
    b.state = 'on_air'; b.onAirAt = this.now() + delayMs;
    this.log(actor, 'on_air', `Revision ${b.publishRevision} on air`, {revision: b.publishRevision});
    return clone(b);
  }
  tick() {
    const b = this.state.broadcast;
    if (b.state === 'on_air' && this.now() >= b.onAirAt + b.manifest.durationSec * 1000) { b.state = 'completed'; this.log({type: 'system', id: 'playout'}, 'completed', `Revision ${b.publishRevision} completed`); return true; }
    return false;
  }
  failBroadcast(actor, {reason}) {
    this.requireProducer(actor);
    this.state.broadcast.state = 'failed';
    this.log(actor, 'broadcast_failed', `Broadcast failed: ${reason}; fallback slate shown`);
    return clone(this.state.broadcast);
  }
}
