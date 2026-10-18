// ECHO broadcast server: one process serialises every mutation of the shared state.
// node:http only; serves the static site, media, the API, and live updates (SSE).
import http from 'node:http';
import {readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, statSync, createReadStream, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, normalize, extname, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {timingSafeEqual} from 'node:crypto';
import {spawn, spawnSync} from 'node:child_process';
import {BroadcastDesk, DomainError, sha256, MEDIA_CHECKS} from './domain.mjs';
import {seedState, editorialSeed} from './seed.mjs';
import {rateLimiter} from './qa.mjs';
import {kaMessage} from './i18n-ka.mjs';
import {voiceServiceFromEnv, sttFromEnv, ProviderError, BudgetError} from './voice/index.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary',
  '.hdr': 'application/octet-stream', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8'};
const STATUS = {in_use: 409, consent_required: 403, transcription_failed: 503, voice_unavailable: 422, unauthorized: 401, forbidden: 403, not_found: 404, bad_request: 422, out_of_bounds: 422, bad_content: 422, rights_required: 422, media_selection_required: 422, undecodable_media: 422, idempotency_conflict: 422, too_large: 413, rate_limited: 429};
const MAX_UPLOAD = 25 * 1024 * 1024, SENT = Symbol('sent');

const MAGIC = {
  '.png': b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  '.jpg': b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, '.jpeg': b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  '.webp': b => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP',
  '.mp3': b => b.toString('latin1', 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0),
  '.wav': b => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WAVE',
  '.ogg': b => b.toString('latin1', 0, 4) === 'OggS', '.m4a': b => b.toString('latin1', 4, 8) === 'ftyp',
};
let decoderAvailable;
const hasDecoder = () => decoderAvailable ??= ['ffprobe', 'ffmpeg'].every(cmd => spawnSync(cmd, ['-version'], {stdio: 'ignore'}).status === 0);
// Media must actually decode before it can be approved or published: ffprobe reads the stream metadata and
// ffmpeg decodes every frame/sample (-xerror stops at the first decoder error). Without a decoder nothing is
// verified, so nothing is accepted (fail closed).
export function probeMedia(file) {
  const ext = extname(file).toLowerCase(), head = readFileSync(file).subarray(0, 16), kind = /png|jpe?g|webp/.test(ext) ? 'image' : 'audio';
  if (!MAGIC[ext]?.(head)) return {kind, decodable: false, probed: false, reason: `not a valid ${ext.slice(1)} file`};
  if (!hasDecoder()) return {kind, decodable: false, probed: false, reason: 'no media decoder on this server (install ffmpeg, which includes ffprobe)'};
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file], {encoding: 'utf8', timeout: 15000});
  let info; try { info = JSON.parse(r.stdout); } catch { info = {}; }
  const stream = (info.streams || []).find(x => x.codec_type === (kind === 'image' ? 'video' : 'audio'));
  if (r.status !== 0 || !stream) return {kind, decodable: false, probed: true, reason: (r.stderr || 'no decodable stream').trim().split('\n')[0].slice(0, 160)};
  const decode = spawnSync('ffmpeg', ['-v', 'error', '-xerror', '-i', file, '-f', 'null', '-'], {encoding: 'utf8', timeout: 30000});
  if (decode.status !== 0 || decode.stderr.trim()) return {kind, decodable: false, probed: true, reason: `decoding failed: ${(decode.stderr || 'decoder error').trim().split('\n').pop().slice(0, 160)}`};
  if (kind === 'audio') {
    const durationSec = +info.format?.duration;
    if (!(durationSec > 0)) return {kind, decodable: false, probed: true, reason: 'audio has no playable duration'};
    return {kind, decodable: true, probed: true, durationSec: Math.round(durationSec * 1000) / 1000};
  }
  if (!(stream.width > 0 && stream.height > 0)) return {kind, decodable: false, probed: true, reason: 'image has no pixels'};
  return {kind, decodable: true, probed: true, width: stream.width, height: stream.height};
}

// Checks the actual bytes of a media file now. A result is stamped with the check that produced it and the SHA-256
// of the bytes it was run on; the domain trusts nothing else. Decode results are cached by content hash (same bytes,
// same check, same answer), so re-checking before every approval, publication and start stays cheap.
const [FULL_DECODE, RECORDED_FINGERPRINT] = MEDIA_CHECKS, decoded = new Map();
export function checkMedia(file, recorded = null) {
  const hash = sha256(readFileSync(file)), key = `${hash}${extname(file).toLowerCase()}`;
  if (!decoded.has(key)) decoded.set(key, probeMedia(file));
  let {reason, ...probe} = decoded.get(key), method = FULL_DECODE;
  // Without a decoder, a shipped file is trusted only if its bytes are exactly the ones verified when it was authored.
  if (!probe.probed && recorded?.sha256 === hash) { probe = {kind: probe.kind, decodable: true, probed: false, verifiedRecord: recorded.by, ...recorded.metadata}; method = RECORDED_FINGERPRINT; }
  return probe.decodable ? {...probe, sha256: hash, verification: {method, sha256: hash}} : {...probe, sha256: hash, unplayableReason: reason, verification: null};
}

// Creator library files (3.2): images and audio get the same full check as broadcast media; existing video is fully
// decoded too (accepted for the library; no video module airs it yet); PDFs are supporting documents only (never
// parsed or broadcast). Nothing here is generated: creators upload what already exists.
export const LIBRARY_TYPES = {'.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.mp3': 'audio', '.wav': 'audio', '.ogg': 'audio', '.m4a': 'audio', '.mp4': 'video', '.mov': 'video', '.webm': 'video', '.pdf': 'document'};
export function checkLibraryFile(file) {
  const ext = extname(file).toLowerCase(), kind = LIBRARY_TYPES[ext], head = readFileSync(file).subarray(0, 16);
  if (kind === 'image' || kind === 'audio') { const r = checkMedia(file); return {kind: r.kind, decodable: r.decodable, reason: r.unplayableReason || null, durationSec: r.durationSec, width: r.width, height: r.height, method: r.verification?.method || null}; }
  if (kind === 'document') return head.toString('latin1', 0, 5) === '%PDF-' ? {kind, decodable: true, reason: null, method: 'pdf-signature', note: 'supporting document: not parsed, never broadcast'} : {kind, decodable: false, reason: 'not a PDF file'};
  if (kind !== 'video') return {kind: 'unknown', decodable: false, reason: `unsupported type ${ext}`};
  const magic = ext === '.webm' ? head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) : head.toString('latin1', 4, 8) === 'ftyp';
  if (!magic) return {kind, decodable: false, reason: `not a valid ${ext.slice(1)} file`};
  if (!hasDecoder()) return {kind, decodable: false, reason: 'no media decoder on this server (install ffmpeg)'};
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file], {encoding: 'utf8', timeout: 15000});
  let info; try { info = JSON.parse(r.stdout); } catch { info = {}; }
  const v = (info.streams || []).find(x => x.codec_type === 'video');
  if (r.status !== 0 || !v || !(v.width > 0)) return {kind, decodable: false, reason: 'no decodable video stream'};
  const d = spawnSync('ffmpeg', ['-v', 'error', '-xerror', '-i', file, '-f', 'null', '-'], {encoding: 'utf8', timeout: 60000});
  if (d.status !== 0 || d.stderr.trim()) return {kind, decodable: false, reason: `decoding failed: ${(d.stderr || 'decoder error').trim().split('\n').pop().slice(0, 160)}`};
  return {kind, decodable: true, reason: null, durationSec: Math.round(+info.format?.duration * 1000) / 1000, width: v.width, height: v.height, method: MEDIA_CHECKS[0]};
}

// Length of a recording in seconds. Browser recordings (webm/ogg) often carry no duration header, so decode if needed.
export function audioSeconds(path) {
  const p = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], {encoding: 'utf8', timeout: 15000});
  const d = parseFloat(p.stdout);
  if (d > 0) return d;
  const f = spawnSync('ffmpeg', ['-v', 'quiet', '-stats', '-i', path, '-f', 'null', '-'], {encoding: 'utf8', timeout: 30000});
  const t = [...String(f.stderr).matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)].pop();
  return t ? (+t[1]) * 3600 + (+t[2]) * 60 + parseFloat(t[3]) : 0;
}

// Demo media shipped in the repo; uploads are stored in the data directory.
const shippedList = mediaDir => existsSync(join(mediaDir, 'media.json')) ? JSON.parse(readFileSync(join(mediaDir, 'media.json'), 'utf8')) : {};
export function demoMedia(mediaDir) {
  return Object.fromEntries(Object.entries(shippedList(mediaDir)).map(([id, {verified, ...meta}]) => [id, {...meta, ...checkMedia(join(mediaDir, meta.file), verified)}]));
}

export function createEchoServer({dataDir = join(ROOT, 'data'), mediaDir = join(ROOT, 'media'), staticDir = join(ROOT, 'dist'), now = () => Date.now(), requestTtlMs = 180000, seedOptions = {}, quiet = false,
  hostVoiceEnabled = process.env.ECHO_HOST_VOICE !== 'off', sseDelayMs = 0, voice = null, stt = null} = {}) {
  mkdirSync(join(dataDir, 'uploads'), {recursive: true});
  const statePath = join(dataDir, 'state.json');
  // Editorial wave: the "AI-მ შექმნა. ვინ არის ავტორი?" programme (one guest, no seeded media, a draft fact pack).
  const factPackPath = join(ROOT, 'episodes', 'facts', 'ai-authorship.ka.json');
  const fresh = () => seedOptions.format === 'editorial'
    ? editorialSeed({people: seedOptions.people, rehearsal: seedOptions.rehearsal === true, factPack: existsSync(factPackPath) ? JSON.parse(readFileSync(factPackPath, 'utf8')) : null})
    : seedState({...seedOptions, media: demoMedia(mediaDir)});
  const askLimit = rateLimiter({now});
  let desk = new BroadcastDesk(existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : fresh(), {now});
  // Older state files: index every asset still referenced by segments or the published manifest.
  for (const a of [...Object.values(desk.state.segments).flatMap(seg => seg.assets), ...(desk.state.broadcast.manifest?.segments || []).flatMap(seg => seg.assets)])
    if (a.file) desk.indexMedia(a.sha256, a);
  desk.state.idempotency ??= {};
  const clients = new Set(), agentCalls = []; // agentCalls: in memory only, newest last
  const persist = () => { const tmp = statePath + '.tmp'; writeFileSync(tmp, JSON.stringify(desk.state)); renameSync(tmp, statePath); };
  // Stored verification results are never trusted on their own (state from earlier versions carries flags from a
  // weaker check): the actual bytes of every asset are checked again at startup and before every approval,
  // publication and start. A file that is missing or whose bytes no longer match its fingerprint is unplayable.
  const recorded = Object.fromEntries(Object.values(shippedList(mediaDir)).map(m => [m.file, m.verified]));
  function verifyAssets(segmentIds) {
    for (const id of segmentIds) for (const a of desk.state.segments[id]?.assets || []) {
      const path = a.file && (a.upload ? join(dataDir, 'uploads', a.file) : join(mediaDir, a.file));
      let {sha256: actual, ...result} = path && existsSync(path) ? checkMedia(path, a.upload ? null : recorded[a.file]) : {decodable: false, probed: false, unplayableReason: 'media file missing', verification: null};
      if (actual && actual !== a.sha256) result = {...result, decodable: false, unplayableReason: 'the bytes on disk do not match the approved fingerprint', verification: null};
      const was = a.decodable;
      if (result.decodable) delete a.unplayableReason;
      Object.assign(a, result);
      if (was === true && !a.decodable) desk.log({type: 'system', id: 'media'}, 'media_revalidated', `${desk.state.segments[id].title}: ${a.id} failed the check of its actual bytes (${a.unplayableReason}); it cannot be approved, published or aired`, {segmentId: id, assetId: a.id, sha256: a.sha256});
    }
    persist();
  }
  verifyAssets(Object.keys(desk.state.segments));

  const tokenMatch = (a, b) => typeof a === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  function actorFor(token) {
    if (!token) return null;
    for (const p of Object.values(desk.state.people)) if (tokenMatch(token, p.token)) return {type: 'person', id: p.id};
    for (const a of Object.values(desk.state.agents)) if (tokenMatch(token, a.token)) return {type: 'agent', id: a.id};
    return null;
  }
  // Public view: everything on the board except credentials.
  function publicState() {
    const s = structuredClone(desk.state);
    for (const p of Object.values(s.people)) delete p.token;
    for (const a of Object.values(s.agents)) delete a.token;
    delete s.idempotency; delete s.media; // internal: retry records and the storage index
    delete s.interviews; delete s.library;   // private, owner-scoped (served only by /api/interviews and /api/library)
    delete s.editorialShares; delete s.rundowns; delete s.facts; delete s.factPackStatus; // editorial desk: producer and editorial agent only
    s.qa = desk.publicQa(); // only the selected question and a released answer are public
    s.audit = s.audit.filter(e => !e.private);
    s.agentCalls = agentCalls.slice(-120);
    s.serverTime = now();
    s.layout = desk.layout();
    s.segmentsValid = Object.fromEntries(Object.keys(s.segments).map(id => [id, desk.approvalValid(desk.state.segments[id])]));
    return s;
  }
  let lastSent = -1;
  function broadcast(force = false) {
    if (!force && lastSent === desk.state.seq) return;
    lastSent = desk.state.seq;
    const data = `event: state\ndata: ${JSON.stringify(publicState())}\n\n`;
    for (const res of clients) sseWrite(res, data);
    for (const waiter of [...waiters]) waiter();
  }
  const waiters = new Set();
  // sseDelayMs simulates a slow or buffering network path in tests; it is 0 in normal use.
  const sseWrite = (res, data) => sseDelayMs ? setTimeout(() => res.writableEnded || res.write(data), sseDelayMs) : res.write(data);
  const mutate = fn => { const result = fn(desk); persist(); broadcast(); return result; };

  const timer = setInterval(() => {
    const seq = desk.state.seq;
    desk.tick(); desk.expireRequests(requestTtlMs);
    if (desk.state.seq !== seq) { persist(); broadcast(); }
    for (const res of clients) sseWrite(res, `event: clock\ndata: ${now()}\n\n`);
  }, 1000);
  timer.unref();

  const send = (res, status, body) => { res.writeHead(status, {'content-type': 'application/json', 'cache-control': 'no-store'}); res.end(JSON.stringify(body)); };
  const readBody = (req, limit) => new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(new DomainError('too_large', 'Upload too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject);
  });
  const parseJson = raw => { try { return raw.length ? JSON.parse(raw) : {}; } catch { throw new DomainError('bad_request', 'Body must be JSON'); } };

  function serveFile(req, res, file) {
    const size = statSync(file).size, type = TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (range) {
      const start = range[1] ? +range[1] : size - +range[2], end = range[1] && range[2] ? Math.min(+range[2], size - 1) : size - 1;
      if (start >= size || start > end) { res.writeHead(416, {'content-range': `bytes */${size}`}); return res.end(); }
      res.writeHead(206, {'content-type': type, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes'});
      return createReadStream(file, {start, end}).pipe(res);
    }
    res.writeHead(200, {'content-type': type, 'content-length': size, 'accept-ranges': 'bytes', 'cache-control': 'no-cache'});
    createReadStream(file).pipe(res);
  }
  function serveStatic(req, res, pathname) {
    let file = normalize(join(staticDir, decodeURIComponent(pathname)));
    if (!file.startsWith(staticDir)) return send(res, 403, {error: 'forbidden'});
    if (existsSync(file) && statSync(file).isDirectory()) {
      if (!pathname.endsWith('/')) { res.writeHead(301, {location: pathname + '/'}); return res.end(); }
      file = join(file, 'index.html');
    }
    if (!existsSync(file)) return send(res, 404, {error: 'not_found'});
    serveFile(req, res, file);
  }
  // Media is served from an append-only index, so a published manifest keeps working after newer drafts arrive.
  function serveMedia(req, res, hash) {
    const entry = /^[0-9a-f]{64}$/.test(hash) && desk.state.media?.[hash];
    if (entry?.private) {
      const who = actorFor((req.headers.authorization || '').replace(/^Bearer\s+/i, '')), person = who?.type === 'person' && desk.state.people[who.id];
      if (!person || (person.id !== entry.ownerId && person.role !== 'producer')) return send(res, 404, {error: 'not_found'});
    }
    const file = entry?.file && (entry.upload ? join(dataDir, 'uploads', entry.file) : join(mediaDir, entry.file));
    if (file && existsSync(file)) return serveFile(req, res, file);
    send(res, 404, {error: 'not_found'});
  }

  // Voices go through the provider-neutral voice service (3.2). The 3.1 house lines keep their behaviour: Piper,
  // or the same captions-only fallback when no voice is available.
  const voiceOwners = new Map(); // draft voice cache key -> owner id (this process only; fail closed after restart)
  const publicVoiceKeys = new Set(); // ECHO's own spoken interview questions: fixed question text, no creator data, playable by <audio>
  const voices = voice || voiceServiceFromEnv({root: ROOT, dataDir, probe: path => { const {reason, ...p} = probeMedia(path); return {...p, reason}; }, log: (event, data) => quiet || console.log(`voice: ${event} ${JSON.stringify(data)}`)});
  const speech = stt || sttFromEnv({dataDir});
  async function hostVoice(lines) {
    const fallback = Object.fromEntries(lines.map(l => [l.id, {text: l.text, captions: [{start: 0, end: 6, text: l.text}], cues: [], duration: 6, audio: null}]));
    const out = {};
    for (const l of lines) {
      try {
        const r = await voices.synthesize({lines: [{presenter: 'echo', text: l.text}], lang: 'en', order: hostVoiceEnabled ? ['piper', 'captions'] : ['captions']});
        out[l.id] = r.audioFile ? {text: l.text, audio: `/voice/${r.key}.mp3`, duration: r.duration, cues: r.cues, captions: r.captions} : fallback[l.id];
      } catch (error) { if (!quiet) console.error('Host voice failed:', error.message); out[l.id] = fallback[l.id]; }
    }
    return out;
  }
  // Approved voice assets play as the segment's host audio: the exact bytes people approved, served by hash.
  function approvedVoices(state) {
    const out = {};
    for (const seg of Object.values(state.segments)) {
      const a = seg.content?.voice && seg.assets.find(x => x.id === seg.content.voice.assetId);
      if (a) out[seg.id] = {text: seg.content.voice.lines.map(l => l.text).join(' '), audio: `/media/${a.sha256}`, duration: a.voice.duration, cues: a.voice.cues, captions: a.voice.captions, turns: a.voice.turns,
        credit: `Approved script · synthetic voice (${a.voice.provider === 'elevenlabs' ? 'ElevenLabs' : a.voice.provider === 'elevenlabs-sample' ? 'ElevenLabs, fixed sample' : a.voice.provider === 'piper' ? 'Piper, offline' : a.voice.provider})${a.voice.approximateTiming ? ' · approximate timing' : ''}`};
    }
    return out;
  }

  const routes = [
    ['GET', /^\/api\/state$/, () => publicState()],
    // Viewers estimate their clock offset from this (round-trip corrected), not from SSE delivery times.
    ['GET', /^\/api\/time$/, () => ({serverTime: now()})],
    // Playback activation (N04): viewers start a scheduled publication only on this answer, never on the event stream
    // alone (it can be delayed or cut). The answer is given once the server's clock has reached onAirAt, the moment
    // after which a rejection can no longer withdraw the publication, so it is final. Asked early, it waits (≤ 5 s).
    ['GET', /^\/api\/broadcast\/activation$/, ({url}) => new Promise(resolve => {
      const publicationId = +url.searchParams.get('publicationId'), hash = url.searchParams.get('hash'), onAirAt = +url.searchParams.get('onAirAt');
      const answer = () => {
        const b = desk.state.broadcast, m = b.manifest, withdrawn = desk.state.withdrawals?.[publicationId];
        const permitted = ['on_air', 'completed'].includes(b.state) && m?.publicationId === publicationId && m.hash === hash && b.onAirAt === onAirAt;
        resolve({permitted, publicationId, serverTime: now(), state: b.state,
          ...(permitted ? {} : {reason: withdrawn ? `Publication #${publicationId} was withdrawn before air: ${withdrawn.reason}` : b.state === 'failed' ? 'Playout was stopped by the producer' : `Publication #${publicationId} is not scheduled to start`})});
      };
      const check = () => {
        const wait = onAirAt - now();
        if (!(wait > 0)) return answer();
        if (wait > 5000) return resolve({permitted: false, pending: true, serverTime: now(), retryInMs: wait - 4000});
        setTimeout(check, Math.min(wait, 250));
      };
      check();
    })],
    ['GET', /^\/api\/me$/, ({actor}) => {
      if (!actor) throw new DomainError('unauthorized', 'Sign in with your link');
      const who = actor.type === 'agent' ? desk.state.agents[actor.id] : desk.state.people[actor.id];
      const {token, ...safe} = who; return {type: actor.type, ...safe};
    }],
    // Agents long-poll their inbox; returns as soon as a request is addressed to them.
    ['GET', /^\/api\/agent\/inbox$/, async ({actor, url, res}) => {
      const agent = desk.requireAgent(actor);
      const wait = Math.min(+url.searchParams.get('wait') || 0, 55) * 1000;
      const pending = () => Object.values(desk.state.requests).filter(r => r.toAgentId === agent.id && r.status === 'open');
      if (!pending().length && wait) await new Promise(resolve => {
        const check = () => pending().length && done(), done = () => { waiters.delete(check); clearTimeout(timeout); resolve(); };
        const timeout = setTimeout(done, wait); waiters.add(check); res.on('close', done);
      });
      return {showRevision: desk.state.showRevision, requests: pending()};
    }],
    ['POST', /^\/api\/proposals$/, ({actor, json}) => { const body = json(); return mutate(d => d.proposeChange(actor, body)); }],
    ['POST', /^\/api\/proposals\/(\w+)\/revise$/, ({actor, json, m}) => { const body = json(); return mutate(d => d.reviseProposal(actor, {...body, proposalId: m[1]})); }],
    ['POST', /^\/api\/proposals\/(\w+)\/withdraw$/, ({actor, json, m}) => { const body = json(); return mutate(d => d.withdrawProposal(actor, {...body, proposalId: m[1]})); }],
    ['POST', /^\/api\/proposals\/(\w+)\/decision$/, ({actor, json, m}) => { const body = json(); return mutate(d => d.decideProposal(actor, {...body, proposalId: m[1]})); }],
    ['POST', /^\/api\/requests\/(\w+)\/respond$/, ({actor, json, m}) => { const body = json(); return mutate(d => d.respondToRequest(actor, {...body, requestId: m[1]})); }],
    ['POST', /^\/api\/slots\/(hold|confirm|release)$/, ({actor, json, m}) => { const body = json(); return mutate(d => d[{hold: 'holdSlot', confirm: 'confirmSlot', release: 'releaseSlot'}[m[1]]](actor, body)); }],
    ['POST', /^\/api\/segments\/(\w+)\/review$/, ({actor, json, m}) => { const body = json(); verifyAssets([m[1]]); return mutate(d => d.reviewSegment(actor, {...body, segmentId: m[1]})); }],
    // Owner uploads authorised existing media. The hash binds any later approval to these exact bytes.
    ['POST', /^\/api\/segments\/(\w+)\/media\/([\w-]+)$/, ({actor, req, m, raw}) => {
      desk.requireHuman(actor);
      const ext = extname(req.headers['x-filename'] || '').toLowerCase();
      if (!['.png', '.jpg', '.jpeg', '.webp', '.mp3', '.wav', '.ogg', '.m4a'].includes(ext)) throw new DomainError('bad_request', 'Supported media: png, jpg, webp, mp3, wav, ogg, m4a');
      const hash = sha256(raw), file = `${hash}${ext}`, path = join(dataDir, 'uploads', file);
      // Bytes are on disk before the state can reference them (same hash, so a rejected change leaves a harmless orphan).
      writeFileSync(path, raw);
      const {sha256: _sameAsHash, unplayableReason, ...probe} = checkMedia(path);
      if (!probe.decodable) throw new DomainError('undecodable_media', `This file cannot be played: ${unplayableReason}`);
      const kind = probe.kind, expected = desk.segment(m[1]).assets.find(a => a.id === m[2])?.kind;
      if (expected && expected !== kind) throw new DomainError('bad_request', `${m[2]} must be ${expected === 'audio' ? 'an audio file' : 'an image'}`);
      const meta = {upload: true, file, rightsDeclared: req.headers['x-rights-declared'] === 'yes', ...probe,
        title: decodeURIComponent(req.headers['x-title'] || ''), credit: decodeURIComponent(req.headers['x-credit'] || ''), license: decodeURIComponent(req.headers['x-license'] || '')};
      return mutate(d => d.replaceAsset(actor, {segmentId: m[1], assetId: m[2], sha256: hash, meta}));
    }],
    // Render a spoken script for a segment (owner, or producer for house segments). Rights are checked before anything
    // is rendered or paid for. The audio becomes the segment's 'voice' asset: a new revision that people must approve
    // as these exact bytes. Agents cannot call this.
    ['POST', /^\/api\/segments\/(\w+)\/voice$/, async ({actor, json, m}) => {
      const body = json();
      const voicedSeg = desk.requireVoiceRights(actor, m[1]);
      if (!Array.isArray(body.lines)) throw new DomainError('bad_request', 'lines must be a list of {presenter, text}');
      let r;
      try { r = await voices.synthesize({lines: body.lines, lang: body.lang || 'en', ...(Array.isArray(body.order) ? {order: body.order} : {})}); }
      catch (e) { if (e instanceof ProviderError) throw new DomainError('voice_unavailable', e.message); throw e; }
      if (r.key) voiceOwners.set(r.key, voicedSeg.ownerId);
      if (!r.audioFile) throw new DomainError('voice_unavailable', `No voice could render this script: ${r.attempts.map(a => `${a.provider}: ${a.skipped || a.error}`).join('; ') || 'captions only'}`, {attempts: r.attempts});
      const bytes = readFileSync(r.audioFile), hash = sha256(bytes), file = `${hash}.mp3`, path = join(dataDir, 'uploads', file);
      writeFileSync(path, bytes);
      const {sha256: _sameAsHash, unplayableReason, ...check} = checkMedia(path);
      if (!check.decodable) throw new DomainError('undecodable_media', `Rendered voice cannot be played: ${unplayableReason}`);
      const voiceMeta = {provider: r.provider, model: r.model, voiceIds: r.voiceIds, lang: r.lang, duration: r.duration, captions: r.captions, cues: r.cues, turns: r.turns, approximateTiming: r.approximateTiming, requestIds: r.requestIds, cacheHit: r.cacheHit, fallbacks: r.attempts};
      return mutate(d => d.setVoice(actor, {segmentId: m[1], lines: r.lines, lang: r.lang, asset: {sha256: hash, file, ...check, voice: voiceMeta}}));
    }],
    // ---- editorial desk (editorial wave): producer and the ECHO editorial agent; drafts never in /api/state ----
    ['GET', /^\/api\/editorial$/, ({actor}) => desk.editorialView(actor)],
    ['GET', /^\/api\/editorial\/packet$/, ({actor}) => desk.editorialPacketFor(actor)],
    ['POST', /^\/api\/editorial\/rundowns$/, ({actor, json}) => { const body = json(); return mutate(d => d.submitRundown(actor, {draft: body.draft ?? body})); }],
    ['POST', /^\/api\/editorial\/baseline$/, ({actor}) => mutate(d => d.planBaseline(actor))],
    ['POST', /^\/api\/editorial\/rundowns\/(\w+)\/decision$/, ({actor, json, m}) => { const body = json(); return mutate(d => d.decideRundown(actor, {...body, rundownId: m[1]})); }],
    ['POST', /^\/api\/editorial\/facts\/([\w-]+)\/verify$/, ({actor, json, m}) => { const body = json(); return mutate(d => d.verifyFact(actor, {factId: m[1], verified: body.verified === true})); }],
    // ---- audience Q&A: viewers ask without an account (rate-limited, screened); people select and release ----
    ['POST', /^\/api\/qa\/questions$/, ({req, json}) => {
      const body = json(), key = req.socket.remoteAddress || 'unknown', limit = askLimit(key);
      if (!limit.ok) throw new DomainError('rate_limited', `Too many questions; try again in ${limit.retryInSec} s`);
      return mutate(d => d.submitQuestion({text: body.text, name: body.name}));
    }],
    ['GET', /^\/api\/qa\/questions\/(\w+)$/, ({url, m}) => desk.questionStatus(m[1], url.searchParams.get('secret'))],
    ['GET', /^\/api\/qa$/, ({actor}) => desk.questionQueue(actor)],
    ['GET', /^\/api\/qa\/guest$/, ({actor}) => desk.guestQuestion(actor)],
    ['POST', /^\/api\/qa\/consent$/, ({actor, json}) => { const body = json(); return mutate(d => d.setQaConsent(actor, body)); }],
    ['POST', /^\/api\/qa\/questions\/(\w+)\/(select|reject|shortlist|answer|release)$/, ({actor, json, m}) => {
      const body = json(), fn = {select: 'selectQuestion', reject: 'rejectQuestion', shortlist: 'shortlistQuestion', answer: 'answerQuestion', release: 'releaseAnswer'}[m[2]];
      return mutate(d => d[fn](actor, {...body, questionId: m[1]}));
    }],
    // ---- creator interviews and private library (3.2): owner-scoped; never in /api/state ----
    ['GET', /^\/api\/interviews$/, ({actor}) => { if (!actor) throw new DomainError('unauthorized', 'Sign in'); const owner = desk.ownerOf(actor); return Object.values(desk.state.interviews || {}).filter(iv => iv.ownerId === owner && iv.status !== 'deleted').map(iv => ({id: iv.id, status: iv.status, title: iv.brief?.work.title || null, updatedAt: iv.updatedAt})); }],
    ['GET', /^\/api\/interviews\/(\w+)$/, ({actor, m}) => { if (!actor) throw new DomainError('unauthorized', 'Sign in'); return desk.interviewView(actor, m[1]); }],
    ['POST', /^\/api\/interviews$/, ({actor}) => mutate(d => d.startInterview(actor))],
    ['POST', /^\/api\/interviews\/(\w+)\/(answer|skip|goto|review|quotes|approve|withdraw)$/, ({actor, json, m}) => { const body = json(); return mutate(d => d.interviewAct(actor, m[1], m[2], body)); }],
    ['POST', /^\/api\/briefs\/(\w+)\/prepare$/, ({actor, json, m}) => { const body = json(); return mutate(d => d.prepareSegment(actor, {interviewId: m[1], segmentId: body.segmentId, assets: body.assets || {}, shareWithEditorial: body.shareWithEditorial === true})); }],
    // ---- spoken interview (3.2): consent, transcription (never stored by ECHO), spoken questions ----
    ['POST', /^\/api\/interviews\/(\w+)\/consent$/, ({actor, json, m}) => { const body = json(); return mutate(d => d.interviewConsent(actor, m[1], body)); }],
    ['POST', /^\/api\/interviews\/(\w+)\/transcribe$/, async ({actor, req, raw, m}) => {
      desk.requireHuman(actor);
      const iv = desk.interviewFor(actor, m[1]);
      if (!iv.consent?.voice) throw new DomainError('consent_required', 'Allow spoken answers first: the recording is sent to the speech-recognition service and is not kept by ECHO');
      const mime = String(req.headers['content-type'] || '').split(';')[0], ext = {'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a', 'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav'}[mime];
      if (!ext) throw new DomainError('bad_request', 'Send audio/webm, ogg, mp4, mpeg or wav');
      if (!raw.length || raw.length > 10 * 1024 * 1024) throw new DomainError('bad_request', 'Recording must be between 1 byte and 10 MB');
      const dir = mkdtempSync(join(tmpdir(), 'echo-stt-')), path = join(dir, `answer${ext}`);
      try {
        writeFileSync(path, raw);
        const seconds = audioSeconds(path);
        if (!(seconds > 0)) throw new DomainError('bad_request', 'This recording could not be read; try again or type your answer');
        if (seconds > 60) throw new DomainError('bad_request', `Answers can be up to 60 seconds (this one is ${Math.round(seconds)} s)`);
        const ok = speech.provider.available();
        if (ok !== true) throw new DomainError('voice_unavailable', `Spoken answers are not available: ${ok}. Type your answer instead.`);
        try { speech.ledger.reserve(Math.ceil(seconds), {provider: speech.provider.name, model: speech.provider.model}); } catch (e) { if (e instanceof BudgetError) throw new DomainError('voice_unavailable', `${e.message}. Type your answer instead.`); throw e; }
        let r;
        try { r = await speech.provider.transcribe({bytes: raw, filename: `answer${ext}`, mime, lang: 'ka'}); }
        catch (e) { if (e instanceof ProviderError) throw new DomainError('transcription_failed', `Speech recognition failed (${e.message.replace(/^[\w-]+: /, '')}). Try again or type your answer.`); throw e; }
        return {recognised: r.text, provider: speech.provider.name, model: speech.provider.model, languageCode: r.languageCode, confidence: r.languageProbability, durationSec: Math.round(seconds * 10) / 10, stored: false};
      } finally { rmSync(dir, {recursive: true, force: true}); }
    }],
    ['GET', /^\/api\/interviews\/(\w+)\/question-audio$/, async ({actor, m}) => {
      if (!actor) throw new DomainError('unauthorized', 'Sign in');
      const view = desk.interviewView(actor, m[1]), prompt = view.prompt;
      if (!prompt) throw new DomainError('not_found', 'No open question');
      // Spoken questions are part of the voice interview: only for the creator, after their voice consent.
      if (actor.type !== 'person' || !view.consent?.voice) return {stepId: prompt.stepId, text: prompt.question.ka, audio: null, captions: [{start: 0, end: 4, text: prompt.question.ka}], cues: [], provider: 'captions', reason: 'spoken questions start after the creator allows voice answers'};
      const r = await voices.synthesize({lines: [{presenter: 'interviewer', text: prompt.question.ka}], lang: 'ka', order: ['elevenlabs-sample', 'elevenlabs', 'captions']});
      if (r.key) publicVoiceKeys.add(r.key);
      return {stepId: prompt.stepId, text: prompt.question.ka, audio: r.audioFile ? `/voice/${r.key}.mp3` : null, duration: r.duration, captions: r.captions, cues: r.cues, provider: r.provider,
        ...(r.audioFile ? {} : {reason: r.attempts.map(a => a.skipped || a.error).join('; ') || 'captions only'})};
    }],
    ['GET', /^\/api\/library$/, ({actor}) => { if (!actor) throw new DomainError('unauthorized', 'Sign in'); return desk.libraryView(actor); }],
    ['GET', /^\/api\/library\/media\/(\w+)\/file$/, ({actor, m, req, res}) => { const item = desk.mediaOf(actor, m[1]); serveFile(req, res, join(dataDir, 'uploads', item.file)); return SENT; }],
    ['POST', /^\/api\/library\/media$/, ({actor, req, raw}) => {
      desk.requireHuman(actor);
      const filename = decodeURIComponent(req.headers['x-filename'] || ''), ext = extname(filename).toLowerCase();
      if (!LIBRARY_TYPES[ext]) throw new DomainError('bad_request', `Supported: ${Object.keys(LIBRARY_TYPES).join(', ')}`);
      if (!raw.length) throw new DomainError('bad_request', 'Empty file');
      const hash = sha256(raw), file = `${hash}${ext}`, path = join(dataDir, 'uploads', file);
      writeFileSync(path, raw);
      const c = checkLibraryFile(path);
      return mutate(d => d.addLibraryMedia(actor, {sha256: hash, file, kind: c.kind, title: decodeURIComponent(req.headers['x-title'] || ''), filename, bytes: raw.length,
        technical: {decodable: c.decodable, reason: c.reason, method: c.method || null, durationSec: c.durationSec, width: c.width, height: c.height, note: c.note || null}}));
    }],
    ['POST', /^\/api\/library\/media\/(\w+)\/rights$/, ({actor, json, m}) => { const body = json(); return mutate(d => d.declareRights(actor, m[1], body)); }],
    ['POST', /^\/api\/interviews\/(\w+)\/delete$/, ({actor, m}) => mutate(d => d.deleteInterview(actor, m[1]))],
    ['POST', /^\/api\/library\/media\/(\w+)\/delete$/, ({actor, m}) => { const r = mutate(d => d.deleteLibraryMedia(actor, m[1])); if (r.removeFile) rmSync(join(dataDir, 'uploads', r.removeFile), {force: true}); return {id: r.id, deleted: true}; }],
    ['POST', /^\/api\/library\/media\/(\w+)\/withdraw$/, ({actor, m}) => mutate(d => d.withdrawLibraryMedia(actor, m[1]))],
    ['GET', /^\/api\/voice\/status$/, () => ({budget: voices.budget()})],
    // Approved fixed Georgian samples (scripts only, no files): what the producer can voice without a paid call.
    ['GET', /^\/api\/voice\/samples$/, ({actor}) => { if (actor?.type !== 'person') throw new DomainError('unauthorized', 'Sign in'); return {provider: 'elevenlabs-sample', dynamic: false, note: 'Fixed samples from the founder-approved test of 2026-10-18; approximate caption timing; no new generation', samples: voices.samples ? voices.samples() : []}; }],
    // House host lines are written from the programme and voiced offline with Piper; captions-only if unavailable.
    ['POST', /^\/api\/publish$/, async ({actor}) => {
      desk.requireProducer(actor);
      const host = {...await hostVoice(hostLines(desk.state)), ...approvedVoices(desk.state)};
      verifyAssets(Object.keys(desk.state.segments)); // immediately before publishing: no await in between
      return mutate(d => {
        const manifest = d.publish(actor, {host});
        // Host lines rendered at publish time live in the voice cache: their keys become public with this publication.
        d.state.publishedVoice ??= {};
        for (const h of Object.values(host)) { const k = h.audio?.match(/^\/voice\/([0-9a-f]{64})\.mp3$/)?.[1]; if (k) d.state.publishedVoice[k] = manifest.publicationId; }
        const silent = Object.entries(host).filter(([, h]) => !h.audio).map(([id]) => d.state.segments[id].title);
        if (silent.length) d.log({type: 'system', id: 'playout'}, 'host_voice_unavailable', `Host voice unavailable for ${silent.join(', ')}: captions only`);
        return manifest;
      });
    }],
    ['POST', /^\/api\/golive$/, ({actor, json}) => { const body = json(); verifyAssets((desk.state.broadcast.manifest?.segments || []).map(s => s.id)); return mutate(d => d.goLive(actor, {delayMs: body.delayMs ?? 3000, publicationId: body.publicationId, hash: body.hash})); }],
    ['POST', /^\/api\/broadcast\/fail$/, ({actor, json}) => { const body = json(); return mutate(d => d.failBroadcast(actor, body)); }],
    // Rehearsal reset keeps identities and tokens so connected agents stay valid.
    ['POST', /^\/api\/reset$/, ({actor}) => {
      desk.requireProducer(actor);
      const keep = {people: desk.state.people, agents: desk.state.agents, interviews: desk.state.interviews, library: desk.state.library};
      const next = fresh(); next.people = keep.people; next.agents = keep.agents;
      // Publication numbers are never reused and old media stays reachable across rehearsals.
      next.counters.publication = desk.state.counters.publication || 0; next.media = {...desk.state.media, ...next.media}; next.publishedVoice = {...(desk.state.publishedVoice || {})}; next.idempotency = {};
      // Creators' private interviews and libraries are not rehearsal data: they survive a reset (ids keep counting).
      next.interviews = keep.interviews; next.library = keep.library; next.counters.interview = desk.state.counters.interview || 0; next.counters.media = desk.state.counters.media || 0;
      desk = new BroadcastDesk(next, {now});
      desk.log(actor, 'reset', 'Rehearsal reset to the seeded programme');
      persist(); broadcast(true); return {ok: true};
    }],
  ];

  function remember({replayKey, fingerprint}, status, body, interviewId = null) {
    const store = desk.state.idempotency;
    // Retry records that concern a creator interview are tagged, so deleting the interview erases them (Q1).
    store[replayKey] = {fingerprint, status, body, at: now(), ...(interviewId ? {interviewId} : {})};
    const keys = Object.keys(store);
    for (const k of keys.slice(0, Math.max(0, keys.length - 500))) delete store[k];
    persist();
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://local');
    if (url.pathname === '/api/events') {
      res.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive'});
      sseWrite(res, `retry: 1500\nevent: state\ndata: ${JSON.stringify(publicState())}\n\n`);
      clients.add(res); req.on('close', () => clients.delete(res));
      return;
    }
    if (url.pathname.startsWith('/media/')) return serveMedia(req, res, url.pathname.slice(7));
    if (/^\/voice\/[0-9a-f]{64}\.mp3$/.test(url.pathname) && existsSync(join(dataDir, 'voice-cache', url.pathname.slice(7)))) {
      // Q2 (independent audit): a rendered voice is public only once a publication carries it. Before that, only a
      // signed-in person (the creator who asked for it or the producer) can fetch the draft bytes; agents and anonymous
      // viewers get 404. Keys of every published host line stay public so earlier publications remain playable.
      const key = url.pathname.slice(7, 71), published = desk.state.publishedVoice?.[key];
      const who = published ? null : actorFor((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
      const person = who?.type === 'person' && desk.state.people[who.id];
      // Owner of the draft (set when it was rendered in this process) or the producer; after a restart, producer only.
      if (!published && !publicVoiceKeys.has(key) && !(person && (person.role === 'producer' || voiceOwners.get(key) === person.id))) return send(res, 404, {error: 'not_found'});
      return serveFile(req, res, join(dataDir, 'voice-cache', url.pathname.slice(7)));
    }
    if (/^\/host\/[\w-]+\.mp3$/.test(url.pathname) && existsSync(join(dataDir, 'host', url.pathname.slice(6)))) return serveFile(req, res, join(dataDir, 'host', url.pathname.slice(6)));
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
    const route = routes.find(([method, re]) => method === req.method && re.test(url.pathname));
    if (!route) return send(res, 404, {error: 'not_found'});
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const actor = actorFor(token);
    if (actor?.type === 'agent') {
      const agent = desk.state.agents[actor.id];
      agent.lastSeenAt = now(); if (req.headers['x-echo-client']) agent.client = String(req.headers['x-echo-client']).slice(0, 60);
      // Technical view: which tool each agent called and what the server answered. Ids of private items are generalised.
      const call = {at: now(), agentId: actor.id, client: agent.client || null, tool: String(req.headers['x-echo-tool'] || '').replace(/[^\w-]/g, '').slice(0, 60) || null, method: req.method,
        path: url.pathname.replace(/^\/api\/(interviews|library\/media)\/\w+/, '/api/$1/…')};
      res.on('finish', () => { call.status = res.statusCode; agentCalls.push(call); if (agentCalls.length > 300) agentCalls.shift(); });
    }
    let replayKey = null;
    try {
      if (route[0] === 'POST' && !actor && url.pathname !== '/api/qa/questions') throw new DomainError('unauthorized', 'Missing or unknown token');
      const raw = route[0] === 'POST' ? await readBody(req, /\/media(\/|$)|\/transcribe$/.test(url.pathname) ? MAX_UPLOAD : 1e6) : Buffer.alloc(0);
      // Retries: the same Idempotency-Key from the same identity returns the first outcome instead of acting twice.
      const key = req.headers['idempotency-key'];
      if (key && route[0] === 'POST' && actor) {
        if (!/^[\w.:-]{8,120}$/.test(key)) throw new DomainError('bad_request', 'Idempotency-Key must be 8–120 characters [A-Za-z0-9_.:-]');
        replayKey = `${actor.type}:${actor.id}:${key}`;
        // Identity = method, path, the metadata headers that change meaning (upload title/credit/licence/rights), body.
        const meta = ['content-type', 'x-filename', 'x-title', 'x-credit', 'x-license', 'x-rights-declared'].map(h => `${h}:${req.headers[h] ?? ''}`).join('\n');
        const fingerprint = sha256(Buffer.concat([Buffer.from(`${req.method} ${url.pathname}\n${meta}\n`), raw])), seen = desk.state.idempotency[replayKey];
        if (seen) {
          if (seen.fingerprint !== fingerprint) throw new DomainError('idempotency_conflict', 'This Idempotency-Key was already used for a different request');
          res.setHeader('idempotent-replay', 'true'); return send(res, seen.status, seen.body);
        }
        replayKey = {replayKey, fingerprint};
      }
      const result = await route[2]({actor, req, res, url, raw, json: () => parseJson(raw), m: url.pathname.match(route[1])});
      if (result === SENT) return; // the route streamed its own response (owner-only file)
      const ivId = url.pathname.match(/^\/api\/(?:interviews|briefs)\/(\w+)(?:\/|$)/)?.[1] || (url.pathname === '/api/interviews' && result?.id) || null;
      if (replayKey && !url.pathname.endsWith('/transcribe')) remember(replayKey, 200, result, ivId); // transcripts are never kept for retries
      send(res, 200, result);
    } catch (error) {
      if (error instanceof DomainError) {
        const status = STATUS[error.code] || 409, body = {error: error.code, message: error.message, ka: kaMessage(error.code, error.message) || undefined, details: error.details};
        if (replayKey && error.code !== 'idempotency_conflict') remember(replayKey, status, body, url.pathname.match(/^\/api\/(?:interviews|briefs)\/(\w+)(?:\/|$)/)?.[1] || null);
        send(res, status, body);
      } else { if (!quiet) console.error(error); send(res, 500, {error: 'internal', message: 'Internal error'}); }
    }
  }

  const server = http.createServer((req, res) => { handle(req, res).catch(() => { if (!res.headersSent) send(res, 500, {error: 'internal'}); }); });
  server.on('close', () => { clearInterval(timer); for (const res of clients) res.end(); });
  return {server, get desk() { return desk; }, publicState, dataDir};
}

// Local links for the people and MCP settings for the agents. Never published.
// What ECHO's moderator says in house segments, written from the current programme (no LLM).
export function hostLines(state) {
  const creators = Object.values(state.people).filter(p => p.role === 'creator').map(p => p.name);
  const names = creators.length > 1 ? `${creators.slice(0, -1).join(', ')} and ${creators.at(-1)}` : creators[0];
  const premiere = Object.values(state.segments).find(s => state.bookings[s.id]?.state === 'confirmed');
  const lines = {
    interstitial: `You're watching ECHO. Coming up, a confirmed premiere from ${premiere ? state.people[premiere.ownerId].name : 'our creators'}.`,
    outro: `That was ${state.episode.title}. Made by ${names}, and their agents, together. See you at the next premiere.`,
  };
  return state.order.map(id => state.segments[id]).filter(s => s.module === 'host' && s.duration > 0 && !s.content?.voice && lines[s.content?.line])
    .map(s => ({id: s.id, text: lines[s.content.line]}));
}

export function credentialsText(state, base) {
  const lines = ['ECHO local credentials — keep private', ''];
  for (const p of Object.values(state.people)) lines.push(`${p.name} (${p.role}) board: ${base}/board/#token=${p.token}`);
  lines.push('');
  for (const a of Object.values(state.agents)) lines.push(`${a.label}: ECHO_URL=${base} ECHO_AGENT_TOKEN=${a.token}`);
  return lines.join('\n') + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = +process.env.PORT || 8787, host = process.env.HOST || '127.0.0.1';
  const people = process.env.ECHO_PEOPLE ? JSON.parse(process.env.ECHO_PEOPLE) : {};
  const dataDir = process.env.ECHO_DATA_DIR || join(ROOT, 'data');
  const echo = createEchoServer({dataDir, seedOptions: {people, format: process.env.ECHO_FORMAT || undefined, rehearsal: process.env.ECHO_REHEARSAL === '1'}});
  echo.server.listen(port, host, () => {
    const base = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`;
    writeFileSync(join(dataDir, 'credentials.txt'), credentialsText(echo.desk.state, base), {mode: 0o600});
    console.log(`ECHO broadcast server on ${base}\n  Board:     ${base}/board/\n  Broadcast: ${base}/broadcast/\n  Credentials written to ${join(dataDir, 'credentials.txt')}`);
  });
}
