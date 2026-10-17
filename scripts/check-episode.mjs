#!/usr/bin/env node
// Checks an ECHO episode file (schema echo.episode/1) before production: structure, ownership, who may write which
// lines, asset requirements, no AI video, spoken-unit size, confirmed slot and timing. Lists every "TBD" as a missing
// input instead of guessing it. Usage: node scripts/check-episode.mjs <episode.json>
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const MODULES = new Set(['host', 'art', 'music']); // what the 3.2 player can air; no video module, no AI video
const MAX_UNIT_CHARS = 2000;                        // ElevenLabs' recommended limit per dialogue request
const isTBD = v => v === 'TBD' || (typeof v === 'string' && v.startsWith('TBD'));

export function checkEpisode(ep) {
  const errors = [], warnings = [], missing = [];
  const walk = (v, path) => { if (isTBD(v)) missing.push(path); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, Array.isArray(v) ? `${path}[${k}]` : `${path}.${k}`); };
  walk(ep, '$');
  if (ep.schema !== 'echo.episode/1') errors.push(`schema must be "echo.episode/1" (got ${JSON.stringify(ep.schema)})`);
  if (ep.noAiVideo !== true) errors.push('noAiVideo must be true: ECHO does not generate video');
  const people = new Map((ep.people || []).map(p => [p.id, p])), agents = new Map((ep.agents || []).map(a => [a.id, a])), presenters = new Map((ep.presenters || []).map(p => [p.id, p]));
  if (![...people.values()].some(p => p.role === 'producer')) errors.push('a producer is required (publishes and approves house segments)');
  for (const a of agents.values()) if (!people.has(a.owner)) errors.push(`agent ${a.id}: owner ${a.owner} is not a person in this episode`);
  if (presenters.size < 2) warnings.push('fewer than two presenters');
  const ids = new Set();
  for (const s of ep.segments || []) {
    const at = `segment ${s.id}`;
    if (ids.has(s.id)) errors.push(`${at}: duplicate id`); ids.add(s.id);
    if (!MODULES.has(s.module)) errors.push(`${at}: module "${s.module}" cannot air (allowed: ${[...MODULES].join(', ')}; no AI video)`);
    const owner = people.get(s.owner);
    if (!owner) errors.push(`${at}: owner ${s.owner} is not a person in this episode`);
    if (s.house && owner?.role !== 'producer') errors.push(`${at}: house segments belong to the producer`);
    if (!isTBD(s.duration) && !(Number.isFinite(s.duration) && s.duration > 0)) errors.push(`${at}: duration must be a positive number of seconds or "TBD"`);
    for (const a of s.assets || []) {
      if (!['image', 'audio'].includes(a.kind)) errors.push(`${at}: asset kind "${a.kind}" not allowed (image, audio; creators upload existing media, nothing is generated)`);
      if (a.rightsDeclared !== 'required') errors.push(`${at}: every asset needs declared rights`);
    }
    if (s.module === 'music' && !(s.assets || []).some(a => a.kind === 'audio')) errors.push(`${at}: a music segment needs one audio asset`);
    if (s.module === 'art' && !(s.assets || []).some(a => a.kind === 'image')) errors.push(`${at}: an art segment needs images`);
    if (s.spoken) {
      if (s.module !== 'host') errors.push(`${at}: spoken lines are only supported on host segments (put presenter lines in an adjacent host segment)`);
      for (const p of s.spoken.presenters || []) if (!presenters.has(p)) errors.push(`${at}: presenter ${p} is not defined`);
      if (!(s.spoken.maxChars > 0 && s.spoken.maxChars <= MAX_UNIT_CHARS)) errors.push(`${at}: spoken.maxChars must be 1–${MAX_UNIT_CHARS} (one render unit)`);
      for (const w of s.spoken.writers || []) {
        const agent = agents.get(w);
        if (!agent) { errors.push(`${at}: writer ${w} is not an agent in this episode`); continue; }
        if (!s.house && agent.owner !== s.owner) errors.push(`${at}: ${w} belongs to ${agent.owner} and may not write lines for ${s.owner}'s segment`);
      }
      if (s.house && (s.spoken.writers || []).some(w => agents.get(w)?.owner !== s.owner) && !s.spoken.rule) errors.push(`${at}: creators' agents write in a house segment only under a stated rule (spoken.rule)`);
      for (const [i, line] of (s.spoken.lines || []).entries()) {
        if (!presenters.has(line.presenter)) errors.push(`${at}: line ${i} has unknown presenter ${line.presenter}`);
        if (line.writtenBy && !(s.spoken.writers || []).includes(line.writtenBy)) errors.push(`${at}: line ${i} written by ${line.writtenBy}, who is not a writer of this segment`);
      }
      const chars = (s.spoken.lines || []).reduce((n, l) => n + [...String(l.text || '')].length, 0);
      if (chars > s.spoken.maxChars) errors.push(`${at}: ${chars} characters exceed spoken.maxChars ${s.spoken.maxChars}`);
    }
  }
  const confirmed = (ep.segments || []).filter(s => s.booking === 'confirmed');
  if (!confirmed.length) warnings.push('no confirmed slot (the premiere is normally confirmed)');
  // Timing, when every duration is known: running order, confirmed start, total.
  let schedule = null;
  if ((ep.segments || []).every(s => Number.isFinite(s.duration))) {
    let at = 0; schedule = ep.segments.map(s => { const e = {id: s.id, start: at, duration: s.duration, confirmed: s.booking === 'confirmed'}; at += s.duration; return e; });
    if (Number.isFinite(ep.durationSec) && at !== ep.durationSec) errors.push(`segments add up to ${at}s, but durationSec is ${ep.durationSec}s`);
    for (const s of ep.segments.filter(x => Number.isFinite(x.start))) if (schedule.find(e => e.id === s.id).start !== s.start) errors.push(`segment ${s.id}: declared start ${s.start}s, but the running order puts it at ${schedule.find(e => e.id === s.id).start}s`);
  }
  return {valid: !errors.length, ready: !errors.length && !missing.length, errors, warnings, missing, schedule};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) { console.error('Usage: node scripts/check-episode.mjs <episode.json>'); process.exit(1); }
  const r = checkEpisode(JSON.parse(readFileSync(file, 'utf8')));
  console.log(`${file}: ${r.valid ? 'structure OK' : `${r.errors.length} error(s)`}${r.ready ? ', ready for production' : r.valid ? `, ${r.missing.length} input(s) still missing` : ''}`);
  for (const e of r.errors) console.log(`  ERROR    ${e}`);
  for (const w of r.warnings) console.log(`  warning  ${w}`);
  for (const m of r.missing) console.log(`  missing  ${m}`);
  if (r.schedule) console.log(`  schedule ${r.schedule.map(e => `${e.id} ${e.start}+${e.duration}${e.confirmed ? ' 🔒' : ''}`).join(' · ')}`);
  process.exit(r.valid ? 0 : 1);
}
