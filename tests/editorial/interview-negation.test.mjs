// Found during the editorial wave: a creator who chose "no AI" and wrote "AI არ გამომიყენებია" got a contradiction
// that could never be resolved, so the brief could never be approved. A denial agrees with "no AI"; a real mention does not.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as I from '../../server/interview.mjs';

const iv = (process) => {
  const x = I.createInterview({id: 'IV1', ownerId: 'creator-a', startedBy: 'creator-a', now: 0});
  I.answer(x, {stepId: 'who', text: 'ზეთის ფერწერა.', fields: {displayName: 'ნიკა', workTitle: 'ქალაქი', category: 'art'}, source: 'typed', by: 'creator-a', now: 1});
  I.skip(x, {stepId: 'inspiration', by: 'creator-a', now: 2});
  I.answer(x, {stepId: 'process', text: process, fields: {aiInvolvement: 'none'}, source: 'typed', by: 'creator-a', now: 3});
  return x;
};
test('"no AI" plus a sentence denying AI use is not a contradiction', () => {
  assert.deepEqual(I.contradictions(iv('ფანქრით დავხატე. AI არცერთ ეტაპზე არ გამომიყენებია.')), []);
  assert.deepEqual(I.contradictions(iv('Painted by hand, without AI.')), []);
});
test('"no AI" plus a real mention of an AI tool still asks the creator to clarify', () => {
  assert.equal(I.contradictions(iv('ფონი Midjourney-ით შევქმენი, დანარჩენი ხელით.')).length, 1);
});
