// ECHO shared broadcast state. Deterministic rules only: time arithmetic, booking protection,
// revisions and approvals live here. Agents (LLMs) only ever create proposals and answers;
// nothing an agent sends changes the committed programme without human approval.
import {createHash} from 'node:crypto';
import * as Interview from './interview.mjs';

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
// Media is playable only on the strength of a current check of its exact bytes: a full decode, or (shipped demo
// files without a decoder) the fingerprint recorded when they were verified. Bare flags from older checks count for nothing.
export const MEDIA_CHECKS = ['ffmpeg-full-decode/2', 'recorded-fingerprint/1'];
export const playable = a => a.decodable === true && !!a.verification && a.verification.sha256 === a.sha256 && MEDIA_CHECKS.includes(a.verification.method);
// A file airs only in part when its segment starts inside it or ends before it does (needs the 'editing' use).
const trims = (seg, durationSec) => durationSec > 0 && ((seg.content?.offset || 0) > 0 || durationSec - ((seg.content?.offset || 0) + seg.duration) > .5);
const whyUnplayable = a => `${a.id} ${a.decodable === false ? `could not be decoded${a.unplayableReason ? ` (${a.unplayableReason})` : ''}` : 'has not been verified as playable'}`;

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
    if (!Number.isInteger(start) || !Number.isInteger(duration)) fail('bad_request', 'start and duration are whole seconds');
    if (start < 0 || duration <= 0 || start + duration > this.episode.durationSec)
      fail('bad_request', `Interval ${start}s+${duration}s must lie within the ${this.episode.durationSec}s episode and last at least 1s`);
    if (duration < seg.minDuration || duration > seg.maxDuration) fail('out_of_bounds', `${seg.title} must stay between ${seg.minDuration}s and ${seg.maxDuration}s`);
    const clash = this.confirmedBookings().find(b => b.segmentId !== segmentId && b.start < start + duration && start < b.start + b.duration);
    if (clash) fail('slot_taken', `Interval overlaps the confirmed ${this.state.segments[clash.segmentId].title}`, {clash: clone(clash)});
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
    seg.assets = assets; seg.revision++; seg.state = 'submitted'; seg.approval = null;
    this.indexMedia(hash, meta);
    this.log(actor, 'asset_replaced', `${seg.title}: media ${assetId} replaced; revision ${seg.revision} needs review`, {segmentId, revision: seg.revision});
    this.contentChanged(actor, `${seg.title} media replaced`, [segmentId]);
    return clone(seg);
  }
  // ---------- creator interviews and library (3.2) ----------
  // Private by default and owner-scoped: a person sees their own; their agent acts for them; nobody else (not the
  // producer, not other creators or agents) can read them. Unknown and foreign ids both read as "not found".
  ownerOf(actor) { return actor?.type === 'agent' ? this.agent(actor.id).ownerId : this.requireHuman(actor).id; }
  library(ownerId) { this.state.library ??= {}; return this.state.library[ownerId] ??= {media: {}}; }
  libraryMedia(ownerId) { return Object.values(this.library(ownerId).media).filter(m => m.status !== 'withdrawn'); }
  interviewFor(actor, id) {
    const iv = this.state.interviews?.[id];
    if (!iv || iv.status === 'deleted' || iv.ownerId !== this.ownerOf(actor)) fail('not_found', `No interview ${id}`);
    return iv;
  }
  ivCtx(ownerId) { const lib = this.libraryMedia(ownerId); return {library: lib, mediaOwned: id => lib.some(m => m.id === id), person: this.state.people[ownerId]}; }
  ivCall(fn) { try { return fn(); } catch (e) { if (e instanceof Interview.InterviewError) fail(e.code, e.message); throw e; } }
  startInterview(actor) {
    const ownerId = this.ownerOf(actor);
    if (this.state.people[ownerId].role !== 'creator') fail('forbidden', 'Interviews are for creators');
    this.state.interviews ??= {};
    const id = `IV${(this.state.counters.interview = (this.state.counters.interview || 0) + 1)}`;
    this.state.interviews[id] = Interview.createInterview({id, ownerId, startedBy: actor.id, now: this.now()});
    this.log(actor, 'interview_started', `${this.state.people[ownerId].name}: interview ${id} started${actor.type === 'agent' ? ` by ${this.agent(actor.id).label}` : ''}`, {interviewId: id, private: true});
    return this.interviewView(actor, id);
  }
  interviewView(actor, id) {
    const iv = this.interviewFor(actor, id);
    return {id: iv.id, status: iv.status, step: iv.step, prompt: Interview.nextPrompt(iv), questions: Interview.STEPS.map(st => Interview.promptFor(iv, st.id)), consent: iv.consent || {voice: false}, answers: iv.answers, brief: iv.brief, history: iv.history, briefRevisions: iv.briefRevisions, updatedAt: iv.updatedAt};
  }
  interviewAct(actor, id, action, body = {}) {
    const iv = this.interviewFor(actor, id), by = actor.id, now = this.now(), ctx = this.ivCtx(iv.ownerId), wasApproved = iv.status === 'approved';
    const human = actor.type === 'person';
    if (['approve', 'withdraw', 'quotes'].includes(action) && !human) fail('forbidden', 'Only the creator can approve, choose quotes or withdraw; an agent can prepare answers');
    this.ivCall(() => {
      if (action === 'answer') Interview.answer(iv, {stepId: body.stepId, text: body.text, fields: body.fields, clear: body.clear === true, source: human ? (body.source === 'voice' ? 'voice' : 'typed') : 'agent', by, now, transcript: human && body.source === 'voice' ? body.transcript : null}, ctx);
      else if (action === 'skip') Interview.skip(iv, {stepId: body.stepId, by, now}, ctx);
      else if (action === 'goto') Interview.goTo(iv, {stepId: body.stepId, by, now});
      else if (action === 'review') Interview.review(iv, ctx, {now});
      else if (action === 'quotes') Interview.setQuotes(iv, {quotes: body.quotes, by, now}, ctx);
      else if (action === 'approve') Interview.approve(iv, {version: body.version, hash: body.hash, by, now});
      else if (action === 'withdraw') Interview.withdraw(iv, {by, now, reason: body.reason});
      else fail('bad_request', 'Unknown interview action');
      // Reaching the end of the questions (by answering or skipping) drafts the brief straight away.
      if (iv.status === 'review' && !iv.brief) { Interview.review(iv, ctx, {now}); action = 'review'; }
    });
    // Only the fact that something happened is logged publicly, never the content.
    if (action === 'review') this.log(actor, 'brief_drafted', `${this.state.people[iv.ownerId].name}: creator brief ${id} draft v${iv.brief?.version}`, {interviewId: id, private: true});
    if (action === 'approve' || action === 'withdraw') this.log(actor, `brief_${action === 'approve' ? 'approved' : 'withdrawn'}`, `${this.state.people[iv.ownerId].name}: creator brief ${id} ${action === 'approve' ? `v${iv.brief.version} approved by the creator` : 'withdrawn by the creator'}`, {interviewId: id});
    if (action === 'withdraw') this.briefWithdrawn(actor, iv);
    else if (wasApproved && iv.status !== 'approved') this.briefWithdrawn(actor, iv, 'the creator changed the approved brief');
    return this.interviewView(actor, id);
  }
  // Spoken answers need the creator's explicit consent, per interview, revocable. The text shown is versioned.
  interviewConsent(actor, id, {voice}) {
    this.requireHuman(actor);
    const iv = this.interviewFor(actor, id);
    iv.consent = {voice: voice === true, at: this.now(), by: actor.id, text: 'voice-v1'};
    iv.history.push({at: this.now(), by: actor.id, action: voice === true ? 'voice_consent_given' : 'voice_consent_revoked'});
    return {consent: clone(iv.consent)};
  }
  // Media: upload acceptance and the technical check (server) are separate from the rights declaration (creator),
  // editorial review (producer, per segment revision) and broadcast authorisation (publication + start checks).
  addLibraryMedia(actor, {sha256: hash, file, kind, technical, title, filename, bytes}) {
    const person = this.requireHuman(actor), lib = this.library(person.id);
    const id = `M${(this.state.counters.media = (this.state.counters.media || 0) + 1)}`;
    lib.media[id] = {id, ownerId: person.id, kind, sha256: hash, file, title: Interview.cleanText(title || filename, 200), filename: Interview.cleanText(filename, 200), bytes, technical, rights: null, status: 'accepted', at: this.now(), history: [{at: this.now(), by: actor.id, action: 'uploaded'}]};
    this.log(actor, 'library_media_added', `${person.name} added a ${kind} file to their private library`, {private: true});
    return clone(lib.media[id]);
  }
  mediaOf(actor, id) { const person = this.requireHuman(actor), m = this.library(person.id).media[id]; if (!m) fail('not_found', `No media ${id}`); return m; }
  // A declaration by the creator, not proof of ownership. Each permitted use is explicit.
  declareRights(actor, id, {publicBroadcast, editing, replays, promoExcerpts, statement, confirm}) {
    const m = this.mediaOf(actor, id);
    if (m.status === 'withdrawn') fail('closed', 'This file was withdrawn');
    if (confirm !== true) fail('rights_required', 'Confirm that you own this work or are licensed to grant these uses');
    const rights = {publicBroadcast: publicBroadcast === true, editing: editing === true, replays: replays === true, promoExcerpts: promoExcerpts === true, statement: Interview.cleanText(statement, 500), declaredBy: actor.id, at: this.now(), verified: false};
    const lostBroadcast = m.rights?.publicBroadcast && !rights.publicBroadcast;
    const changed = ['publicBroadcast', 'editing', 'replays', 'promoExcerpts'].some(k => !!m.rights?.[k] !== rights[k]);
    m.rights = rights; m.history.push({at: this.now(), by: actor.id, action: 'rights_declared', rights: {...rights, statement: undefined}});
    this.log(actor, 'rights_declared', `${this.state.people[m.ownerId].name} declared uses for a library file: ${['publicBroadcast', 'editing', 'replays', 'promoExcerpts'].filter(k => rights[k]).join(', ') || 'none'}`, {private: true});
    if (lostBroadcast) this.mediaPermissionLost(actor, m, 'broadcast permission withdrawn by the creator');
    // A brief records the uses of its files: a changed declaration reopens it (its approval no longer counts).
    if (changed) for (const iv of Object.values(this.state.interviews || {}).filter(i => i.ownerId === m.ownerId && ['approved', 'review'].includes(i.status) && i.brief?.media.some(x => x.id === m.id))) {
      const was = iv.status;
      Interview.refresh(iv, {by: actor.id, now: this.now(), reason: 'declared uses of a file changed'}, this.ivCtx(iv.ownerId));
      if (was === 'approved' && iv.status !== 'approved') this.briefWithdrawn(actor, iv, 'the declared uses of a file in the brief changed');
    }
    return clone(m);
  }
  withdrawLibraryMedia(actor, id) {
    const m = this.mediaOf(actor, id);
    m.status = 'withdrawn'; m.history.push({at: this.now(), by: actor.id, action: 'withdrawn'});
    this.log(actor, 'library_media_withdrawn', `${this.state.people[m.ownerId].name} withdrew a library file`, {private: true});
    this.mediaPermissionLost(actor, m, 'file withdrawn by the creator');
    return clone(m);
  }
  // Segments built from this file lose authorisation; a ready publication (or one counting down) that contains them
  // is withdrawn before air (N04). Bytes are kept for audit.
  mediaPermissionLost(actor, m, note) {
    for (const seg of Object.values(this.state.segments)) if (seg.assets.some(a => a.libraryMediaId === m.id)) {
      this.log(actor, 'segment_unauthorised', `${seg.title}: ${note}; it cannot be published or aired`, {segmentId: seg.id});
      this.withdrawIfPublished(actor, seg, 'rejected', note);
    }
  }
  // Segment preparation: the creator turns their approved brief and authorised library files into their own segment.
  // A new revision that needs content review; only air-facing brief fields enter the (public) programme.
  // The creator, or the creator's own agent, may prepare: every input (brief, files, uses) was approved or declared
  // by the creator, and the result is a new revision the producer must review. Other people and agents: refused.
  prepareSegment(actor, {interviewId, segmentId, assets = {}}) {
    const person = this.person(this.ownerOf(actor)), iv = this.interviewFor(actor, interviewId), seg = this.segment(segmentId);
    if (seg.ownerId !== person.id) fail('forbidden', `Only ${this.state.people[seg.ownerId].name} can prepare ${seg.title}`);
    if (iv.status !== 'approved') fail('brief_not_approved', 'Approve your brief first');
    const briefMedia = new Set(iv.brief.media.map(m => m.id)), replaced = [];
    for (const [assetId, mediaId] of Object.entries(assets)) {
      const slot = seg.assets.find(a => a.id === assetId) || fail('bad_request', `${seg.title} has no asset ${assetId}`);
      const m = this.library(person.id).media[mediaId];
      if (!m || m.status === 'withdrawn') fail('not_found', `No media ${mediaId}`);
      if (!briefMedia.has(m.id)) fail('bad_request', `${m.title} is not part of your approved brief`);
      if (!m.technical?.decodable) fail('undecodable_media', `${m.title} did not pass the technical check: ${m.technical?.reason}`);
      if (!m.rights?.publicBroadcast) fail('rights_required', `${m.title}: public broadcast is not among the uses you declared`);
      if (m.kind !== slot.kind) fail('bad_request', `${assetId} needs ${slot.kind === 'audio' ? 'an audio file' : 'an image'}`);
      if (trims(seg, m.technical?.durationSec) && !m.rights.editing) fail('rights_required', `${m.title}: only part of it would air (${seg.duration} s of ${Math.round(m.technical.durationSec)} s); that needs your "editing" permission`);
      replaced.push([assetId, m]);
    }
    for (const [assetId, m] of replaced) {
      const asset = {id: assetId, kind: m.kind, sha256: m.sha256, file: m.file, upload: true, libraryMediaId: m.id, title: iv.brief.work.title || m.title, credit: iv.brief.creator.displayName,
        license: `Creator-declared uses: ${['publicBroadcast', 'editing', 'replays', 'promoExcerpts'].filter(k => m.rights[k]).join(', ')}`, rightsDeclared: true,
        decodable: true, verification: {method: m.technical.method, sha256: m.sha256}, ...(m.technical.durationSec ? {durationSec: m.technical.durationSec} : {}), ...(m.technical.width ? {width: m.technical.width, height: m.technical.height} : {})};
      seg.assets = [...seg.assets.filter(a => a.id !== assetId), asset];
      this.indexMedia(m.sha256, {...asset, ownerId: person.id}); // private (owner, producer) until it is published
    }
    const b = iv.brief;
    seg.content = {...seg.content, brief: {interviewId: iv.id, version: b.version, hash: b.hash, displayName: b.creator.displayName, title: b.work.title, category: b.work.category, aiInvolvement: b.process.aiInvolvement, quotes: b.story.quotes}};
    seg.revision++; seg.state = 'submitted'; seg.approval = null;
    this.log(actor, 'segment_prepared', `${actor.type === 'agent' ? `${this.agent(actor.id).label} (for ${person.name})` : person.name} prepared ${seg.title} from ${person.name}'s approved brief (v${b.version})${replaced.length ? ` with ${replaced.length} authorised file(s)` : ''}; revision ${seg.revision} needs content review`, {segmentId, revision: seg.revision});
    this.contentChanged(actor, `${seg.title} prepared from a creator brief`, [segmentId]);
    return clone(seg);
  }
  // Broadcast authorisation of a prepared segment: its brief is still approved at the prepared version, and every
  // library file in it is still offered for public broadcast. Checked at review, publication and start.
  permissionProblems(seg) {
    const out = [], ref = seg.content?.brief;
    if (ref) {
      const iv = this.state.interviews?.[ref.interviewId];
      if (!iv || iv.status === 'withdrawn') out.push(`${seg.title}: the creator withdrew its brief`);
      else if (iv.status !== 'approved' || iv.brief.version !== ref.version) out.push(`${seg.title}: the brief changed since this segment was prepared; prepare it again`);
    }
    for (const a of seg.assets.filter(x => x.libraryMediaId)) {
      const m = this.state.library?.[seg.ownerId]?.media[a.libraryMediaId];
      if (!m || m.status === 'withdrawn') out.push(`${seg.title}: ${a.id} was withdrawn by its creator`);
      else if (!m.rights?.publicBroadcast) out.push(`${seg.title}: ${a.id} has no public-broadcast permission`);
      else if (a.kind === 'audio' && a.id === seg.content?.assetId && trims(seg, a.durationSec) && !m.rights.editing) out.push(`${seg.title}: only part of ${a.id} would air and its creator did not allow editing`);
    }
    return out;
  }
  briefWithdrawn(actor, iv, why = 'the creator withdrew the brief') {
    for (const seg of Object.values(this.state.segments)) if (seg.content?.brief?.interviewId === iv.id) {
      this.log(actor, 'segment_unauthorised', `${seg.title}: ${why}; it cannot be published or aired until it is approved and prepared again`, {segmentId: seg.id});
      this.withdrawIfPublished(actor, seg, 'rejected', why);
    }
  }
  // Deletion (the creator only). Interview: answers, transcripts, history and the private brief are erased; a dated
  // tombstone remains. A brief prepared into the programme is withdrawn first (the programme can no longer air it);
  // fields that already went out in a publication stay only in that publication's record. Library file: removed with
  // its bytes, unless it is part of a segment or publication (then: kept for audit, withdraw it instead).
  deleteInterview(actor, id) {
    this.requireHuman(actor);
    const iv = this.interviewFor(actor, id);
    if (iv.status !== 'withdrawn') { Interview.withdraw(iv, {by: actor.id, now: this.now(), reason: 'deleted by the creator'}); this.briefWithdrawn(actor, iv); }
    this.state.interviews[id] = {id, ownerId: iv.ownerId, status: 'deleted', deletedAt: this.now(), deletedBy: actor.id};
    this.log(actor, 'interview_deleted', `${this.state.people[iv.ownerId].name} deleted interview ${id}`, {private: true});
    return {id, status: 'deleted'};
  }
  deleteLibraryMedia(actor, id) {
    const m = this.mediaOf(actor, id), inUse = this.state.media?.[m.sha256] || Object.values(this.state.segments).some(s => s.assets.some(a => a.libraryMediaId === id));
    if (inUse) fail('in_use', `${m.title} is part of a programme or publication and is kept for audit; withdraw it instead`);
    delete this.library(m.ownerId).media[id];
    this.log(actor, 'library_media_deleted', `${this.state.people[m.ownerId].name} deleted a library file`, {private: true});
    const stillUsed = Object.values(this.state.library || {}).some(l => Object.values(l.media).some(x => x.file === m.file));
    return {id, deleted: true, removeFile: stillUsed ? null : m.file};
  }
  libraryView(actor) {
    const ownerId = this.ownerOf(actor);
    return {media: Object.values(this.library(ownerId).media).map(m => ({...clone(m), file: undefined})),
      briefs: Object.values(this.state.interviews || {}).filter(iv => iv.ownerId === ownerId && iv.status !== 'deleted').map(iv => ({interviewId: iv.id, status: iv.status, brief: iv.brief && {version: iv.brief.version, status: iv.brief.status, displayName: iv.brief.creator.displayName, title: iv.brief.work.title, missing: iv.brief.missing}, lifecycle: this.briefLifecycle(iv)}))};
  }
  briefLifecycle(iv) {
    const seg = Object.values(this.state.segments).find(s => s.content?.brief?.interviewId === iv.id), b = this.state.broadcast;
    const steps = [['interview', true], ['draft', !!iv.brief], ['creator_approved', iv.status === 'approved' || !!seg], ['segment_prepared', !!seg], ['content_reviewed', !!seg && this.approvalValid(seg)],
      ['airtime_requested', !!seg && Object.values(this.state.proposals).some(p => [...p.changes, ...p.concessions].some(c => c.segmentId === seg.id))], ['booking_confirmed', !!seg && this.state.bookings[seg.id]?.state === 'confirmed'],
      ['published', !!seg && !!b.manifest?.segments.some(x => x.id === seg.id)], ['on_air', !!seg && ['on_air', 'completed'].includes(b.state) && !!b.manifest?.segments.some(x => x.id === seg.id)]];
    return {withdrawn: iv.status === 'withdrawn', segmentId: seg?.id || null, steps: steps.map(([step, done]) => ({step, done}))};
  }

  // ---------- voice (3.2) ----------
  // Who may put words in a segment's mouth: its owner, or the producer for house segments. Checked before any
  // render is paid for. Agents never render or approve; people do.
  requireVoiceRights(actor, segmentId) {
    const person = this.requireHuman(actor), seg = this.segment(segmentId);
    if (seg.ownerId !== person.id && !(seg.house && person.role === 'producer')) fail('forbidden', `Only ${seg.house ? 'the producer' : 'the owner'} can voice ${seg.title}`);
    if (seg.module !== 'host') fail('bad_request', `${seg.title} has no spoken part (only host segments can be voiced yet)`);
    return seg;
  }
  // A rendered voice is a new asset: a new revision whose exact audio bytes need review like any other media.
  setVoice(actor, {segmentId, lines, lang, asset}) {
    const seg = this.requireVoiceRights(actor, segmentId);
    const voiceAsset = {id: 'voice', kind: 'audio', upload: true, rightsDeclared: true, declaredBy: actor.id, title: `${seg.title}: voice`, credit: `Synthetic voice (${asset.voice.provider})`, license: 'Rendered for ECHO', ...asset};
    seg.assets = [...seg.assets.filter(a => a.id !== 'voice'), voiceAsset];
    seg.content = {...seg.content, voice: {assetId: 'voice', lang, lines: clone(lines)}};
    seg.revision++; seg.state = 'submitted'; seg.approval = null;
    this.indexMedia(asset.sha256, voiceAsset);
    this.log(actor, 'voice_rendered', `${seg.title}: ${lines.length} line(s) voiced by ${asset.voice.provider}${asset.voice.cacheHit ? ' (cached)' : ''}; revision ${seg.revision} needs review of this exact audio`, {segmentId, revision: seg.revision, sha256: asset.sha256, provider: asset.voice.provider});
    this.contentChanged(actor, `${seg.title} voice rendered`, [segmentId]);
    return clone(seg);
  }
  // Content changed outside a proposal: the programme gets a new revision, open proposals are rebased onto it
  // (durations are unaffected) and every approval already given for them is void, because people approved
  // what they saw before the change.
  contentChanged(actor, reason, segmentIds) {
    const from = this.state.showRevision;
    this.state.showRevision++;
    this.state.revisions.push({revision: this.state.showRevision, baseRevision: from, proposalId: null, reason, segmentIds, at: this.now(), schedule: this.layout(), diff: []});
    for (const p of Object.values(this.state.proposals).filter(p => OPEN_PROPOSAL.has(p.status))) {
      const hadApprovals = Object.keys(p.approvals || {}).length > 0;
      p.baseRevision = this.state.showRevision;
      if (p.status === 'awaiting_approval') { p.history.push({version: p.version, changes: clone(p.changes), voidedBy: reason}); p.version++; p.approvals = {}; p.segmentRevisions = this.segmentRevisions(p); }
      this.log({type: 'system', id: 'showrunner'}, 'approvals_reset', `${reason}: ${p.id} rebased on r${this.state.showRevision}${hadApprovals ? `; earlier approvals are void, please approve v${p.version}` : ''}`, {proposalId: p.id});
    }
  }
  indexMedia(hash, meta = {}) {
    // Append-only: a published manifest can always fetch the exact bytes it was approved with. A creator's library
    // file stays private (owner and producer only) until it is part of a publication.
    this.state.media ??= {};
    this.state.media[hash] ??= {file: meta.file, upload: !!meta.upload, kind: meta.kind, at: this.now(), ...(meta.libraryMediaId ? {private: true, ownerId: meta.ownerId} : {})};
  }
  segmentRevisions(proposal) {
    const ids = new Set([...proposal.changes, ...proposal.concessions, ...proposal.houseChanges].map(c => c.segmentId));
    return Object.fromEntries([...ids].map(id => [id, this.state.segments[id].revision]));
  }
  reviewSegment(actor, {segmentId, revision, decision, note = ''}) {
    this.requireProducer(actor);
    const seg = this.segment(segmentId);
    if (revision !== seg.revision) fail('stale_revision', `Review is for revision ${revision}; current is ${seg.revision}`, {current: seg.revision});
    if (!['approved', 'needs_changes', 'rejected'].includes(decision)) fail('bad_request', 'Unknown review decision');
    if (decision === 'approved' && seg.assets.some(a => !a.rightsDeclared)) fail('rights_required', 'Every asset needs declared rights before approval');
    if (decision === 'approved' && this.permissionProblems(seg).length) fail('rights_required', this.permissionProblems(seg).join('; '));
    if (decision === 'approved' && seg.assets.some(a => !playable(a))) fail('undecodable_media', `${seg.title} cannot be approved: ${seg.assets.filter(a => !playable(a)).map(whyUnplayable).join('; ')}`);
    // A revision that was turned down stays turned down: corrected content (a new revision) must be reviewed instead.
    if (decision === 'approved' && seg.declined?.revision === seg.revision)
      fail('rejected_revision', `${seg.title} r${seg.revision} was ${seg.declined.decision === 'rejected' ? 'rejected' : 'sent back for changes'}; submit corrected content (a new revision) for review`);
    seg.state = decision;
    seg.approval = decision === 'approved' ? {revision: seg.revision, assetHashes: seg.assets.map(a => a.sha256).sort(), by: actor.id, at: this.now()} : null;
    seg.reviewNote = note;
    this.log(actor, 'segment_reviewed', `${seg.title} r${revision}: ${decision}${note ? ` — ${note}` : ''}`, {segmentId, revision});
    if (decision !== 'approved') { seg.declined = {revision: seg.revision, decision, at: this.now()}; this.withdrawIfPublished(actor, seg, decision, note); }
    return clone(seg);
  }
  // N04 policy (approved by the product owner, option 1): turning down content that is part of the ready
  // publication withdraws that publication before air. Nothing else changes: no airtime, no other segment,
  // no media. On air, playback is never interrupted automatically; the producer keeps Stop broadcast.
  // "Before air" includes the Starting countdown: Go live schedules a start (state on_air, onAirAt in the future),
  // and until that instant on the server clock the start is only pending, so a rejection cancels it.
  withdrawIfPublished(actor, seg, decision, note) {
    const b = this.state.broadcast, m = b.manifest;
    if (!m?.segments.some(x => x.id === seg.id && x.revision === seg.revision)) return;
    const reason = note || `${seg.title} r${seg.revision} ${decision === 'rejected' ? 'rejected' : 'needs changes'} in editorial review`;
    const pendingStart = b.state === 'on_air' && this.now() < b.onAirAt;
    if (b.state === 'ready' || pendingStart) {
      const record = {publicationId: m.publicationId, publishRevision: m.publishRevision, hash: m.hash, segmentId: seg.id, segmentRevision: seg.revision, decision, reason, by: actor.id, at: this.now(),
        ...(pendingStart ? {cancelledStartAt: b.onAirAt} : {})};
      (this.state.withdrawals ??= {})[m.publicationId] = record;
      this.state.broadcast = {state: 'queued', publicationId: null, publishRevision: null, manifest: null, onAirAt: null, withdrawn: record};
      this.log(actor, 'publication_withdrawn', `Publication #${m.publicationId} (revision ${m.publishRevision}) withdrawn before air by ${this.state.people[actor.id].name}${pendingStart ? `, cancelling its start in ${((b.onAirAt - this.now()) / 1000).toFixed(1)}s` : ''}: ${reason}`,
        {publicationId: m.publicationId, revision: m.publishRevision, segmentId: seg.id, reason, ...(pendingStart ? {cancelledStartAt: b.onAirAt} : {})});
    } else if (b.state === 'on_air') {
      this.log(actor, 'rejected_on_air', `${seg.title} turned down while publication #${m.publicationId} is on air: ${reason}. Playback continues; use Stop broadcast to interrupt.`,
        {publicationId: m.publicationId, revision: m.publishRevision, segmentId: seg.id, reason});
    }
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
    proposal.segmentRevisions = this.segmentRevisions(proposal);
    proposal.preview = this.layout(this.proposedDurations(proposal));
    this.log({type: 'system', id: 'showrunner'}, 'proposal_ready', `${reason} Waiting for: ${proposal.requiredApprovals.map(id => this.state.people[id].name).join(', ')}.`, {proposalId: proposal.id});
  }
  // Humans approve an exact proposal version. The commit re-checks every invariant at that moment.
  decideProposal(actor, {proposalId, version, decision, note = ''}) {
    const person = this.requireHuman(actor), proposal = this.proposal(proposalId);
    if (proposal.status !== 'awaiting_approval') fail('closed', `Proposal is ${proposal.status}`);
    if (version !== proposal.version) fail('stale_revision', `You reviewed version ${version}; current is ${proposal.version}`);
    if (!proposal.requiredApprovals.includes(person.id)) fail('forbidden', 'Your approval is not required for this proposal');
    this.requireUnchangedSegments(proposal);
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
  // Defence in depth: a proposal can only be approved or committed against the segment revisions it was shown with.
  requireUnchangedSegments(proposal) {
    const now = this.segmentRevisions(proposal), then = proposal.segmentRevisions || {};
    const changed = Object.keys(now).filter(id => now[id] !== then[id]);
    if (changed.length) fail('stale_revision', `${changed.map(id => this.state.segments[id].title).join(', ')} changed after this version was prepared; approvals must be given again`, {changed});
  }
  commit(proposal) {
    this.requireUnchangedSegments(proposal);
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
  // Media URLs are content-addressed, so viewers always receive exactly the approved bytes.
  publish(actor, {host = {}} = {}) {
    this.requireProducer(actor);
    if (Object.values(this.state.proposals).some(p => OPEN_PROPOSAL.has(p.status))) fail('busy', 'Finish or withdraw open proposals before publishing');
    if (this.state.broadcast.state === 'on_air') fail('on_air', 'A broadcast is on air');
    const problems = this.violations(this.durations());
    const unapproved = this.layout().filter(e => e.duration > 0 && !this.approvalValid(this.state.segments[e.segmentId])).map(e => this.state.segments[e.segmentId].title);
    const unplayable = [];
    for (const e of this.layout().filter(e => e.duration > 0)) {
      const seg = this.state.segments[e.segmentId];
      // Fail closed: only media positively verified as decodable can be published.
      for (const a of seg.assets) if (!playable(a)) unplayable.push(`${seg.title}: ${whyUnplayable(a)}`);
      unplayable.push(...this.permissionProblems(seg));
      const audio = seg.module === 'music' && seg.assets.find(a => a.id === seg.content?.assetId);
      if (audio?.durationSec !== undefined && audio.durationSec + .05 < (seg.content.offset || 0) + e.duration)
        unplayable.push(`${seg.title}: audio is ${audio.durationSec.toFixed(1)}s but the slot needs ${(seg.content.offset || 0) + e.duration}s`);
    }
    if (problems.length || unapproved.length || unplayable.length) fail('not_publishable', `Cannot publish: ${[...problems.map(p => p.rule), ...unapproved.map(t => `${t} not approved for its current revision`), ...unplayable].join('; ')}`, {problems, unapproved, unplayable});
    const segments = this.layout().filter(e => e.duration > 0).map(e => {
      const seg = this.state.segments[e.segmentId];
      return {id: seg.id, module: seg.module, title: seg.title, owner: this.state.people[seg.ownerId].name, ownerId: seg.ownerId, start: e.start, duration: e.duration, revision: seg.revision,
        confirmed: this.state.bookings[seg.id]?.state === 'confirmed', content: {...clone(seg.content || {}), ...(host[seg.id] ? {host: clone(host[seg.id])} : {})},
        assets: seg.assets.map(a => ({id: a.id, sha256: a.sha256, url: `/media/${a.sha256}`, title: a.title, credit: a.credit, license: a.license, source: a.source, kind: a.kind}))};
    });
    // publicationId is never reused (it survives rehearsal resets); publishRevision names the programme revision.
    this.state.counters.publication = (this.state.counters.publication || 0) + 1;
    const body = {episodeId: this.episode.id, title: this.episode.title, durationSec: this.episode.durationSec, publicationId: this.state.counters.publication, publishRevision: this.state.showRevision, segments};
    const manifest = {...body, hash: sha256(canonical(body)), publishedAt: this.now(), publishedBy: actor.id};
    for (const seg of segments) for (const a of seg.assets) if (this.state.media?.[a.sha256]?.private) this.state.media[a.sha256].private = false; // published: public by hash
    this.state.broadcast = {state: 'ready', publicationId: manifest.publicationId, publishRevision: this.state.showRevision, manifest, onAirAt: null};
    this.log(actor, 'published', `Publication #${manifest.publicationId} of revision ${this.state.showRevision} published (${manifest.hash.slice(0, 12)})`, {revision: this.state.showRevision});
    return clone(manifest);
  }
  // The producer goes live with the exact publication they reviewed, and only if it is still the current programme.
  goLive(actor, {delayMs = 3000, publicationId, hash} = {}) {
    this.requireProducer(actor);
    const b = this.state.broadcast, withdrawn = this.state.withdrawals?.[publicationId];
    if (withdrawn) fail('withdrawn', `Publication #${publicationId} was withdrawn before air by ${this.state.people[withdrawn.by]?.name || withdrawn.by} (${new Date(withdrawn.at).toISOString()}): ${withdrawn.reason}. Correct the content, have it reviewed and approved, then publish again.`, {withdrawal: clone(withdrawn)});
    if (b.state !== 'ready') fail('not_ready', `Broadcast is ${b.state}; publish an approved revision first`);
    if (publicationId !== b.manifest.publicationId || hash !== b.manifest.hash)
      fail('stale_manifest', `You confirmed publication #${publicationId ?? '?'}; the ready publication is #${b.manifest.publicationId} (${b.manifest.hash.slice(0, 10)}). Review it and go live again.`);
    if (b.publishRevision !== this.state.showRevision) fail('stale_manifest', `Publication #${b.manifest.publicationId} is revision ${b.publishRevision}, but the programme is now at revision ${this.state.showRevision}. Publish again.`);
    // Nothing unplayable starts: the server re-checks the actual bytes just before this call.
    const bad = b.manifest.segments.flatMap(x => this.state.segments[x.id].assets.filter(a => !playable(a)).map(a => `${x.title}: ${whyUnplayable(a)}`));
    if (bad.length) fail('undecodable_media', `Publication #${b.manifest.publicationId} cannot go live: ${bad.join('; ')}`, {unplayable: bad});
    const denied = b.manifest.segments.flatMap(x => this.permissionProblems(this.state.segments[x.id]));
    if (denied.length) fail('rights_required', `Publication #${b.manifest.publicationId} cannot go live: ${denied.join('; ')}`, {denied});
    if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 600000) fail('bad_request', 'delayMs must be 0–600000');
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
