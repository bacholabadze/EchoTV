// The §24 demonstration programme: 120 seconds, one confirmed premiere at 50s.
// Names, tokens and media are configuration; the rules are the same for any creators.
import {randomBytes} from 'node:crypto';

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
