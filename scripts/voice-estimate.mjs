#!/usr/bin/env node
// Dry run before any paid voice call: which provider would render each unit, whether it is cached, and how many
// characters would be billed against the budget. Makes no network request.
// Usage: node scripts/voice-estimate.mjs <script.json> [dataDir]
//   script.json = {"lang": "ka", "units": [{"segmentId": "...", "lines": [{"presenter": "presenter-1", "text": "..."}]}]}
import {readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {voiceServiceFromEnv} from '../server/voice/index.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [file, dataDir = join(ROOT, 'data')] = process.argv.slice(2);
if (!file) { console.error('Usage: node scripts/voice-estimate.mjs <script.json> [dataDir]'); process.exit(1); }
const script = JSON.parse(readFileSync(file, 'utf8'));
const voice = voiceServiceFromEnv({root: ROOT, dataDir, probe: () => ({decodable: false})});
let billed = 0;
for (const unit of script.units) {
  const plan = voice.estimate({lines: unit.lines, lang: script.lang || 'en', ...(script.order ? {order: script.order} : {})});
  const first = plan.find(p => p.usable);
  billed += first?.billedChars || 0;
  console.log(`${unit.segmentId}: ${unit.lines.length} line(s) → ${first ? `${first.provider}${first.cached ? ' (cached)' : ''}, ${first.billedChars} billed chars` : 'no provider'}${plan.filter(p => !p.usable).map(p => `\n    skipped ${p.provider}: ${p.reason}`).join('')}`);
}
const b = voice.budget();
console.log(`\nTotal billed characters if rendered now: ${billed}. Budget: ${b.limitChars ? `${b.remainingChars} of ${b.limitChars} left` : 'not set (paid voices off)'}.`);
