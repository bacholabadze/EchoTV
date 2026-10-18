// Georgian refusals: real DomainError messages from the domain map to Georgian sentences with their dynamic parts
// (titles, numbers) kept; anything unknown falls back to a Georgian sentence for its code.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BroadcastDesk, DomainError, MEDIA_CHECKS} from '../../server/domain.mjs';
import {seedState} from '../../server/seed.mjs';
import {kaMessage} from '../../server/i18n-ka.mjs';

const A = {type: 'agent', id: 'agent-a'}, creatorA = {type: 'person', id: 'creator-a'}, producer = {type: 'person', id: 'producer'};
const verified = sha => ({decodable: true, probed: true, verification: {method: MEDIA_CHECKS[0], sha256: sha}});
function desk() { const s = seedState(); for (const seg of Object.values(s.segments)) for (const a of seg.assets) Object.assign(a, verified(a.sha256)); let t = 1000; return new BroadcastDesk(s, {now: () => (t += 10)}); }
const refusal = fn => { try { fn(); } catch (e) { if (e instanceof DomainError) return e; throw e; } assert.fail('expected a DomainError'); };
const georgian = s => /[ა-ჿ]/.test(s);
// No leftover English sentence words: only proper names, ids and technical names may stay in Latin script.
const englishLeft = (ka, allowed = []) => ka.replace(/„[^“]*“/g, '').split(/[^A-Za-z_-]+/).filter(w => w.length > 2 && !allowed.includes(w));

test('stale base: revision numbers are carried into the Georgian sentence', () => {
  const e = refusal(() => desk().proposeChange(A, {baseRevision: 7, changes: [{segmentId: 'gallery', duration: 45}]}));
  assert.equal(e.code, 'stale_base');
  const ka = kaMessage(e.code, e.message);
  assert.match(ka, /ვერსია 7/); assert.match(ka, /ვერსია 1-ზეა/);
  assert.deepEqual(englishLeft(ka), []);
});

test('out of bounds: the segment title and the limits are kept', () => {
  const d = desk(), seg = d.state.segments.gallery;
  const e = refusal(() => d.proposeChange(A, {baseRevision: 1, changes: [{segmentId: 'gallery', duration: seg.maxDuration + 50}]}));
  assert.equal(e.code, 'out_of_bounds');
  assert.equal(kaMessage(e.code, e.message), `სეგმენტი „${seg.title}“ უნდა გრძელდებოდეს ${seg.minDuration}-დან ${seg.maxDuration} წამამდე.`);
});

test('forbidden: an agent touching another creator\'s segment, and a creator acting as producer', () => {
  const d = desk();
  const e = refusal(() => d.proposeChange(A, {baseRevision: 1, changes: [{segmentId: 'premiere', duration: 50}]}));
  assert.equal(e.code, 'forbidden');
  const ka = kaMessage(e.code, e.message);
  assert.ok(ka.includes(d.state.agents['agent-a'].label) && ka.includes(`„${d.state.segments.premiere.title}“`), ka);
  assert.match(ka, /Showrunner-ს სთხოვე/);
  const p = refusal(() => d.publish(creatorA));
  assert.equal(kaMessage(p.code, p.message), 'ეს მხოლოდ პროდიუსერს შეუძლია.');
  const h = refusal(() => d.publish(A));
  assert.match(kaMessage(h.code, h.message), /მხოლოდ ადამიანს/);
});

test('not found and not ready', () => {
  const d = desk();
  const n = refusal(() => d.segment('nope'));
  assert.equal(kaMessage(n.code, n.message), 'სეგმენტი „nope“ ვერ მოიძებნა.');
  const r = refusal(() => d.goLive(producer, {delayMs: 0}));
  assert.equal(r.code, 'not_ready');
  assert.equal(kaMessage(r.code, r.message), 'ეთერი ჯერ არ არის მზად. ჯერ დამტკიცებული ვერსია გამოაქვეყნე.');
});

test('stale review revision and an unpublishable programme list their parts in Georgian', () => {
  const d = desk();
  const e = refusal(() => d.reviewSegment(producer, {segmentId: 'gallery', revision: 99, decision: 'approved'}));
  assert.equal(e.code, 'stale_revision');
  assert.match(kaMessage(e.code, e.message), /^შენ განიხილე ვერსია 99, მიმდინარე კი ვერსია \d+-ია\./);
  const ka = kaMessage('not_publishable', 'Cannot publish: episode_length; Art gallery not approved for its current revision; Art gallery: art-2 could not be decoded (bad header)');
  assert.equal(ka, 'ვერ გამოქვეყნდება: ეპიზოდის ჯამური ხანგრძლივობა არ ემთხვევა; „Art gallery“ მიმდინარე ვერსიით დამტკიცებული არ არის; „Art gallery“: ფაილი art-2 ვერ იკითხება.');
});

test('withdrawn publication keeps the producer name and the reason as written', () => {
  const msg = 'Publication #3 was withdrawn before air by ECHO Producer (2026-10-18T10:00:00.000Z): Rights for art-2 not confirmed. Correct the content, have it reviewed and approved, then publish again.';
  assert.equal(kaMessage('withdrawn', msg), 'გამოქვეყნება #3 ეთერამდე გააუქმა ECHO Producer. მიზეზი: Rights for art-2 not confirmed. შეასწორე შინაარსი, დაამტკიცებინე და ხელახლა გამოაქვეყნე.');
});

test('interview and server messages', () => {
  assert.equal(kaMessage('stale_version', 'You reviewed version 2; the brief is now version 3. Review it again.'), 'შენ ნახე ბრიფის ვერსია 2, ახლა კი ის ვერსია 3-ია. ხელახლა გადახედე.');
  assert.equal(kaMessage('incomplete', 'The brief still needs: workTitle, rights:m1'), 'ბრიფს ჯერ აკლია: ნამუშევრის სათაური, ფაილის უფლებები.');
  assert.equal(kaMessage('bad_request', 'Answers can be up to 60 seconds (this one is 75 s)'), 'პასუხი მაქსიმუმ 60 წამია (ეს ჩანაწერი 75 წმ-ია).');
  assert.equal(kaMessage('unauthorized', 'Missing or unknown token'), 'ბმული ვერ ვიცანი — შედი შენი პირადი ბმულით.');
  assert.equal(kaMessage('voice_unavailable', 'Daily speech budget reached. Type your answer instead.'), 'ხმოვანი პასუხი ახლა მიუწვდომელია — დაწერე პასუხი.');
  assert.equal(kaMessage('rights_required', 'Art gallery: the creator withdrew its brief; Art gallery: art-1 has no public-broadcast permission'), '„Art gallery“: ავტორმა ბრიფი გააუქმა; „Art gallery“: ფაილს art-1 საჯარო ეთერის ნებართვა არ აქვს.');
});

test('unknown messages fall back to a Georgian sentence per code, and to a generic one', () => {
  const codes = ['unauthorized', 'forbidden', 'not_found', 'bad_request', 'stale_base', 'stale_revision', 'stale_version', 'rights_required', 'media_selection_required', 'undecodable_media', 'not_publishable', 'busy', 'on_air', 'not_ready', 'stale_manifest', 'withdrawn', 'booking_confirmed', 'slot_taken', 'out_of_bounds', 'consent_required', 'voice_unavailable', 'transcription_failed', 'incomplete', 'brief_not_approved', 'closed', 'idempotency_conflict', 'too_large', 'invariant', 'rejected_revision', 'in_use'];
  for (const c of codes) { const ka = kaMessage(c, 'Something new the table does not know'); assert.ok(georgian(ka), `${c}: ${ka}`); assert.deepEqual(englishLeft(ka), [], `${c}: ${ka}`); }
  assert.equal(kaMessage('forbidden', 'A brand new refusal'), 'ამის გაკეთების უფლება არ გაქვს.');
  assert.equal(kaMessage('some_future_code', 'Whatever'), 'მოქმედება ვერ შესრულდა.');
  assert.equal(kaMessage('bad_request', undefined), 'მოთხოვნა არასწორია — შეამოწმე შეყვანილი მონაცემები.');
});
