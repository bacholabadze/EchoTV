// Speech-to-text for the spoken Creator Interview (3.2). ElevenLabs Scribe v2 (POST /v1/speech-to-text,
// multipart, Georgian listed as "kat" in their docs, 2026-10-18), behind a seconds budget checked before sending.
// The key is sent only in the xi-api-key header. Audio is never stored by ECHO; ElevenLabs' own retention applies
// (zero-retention is enterprise-only), so the creator is told before recording.
import {ProviderError} from './providers.mjs';

export function elevenLabsStt({apiKey, baseUrl = 'https://api.elevenlabs.io', model = 'scribe_v2', timeoutMs = 30000, fetchImpl = fetch} = {}) {
  return {
    name: 'elevenlabs', model, paid: true,
    available: () => apiKey ? true : 'no ElevenLabs API key configured',
    async transcribe({bytes, filename, mime, lang = 'ka'}) {
      const form = new FormData();
      form.append('model_id', model); form.append('language_code', lang); form.append('timestamps_granularity', 'word'); form.append('tag_audio_events', 'false');
      form.append('file', new Blob([bytes], {type: mime || 'application/octet-stream'}), filename);
      let res;
      try { res = await fetchImpl(`${baseUrl}/v1/speech-to-text`, {method: 'POST', headers: {'xi-api-key': apiKey}, body: form, signal: AbortSignal.timeout(timeoutMs)}); }
      catch (e) { throw new ProviderError('elevenlabs-stt', e.name === 'TimeoutError' ? 'timed out' : 'network error'); }
      if (!res.ok) { const detail = (await res.text().catch(() => '')).replaceAll(apiKey, '[key]').slice(0, 200); throw new ProviderError('elevenlabs-stt', `HTTP ${res.status} ${detail}`, res.status); }
      const x = await res.json();
      return {text: String(x.text || '').trim(), languageCode: x.language_code || null, languageProbability: x.language_probability ?? null,
        words: (x.words || []).filter(w => w.type === 'word').length, requestId: res.headers.get('request-id') || null};
    },
  };
}
