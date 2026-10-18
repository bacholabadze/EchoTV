// The §24 demonstration programme: 120 seconds, one confirmed premiere at 50s.
// Names, tokens and media are configuration; the rules are the same for any creators.
import {randomBytes} from 'node:crypto';
import {genitive} from './editorial.mjs';

const token = () => randomBytes(18).toString('base64url');

export function seedState({people = {}, media = {}} = {}) {
  const a = {id: 'creator-a', name: 'Creator A', role: 'creator', specialty: 'Art', ...people.a};
  const b = {id: 'creator-b', name: 'Creator B', role: 'creator', specialty: 'Music', ...people.b};
  const producer = {id: 'producer', name: 'ECHO Producer', role: 'producer', ...people.producer};
  for (const p of [a, b, producer]) p.token ??= token();
  const asset = (id, extra) => ({id, sha256: media[id]?.sha256 || `unhashed-${id}`, rightsDeclared: true, ...media[id], ...extra});
  const gallery = ['art-1', 'art-2', 'art-3'].map(id => asset(id, {kind: 'image'}));
  const segments = {
    intro: {id: 'intro', module: 'music', title: 'Music intro', ownerId: b.id, duration: 10, minDuration: 5, maxDuration: 10,
      assets: [asset('track', {kind: 'audio'})], content: {assetId: 'track', offset: 40, role: 'teaser'}},
    gallery: {id: 'gallery', module: 'art', title: 'Art gallery', ownerId: a.id, duration: 30, minDuration: 20, maxDuration: 45,
      assets: gallery, content: {slides: gallery.map(g => ({assetId: g.id, seconds: 10}))}},
    interstitial: {id: 'interstitial', module: 'host', title: 'ECHO interstitial', ownerId: producer.id, house: true, duration: 10, minDuration: 0, maxDuration: 10,
      assets: [], content: {line: 'interstitial'}},
    premiere: {id: 'premiere', module: 'music', title: 'Music premiere', ownerId: b.id, duration: 60, minDuration: 60, maxDuration: 60,
      assets: [asset('track', {kind: 'audio'})], content: {assetId: 'track', offset: 0, role: 'premiere'}},
    outro: {id: 'outro', module: 'host', title: 'Outro', ownerId: producer.id, house: true, duration: 10, minDuration: 10, maxDuration: 10,
      assets: [], content: {line: 'outro'}},
  };
  for (const seg of Object.values(segments)) {
    seg.revision = 1; seg.state = 'approved';
    seg.approval = {revision: 1, assetHashes: seg.assets.map(x => x.sha256).sort(), by: producer.id, at: 0, seeded: true};
  }
  return {
    schema: 1, seq: 0, showRevision: 1, counters: {proposal: 0, request: 0, publication: 0},
    media: Object.fromEntries(Object.values(media).filter(m => m.file).map(m => [m.sha256, {file: m.file, upload: false, kind: m.kind, at: 0}])),
    idempotency: {},
    episode: {id: 'one-premiere-three-roles', title: 'One premiere, three roles', durationSec: 120},
    people: {[a.id]: a, [b.id]: b, [producer.id]: producer},
    agents: {
      'agent-a': {id: 'agent-a', ownerId: a.id, label: `${a.name}'s agent`, token: token()},
      'agent-b': {id: 'agent-b', ownerId: b.id, label: `${b.name}'s agent`, token: token()},
    },
    order: ['intro', 'gallery', 'interstitial', 'premiere', 'outro'],
    segments,
    bookings: {premiere: {segmentId: 'premiere', start: 50, duration: 60, state: 'confirmed', confirmedBy: producer.id, confirmedAt: 0}},
    proposals: {}, requests: {},
    revisions: [{revision: 1, baseRevision: null, proposalId: null, at: 0, schedule: null, diff: []}],
    broadcast: {state: 'queued', publishRevision: null, manifest: null, onAirAt: null},
    audit: [],
  };
}

// Editorial wave: "AI-მ შექმნა. ვინ არის ავტორი?" — one guest creator, the producer, the guest's own agent and ECHO's
// editorial agent. The theme is fixed; the programme is not: until the producer approves a rundown, every house
// segment is an unapproved placeholder and the guest's segment holds no media, so nothing here can be published.
export function editorialSeed({people = {}, factPack = null, rehearsal = false} = {}) {
  const a = {id: 'creator-a', name: 'Creator A', role: 'creator', specialty: 'Music', ...people.a};
  const producer = {id: 'producer', name: 'ECHO Producer', role: 'producer', ...people.producer};
  for (const p of [a, producer]) p.token ??= token();
  const art = /art/i.test(a.specialty || '');
  const slot = (id, kind, extra = {}) => ({id, kind, sha256: `pending-${id}`, placeholder: true, title: '', ...extra});
  const work = art
    ? {id: 'work', module: 'art', title: 'სტუმრის ნამუშევარი', ownerId: a.id, duration: 30, minDuration: 15, maxDuration: 90,
      assets: [slot('work-image', 'image'), slot('process-image', 'image', {optional: true})], content: {slides: [{assetId: 'work-image', seconds: 15}, {assetId: 'process-image', seconds: 15}], role: 'work'}}
    : {id: 'work', module: 'music', title: 'სტუმრის ნამუშევარი', ownerId: a.id, duration: 45, minDuration: 15, maxDuration: 90,
      assets: [slot('track', 'audio')], content: {assetId: 'track', offset: 0, role: 'work'}};
  const house = (id, title, duration) => ({id, module: 'host', title, ownerId: producer.id, house: true, duration, minDuration: 0, maxDuration: 180, assets: [], content: {line: 'editorial-pending', placeholder: true}});
  const segments = {opening: house('opening', 'შესავალი (გეგმა ჯერ არ არის)', 50), work, after: house('after', 'საუბარი და კითხვა (გეგმა ჯერ არ არის)', 180 - 50 - work.duration)};
  for (const seg of Object.values(segments)) { seg.revision = 1; seg.state = 'draft'; seg.approval = null; }
  return {
    schema: 1, seq: 0, showRevision: 1, counters: {proposal: 0, request: 0, publication: 0, rundown: 0, question: 0},
    media: {}, idempotency: {},
    episode: {id: 'ai-authorship-001', title: 'AI-მ შექმნა. ვინ არის ავტორი?', durationSec: 180, format: 'editorial', workSegmentId: 'work', editorial: null, ...(rehearsal ? {rehearsal: true} : {})},
    people: {[a.id]: a, [producer.id]: producer},
    agents: {
      'agent-a': {id: 'agent-a', ownerId: a.id, label: `${genitive(a.name)} აგენტი`, token: token()},
      'agent-editor': {id: 'agent-editor', ownerId: producer.id, role: 'editor', label: 'ECHO-ს რედაქციის აგენტი', token: token()},
    },
    order: ['opening', 'work', 'after'], segments, bookings: {},
    proposals: {}, requests: {},
    revisions: [{revision: 1, baseRevision: null, proposalId: null, at: 0, schedule: null, diff: []}],
    broadcast: {state: 'queued', publishRevision: null, manifest: null, onAirAt: null},
    audit: [],
    editorialShares: {}, rundowns: {},
    facts: Object.fromEntries((factPack?.facts || []).map(f => [f.id, {...f, verified: null}])), factPackStatus: factPack?.status || null,
    qa: {questions: {}, selected: {}, consent: {}},
  };
}
