// Local stand-in for the two ElevenLabs "with-timestamps" endpoints, shaped like their documented responses
// (elevenlabs.io/docs/api-reference, checked 2026-10-17). Tests point ELEVENLABS_BASE_URL here: no paid call is
// ever made. Audio is a real 4 s MP3 fixture so the full-decode check runs on it.
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const AUDIO = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'tone-4s.mp3'));

// Characters spread evenly over 3.9 s, as one alignment for all inputs (dialogue) or for the one text.
function alignmentFor(text, duration = 3.9) {
  const characters = [...text], step = duration / characters.length;
  return {characters, character_start_times_seconds: characters.map((_, i) => +(i * step).toFixed(3)), character_end_times_seconds: characters.map((_, i) => +((i + 1) * step).toFixed(3))};
}

export async function startMockElevenLabs({mode = 'ok', audio = AUDIO} = {}) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', d => raw += d).on('end', () => {
      const url = new URL(req.url, 'http://mock'), body = raw ? JSON.parse(raw) : null;
      calls.push({method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: {...req.headers}, body});
      if (mode === 'hang') return; // never answers
      if (mode === 'error') { res.writeHead(500, {'content-type': 'application/json'}); return res.end(JSON.stringify({detail: {message: `internal error for key ${req.headers['xi-api-key']}`}})); }
      if (mode === 'unauthorized') { res.writeHead(401, {'content-type': 'application/json'}); return res.end(JSON.stringify({detail: {status: 'invalid_api_key'}})); }
      const dialogue = url.pathname === '/v1/text-to-dialogue/with-timestamps';
      if (!dialogue && !/^\/v1\/text-to-speech\/[^/]+\/with-timestamps$/.test(url.pathname)) { res.writeHead(404); return res.end(); }
      const text = dialogue ? body.inputs.map(i => i.text).join('') : body.text, alignment = alignmentFor(text);
      const out = {audio_base64: audio.toString('base64'), ...(mode === 'no-alignment' ? {} : {alignment, normalized_alignment: alignment})};
      if (dialogue && mode !== 'no-alignment') {
        let at = 0;
        out.voice_segments = body.inputs.map((input, i) => {
          const from = at, to = at + [...input.text].length; at = to;
          return {voice_id: input.voice_id, start_time_seconds: alignment.character_start_times_seconds[from], end_time_seconds: alignment.character_end_times_seconds[to - 1], character_start_index: from, character_end_index: to, dialogue_input_index: i};
        });
      }
      res.writeHead(200, {'content-type': 'application/json', 'request-id': `mock-${calls.length}`});
      res.end(JSON.stringify(out));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return {url: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise(r => { server.closeAllConnections(); server.close(r); })};
}
