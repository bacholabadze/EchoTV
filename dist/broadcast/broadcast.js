// ECHO playout: renders exactly the published manifest on the server's on-air clock.
// Every viewer computes the same programme position from onAirAt, so joining late or reconnecting lands in sync.
import * as THREE from 'three';
import {GLTFLoader} from '/lab/vendor/GLTFLoader.js';
import {conversationSeats, conversationFrame, conversationPracticals} from '/studio/blocking.js?v=5';
import {lightEditorialRoom} from '/studio/materials.js?v=6';
import {makeEditorialCharacter} from '/studio/editorial-characters.js?v=6';
import {createRoom, applyPerformance} from '/studio/room.js?v=5';
import {captionAt} from '/studio/core.js?v=2';

const $ = s => document.querySelector(s), screen = $('#screen');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const audio = new Audio(); audio.preload = 'auto';
let state = null, offset = 0, soundOn = false, analyser = null, levels = null, lastSync = 0, view = {};
const now = () => Date.now() + offset;
const fmt = t => `${Math.floor(Math.max(0, t) / 60)}:${String(Math.floor(Math.max(0, t) % 60)).padStart(2, '0')}`;
const setText = (sel, text) => { const el = $(sel); if (el.textContent !== text) el.textContent = text; };

// ---------- 3D studio (house host segments) ----------
const studio = {ready: false, failed: false, visualTime: 0, last: 0};
async function loadStudio() {
  try {
    const canvas = $('#studio');
    const renderer = new THREE.WebGLRenderer({canvas, antialias: true, powerPreference: 'low-power'});
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .88;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    const camera = new THREE.PerspectiveCamera(37, 16 / 9, .05, 30);
    const [gltf, hair] = await Promise.all([new GLTFLoader().loadAsync('/studio/lookdev/assets/cast-clean-v6.glb'), new GLTFLoader().loadAsync('/studio/lookdev/assets/hair-clean-v6.glb')]);
    const room = createRoom(gltf.scene, {cast: conversationSeats, practicalPositions: conversationPracticals, actorFactory: (base, i) => makeEditorialCharacter(base, i, {hairLibrary: hair.scene})});
    lightEditorialRoom(room.scene);
    Object.assign(studio, {renderer, camera, scene: room.scene, actors: room.actors, ready: true});
    // Compile shaders and upload geometry now, so the first host frame on air is not a long frame.
    try { renderer.compile(room.scene, camera); frameShot('wide'); renderer.render(room.scene, camera); } catch {}
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); studio.failed = true; studio.ready = false; });
  } catch (error) { studio.failed = true; console.warn('Studio unavailable:', error.message); }
}
function frameShot(shot) {
  const {renderer, camera} = studio, w = screen.clientWidth, h = screen.clientHeight;
  if (studio.size !== `${w}x${h}`) { renderer.setSize(w, h, false); camera.aspect = w / h; studio.size = `${w}x${h}`; studio.shot = null; }
  if (studio.shot === shot) return;
  const p = conversationFrame(shot, w / h);
  camera.position.set(...p.slice(0, 3)); camera.fov = p[6]; camera.lookAt(...p.slice(3, 6)); camera.updateProjectionMatrix(); studio.shot = shot;
}
function renderHost(host, local, ms) {
  const dt = studio.last ? Math.min((ms - studio.last) / 1000, .08) : 1 / 30; studio.last = ms; studio.visualTime += dt;
  frameShot(local < 1.8 ? 'wide' : 'echo');
  const speaking = !!host && local < host.duration;
  const cues = host?.cues || [], cue = speaking ? cues.find(c => local >= c.start && local < c.end) : null;
  const performance = {speaker: 'echo', speaking, mouthStrength: .56, expressive: true, directed: true, attention: [{at: 0, target: 'audience'}],
    gestures: [{at: 1.2, duration: 1.6, strength: .5}], performance: [{at: .2, actor: 'echo', intent: 'warmth', duration: Math.max(2, (host?.duration || 4) - .4)}],
    audioTime: local, cue, reaction: null, reactionAge: 0};
  for (const actor of studio.actors) applyPerformance(actor, studio.visualTime, dt, performance, reduced);
  studio.renderer.render(studio.scene, studio.camera);
}

// ---------- audio ----------
// Required-audio watchdog: playback must keep advancing. No progress for STALL_MS → visible "interrupted" state and
// a bounded number of reloads; no progress for FAIL_MS → visible "unavailable", the programme continues without it.
const STALL_MS = 2500, FAIL_MS = 8000, MAX_RETRIES = 3;
const health = {src: null, state: 'ok', since: 0, lastTime: -1, retries: 0, lastRetry: 0, errored: false, recoveries: 0};
audio.addEventListener('error', () => { health.errored = true; });
audio.addEventListener('playing', () => { const b = state?.broadcast; if (b?.onAirAt) (view.playing ??= []).push({src: audio.dataset.src, t: +((now() - b.onAirAt) / 1000).toFixed(4)}); });
function resetHealth(src) { Object.assign(health, {src, state: 'ok', since: performance.now(), lastTime: audio.currentTime, retries: 0, lastRetry: 0, errored: false}); }
function watchAudio(src, expected) {
  const t = performance.now();
  if (health.src !== src) resetHealth(src);
  if (health.state === 'failed') return;
  // Progress means decoded media advancing on its own; our own seeks (see seekTo) never count.
  if (!health.errored && !audio.paused && audio.readyState >= 2 && audio.currentTime !== health.lastTime) {
    health.lastTime = audio.currentTime; health.since = t;
    if (health.state !== 'ok') { health.state = 'ok'; health.recoveries++; }
    return;
  }
  const stuck = t - health.since;
  if (stuck > FAIL_MS) { health.state = 'failed'; audio.pause(); return; }
  if (stuck > STALL_MS || health.errored) {
    health.state = 'stalled';
    if (health.retries < MAX_RETRIES && t - health.lastRetry > STALL_MS) {
      health.retries++; health.lastRetry = t; health.errored = false;
      audio.src = `${src}${src.includes('?') ? '&' : '?'}retry=${health.retries}`; seekTo(expected); audio.play().catch(() => {});
    }
  }
}
function seekTo(t) { audio.currentTime = t; health.lastTime = audio.currentTime; }
function syncAudio(src, expected, volume = 1, end = Infinity) {
  view.audioNeeded = false;
  if (!soundOn || !src || expected >= end) { stopAudio(); return; }
  view.audioNeeded = true;
  if (health.src === src && health.state === 'failed') return;
  watchAudio(src, expected);
  audio.volume = Math.max(0, Math.min(1, volume));
  const t = performance.now();
  if (audio.dataset.src !== src) { audio.dataset.src = src; audio.src = src; seekTo(expected); audio.play().catch(() => {}); lastSync = t; return; }
  if (audio.paused && health.state === 'ok') { if (Math.abs(audio.currentTime - expected) > .1) seekTo(expected); audio.play().catch(() => {}); lastSync = t; return; }
  if (t - lastSync < 400 || health.state !== 'ok') return;
  lastSync = t;
  if (Math.abs(audio.currentTime - expected) > .35) seekTo(expected);
}
// A deliberate stop ends watching: the next segment that needs audio (even the same file) starts a fresh watch.
function stopAudio() { if (!audio.paused) audio.pause(); health.src = null; }

// ---------- modules ----------
function lower(kicker, title, credit, owner) {
  const el = $('#lower'); el.hidden = !title; el.dataset.owner = owner || '';
  setText('#lower-kicker', kicker); setText('#lower-title', title || ''); setText('#lower-credit', credit || '');
}
function slate(eyebrow, title, text, meta = '') {
  screen.dataset.module = 'slate'; stopAudio(); $('#lower').hidden = true; $('#caption').hidden = true;
  setText('#slate-eyebrow', eyebrow); setText('#slate-title', title); setText('#slate-text', text); setText('#slate-meta', meta);
}
const assetOf = (seg, id) => seg.assets.find(a => a.id === id) || seg.assets[0];

// Required-image check: every slide must load and decode. A broken or missing artwork is shown as a visible
// fault with its credits, never as a blank frame under a plain "Live". Bounded: undecided after 8 s = failed.
const IMAGE_SLOW_MS = 1500, IMAGE_FAIL_MS = 8000, images = new Map();
function checkImage(url) {
  if (!images.has(url)) {
    images.set(url, 'loading');
    const img = new Image(); img.src = url;
    img.decode().then(() => images.set(url, img.naturalWidth > 0 ? 'ok' : 'failed'), () => images.set(url, 'failed'));
    setTimeout(() => { if (images.get(url) === 'loading') images.set(url, 'failed'); }, IMAGE_FAIL_MS);
  }
  return images.get(url);
}
// The image on screen is the authority, not the preload: the displayed element makes its own fetch, which can fail
// after a successful preload (e.g. once the cache is evicted). Each assignment is judged by that element's own
// decode result, bounded in time, and a failed slide is retried while it stays on screen (same approved URL).
const IMAGE_RETRIES = 3, IMAGE_RETRY_MS = 2000, shown = new WeakMap();
function showImage(img, url, attempt = 0) {
  const rec = {url, attempt, state: attempt ? 'retrying' : 'loading', at: performance.now()};
  shown.set(img, rec);
  if (attempt) img.removeAttribute('src');
  img.src = url;
  const settle = ok => { if (shown.get(img) === rec) { rec.state = ok && img.naturalWidth > 0 ? 'ok' : 'failed'; rec.at = performance.now(); } };
  img.decode().then(() => settle(true), () => settle(false));
}
function displayedStatus(img) {
  const rec = img && shown.get(img), t = performance.now();
  if (!rec) return 'loading';
  if ((rec.state === 'loading' || rec.state === 'retrying') && t - rec.at > IMAGE_FAIL_MS) { rec.state = 'failed'; rec.at = t; }
  if (rec.state === 'failed' && rec.attempt < IMAGE_RETRIES && t - rec.at > IMAGE_RETRY_MS) showImage(img, rec.url, rec.attempt + 1);
  return rec.state === 'retrying' ? 'failed' : rec.state;
}
function playArt(seg, local) {
  const slides = seg.content.slides || [];
  let at = 0, index = 0;
  for (let i = 0; i < slides.length; i++) { if (local >= at && local < at + slides[i].seconds) { index = i; break; } at += slides[i].seconds; index = i; }
  const slide = slides[index], asset = assetOf(seg, slide?.assetId), progress = slide ? Math.min(1, (local - at) / slide.seconds) : 0;
  if (view.artKey !== `${seg.id}:${index}`) {
    view.artKey = `${seg.id}:${index}`; view.slideAt = performance.now();
    const [on, off] = $('#art-a').classList.contains('on') ? [$('#art-b'), $('#art-a')] : [$('#art-a'), $('#art-b')];
    showImage(on, asset.url); on.alt = `${asset.title || ''}, ${asset.credit || ''}`; on.classList.add('on'); off.classList.remove('on');
  }
  // Shown only when the displayed element decoded; failed when it failed, or while it is pending and the preload failed.
  const display = displayedStatus(document.querySelector('#art img.on')), preload = checkImage(asset.url);
  const status = display === 'ok' ? 'ok' : display === 'failed' || preload === 'failed' ? 'failed' : 'loading';
  const slow = status === 'loading' && performance.now() - view.slideAt > IMAGE_SLOW_MS;
  view.artFault = status === 'failed' ? {state: 'failed', asset} : slow ? {state: 'stalled', asset} : null;
  $('#art-missing').hidden = status !== 'failed';
  if (status === 'failed') { setText('#art-missing-title', asset.title || 'Untitled'); setText('#art-missing-credit', [asset.credit, asset.license].filter(Boolean).join(' · ')); }
  const img = document.querySelector('#art img.on');
  if (img && !reduced) img.style.transform = `scale(${1.02 + .06 * progress}) translate(${(index % 2 ? -1 : 1) * progress * 1.2}%, ${-progress * .8}%)`;
  lower(`Art gallery · curated by ${seg.owner} · ${index + 1}/${slides.length}`, asset.title, [asset.credit, asset.license].filter(Boolean).join(' · '), seg.ownerId);
  stopAudio();
}
function playMusic(seg, local) {
  const asset = assetOf(seg, seg.content.assetId), expected = (seg.content.offset || 0) + local;
  setText('#music-badge', seg.confirmed ? `Premiere · confirmed slot ${fmt(seg.start)}` : seg.title);
  // A segment prepared from a creator brief credits the creator's approved display name and discloses AI use.
  const brief = seg.content.brief, AI = {none: 'შექმნილია AI-ს გარეშე', assisted: 'შექმნილია AI-ს დახმარებით', substantial: 'ნამუშევრის დიდი ნაწილი AI-მ შექმნა', unsure: 'AI-ის როლი ზუსტდება'};
  setText('#music-name', (brief?.title || asset.title || seg.title)); setText('#music-credit', brief ? `${brief.displayName} · ${AI[brief.aiInvolvement] || ''}` : `${seg.title} · ${seg.owner} · ${asset.license || ''}`);
  $('#lower').hidden = true;
  syncAudio(asset.url, expected, Math.min(local / .4, (seg.duration - local) / .8));
  drawViz(local);
}
function playHost(seg, local, ms) {
  const host = seg.content.host;
  lower('ECHO · host', seg.title, host?.credit || (host?.audio ? 'Scripted from the approved programme · offline synthetic voice' : 'Scripted from the approved programme · captions only (voice unavailable)'), seg.ownerId);
  const caption = host ? captionAt({text: host.text, captions: host.captions}, local) : '';
  $('#caption').hidden = !caption || local > (host?.duration ?? 0) + .8; setText('#caption', caption);
  syncAudio(host?.audio, local, 1, host?.duration ?? 0);
  if (studio.ready) renderHost(host, local, ms);
  else slate('ECHO · host', host?.text || seg.title, studio.failed ? '3D studio unavailable on this device; the programme continues.' : 'Loading the studio…');
}

function drawViz(local) {
  const canvas = $('#viz'), c = canvas.getContext('2d'), w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w) { canvas.width = w; canvas.height = h; }
  c.clearRect(0, 0, w, h);
  const bars = 64, gap = w * .002, bw = (w * .88) / bars - gap;
  if (analyser && soundOn) analyser.getByteFrequencyData(levels);
  let active = 0, peak = 0;
  for (let i = 0; i < bars; i++) {
    // Bars span ~0–3.5 kHz on a curved scale with a gentle high-frequency tilt, so the whole spectrum moves.
    const bin = levels ? 1 + Math.floor(Math.pow(i / (bars - 1), 1.7) * (levels.length * .16)) : 0;
    const level = analyser && soundOn ? Math.min(1, levels[bin] / 255 * (.8 + i / bars * .9)) : (.25 + .2 * Math.sin(local * 2 + i * .35)) * (reduced ? .5 : 1);
    if (level > .08) active++; peak = Math.max(peak, level);
    const bh = Math.max(2, level * h * .42);
    c.fillStyle = `rgba(143,195,216,${.35 + level * .6})`;
    c.fillRect(w * .06 + i * (bw + gap), h * .9 - bh, bw, bh);
  }
  view.viz = {active, peak: +peak.toFixed(3), live: !!(analyser && soundOn)};
}

// ---------- start authorisation (N04) ----------
// A scheduled publication starts on this viewer only after the server confirms that this exact publication may start.
// The server answers once its own clock has reached onAirAt, after which a rejection can no longer withdraw it, so the
// answer is final. The event stream alone never authorises playback: it can arrive late or not at all. The check is
// sent ~2 s early so the answer arrives right at onAirAt. A confirmed start is kept: a running programme is never
// re-checked or interrupted (on air, only the producer's Stop ends it). No answer = nothing plays (fail closed).
const VERIFY_TIMEOUT_MS = 2000, VERIFY_RETRY_MS = 1000, starts = new Map();
function startCheck(b, m) {
  const key = `${m.publicationId}:${m.hash}:${b.onAirAt}`, prev = starts.get(key), t = performance.now();
  if (prev && !(prev.state === 'error' && t - prev.at > VERIFY_RETRY_MS) && !(prev.state === 'pending' && t > prev.retryAt)) return prev;
  const check = {state: prev?.state === 'error' ? 'retrying' : 'checking', at: t, attempts: (prev?.attempts || 0) + 1};
  starts.set(key, check);
  const params = new URLSearchParams({publicationId: m.publicationId, hash: m.hash, onAirAt: b.onAirAt});
  fetch(`/api/broadcast/activation?${params}`, {cache: 'no-store', signal: AbortSignal.timeout(Math.max(0, b.onAirAt - now()) + VERIFY_TIMEOUT_MS)})
    .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
    .then(x => {
      if (starts.get(key) !== check) return;
      if (x.pending) Object.assign(check, {state: 'pending', retryAt: performance.now() + Math.min(x.retryInMs, 3000)});
      else Object.assign(check, {state: x.permitted ? 'permitted' : 'denied', reason: x.reason || '', answeredAt: Date.now()});
    })
    .catch(e => { if (starts.get(key) === check) Object.assign(check, {state: 'error', at: performance.now(), reason: e.name === 'TimeoutError' ? 'no answer in time' : 'network error'}); });
  return check;
}

// ---------- programme clock ----------
function tick(ms) {
  requestAnimationFrame(tick);
  if (ms - (view.lastFrame || 0) < 32) return; view.lastFrame = ms;
  const b = state?.broadcast, m = b?.manifest;
  screen.dataset.live = 'no';
  if (!state) return;
  if (!m || b.state === 'queued') { $('#fault').hidden = true; screen.dataset.audio = 'ok'; setText('#onair-label', 'Off air'); setText('#manifest', ''); setText('#clock', ''); setText('#next', ''); return slate('ECHO TV', 'Off air', 'The next programme is being prepared on the Production Board by its creators and their agents.'); }
  setText('#manifest', `publication #${m.publicationId ?? '–'} · r${m.publishRevision} · ${m.hash.slice(0, 10)}`);
  // Say which synthetic voices this publication really uses (from the approved manifest), never a fixed claim.
  const hosts = m.segments.map(s => s.content?.host).filter(h => h?.audio), cloud = hosts.some(h => /ElevenLabs/.test(h.credit || ''));
  setText('#voice-disclosure', !hosts.length ? 'shown as captions (no voice)' : cloud ? `synthetic (${hosts.some(h => !/ElevenLabs/.test(h.credit || '')) ? 'ElevenLabs and Piper, offline' : 'ElevenLabs'})` : 'synthesised offline (Piper)');
  if (b.state === 'failed') { $('#fault').hidden = true; screen.dataset.audio = 'ok'; setText('#onair-label', 'Technical break'); return slate('ECHO TV', 'We’ll be right back.', 'Playout was stopped by the producer. Approved programme r' + m.publishRevision + ' is safe.'); }
  if (b.state === 'ready') { $('#fault').hidden = true; screen.dataset.audio = 'ok'; setText('#onair-label', 'Standby'); setText('#clock', `0:00 / ${fmt(m.durationSec)}`); setText('#next', ''); return slate('Next on ECHO', m.title, `${m.segments.map(s => s.title).join(' · ')}`, `Approved revision r${m.publishRevision} · waiting for the producer to go live`); }
  const t = (now() - b.onAirAt) / 1000, startKey = `${m.publicationId}:${m.hash}:${b.onAirAt}`;
  if (t < 0) { if (t > -2) startCheck(b, m); view.start = starts.get(startKey)?.state; $('#fault').hidden = true; screen.dataset.audio = 'ok'; setText('#onair-label', 'Starting'); return slate('ECHO TV', `On air in ${Math.ceil(-t)}`, m.title, `Approved revision r${m.publishRevision} · ${m.hash.slice(0, 10)}`); }
  // The server refused this start: it was withdrawn before air, whatever the (possibly stale) event stream still says.
  if (starts.get(startKey)?.state === 'denied') { view.start = 'denied'; $('#fault').hidden = true; screen.dataset.audio = 'ok'; setText('#next', ''); setText('#clock', ''); setText('#onair-label', 'Off air'); return slate('ECHO TV', 'Off air', 'This programme was withdrawn before air and will not be shown.', starts.get(startKey).reason); }
  if (t >= m.durationSec) { $('#fault').hidden = true; screen.dataset.audio = 'ok'; setText('#onair-label', 'Ended'); setText('#next', ''); setText('#clock', `${fmt(m.durationSec)} / ${fmt(m.durationSec)}`); return slate('That was', m.title, `Made by ${[...new Set(m.segments.filter(s => s.ownerId !== 'producer').map(s => s.owner))].sort().join(' and ')} with their agents, coordinated by the ECHO Showrunner.`, `Aired revision r${m.publishRevision} · ${m.hash.slice(0, 10)} · ${fmt(m.durationSec)}`); }
  const start = startCheck(b, m); view.start = start.state;
  if (start.state !== 'permitted') {
    $('#fault').hidden = true; screen.dataset.audio = 'ok'; setText('#next', ''); setText('#clock', '');
    const unable = start.state === 'error' || start.state === 'retrying';
    setText('#onair-label', unable ? 'Unable to verify' : 'Waiting');
    return slate('ECHO TV', unable ? 'Waiting for the studio' : 'Starting…', unable ? `Unable to verify this programme with the studio (${start.reason || 'retrying'}). Nothing plays until the start is confirmed; retrying.` : 'Confirming the start with the studio.', `Approved revision r${m.publishRevision} · ${m.hash.slice(0, 10)}`);
  }
  screen.dataset.live = 'yes';
  const seg = m.segments.find(s => t >= s.start && t < s.start + s.duration), next = m.segments[m.segments.indexOf(seg) + 1], local = t - seg.start;
  setText('#clock', `${fmt(t)} / ${fmt(m.durationSec)}`);
  setText('#next', next ? `Next · ${next.title} at ${fmt(next.start)}${next.confirmed ? ' · confirmed' : ''}` : 'Final segment');
  view.segment = seg.id; view.local = local; view.t = t;
  view.onsets ??= {}; if (!(seg.id in view.onsets)) view.onsets[seg.id] = +t.toFixed(4);
  if (seg.module !== 'host') $('#caption').hidden = true;
  screen.dataset.module = seg.module;
  view.audioNeeded = false; // set again by syncAudio when this segment requires sound
  if (seg.module === 'art') playArt(seg, local);
  else if (seg.module === 'music') playMusic(seg, local);
  else if (seg.module === 'host') playHost(seg, local, ms);
  // Never a plain "Live" while required audio or a required image is not actually playing.
  const audioFault = view.audioNeeded && health.src === audio.dataset.src && health.state !== 'ok' ? health.state : null;
  const imageFault = seg.module === 'art' ? view.artFault : null;
  const fault = audioFault ? {kind: 'audio', state: audioFault} : imageFault ? {kind: 'image', ...imageFault} : null;
  screen.dataset.audio = fault?.state || 'ok';
  setText('#onair-label', !fault ? 'Live' : fault.kind === 'audio' ? (fault.state === 'stalled' ? 'Live · audio interrupted' : 'Live · audio unavailable') : (fault.state === 'stalled' ? 'Live · artwork loading' : 'Live · artwork unavailable'));
  $('#fault').hidden = !fault; $('#fault-retry').hidden = !(fault?.kind === 'audio' && fault.state === 'failed');
  if (fault) setText('#fault-text', fault.kind === 'audio'
    ? (fault.state === 'stalled' ? `Audio interrupted — reconnecting (attempt ${health.retries} of ${MAX_RETRIES})` : `Audio unavailable for “${seg.title}” — the programme continues without sound`)
    : (fault.state === 'stalled' ? `Artwork “${fault.asset.title || 'untitled'}” is still loading` : `Artwork “${fault.asset.title || 'untitled'}” could not be displayed — the programme continues`));
  // Get the next segment ready so it starts on time: pre-seek its audio and pre-render the studio.
  if (next && next.start - t <= 1.5) prepare(next, ms);
}
function prepare(next, ms) {
  const src = next.module === 'music' ? assetOf(next, next.content.assetId).url : next.module === 'host' ? next.content.host?.audio : null;
  if (src && soundOn && !view.audioNeeded) {
    const at = next.module === 'music' ? next.content.offset || 0 : 0;
    if (audio.dataset.src !== src) { audio.dataset.src = src; audio.src = src; seekTo(at); }
    else if (audio.paused && Math.abs(audio.currentTime - at) > .05) seekTo(at);
  }
  if (next.module === 'host' && studio.ready && view.warmed !== next.id) { view.warmed = next.id; renderHost(next.content.host, 0, ms); }
  if (next.module === 'art') for (const slide of next.content.slides || []) checkImage(assetOf(next, slide.assetId).url);
}

$('#sound').onclick = () => {
  soundOn = true; $('#sound').hidden = true;
  try {
    const ctx = new AudioContext(), source = ctx.createMediaElementSource(audio);
    analyser = ctx.createAnalyser(); analyser.fftSize = 512; analyser.smoothingTimeConstant = .75; levels = new Uint8Array(analyser.frequencyBinCount);
    source.connect(analyser); analyser.connect(ctx.destination);
  } catch { analyser = null; }
  audio.dataset.src = '';
};

const events = new EventSource('/api/events');
const preloaded = new Set();
// Fetch every image of the published manifest up front so a slide never appears blank.
function preload(m) { for (const seg of m?.segments || []) for (const a of seg.assets) if (a.kind === 'image' && !preloaded.has(a.url)) { preloaded.add(a.url); checkImage(a.url); } }
// Clock: round-trip-corrected samples of /api/time (lowest-latency sample wins). SSE delivery can be delayed or
// buffered, so its timestamps are only used until the first real sample arrives.
let clockSamples = [], clockSynced = false;
async function syncClock() {
  try {
    const t0 = Date.now(), r = await fetch('/api/time', {cache: 'no-store'}), {serverTime} = await r.json(), t1 = Date.now();
    clockSamples = [...clockSamples, {rtt: t1 - t0, offset: serverTime - (t0 + t1) / 2}].slice(-8);
    offset = clockSamples.reduce((best, x) => x.rtt < best.rtt ? x : best).offset; clockSynced = true;
  } catch {}
}
for (const delay of [0, 300, 900]) setTimeout(syncClock, delay);
setInterval(syncClock, 10000);
events.addEventListener('state', e => { state = JSON.parse(e.data); if (!clockSynced) offset = state.serverTime - Date.now(); preload(state.broadcast?.manifest); });
$('#fault-retry').onclick = () => { if (health.src) { resetHealth(health.src); audio.dataset.src = ''; } };
const audioLevel = () => { if (!analyser) return null; const d = new Uint8Array(analyser.fftSize); analyser.getByteTimeDomainData(d); let m = 0; for (const v of d) m = Math.max(m, Math.abs(v - 128)); return m / 128; };
window.EchoBroadcast = {getState: () => ({start: view.start, onsets: view.onsets || {}, playing: view.playing || [], artFault: view.artFault ? {state: view.artFault.state, assetId: view.artFault.asset.id} : null, audioHealth: {state: health.state, retries: health.retries, recoveries: health.recoveries, needed: !!view.audioNeeded}, onAirLabel: $('#onair-label').textContent, faultVisible: !$('#fault').hidden, clockSynced, clockOffsetMs: Math.round(offset), publicationId: state?.broadcast?.manifest?.publicationId, viz: view.viz, audioLevel: audioLevel(), module: screen.dataset.module, live: screen.dataset.live === 'yes', segment: view.segment, programmeTime: view.t, publishRevision: state?.broadcast?.publishRevision, hash: state?.broadcast?.manifest?.hash, broadcastState: state?.broadcast?.state, studioReady: studio.ready, soundOn, audioTime: audio.currentTime, audioSrc: audio.dataset.src})};
loadStudio();
requestAnimationFrame(tick);
