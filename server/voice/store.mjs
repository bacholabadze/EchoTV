// Voice cache and spending ledger. Files only; nothing here talks to a provider.
import {existsSync, readFileSync, writeFileSync, renameSync, mkdirSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {createHash} from 'node:crypto';

const sha256 = data => createHash('sha256').update(data).digest('hex');
const writeAtomic = (path, data) => { mkdirSync(dirname(path), {recursive: true}); const tmp = `${path}.tmp`; writeFileSync(tmp, data); renameSync(tmp, path); };

// Cache key = everything that changes the audio: provider, model, voices, settings, language, mode, seed, text.
// The same request never renders (or pays) twice.
export function cacheKey({provider, model, voiceIds, settings, lang, mode, seed, lines}) {
  return sha256(JSON.stringify({provider, model: model ?? null, voiceIds: voiceIds ?? null, settings: settings ?? null, lang, mode, seed: seed ?? null,
    lines: lines.map(l => [l.presenter ?? null, l.text])}));
}
export function createCache(dir) {
  mkdirSync(dir, {recursive: true});
  return {
    dir,
    audioPath: key => join(dir, `${key}.mp3`),
    get(key) {
      const meta = join(dir, `${key}.json`), audio = join(dir, `${key}.mp3`);
      if (!existsSync(meta)) return null;
      const entry = JSON.parse(readFileSync(meta, 'utf8'));
      if (entry.audio && !existsSync(audio)) return null;
      // The cached bytes must still be the ones recorded; otherwise render again.
      if (entry.audio && sha256(readFileSync(audio)) !== entry.sha256) return null;
      return {...entry, audioFile: entry.audio ? audio : null};
    },
    put(key, entry, audioBytes) {
      if (audioBytes) writeAtomic(join(dir, `${key}.mp3`), audioBytes);
      const record = {...entry, audio: !!audioBytes, ...(audioBytes ? {sha256: sha256(audioBytes)} : {})};
      writeAtomic(join(dir, `${key}.json`), JSON.stringify(record));
      return {...record, audioFile: audioBytes ? join(dir, `${key}.mp3`) : null};
    },
  };
}

export class BudgetError extends Error { constructor(message, details) { super(message); this.code = 'voice_budget'; this.details = details; } }

// Billed characters are counted before a paid call is sent; a call that would pass the limit is refused unsent.
// Every paid call is recorded (time, chars, provider, model, request ids). The ledger never stores keys.
export function createLedger(path, limitChars, {what = 'Voice budget', unit = 'characters', unset = 'No voice budget is set (ECHO_VOICE_BUDGET_CHARS); paid voices are off'} = {}) {
  const read = () => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {billedChars: 0, calls: []};
  return {
    limitChars, unit,
    status() { const l = read(); return {unit, limit: limitChars, billed: l.billedChars, remaining: Math.max(0, limitChars - l.billedChars), limitChars, billedChars: l.billedChars, remainingChars: Math.max(0, limitChars - l.billedChars), calls: l.calls.length}; },
    check(chars) {
      const l = read();
      if (!(limitChars > 0)) throw new BudgetError(unset, {limitChars});
      if (l.billedChars + chars > limitChars) throw new BudgetError(`${what}: ${chars} ${unit} requested, ${Math.round((limitChars - l.billedChars) * 10) / 10} of ${limitChars} left`, {chars, billedChars: l.billedChars, limitChars});
    },
    // Check and charge in one synchronous step before anything is sent, so concurrent calls cannot pass the limit.
    // A failed paid call still counts (conservative: the provider may have billed it).
    reserve(chars, call = {}) { this.check(chars); const l = read(); l.billedChars += chars; l.calls.push({...call, chars, at: new Date().toISOString()}); writeAtomic(path, JSON.stringify(l, null, 1)); },
    record(call) { this.reserve(call.chars, call); },
  };
}
