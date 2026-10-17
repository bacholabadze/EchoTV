// Provider-neutral voice service (ECHO 3.2). One call renders one spoken unit (one or more lines, one or more
// presenters) to MP3 plus captions, viseme cues and speaker turns, with provenance. Providers are tried in order;
// a cache hit never renders or pays again; paid calls need a key and a character budget, checked before sending.
// Rendered audio is fully decoded (probe) before it is accepted. Nothing here decides approval: callers attach the
// audio as a segment asset, and people approve those exact bytes (see BroadcastDesk.setVoice).
import {readFileSync, existsSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {cacheKey, createCache, createLedger, BudgetError} from './store.mjs';
import {piperProvider, elevenLabsProvider, captionsProvider, approximateTiming, ProviderError} from './providers.mjs';
import {elevenLabsStt} from './stt.mjs';
import {normalizeText} from './align.mjs';

export {BudgetError, ProviderError};
export const DEFAULT_ORDER = {en: ['piper', 'captions'], ka: ['elevenlabs', 'piper', 'captions']};
const MAX_CHARS = 2000; // ElevenLabs recommends ≤ 2,000 characters per dialogue request

export function createVoiceService({providers, cacheDir, ledger, probe, log = () => {}}) {
  const cache = createCache(cacheDir);
  const prepare = lines => {
    const out = (lines || []).map(l => ({presenter: String(l.presenter || 'echo'), text: normalizeText(l.text)})).filter(l => l.text);
    if (!out.length) throw new ProviderError('voice', 'nothing to say');
    const chars = out.reduce((n, l) => n + [...l.text].length, 0);
    if (chars > MAX_CHARS) throw new ProviderError('voice', `${chars} characters in one unit; split it (max ${MAX_CHARS})`);
    return out;
  };
  const plan = (name, lines, lang) => {
    const p = providers[name];
    if (!p) return {provider: name, usable: false, reason: 'not configured'};
    const ok = p.available({lines, lang});
    const key = cacheKey({provider: name, model: p.model, voiceIds: p.voiceIdsFor(lines), lang, mode: lines.length > 1 ? 'dialogue' : 'single', lines});
    return {provider: name, p, key, usable: ok === true, reason: ok === true ? null : ok, chars: p.billedChars(lines), paid: p.paid};
  };
  return {
    // Dry run: which provider would answer, whether it is cached, and how many characters would be billed. No network.
    estimate({lines, lang = 'en', order = DEFAULT_ORDER[lang] || ['captions']}) {
      const clean = prepare(lines);
      return order.map(name => { const x = plan(name, clean, lang); return {provider: name, usable: x.usable, reason: x.reason, cached: !!(x.key && cache.get(x.key)), billedChars: x.paid && x.usable && !(x.key && cache.get(x.key)) ? x.chars : 0}; });
    },
    budget: () => ledger.status(),
    async synthesize({lines, lang = 'en', order = DEFAULT_ORDER[lang] || ['captions']}) {
      const clean = prepare(lines), attempts = [];
      for (const name of order) {
        const x = plan(name, clean, lang);
        if (!x.usable) { attempts.push({provider: name, skipped: x.reason}); continue; }
        const hit = cache.get(x.key);
        if (hit) return {...hit, key: x.key, cacheHit: true, attempts};
        if (x.paid) { try { ledger.check(x.chars); } catch (e) { if (!(e instanceof BudgetError)) throw e; attempts.push({provider: name, skipped: e.message}); continue; } }
        const tmp = join(cache.dir, `${x.key}.render.mp3`);
        try {
          const r = await x.p.render({lines: clean, lang, outPath: tmp});
          if (x.paid) ledger.record({provider: name, model: x.p.model, chars: x.chars, lang, lines: clean.length, requestIds: r.requestIds});
          let audio = null, duration = r.duration, timing = r;
          if (existsSync(tmp)) {
            const check = probe(tmp);
            if (!check.decodable) throw new ProviderError(name, `rendered audio does not decode: ${check.reason || 'unknown'}`);
            audio = readFileSync(tmp); duration = check.durationSec ?? duration;
            if (r.approximateTiming) timing = approximateTiming(clean, duration);
          }
          const entry = {provider: name, model: x.p.model, voiceIds: x.p.voiceIdsFor(clean), lang, lines: clean, duration, captions: timing.captions, cues: timing.cues, turns: timing.turns,
            requestIds: r.requestIds || [], approximateTiming: !!r.approximateTiming, billedChars: x.paid ? x.chars : 0, synthetic: true, renderedAt: new Date().toISOString()};
          const stored = cache.put(x.key, entry, audio);
          log('voice_rendered', {provider: name, key: x.key, chars: x.chars, paid: x.paid});
          return {...stored, key: x.key, cacheHit: false, attempts};
        } catch (e) {
          attempts.push({provider: name, error: e.message}); log('voice_failed', {provider: name, error: e.message});
        } finally { rmSync(tmp, {force: true}); }
      }
      throw new ProviderError('voice', `no provider could render: ${attempts.map(a => `${a.provider}: ${a.skipped || a.error}`).join('; ')}`);
    },
  };
}

// Configuration from the environment. The ElevenLabs key comes from ELEVENLABS_API_KEY or data/secrets/elevenlabs.key
// (mode 600, git-ignored); presenters' voices from ECHO_ELEVENLABS_VOICES = {"<presenter>": "<voice_id>"}.
export function voiceServiceFromEnv({root, dataDir, probe, env = process.env, log}) {
  const keyFile = join(dataDir, 'secrets', 'elevenlabs.key');
  const apiKey = env.ELEVENLABS_API_KEY || (existsSync(keyFile) ? readFileSync(keyFile, 'utf8').trim() : '');
  let voices = {}; try { voices = JSON.parse(env.ECHO_ELEVENLABS_VOICES || '{}'); } catch {}
  const providers = {
    piper: piperProvider({root}),
    elevenlabs: elevenLabsProvider({apiKey, voices, model: env.ELEVENLABS_MODEL || 'eleven_v3', baseUrl: env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io'}),
    captions: captionsProvider(),
  };
  return createVoiceService({providers, cacheDir: join(dataDir, 'voice-cache'), ledger: createLedger(join(dataDir, 'voice-ledger.json'), +env.ECHO_VOICE_BUDGET_CHARS || 0), probe, log});
}

// Speech-to-text for spoken interview answers: off unless both a key and a seconds budget are set.
export function sttFromEnv({dataDir, env = process.env}) {
  const keyFile = join(dataDir, 'secrets', 'elevenlabs.key');
  const apiKey = env.ELEVENLABS_API_KEY || (existsSync(keyFile) ? readFileSync(keyFile, 'utf8').trim() : '');
  return {provider: elevenLabsStt({apiKey, baseUrl: env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io', model: env.ELEVENLABS_STT_MODEL || 'scribe_v2'}),
    ledger: createLedger(join(dataDir, 'stt-ledger.json'), +env.ECHO_STT_BUDGET_SECONDS || 0, {what: 'Speech-recognition budget', unit: 'seconds', unset: 'No speech-recognition budget is set (ECHO_STT_BUDGET_SECONDS); spoken answers are off'})};
}
