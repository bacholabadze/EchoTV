// Episode checker (3.2): the Premiere #001 template is structurally valid and lists founder inputs as missing;
// broken episodes are refused with the reason. Durations below are test values, not programme decisions.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkEpisode} from '../../scripts/check-episode.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const template = () => JSON.parse(readFileSync(join(ROOT, 'episodes/premiere-001.template.json'), 'utf8'));

test('the template is valid, not ready, and every TBD is reported as a missing input', () => {
  const r = checkEpisode(template());
  assert.equal(r.valid, true, r.errors.join('\n')); assert.equal(r.ready, false);
  assert.ok(r.missing.includes('$.presenters[0].voices.elevenlabs')); assert.ok(r.missing.includes('$.segments[4].duration'));
  assert.equal(r.schedule, null, 'no schedule while durations are unknown');
});

test('with every input filled (test values), the running order and confirmed start are computed and checked', () => {
  const ep = template(), d = {intro: 20, 'art-intro': 10, art: 45, 'premiere-intro': 10, premiere: 60, discussion: 40, closing: 15};
  ep.durationSec = 200; ep.title.ka = 'ტესტი';
  for (const s of ep.segments) { s.duration = d[s.id]; s.title.ka = 'ტესტი'; for (const a of s.assets || []) if (a.count === 'TBD') a.count = 3; }
  for (const p of ep.people) p.name = 'Test'; for (const a of ep.agents) a.client = 'Claude Code';
  for (const p of ep.presenters) Object.assign(p, {name: 'Test', castActor: 'nova', voices: {elevenlabs: 'voice-id'}});
  ep.segments.find(s => s.id === 'premiere').start = 85;
  const r = checkEpisode(ep);
  assert.equal(r.ready, true, JSON.stringify(r, null, 1));
  assert.deepEqual(r.schedule.find(e => e.id === 'premiere'), {id: 'premiere', start: 85, duration: 60, confirmed: true});
  ep.segments.find(s => s.id === 'premiere').start = 90;
  assert.match(checkEpisode(ep).errors.join(), /declared start 90s, but the running order puts it at 85s/);
  ep.segments.find(s => s.id === 'premiere').start = 85; ep.durationSec = 199;
  assert.match(checkEpisode(ep).errors.join(), /add up to 200s, but durationSec is 199s/);
});

test('refused: AI video, video assets, voice outside host, an agent writing for someone else, missing rule, oversize lines', () => {
  const cases = [
    [ep => { ep.noAiVideo = false; }, /noAiVideo must be true/],
    [ep => { ep.segments[2].assets.push({kind: 'video', rightsDeclared: 'required'}); }, /asset kind "video" not allowed/],
    [ep => { ep.segments.push({id: 'clip', module: 'ai-video', owner: 'producer', duration: 10}); }, /module "ai-video" cannot air/],
    [ep => { ep.segments[2].spoken = {presenters: ['presenter-1'], writers: ['agent-art'], maxChars: 100}; }, /only supported on host segments/],
    [ep => { ep.segments[1].spoken.writers = ['agent-music']; }, /agent-music belongs to creator-music and may not write lines for creator-art's segment/],
    [ep => { delete ep.segments[5].spoken.rule; }, /only under a stated rule/],
    [ep => { ep.segments[1].spoken.lines = [{presenter: 'presenter-1', text: 'ა'.repeat(301), writtenBy: 'agent-art'}]; }, /301 characters exceed spoken.maxChars 300/],
    [ep => { ep.segments[1].spoken.lines = [{presenter: 'presenter-1', text: 'ტესტი', writtenBy: 'agent-music'}]; }, /written by agent-music, who is not a writer/],
    [ep => { ep.segments[0].owner = 'creator-art'; }, /house segments belong to the producer/],
    [ep => { ep.segments[3].id = 'art'; }, /duplicate id/],
  ];
  for (const [spoil, reason] of cases) {
    const ep = template(); spoil(ep);
    const r = checkEpisode(ep);
    assert.equal(r.valid, false, String(reason)); assert.match(r.errors.join('\n'), reason);
  }
});
