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
function syncAudio(src, expected, volume = 1, end = Infinity) {
  if (!soundOn || !src || expected >= end) { if (!audio.paused) audio.pause(); return; }
  audio.volume = Math.max(0, Math.min(1, volume));
  const t = performance.now();
  if (audio.dataset.src !== src) { audio.dataset.src = src; audio.src = src; audio.currentTime = expected; audio.play().catch(() => {}); lastSync = t; return; }
  if (t - lastSync < 400) return;
  lastSync = t;
  if (audio.paused) { audio.currentTime = expected; audio.play().catch(() => {}); }
  else if (Math.abs(audio.currentTime - expected) > .35) audio.currentTime = expected;
}
function stopAudio() { if (!audio.paused) audio.pause(); }

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

function playArt(seg, local) {
  const slides = seg.content.slides || [];
  let at = 0, index = 0;
  for (let i = 0; i < slides.length; i++) { if (local >= at && local < at + slides[i].seconds) { index = i; break; } at += slides[i].seconds; index = i; }
  const slide = slides[index], asset = assetOf(seg, slide?.assetId), progress = slide ? Math.min(1, (local - at) / slide.seconds) : 0;
  if (view.artKey !== `${seg.id}:${index}`) {
    view.artKey = `${seg.id}:${index}`;
    const [on, off] = $('#art-a').classList.contains('on') ? [$('#art-b'), $('#art-a')] : [$('#art-a'), $('#art-b')];
    on.src = asset.url; on.alt = `${asset.title || ''}, ${asset.credit || ''}`; on.classList.add('on'); off.classList.remove('on');
  }
  const img = document.querySelector('#art img.on');
  if (img && !reduced) img.style.transform = `scale(${1.02 + .06 * progress}) translate(${(index % 2 ? -1 : 1) * progress * 1.2}%, ${-progress * .8}%)`;
  lower(`Art gallery · curated by ${seg.owner} · ${index + 1}/${slides.length}`, asset.title, [asset.credit, asset.license].filter(Boolean).join(' · '), seg.ownerId);
  stopAudio();
}
function playMusic(seg, local) {
  const asset = assetOf(seg, seg.content.assetId), expected = (seg.content.offset || 0) + local;
  setText('#music-badge', seg.confirmed ? `Premiere · confirmed slot ${fmt(seg.start)}` : seg.title);
  setText('#music-name', asset.title || seg.title); setText('#music-credit', `${seg.title} · ${seg.owner} · ${asset.license || ''}`);
  $('#lower').hidden = true;
  syncAudio(asset.url, expected, Math.min(local / .4, (seg.duration - local) / .8));
  drawViz(local);
}
function playHost(seg, local, ms) {
  const host = seg.content.host;
  lower('ECHO · host', seg.title, host?.audio ? 'Scripted from the approved programme · offline synthetic voice' : 'Scripted from the approved programme · captions only (voice unavailable)', seg.ownerId);
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
  for (let i = 0; i < bars; i++) {
    // Bars span ~0–3.5 kHz on a curved scale with a gentle high-frequency tilt, so the whole spectrum moves.
    const bin = levels ? 1 + Math.floor(Math.pow(i / (bars - 1), 1.7) * (levels.length * .16)) : 0;
    const level = analyser && soundOn ? Math.min(1, levels[bin] / 255 * (.8 + i / bars * .9)) : (.25 + .2 * Math.sin(local * 2 + i * .35)) * (reduced ? .5 : 1);
    const bh = Math.max(2, level * h * .42);
    c.fillStyle = `rgba(143,195,216,${.35 + level * .6})`;
    c.fillRect(w * .06 + i * (bw + gap), h * .9 - bh, bw, bh);
  }
}

// ---------- programme clock ----------
function tick(ms) {
  requestAnimationFrame(tick);
  if (ms - (view.lastFrame || 0) < 32) return; view.lastFrame = ms;
  const b = state?.broadcast, m = b?.manifest;
  screen.dataset.live = 'no';
  if (!state) return;
  if (!m || b.state === 'queued') { setText('#onair-label', 'Off air'); setText('#manifest', ''); setText('#clock', ''); setText('#next', ''); return slate('ECHO TV', 'Off air', 'The next programme is being prepared on the Production Board by its creators and their agents.'); }
  setText('#manifest', `manifest r${m.publishRevision} · ${m.hash.slice(0, 10)}`);
  if (b.state === 'failed') { setText('#onair-label', 'Technical break'); return slate('ECHO TV', 'We’ll be right back.', 'Playout was stopped by the producer. Approved programme r' + m.publishRevision + ' is safe.'); }
  if (b.state === 'ready') { setText('#onair-label', 'Standby'); setText('#clock', `0:00 / ${fmt(m.durationSec)}`); setText('#next', ''); return slate('Next on ECHO', m.title, `${m.segments.map(s => s.title).join(' · ')}`, `Approved revision r${m.publishRevision} · waiting for the producer to go live`); }
  const t = (now() - b.onAirAt) / 1000;
  if (t < 0) { setText('#onair-label', 'Starting'); return slate('ECHO TV', `On air in ${Math.ceil(-t)}`, m.title, `Approved revision r${m.publishRevision} · ${m.hash.slice(0, 10)}`); }
  if (t >= m.durationSec) { setText('#onair-label', 'Ended'); setText('#next', ''); setText('#clock', `${fmt(m.durationSec)} / ${fmt(m.durationSec)}`); return slate('That was', m.title, `Made by ${[...new Set(m.segments.filter(s => s.ownerId !== 'producer').map(s => s.owner))].sort().join(' and ')} with their agents, coordinated by the ECHO Showrunner.`, `Aired revision r${m.publishRevision} · ${m.hash.slice(0, 10)} · ${fmt(m.durationSec)}`); }
  screen.dataset.live = 'yes'; setText('#onair-label', 'Live');
  const seg = m.segments.find(s => t >= s.start && t < s.start + s.duration), next = m.segments[m.segments.indexOf(seg) + 1], local = t - seg.start;
  setText('#clock', `${fmt(t)} / ${fmt(m.durationSec)}`);
  setText('#next', next ? `Next · ${next.title} at ${fmt(next.start)}${next.confirmed ? ' · confirmed' : ''}` : 'Final segment');
  view.segment = seg.id; view.local = local; view.t = t;
  if (seg.module !== 'host') $('#caption').hidden = true;
  screen.dataset.module = seg.module;
  if (seg.module === 'art') playArt(seg, local);
  else if (seg.module === 'music') playMusic(seg, local);
  else if (seg.module === 'host') playHost(seg, local, ms);
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
function preload(m) { for (const seg of m?.segments || []) for (const a of seg.assets) if (a.kind === 'image' && !preloaded.has(a.url)) { preloaded.add(a.url); new Image().src = a.url; } }
events.addEventListener('state', e => { state = JSON.parse(e.data); offset = state.serverTime - Date.now(); preload(state.broadcast?.manifest); });
events.addEventListener('clock', e => { offset = +e.data - Date.now(); });
window.EchoBroadcast = {getState: () => ({module: screen.dataset.module, live: screen.dataset.live === 'yes', segment: view.segment, programmeTime: view.t, publishRevision: state?.broadcast?.publishRevision, hash: state?.broadcast?.manifest?.hash, broadcastState: state?.broadcast?.state, studioReady: studio.ready, soundOn, audioTime: audio.currentTime, audioSrc: audio.dataset.src})};
loadStudio();
requestAnimationFrame(tick);
