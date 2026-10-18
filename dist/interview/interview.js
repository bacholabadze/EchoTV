// ECHO Creator Interview (3.2). Georgian first. A creator answers ECHO's questions by typing or speaking (with
// consent; the transcript is theirs to correct), reviews the brief and approves it. Everything shown comes from the
// server; nothing is marked done before the server says so. The interviewer is the existing ECHO host avatar.
import * as THREE from 'three';
import {GLTFLoader} from '/lab/vendor/GLTFLoader.js';
import {conversationSeats, conversationFrame, conversationPracticals} from '/studio/blocking.js?v=5';
import {lightEditorialRoom} from '/studio/materials.js?v=6';
import {makeEditorialCharacter} from '/studio/editorial-characters.js?v=6';
import {createRoom, applyPerformance} from '/studio/room.js?v=5';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fromHash = new URLSearchParams(location.hash.slice(1)).get('token');
if (fromHash) { try { sessionStorage.setItem('echo-token', fromHash); } catch {} history.replaceState(null, '', location.pathname); }
let token = fromHash; try { token ||= sessionStorage.getItem('echo-token'); } catch {}

const KA = {
  fields: {displayName: 'სახელი ეთერისთვის', workTitle: 'ნამუშევრის სათაური', category: 'კატეგორია', aiInvolvement: 'AI-ის როლი', preferredFormat: 'სასურველი ფორმატი', desiredAirtimeSec: 'სასურველი დრო ეთერში (წამი)', mediaIds: 'ფაილები'},
  answerFields: {workDescription: 'მოკლედ შენ და შენი ნამუშევარი', inspiration: 'შთაგონება', creationProcess: 'რა გააკეთე თავად', presentationFocus: 'რა ვაჩვენოთ', mediaNote: 'შენიშვნა ფაილებზე', presenterNotes: 'წამყვანისთვის'},
  missing: {displayName: 'სახელი ეთერისთვის', workTitle: 'ნამუშევრის სათაური', category: 'კატეგორია', aiInvolvement: 'AI-ის როლი', desiredAirtimeSec: 'სასურველი დრო', mediaIds: 'ფაილი'},
  life: {interview: 'ინტერვიუ', draft: 'ბრიფის მონახაზი', creator_approved: 'შენ დაადასტურე', segment_prepared: 'სეგმენტი მომზადდა', content_reviewed: 'რედაქციამ დაამტკიცა', airtime_requested: 'ეთერის დრო მოთხოვნილია', booking_confirmed: 'დრო დადასტურებულია', published: 'გამოქვეყნდა', on_air: 'ეთერში'},
  uses: {publicBroadcast: 'საჯარო ეთერი', editing: 'მოკლე მონტაჟი', replays: 'განმეორებითი ჩვენება და არქივი', promoExcerpts: 'ანონსის ფრაგმენტი'},
};
const requestKey = () => crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
async function api(method, path, body, headers = {}) {
  const raw = body instanceof Blob;
  const res = await fetch(path, {method, headers: {...(token ? {authorization: `Bearer ${token}`} : {}), ...(method === 'POST' ? {'idempotency-key': requestKey()} : {}), ...(body && !raw ? {'content-type': 'application/json'} : {}), ...headers}, body: raw ? body : body && JSON.stringify(body)});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || data.error || `HTTP ${res.status}`), {code: data.error, status: res.status});
  return data;
}
const ui = {me: null, iv: null, lib: null, mode: 'text', editing: null, rec: null, transcript: null, busy: false, spoken: null};
function showError(e, ka) { const el = $('#error'); el.innerHTML = `${esc(ka || 'რაღაც ვერ გამოვიდა.')}${e ? `<br><small>${esc(e.message)}</small>` : ''}`; el.hidden = false; }
const clearError = () => { $('#error').hidden = true; };
// Read the form first, then act: buttons are disabled in place (re-rendering before the action would reset the inputs).
async function run(fn, ka) { clearError(); ui.busy = true; for (const b of document.querySelectorAll('#view button')) b.disabled = true; try { await fn(); } catch (e) { showError(e, ka); } finally { ui.busy = false; render(); } }

// ---------- data ----------
async function refresh() { ui.iv = ui.iv && await api('GET', `/api/interviews/${ui.iv.id}`); ui.lib = await api('GET', '/api/library'); }
async function boot() {
  if (!token) { $('#view').innerHTML = `<h1>გახსენი შენი პირადი ბმული</h1><p class="hint">ინტერვიუ შემქმნელის პირადი ბმულით იხსნება (დაფაზე „ესაუბრე ECHO-ს“).</p>`; return; }
  try { ui.me = await api('GET', '/api/me'); } catch { $('#view').innerHTML = '<h1>ბმული ვერ ვიცანი</h1>'; return; }
  $('#who').textContent = ui.me.name || ui.me.label;
  if (ui.me.role !== 'creator') { $('#view').innerHTML = '<h1>ინტერვიუ შემქმნელებისთვისაა</h1><p class="hint">Interviews are for creators.</p>'; return; }
  const list = await api('GET', '/api/interviews'), open = list.filter(i => i.status !== 'withdrawn').pop();
  if (open) ui.iv = await api('GET', `/api/interviews/${open.id}`);
  ui.lib = await api('GET', '/api/library');
  render(); loadStudio();
}

// ---------- views ----------
function render() {
  const v = $('#view'), iv = ui.iv;
  if (!ui.me) return;
  if (!iv) { v.innerHTML = `<h1>მოემზადე ეთერისთვის<span class="en">Prepare your appearance</span></h1>
    <p>რამდენიმე მოკლე კითხვა — შენი პასუხებით ECHO შენს ეთერს მოამზადებს. ბოლოს ყველაფერს გადახედავ და მხოლოდ შენ დაადასტურებ.</p>
    <p class="hint">შეგიძლია ხმით ან ტექსტით უპასუხო, ნებისმიერი კითხვა გამოტოვო და მოგვიანებით დაბრუნდე. თუ შენი AI აგენტი გყავს, ის იმავე კითხვებს შენ ნაცვლად უპასუხებს.</p>
    <div class="row"><button class="primary" id="begin" ${ui.busy ? 'disabled' : ''}>დავიწყოთ</button></div>`;
    $('#begin').onclick = () => run(async () => { ui.iv = await api('POST', '/api/interviews'); }, 'ინტერვიუ ვერ დაიწყო.');
    caption('გამარჯობა! მე ECHO ვარ. მოდი, შენი ეთერი ერთად მოვამზადოთ.'); return;
  }
  if (iv.status === 'withdrawn') { v.innerHTML = '<h1>ბრიფი გაუქმებულია</h1><div class="row"><button class="primary" id="again">ახლიდან დაწყება</button></div>'; $('#again').onclick = () => run(async () => { ui.iv = await api('POST', '/api/interviews'); }); return; }
  if (ui.editing || iv.status === 'in_progress') return questionView(ui.editing ? iv.questions.find(q => q.stepId === ui.editing) : iv.prompt);
  if (iv.status === 'review') return reviewView();
  return approvedView();
}

function progress(index) {
  return `<div class="progress" aria-hidden="true">${ui.iv.questions.map((q, i) => `<i class="${i + 1 === index ? 'now' : ui.iv.answers[q.stepId] ? 'done' : ''}"></i>`).join('')}</div>`;
}
function fieldInput(f) {
  const id = `f-${f.key}`, label = `<label for="${id}">${esc(KA.fields[f.key])}</label>`;
  if (f.kind === 'text') return `${label}<input id="${id}" type="text" maxlength="200" value="${esc(f.value || '')}">`;
  if (f.kind === 'seconds') return `${label}<input id="${id}" type="number" min="1" max="600" step="1" inputmode="numeric" value="${esc(f.value || '')}">`;
  if (f.kind === 'choice') return `${label}<select id="${id}"><option value="">— აირჩიე —</option>${f.options.map(o => `<option value="${o.value}"${o.value === f.value ? ' selected' : ''}>${esc(o.ka)}</option>`).join('')}</select>`;
  if (f.kind === 'mediaIds') return mediaPicker(f.value || []);
  return '';
}
function mediaPicker(selected) {
  const items = ui.lib.media.filter(m => m.status !== 'withdrawn');
  return `<label>${KA.fields.mediaIds} <small>(აირჩიე, რისი გამოყენების უფლებასაც გვაძლევ)</small></label>
    <ul class="media">${items.map(m => `<li><label style="display:flex;gap:8px;font-weight:600;margin:0"><input type="checkbox" name="media" value="${m.id}"${selected.includes(m.id) ? ' checked' : ''}> ${esc(m.title)} <span class="tag">${esc({audio: 'აუდიო', image: 'სურათი', video: 'ვიდეო', document: 'დოკუმენტი'}[m.kind] || m.kind)}</span></label>
      <div class="meta">${m.kind === 'document' ? (m.technical?.decodable ? '<span class="ok">მიღებულია</span> <small>(შემოწმდა მხოლოდ PDF ფორმატის ნიშანი; შიგთავსი არ მოწმდება)</small>' : `<span class="bad">მიუღებელია</span> <small>${esc(m.technical?.reason || '')}</small>`) : m.technical?.decodable ? '<span class="ok">ტექნიკური შემოწმება გაიარა</span>' : `<span class="bad">ტექნიკური შემოწმება ვერ გაიარა</span> <small>${esc(m.technical?.reason || '')}</small>`}${m.kind === 'video' ? ' · ვიდეოს ეთერში ჩვენება ჯერ არ არის ხელმისაწვდომი' : m.kind === 'document' ? ' · დამხმარე დოკუმენტი, ეთერში არ გავა' : ''}</div>
      ${rightsEditor(m)}<div class="row"><button data-delete-media="${m.id}">ფაილის წაშლა</button></div></li>`).join('') || '<li class="meta">ბიბლიოთეკა ცარიელია.</li>'}</ul>
    <label for="upload">ახალი ფაილის ატვირთვა <small>(აუდიო, სურათი, ვიდეო ან PDF; არსებული ნამუშევარი — არაფერს ვაგენერირებთ)</small></label>
    <input id="upload" type="file" accept="audio/*,image/*,video/mp4,video/quicktime,video/webm,application/pdf">`;
}
function rightsEditor(m) {
  const r = m.rights || {};
  return `<details class="rights"${m.rights ? '' : ' open'}><summary>${m.rights ? `დაშვებული: ${Object.keys(KA.uses).filter(k => r[k]).map(k => KA.uses[k]).join(', ') || 'არაფერი'}` : 'რისი უფლება გვაქვს? (სავალდებულო)'}</summary>
    ${Object.entries(KA.uses).map(([k, ka]) => `<label><input type="checkbox" data-use="${k}" data-media="${m.id}"${r[k] ? ' checked' : ''}> ${ka}</label>`).join('')}
    <label><input type="checkbox" data-confirm="${m.id}"> ვადასტურებ, რომ ეს ნამუშევარი ჩემია ან ამ გამოყენების უფლება მაქვს</label>
    <div class="row"><button data-save-rights="${m.id}">შენახვა</button></div><small class="meta">ეს შენი განცხადებაა, არა საავტორო უფლების დამოუკიდებელი შემოწმება.</small></details>`;
}

function questionView(p) {
  const iv = ui.iv, editing = !!ui.editing, agent = p.current?.source === 'agent';
  speak(p);
  $('#view').innerHTML = `${progress(p.index)}<p class="step-label">კითხვა ${p.index} / ${p.total}${p.followUp ? ' <span class="tag">დამატებითი კითხვა</span>' : ''}${agent ? ' <span class="tag">ეს პასუხი შენმა აგენტმა მოამზადა</span>' : ''}${editing ? ' <span class="tag">შესწორება</span>' : ''}</p>
    <h1>${esc(p.question.ka)}<span class="en">${esc(p.question.en)}</span></h1>${p.hint ? `<p class="hint">${esc(p.hint.ka)}</p>` : ''}
    <div class="modes" role="group" aria-label="პასუხის ფორმა"><button data-mode="text" aria-pressed="${ui.mode === 'text'}">ტექსტით</button><button data-mode="voice" aria-pressed="${ui.mode === 'voice'}">🎙 ხმით</button></div>
    ${ui.mode === 'voice' ? voicePanel() : `<label for="answer">${esc(KA.answerFields[p.answerField] || 'პასუხი')}</label><textarea id="answer" maxlength="2000" placeholder="შენი პასუხი…">${esc(p.current?.text || '')}</textarea>`}
    ${p.fields.map(fieldInput).join('')}
    <div class="row"><button class="primary" id="next" ${ui.busy || (ui.mode === 'voice' && !ui.transcript) ? 'disabled' : ''}>${editing ? 'შენახვა' : 'შემდეგი'}</button>
      ${editing ? '<button id="cancel">გაუქმება</button>' : `<button id="skip" ${ui.busy ? 'disabled' : ''}>გამოტოვება</button>${p.index > 1 ? '<button id="prev">წინა</button>' : ''}`}</div>`;
  for (const b of document.querySelectorAll('[data-mode]')) b.onclick = () => { ui.mode = b.dataset.mode; render(); };
  $('#next').onclick = () => run(async () => {
    const fields = Object.fromEntries(p.fields.map(f => [f.key, f.kind === 'mediaIds' ? [...document.querySelectorAll('input[name=media]:checked')].map(x => x.value) : f.kind === 'seconds' ? ($(`#f-${f.key}`).value ? +$(`#f-${f.key}`).value : null) : $(`#f-${f.key}`).value || null]));
    const voice = ui.mode === 'voice' && ui.transcript;
    const typed = voice ? $('#transcript').value : $('#answer')?.value || '';
    ui.iv = await api('POST', `/api/interviews/${iv.id}/answer`, {stepId: p.stepId, text: typed, clear: !typed.trim() && !!p.current?.text, fields, source: voice ? 'voice' : 'typed', ...(voice ? {transcript: {provider: ui.transcript.provider, recognised: ui.transcript.recognised}} : {})});
    ui.transcript = null; ui.editing = null;
  }, 'პასუხი ვერ შეინახა.');
  if ($('#skip')) $('#skip').onclick = () => run(async () => { ui.iv = await api('POST', `/api/interviews/${iv.id}/skip`, {stepId: p.stepId}); ui.transcript = null; }, 'ვერ გამოვტოვე.');
  if ($('#prev')) $('#prev').onclick = () => run(async () => { ui.iv = await api('POST', `/api/interviews/${iv.id}/goto`, {stepId: iv.questions[p.index - 2].stepId}); ui.transcript = null; });
  if ($('#cancel')) $('#cancel').onclick = () => { ui.editing = null; ui.transcript = null; render(); };
  wireMedia(); wireVoice();
}
function wireMedia() {
  const up = $('#upload');
  if (up) up.onchange = () => run(async () => {
    const f = up.files[0]; if (!f) return;
    await api('POST', '/api/library/media', f, {'x-filename': encodeURIComponent(f.name), 'x-title': encodeURIComponent(f.name.replace(/\.[^.]+$/, ''))});
    ui.lib = await api('GET', '/api/library');
  }, 'ფაილი ვერ აიტვირთა.');
  for (const b of document.querySelectorAll('[data-delete-media]')) b.onclick = () => { if (confirm('წავშალოთ ფაილი? თუ ის უკვე გადაცემაშია, აუდიტისთვის შეინახება — მაშინ ჯერ გააუქმე.')) run(async () => { await api('POST', `/api/library/media/${b.dataset.deleteMedia}/delete`); ui.lib = await api('GET', '/api/library'); }, 'ფაილი ვერ წაიშალა (შესაძლოა გადაცემაშია).'); };
  for (const b of document.querySelectorAll('[data-save-rights]')) b.onclick = () => run(async () => {
    const id = b.dataset.saveRights, body = {confirm: !!document.querySelector(`[data-confirm="${id}"]`).checked};
    for (const k of Object.keys(KA.uses)) body[k] = !!document.querySelector(`[data-use="${k}"][data-media="${id}"]`).checked;
    await api('POST', `/api/library/media/${id}/rights`, body); ui.lib = await api('GET', '/api/library');
  }, 'უფლებები ვერ შეინახა — მონიშნე დადასტურება.');
}

// ---------- voice answers ----------
function voicePanel() {
  if (!ui.iv.consent?.voice) return `<div class="notice"><p><b>ხმოვანი პასუხი</b></p><p>შენი ჩანაწერი გადაეგზავნება მეტყველების ამოცნობის სერვისს (ElevenLabs), რომ ტექსტად გადაიქცეს. ECHO ჩანაწერს არ ინახავს; სერვისი მას საკუთარი წესებით ინახავს. ტექსტს გაგზავნამდე შენ შეამოწმებ და გაასწორებ. ნებისმიერ დროს შეგიძლია ტექსტით უპასუხო.</p>
    <label style="display:flex;gap:8px;font-weight:400"><input type="checkbox" id="consent"> ვეთანხმები</label><div class="row"><button id="allow">ხმის ჩართვა</button></div></div>`;
  if (ui.transcript) return `<label for="transcript">ასე გავიგე — შეამოწმე და საჭიროებისას გაასწორე:</label><textarea id="transcript" maxlength="2000">${esc(ui.transcript.recognised)}</textarea><div class="row"><button id="again">თავიდან ჩაწერა</button></div>`;
  const r = ui.rec;
  return `<div class="row"><button class="rec${r?.state === 'recording' ? ' on' : ''}" id="rec" ${r?.state === 'processing' ? 'disabled' : ''}>${r?.state === 'recording' ? '■ დასრულება' : '🎙 ჩაწერა'}</button></div>
    <p class="state" id="rec-state">${r?.state === 'recording' ? `ჩაწერა მიმდინარეობს — <span id="rec-time">0:00</span> (მაქს. 1 წუთი)` : r?.state === 'processing' ? 'ვამუშავებ…' : 'დააჭირე და მოყევი.'}</p>`;
}
function wireVoice() {
  if ($('#allow')) $('#allow').onclick = () => run(async () => { if (!$('#consent').checked) throw new Error('consent'); await api('POST', `/api/interviews/${ui.iv.id}/consent`, {voice: true}); ui.iv = await api('GET', `/api/interviews/${ui.iv.id}`); }, 'ხმის ჩასართავად მონიშნე „ვეთანხმები“.');
  if ($('#again')) $('#again').onclick = () => { ui.transcript = null; render(); };
  if ($('#rec')) $('#rec').onclick = () => ui.rec?.state === 'recording' ? ui.rec.recorder.stop() : record();
}
async function record() {
  clearError();
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({audio: true}); }
  catch { showError(null, 'მიკროფონზე წვდომა არ მოგვეცა. შეგიძლია ტექსტით უპასუხო.'); ui.mode = 'text'; return render(); }
  const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find(t => window.MediaRecorder?.isTypeSupported?.(t)) || '';
  const recorder = new MediaRecorder(stream, type ? {mimeType: type} : {}), chunks = [], started = Date.now();
  ui.rec = {state: 'recording', recorder};
  recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
  const tick = setInterval(() => { const s = Math.floor((Date.now() - started) / 1000); const el = $('#rec-time'); if (el) el.textContent = `0:${String(s).padStart(2, '0')}`; if (s >= 60) recorder.stop(); }, 250);
  recorder.onstop = async () => {
    clearInterval(tick); stream.getTracks().forEach(t => t.stop());
    ui.rec = {state: 'processing'}; render();
    const blob = new Blob(chunks, {type: (recorder.mimeType || 'audio/webm').split(';')[0]});
    try { const r = await api('POST', `/api/interviews/${ui.iv.id}/transcribe`, blob, {'content-type': blob.type}); ui.transcript = {recognised: r.recognised, provider: r.provider}; }
    catch (e) { showError(e, e.code === 'voice_unavailable' ? 'ხმოვანი პასუხი ახლა მიუწვდომელია — გთხოვ, ტექსტით უპასუხე.' : 'ხმის ამოცნობა ვერ მოხერხდა. სცადე თავიდან ან დაწერე პასუხი.'); if (e.code === 'voice_unavailable') ui.mode = 'text'; }
    ui.rec = null; render();
  };
  recorder.start(); render();
}

// ---------- review and approval ----------
function sentences(text) { return String(text || '').split(/(?<=[.!?…])\s+/).map(s => s.trim()).filter(s => s.length > 3); }
function reviewView() {
  const iv = ui.iv, b = iv.brief, own = ['workDescription', 'inspiration', 'creationProcess', 'presenterNotes'];
  const textOf = k => iv.questions.find(q => q.answerField === k)?.current?.text;
  const choice = (key, v) => iv.questions.flatMap(q => q.fields).find(f => f.key === key)?.options?.find(o => o.value === v)?.ka || '—';
  const agentSteps = Object.entries(iv.answers).filter(([, a]) => a.source === 'agent').map(([k]) => k);
  caption('გადახედე შენს ბრიფს. თუ ყველაფერი სწორია, დაადასტურე.');
  $('#view').innerHTML = `<h1>შენი ბრიფი <span class="tag">ვერსია ${b.version}</span><span class="en">Your Creator Brief: nothing airs until you approve it</span></h1>
    ${agentSteps.length ? `<div class="notice">ზოგიერთი პასუხი შენმა აგენტმა მოამზადა. გადაამოწმე, სანამ დაადასტურებ.</div>` : ''}
    <dl class="brief"><dt>სახელი ეთერისთვის</dt><dd>${esc(b.creator.displayName || '—')}</dd><dt>ნამუშევარი</dt><dd>${esc(b.work.title || '—')} · ${esc(choice('category', b.work.category))}</dd>
      <dt>შენ შესახებ</dt><dd>${esc(b.work.description || '—')}</dd><dt>შთაგონება</dt><dd>${esc(b.story.inspiration || '—')}</dd>
      <dt>რა გააკეთე თავად</dt><dd>${esc(b.process.text || '—')}<br><b>${esc(choice('aiInvolvement', b.process.aiInvolvement))}</b></dd>
      <dt>რა ვაჩვენოთ</dt><dd>${esc(b.presentation.focus || '—')} · ${esc(choice('preferredFormat', b.presentation.preferredFormat))} · ${b.presentation.desiredAirtimeSec ? `${b.presentation.desiredAirtimeSec} წამი` : '—'}</dd>
      <dt>ფაილები</dt><dd>${b.media.map(m => `${esc(m.title)} — ${m.rights ? Object.keys(KA.uses).filter(k => m.rights[k]).map(k => KA.uses[k]).join(', ') || 'უფლებები არ არის' : 'უფლებები ჯერ არ არის მითითებული'}`).join('<br>') || '—'}</dd>
      <dt>წამყვანისთვის</dt><dd>${esc(b.presenterNotes || '—')}</dd></dl>
    ${b.missing.length ? `<h2>აკლია</h2><p>${b.missing.map(k => esc(KA.missing[k] || (k.startsWith('rights:') ? 'ფაილის უფლებები' : k.startsWith('broadcastPermission:') ? 'ეთერის ნებართვა ფაილზე' : k))).join(' · ')}</p>` : ''}
    ${b.contradictions.length ? `<h2>დასაზუსტებელი</h2>${b.contradictions.map(c => `<p class="bad">${esc(c.ka)}</p>`).join('')}` : ''}
    <h2>ციტატები ეთერისთვის <span class="en">Only sentences you said; choose up to 5</span></h2>
    ${own.flatMap(k => sentences(textOf(k))).map((s, i) => `<label style="display:flex;gap:8px;font-weight:400"><input type="checkbox" name="quote" value="${esc(s)}"${b.story.quotes.includes(s) ? ' checked' : ''}> „${esc(s)}“</label>`).join('') || '<p class="hint">—</p>'}
    <div class="row"><button id="quotes">ციტატების შენახვა</button></div>
    <h2>შესწორება</h2><div class="row">${iv.questions.map(q => `<button data-edit="${q.stepId}">${q.index}. ${esc(q.question.ka.replace(/\?$/, ''))}</button>`).join('')}</div>
    <div class="row"><button class="primary" id="approve" ${ui.busy || b.contradictions.length ? 'disabled' : ''}>ვადასტურებ ბრიფს · ვერსია ${b.version}</button><button id="withdraw">ბრიფის გაუქმება</button><button id="erase">ინტერვიუს წაშლა</button></div>
    <p class="hint">გაითვალისწინე: ვინაობა, ავტორობა, AI-ის როლი და ფაილების უფლებები შენი განცხადებაა — ECHO მათ დამოუკიდებლად არ ამოწმებს.</p>`;
  $('#quotes').onclick = () => run(async () => { ui.iv = await api('POST', `/api/interviews/${iv.id}/quotes`, {quotes: [...document.querySelectorAll('input[name=quote]:checked')].map(x => x.value)}); }, 'ციტატები ვერ შეინახა.');
  $('#approve').onclick = () => run(async () => { ui.iv = await api('POST', `/api/interviews/${iv.id}/approve`, {version: b.version, hash: b.hash}); await refresh(); }, 'ვერ დადასტურდა.');
  $('#withdraw').onclick = () => { if (confirm('გავაუქმოთ ბრიფი? ეთერში ვერ გავა.')) run(async () => { ui.iv = await api('POST', `/api/interviews/${iv.id}/withdraw`, {reason: 'creator'}); }); };
  for (const e of document.querySelectorAll('[data-edit]')) e.onclick = () => { ui.editing = e.dataset.edit; render(); };
  wireErase();
}
function wireErase() {
  if ($('#erase')) $('#erase').onclick = () => { if (confirm('წავშალოთ ინტერვიუ? პასუხები და ბრიფი წაიშლება; თუ რამე უკვე გავიდა ეთერში, მხოლოდ ის დარჩება გამოქვეყნების ჩანაწერში.')) run(async () => { await api('POST', `/api/interviews/${ui.iv.id}/delete`); ui.iv = null; ui.lib = await api('GET', '/api/library'); }, 'ვერ წაიშალა.'); };
}
async function approvedView() {
  const iv = ui.iv, b = iv.brief, entry = ui.lib.briefs.find(x => x.interviewId === iv.id), life = entry?.lifecycle;
  const state = await api('GET', '/api/state'), mine = state.order.map(id => state.segments[id]).filter(s => s.ownerId === ui.me.id);
  // Q3/Q4 (independent audit): "prepared" is true only for the brief version approved now; a corrected brief offers
  // an explicit update, and every slot must be chosen by the creator (nothing is kept silently).
  const prepared = !!life?.segmentId && !life.stale, stale = !!life?.segmentId && life.stale;
  const segTitle = life?.segmentId ? state.segments[life.segmentId]?.title : '';
  caption(stale ? 'ბრიფი შეიცვალა — განაახლე მომზადებული სეგმენტი.' : 'მადლობა! შენი ბრიფი დადასტურებულია.');
  $('#view').innerHTML = `<h1>✓ ბრიფი დადასტურებულია <span class="tag">ვერსია ${b.version}</span><span class="en">Approved by you</span></h1>
    <ol class="life">${(life?.steps || []).map(s => `<li class="${s.done ? 'done' : ''}">${esc(KA.life[s.step])}</li>`).join('')}</ol>
    ${prepared ? `<p>სეგმენტი: <b>${esc(segTitle)}</b> — შემდეგი ნაბიჯები გადაცემის დაფაზე ჩანს: რედაქციის დამტკიცება, ეთერის დრო, გამოქვეყნება.</p><div class="row"><a class="primary-link" href="/board/">გადაცემის დაფა →</a><a href="/broadcast/">ეთერი →</a></div>`
      : `<h2>${stale ? 'მომზადებული სეგმენტის განახლება' : 'გადაცემაში ჩასმა'}</h2>
      ${stale ? `<p class="warn">ბრიფი შესწორდა (ვერსია ${b.version}); სეგმენტი „${esc(segTitle)}" ძველ ვერსიაზეა (ვერსია ${life.preparedVersion}). აირჩიე საბოლოო ფაილები და განაახლე — რედაქცია მას ხელახლა დაამტკიცებს და თანხმობები განახლდება.</p>`
        : `<p class="hint">აირჩიე შენი სეგმენტი და ყოველი ადგილისთვის ფაილი, რომლის საჯარო ეთერის უფლებაც მოგვეცი. არაფერი არ რჩება „უცვლელად": ეთერში მხოლოდ შენ მიერ არჩეული ფაილი გავა, შენი სახელით.</p>`}
      <label for="seg">სეგმენტი</label><select id="seg" ${stale ? 'disabled' : ''}>${mine.map(s => `<option value="${s.id}" ${s.id === life?.segmentId ? 'selected' : ''}>${esc(s.title)}</option>`).join('')}</select>
      <div id="slots"></div><div id="final" class="final"></div><div class="row"><button class="primary" id="prepare" disabled>${stale ? 'განახლება' : 'მომზადება'}</button></div>`}
    <div class="row"><button id="edit">შესწორება</button><button id="erase">ინტერვიუს წაშლა</button></div>`;
  wireErase();
  $('#edit').onclick = () => { ui.editing = 'who'; render(); };
  if (!prepared) {
    const choices = (slot) => {
      const files = b.media.filter(m => m.kind === slot.kind && m.rights?.publicBroadcast);
      const current = (life?.assets || []).find(a => a.id === slot.id);
      const keep = stale && current?.creatorBound && files.some(m => m.id === current.libraryMediaId) ? current : null;
      return {files, keep};
    };
    const preview = () => {
      const seg = state.segments[$('#seg').value], selects = [...document.querySelectorAll('[data-slot]')];
      const rows = selects.map(sel => { const slot = seg.assets.find(a => a.id === sel.dataset.slot), {files, keep} = choices(slot); const v = sel.value; const m = v.startsWith('keep:') ? {title: keep?.title, technical: null} : files.find(f => f.id === v); return {slot, v, m}; });
      const complete = rows.length > 0 && rows.every(r => r.v);
      $('#prepare').disabled = ui.busy || !complete;
      $('#final').innerHTML = complete ? `<h3>ეთერში გავა</h3><ul>${rows.map(r => `<li><b>${esc(b.work.title || r.m?.title || '')}</b> · ${esc(b.creator.displayName)} · ${esc(r.slot.id)}: ${esc(r.m?.title || '')}${r.m?.technical?.durationSec ? ` (${Math.round(r.m.technical.durationSec)} წმ)` : ''}${r.v.startsWith('keep:') ? ' · იგივე ფაილი, ზუსტი ჰეში' : ''}</li>`).join('')}</ul><p class="hint">რედაქცია ამ ზუსტ ფაილებს დაამტკიცებს; ჰეში ჩანს დაფაზე.</p>`
        : `<p class="hint">${rows.length ? 'აირჩიე ფაილი ყველა ადგილისთვის.' : 'ამ სეგმენტს ფაილი არ სჭირდება.'}</p>`;
    };
    const slots = () => {
      const seg = state.segments[$('#seg').value];
      $('#slots').innerHTML = seg.assets.map(a => { const {files, keep} = choices(a); return `<label for="slot-${a.id}">${esc(a.id)} <small>(${a.kind === 'audio' ? 'აუდიო' : 'სურათი'})</small></label><select id="slot-${a.id}" data-slot="${a.id}"><option value="">— აირჩიე —</option>${keep ? `<option value="keep:${keep.sha256}" selected>დატოვე: ${esc(keep.title)} (იგივე ფაილი)</option>` : ''}${files.map(m => `<option value="${m.id}">${esc(m.title)}</option>`).join('')}</select>`; }).join('')
        || '<p class="hint">ამ სეგმენტს ფაილის ადგილი არ აქვს.</p>';
      if (!b.media.some(m => m.rights?.publicBroadcast)) $('#slots').insertAdjacentHTML('beforeend', '<p class="warn">ბრიფში საჯარო ეთერის უფლებით ფაილი არ არის. შესწორებაში „რომელი ფაილების უფლებას გვაძლევ?" კითხვაზე აირჩიე ფაილი და განაცხადე უფლებები.</p>');
      for (const sel of document.querySelectorAll('[data-slot]')) sel.onchange = preview;
      preview();
    };
    $('#seg').onchange = slots; slots();
    $('#prepare').onclick = () => run(async () => {
      const assets = Object.fromEntries([...document.querySelectorAll('[data-slot]')].map(s => [s.dataset.slot, s.value.startsWith('keep:') ? {keep: s.value.slice(5)} : s.value]));
      await api('POST', `/api/briefs/${iv.id}/prepare`, {segmentId: $('#seg').value, assets}); await refresh();
    }, stale ? 'სეგმენტი ვერ განახლდა.' : 'სეგმენტი ვერ მომზადდა.');
  }
}

// ---------- the interviewer: the existing ECHO host, unchanged ----------
const studio = {ready: false, visualTime: 0, last: 0, cues: []};
function caption(text) { if (studio.captionText !== text) { studio.captionText = text; $('#caption').textContent = text; } }
async function speak(p) {
  const key = `${ui.iv.id}:${p.stepId}:${p.question.ka}`;
  caption(p.question.ka);
  if (ui.spoken === key) return; ui.spoken = key;
  try {
    const q = await api('GET', `/api/interviews/${ui.iv.id}/question-audio`);
    if (q.audio && q.text === p.question.ka) { const a = $('#voice'); studio.cues = q.cues || []; a.src = q.audio; a.play().catch(() => {}); }
  } catch {}
}
async function loadStudio() {
  try {
    const canvas = $('#studio'), renderer = new THREE.WebGLRenderer({canvas, antialias: true, powerPreference: 'low-power'});
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .88;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    const camera = new THREE.PerspectiveCamera(37, 16 / 10, .05, 30);
    const [gltf, hair] = await Promise.all([new GLTFLoader().loadAsync('/studio/lookdev/assets/cast-clean-v6.glb'), new GLTFLoader().loadAsync('/studio/lookdev/assets/hair-clean-v6.glb')]);
    const room = createRoom(gltf.scene, {cast: conversationSeats, practicalPositions: conversationPracticals, actorFactory: (base, i) => makeEditorialCharacter(base, i, {hairLibrary: hair.scene})});
    lightEditorialRoom(room.scene);
    Object.assign(studio, {renderer, camera, scene: room.scene, actors: room.actors, ready: true});
    requestAnimationFrame(frame);
  } catch (e) { console.warn('Studio unavailable:', e.message); $('#studio').hidden = true; $('#studio-fallback').hidden = false; }
}
function frame(ms) {
  requestAnimationFrame(frame);
  if (!studio.ready) return;
  const {renderer, camera} = studio, el = $('#studio'), w = el.clientWidth, h = el.clientHeight;
  if (studio.size !== `${w}x${h}`) { renderer.setSize(w, h, false); camera.aspect = w / h; const p = conversationFrame('echo', w / h); camera.position.set(...p.slice(0, 3)); camera.fov = p[6]; camera.lookAt(...p.slice(3, 6)); camera.updateProjectionMatrix(); studio.size = `${w}x${h}`; }
  const dt = studio.last ? Math.min((ms - studio.last) / 1000, .08) : 1 / 30; studio.last = ms; studio.visualTime += dt;
  const a = $('#voice'), speaking = !a.paused && !a.ended, t = a.currentTime, cue = speaking ? studio.cues.find(c => t >= c.start && t < c.end) : null;
  const performance = {speaker: 'echo', speaking, mouthStrength: .56, expressive: true, directed: true, attention: [{at: 0, target: 'audience'}], gestures: [], performance: [{at: 0, actor: 'echo', intent: 'warmth', duration: 3}], audioTime: t, cue, reaction: null, reactionAge: 0};
  for (const actor of studio.actors) applyPerformance(actor, studio.visualTime, dt, performance, reduced);
  renderer.render(studio.scene, camera);
}
window.EchoInterview = {state: () => ({status: ui.iv?.status, step: ui.iv?.step, mode: ui.mode, editing: ui.editing, transcript: ui.transcript, studioReady: studio.ready, caption: studio.captionText, busy: ui.busy})};
boot();
