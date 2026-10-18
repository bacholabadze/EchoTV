// Editorial desk and audience Q&A on the Production Board (editorial wave).
// Producer: what the desk is waiting for, fact verification, rundown drafts (rule-based or from the ECHO editorial
// agent) shown in full before approval, the confirmed slot, and the moderated Q&A (select, release).
// Guest: their airtime request, whether their own agent may answer for them, and their answer to the selected question.
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
let token = null; try { token = sessionStorage.getItem('echo-token'); } catch {}
const root = $('#editorial-desk');
let me = null, state = null, desk = null, queue = null, guest = null, openRundown = null, busy = false;

const requestKey = () => crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
async function api(method, path, body) {
  const res = await fetch(path, {method, headers: {'content-type': 'application/json', authorization: `Bearer ${token}`, ...(method === 'POST' ? {'idempotency-key': requestKey()} : {})}, body: body && JSON.stringify(body)});
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.ka || data.message || data.error), {data});
  return data;
}
const act = fn => async e => {
  const b = e?.currentTarget; if (b) b.disabled = true; $('#ed-error').hidden = true;
  try { await fn(); await refresh(); } catch (err) {
    const problems = err.data?.details?.problems || err.data?.details?.reasons;
    $('#ed-error').innerHTML = esc(err.message.split(':')[0]) + (problems ? `<ul>${problems.map(p => `<li>${esc(p.ka || p.en)}</li>`).join('')}</ul>` : '');
    $('#ed-error').hidden = false;
  } finally { if (b) b.disabled = false; }
};

const SPEAKER = {moderator: 'ECHO (წამყვანი)', enthusiast: 'ატლასი (ენთუზიასტი)', analyst: 'ნოვა (სკეპტიკოსი)'};
const KIND = {opening: 'შესავალი', story: 'ამბავი', process: 'პროცესი', work: 'ნამუშევარი', debate: 'დებატი', evidence: 'რა ვიცით', qa: 'მაყურებლის კითხვა', takeaway: 'დასკვნა'};
const LINE = {question: 'კითხვა', viewpoint: 'პოზიცია', claim: 'განცხადების გარჩევა', fact: 'დადასტურებული ფაქტი', quote: 'ავტორის ციტატა', humor: 'იუმორი', transition: 'გადასვლა'};
const AUTHOR = a => a.kind === 'agent' ? `LLM აგენტი: ${a.label}${a.client ? ` (${a.client})` : ''}` : a.kind === 'rule-based' ? 'ECHO-ს წესებზე დაფუძნებული დამგეგმავი (არა LLM)' : `პროდიუსერი: ${a.label}`;
const STATUS = {draft: 'მონახაზი — ელოდება შენს გადაწყვეტილებას', approved: 'დამტკიცებულია და პროგრამაშია', rejected: 'უარყოფილია', stale: 'მოძველდა (მასალა შეიცვალა)', superseded: 'ჩაანაცვლა ახალმა გეგმამ'};
const Q = {pending: 'ახალი', shortlisted: 'აგენტმა შემოგთავაზა', selected: 'შერჩეულია', answered: 'უპასუხეს', rejected: 'უარყოფილია', blocked: 'ფილტრმა დაბლოკა'};
const mmss = t => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;

function rundownHtml(rd, packet) {
  const r = rd.rundown, guestName = packet?.guest?.displayName || 'სტუმარი';
  return `<div class="rd-body">
    <p><b>მთავარი კითხვა:</b> ${esc(r.centralQuestion)}</p><p><b>რატომ არის მნიშვნელოვანი:</b> ${esc(r.whyItMatters)}</p>
    <p><b>დაძაბულობა:</b> ${esc(r.tension)}</p><p><b>დასკვნა:</b> ${esc(r.takeaway.text)} ${r.takeaway.unresolved ? '<span class="tag">ღია კითხვა</span>' : ''}</p>
    <p><b>მაყურებლის კითხვის მოწოდება:</b> ${esc(r.audienceSlot.prompt)}</p>
    <ol class="rd-blocks">${r.blocks.map(b => `<li><b>${mmss(b.start)} · ${KIND[b.kind] || b.kind} · ${b.duration} წმ</b> — ${esc(b.title)} <small>${esc(b.purpose)}</small>
      ${b.kind === 'work' ? `<ul>${b.media.map(m => `<li>ფაილი <code>${esc(m.assetId)}</code>: ${esc(m.purpose)}</li>`).join('')}</ul><small>ამ დროს ავტორის ნამუშევარი გადის; წამყვანები არ საუბრობენ.</small>`
        : `<ul>${b.lines.map(l => `<li class="ln ln-${l.kind}"><span>${esc(l.speaker === 'guest' ? `${guestName} — ციტატა ბრიფიდან` : SPEAKER[l.speaker])} · ${LINE[l.kind]}${l.refs.length ? ` · ეყრდნობა: ${esc(l.refs.join(', '))}` : ''}</span> ${esc(l.speaker === 'guest' ? `„${l.text}“` : l.text)}</li>`).join('')}</ul>`}</li>`).join('')}</ol></div>`;
}

function renderProducer() {
  const d = desk, e = state.episode.editorial, wseg = state.segments[state.episode.workSegmentId], booking = state.bookings[wseg?.id];
  const drafts = d.rundowns.filter(r => r.status === 'draft'), shown = d.rundowns.find(r => r.id === openRundown) || drafts[0] || d.rundowns[0];
  $('#ed-main').innerHTML = `
    <div class="ed-col">
      <h3>1. რას ელოდება რედაქცია</h3>
      ${d.readiness.ready ? '<p class="ok">✓ მასალა მზადაა: ავტორის დამტკიცებული და გაზიარებული ბრიფი, მისი ფაილი, დადასტურებული ეთერის დრო.</p>'
        : `<ul class="wait">${d.readiness.reasons.map(r => `<li>${esc(r.ka)}</li>`).join('')}</ul>`}
      ${booking?.state === 'held' ? `<p>ავტორმა მოითხოვა ეთერის დრო: ${mmss(booking.start)}-დან ${booking.duration} წმ. <button id="ed-confirm" class="primary">დროის დადასტურება</button></p>` : ''}
      ${booking?.state === 'confirmed' ? `<p class="ok">🔒 ავტორის დრო დადასტურებულია: ${mmss(booking.start)}–${mmss(booking.start + booking.duration)}</p>` : ''}
      <h3>2. ფაქტები (ეთერში მხოლოდ შენ მიერ გადამოწმებული)</h3>
      <p class="fine">მონახაზი: ფაქტი ეთერში მხოლოდ მაშინ გავა, როცა შენ მას წყაროსთან გადაამოწმებ. ორივე ფაქტი აშშ-ს ეხება და საქართველოს კანონად არ უნდა წარვადგინოთ.</p>
      <ul class="facts">${d.facts.map(f => `<li><p>${esc(f.ka)}</p><p class="fine">წყარო: <a href="${esc(f.source.url)}" target="_blank" rel="noopener">${esc(f.source.title)}</a> · ${esc(f.scope || '')}</p>
        <button data-fact="${esc(f.id)}" data-verified="${f.verified ? 'yes' : 'no'}">${f.verified ? '✓ გადამოწმებულია — გაუქმება' : 'წყაროსთან გადავამოწმე'}</button></li>`).join('')}</ul>
    </div>
    <div class="ed-col wide">
      <h3>3. რედაქციული გეგმა</h3>
      <p class="fine">გეგმას ადგენს ECHO-ს რედაქციის აგენტი (MCP) ან წესებზე დაფუძნებული დამგეგმავი. სერვერი ამოწმებს: ციტატები ზუსტად ავტორის სიტყვებია, ფაქტები მხოლოდ გადამოწმებულია, დრო ემთხვევა ჯავშანს. ეთერში არაფერი გავა შენი დამტკიცების გარეშე.</p>
      <button id="ed-baseline" ${d.readiness.ready ? '' : 'disabled'}>წესებზე დაფუძნებული გეგმის მომზადება</button>
      ${e ? `<p class="ok">ეთერისთვის დამტკიცებულია: ${esc(e.rundownId)} · ${esc(AUTHOR(e.author))}</p>` : ''}
      <ul class="rd-list">${d.rundowns.map(r => `<li><button class="quiet" data-open="${r.id}">${r.id}</button> ${esc(AUTHOR(r.author))} · <i>${STATUS[r.status] || r.status}</i> · ${r.rundown.blocks.map(b => KIND[b.kind]).join(' → ')}</li>`).join('') || '<li class="fine">გეგმა ჯერ არ არის.</li>'}</ul>
      ${shown ? `<article class="rd" data-id="${shown.id}"><h4>${shown.id} · ${esc(AUTHOR(shown.author))}</h4>${rundownHtml(shown, d.packet)}
        ${shown.status === 'draft' ? `<p><button id="ed-approve" class="primary" data-id="${shown.id}" data-hash="${shown.hash}">დამტკიცება და პროგრამაში ჩასმა</button> <button id="ed-reject" data-id="${shown.id}" data-hash="${shown.hash}">უარყოფა</button></p>
          <p class="fine">დამტკიცება ეხება ზუსტად ამ ვერსიას (${shown.hash.slice(0, 10)}). ავტორის სეგმენტი ცალკე განიხილება.</p>` : ''}</article>` : ''}
    </div>`;
  $('#ed-confirm') && ($('#ed-confirm').onclick = act(() => api('POST', '/api/slots/confirm', {segmentId: wseg.id})));
  for (const b of root.querySelectorAll('[data-fact]')) b.onclick = act(() => api('POST', `/api/editorial/facts/${b.dataset.fact}/verify`, {verified: b.dataset.verified !== 'yes'}));
  $('#ed-baseline').onclick = act(async () => { const rd = await api('POST', '/api/editorial/baseline'); openRundown = rd.id; });
  for (const b of root.querySelectorAll('[data-open]')) b.onclick = () => { openRundown = b.dataset.open; renderProducer(); };
  $('#ed-approve') && ($('#ed-approve').onclick = act(() => api('POST', `/api/editorial/rundowns/${$('#ed-approve').dataset.id}/decision`, {decision: 'approve', hash: $('#ed-approve').dataset.hash})));
  $('#ed-reject') && ($('#ed-reject').onclick = act(() => api('POST', `/api/editorial/rundowns/${$('#ed-reject').dataset.id}/decision`, {decision: 'reject', hash: $('#ed-reject').dataset.hash})));
  renderQueue();
}

function renderQueue() {
  const q = queue, el = $('#ed-qa');
  if (!q) { el.innerHTML = ''; return; }
  const w = q.window, list = q.questions.slice().reverse();
  el.innerHTML = `<h3>4. მაყურებლის კითხვები (ცოცხალი, მოდერირებული)</h3>
    <p class="fine">${!w.publicationId ? 'კითხვები გამოქვეყნების შემდეგ იხსნება.' : w.open ? `მიღება ღიაა${w.closesAt ? ` ${new Date(w.closesAt).toLocaleTimeString()}-მდე` : ' (ეთერის დაწყებამდე და კითხვის ბლოკის ბოლომდე)'}.` : 'მიღება დახურულია.'}
      სტუმრის აგენტს ${q.consent.agentMayAnswer ? '<b>აქვს</b>' : '<b>არ აქვს</b>'} სტუმრის ნებართვა, რომ მის ნაცვლად უპასუხოს.</p>
    <ul class="qs">${list.map(x => `<li class="q q-${x.status}"><p>${x.text ? esc(x.text) : '<i>ტექსტი არ ინახება (დაბლოკილია)</i>'} <small>— ${esc(x.name || 'ანონიმური')}</small></p>
      <p class="fine">${Q[x.status] || x.status} · ფილტრი: ${x.auto.verdict === 'ok' ? 'სუფთაა' : x.auto.verdict === 'flagged' ? '⚠ ყურადღება' : '✗ დაბლოკა'}${x.auto.reasons.length ? ` — ${esc(x.auto.reasons.map(r => r.ka).join(' '))}` : ''}${x.shortlist ? ` · აგენტის შენიშვნა (${esc(x.shortlist.label)}): ${esc(x.shortlist.note)}` : ''}</p>
      ${['pending', 'shortlisted'].includes(x.status) && w.open ? `<button data-select="${x.id}" class="primary">შერჩევა ეთერისთვის</button> <button data-reject="${x.id}">უარყოფა</button>` : ''}
      ${x.answer ? `<div class="ans"><p><b>${x.answer.source === 'human' ? `პასუხი: ${esc(x.answer.label)} (სტუმარი, პირადად)` : `პასუხი: ${esc(x.answer.label)}${x.answer.client ? ` (${esc(x.answer.client)})` : ''} — AI აგენტი, სტუმრის ნებართვით`}</b></p><p>${esc(x.answer.text)}</p>
        ${x.answer.flags?.length ? `<p class="fine">⚠ ${esc(x.answer.flags.map(r => r.ka).join(' '))}</p>` : ''}
        ${x.answer.status === 'submitted' ? `<button data-release="${x.id}" class="primary">ეთერში ჩვენება</button> <button data-withhold="${x.id}">დაკავება</button>` : `<p class="fine">${x.answer.status === 'released' ? 'ეთერშია' : 'დაკავებულია'}</p>`}</div>` : ''}</li>`).join('') || '<li class="fine">კითხვა ჯერ არ შემოსულა.</li>'}</ul>`;
  for (const b of el.querySelectorAll('[data-select]')) b.onclick = act(() => api('POST', `/api/qa/questions/${b.dataset.select}/select`, {}));
  for (const b of el.querySelectorAll('[data-reject]')) b.onclick = act(() => api('POST', `/api/qa/questions/${b.dataset.reject}/reject`, {}));
  for (const b of el.querySelectorAll('[data-release]')) b.onclick = act(() => api('POST', `/api/qa/questions/${b.dataset.release}/release`, {release: true}));
  for (const b of el.querySelectorAll('[data-withhold]')) b.onclick = act(() => api('POST', `/api/qa/questions/${b.dataset.withhold}/release`, {release: false}));
}

function renderGuest() {
  const g = guest, wseg = state.segments[state.episode.workSegmentId], booking = state.bookings[wseg.id], e = state.episode.editorial;
  const q = g?.question;
  $('#ed-main').innerHTML = `
    <div class="ed-col">
      <h3>შენი ეთერის დრო</h3>
      ${booking?.state === 'confirmed' ? `<p class="ok">🔒 დადასტურებულია: ${mmss(booking.start)}–${mmss(booking.start + booking.duration)}</p>`
        : `${booking?.state === 'held' ? `<p>მოთხოვნილია: ${mmss(booking.start)}-დან ${booking.duration} წმ — ელოდება პროდიუსერის დადასტურებას.</p>` : '<p>ჯერ არ მოგითხოვია.</p>'}
          <label>დაწყება (წამი) <input id="ed-start" type="number" min="12" max="140" value="${booking?.start ?? 50}"></label>
          <label>ხანგრძლივობა (წამი) <input id="ed-dur" type="number" min="15" max="90" value="${booking?.duration ?? wseg.duration}"></label>
          <button id="ed-hold">დროის მოთხოვნა</button>`}
      ${e ? `<p>გადაცემის მთავარი კითხვა: <b>${esc(e.centralQuestion)}</b></p>` : '<p class="fine">რედაქციული გეგმა ჯერ არ დამტკიცებულა.</p>'}
    </div>
    <div class="ed-col wide">
      <h3>მაყურებლის კითხვა შენთვის</h3>
      <label class="check"><input id="ed-consent" type="checkbox" ${g?.consent?.agentMayAnswer ? 'checked' : ''}> ჩემს AI აგენტს შეუძლია ჩემ ნაცვლად უპასუხოს. <small>ეკრანზე ეწერება, რომ პასუხი აგენტისაა და არა ჩემი სიტყვები.</small></label>
      ${q ? `<p class="qbox">${esc(q.text)} <small>— ${esc(q.from)}</small></p>
        ${q.answer ? `<p>${q.answer.source === 'human' ? 'შენი პასუხი' : 'შენი აგენტის პასუხი'}: ${esc(q.answer.text)} <i>(${q.answer.status === 'released' ? 'ეთერშია' : q.answer.status === 'withheld' ? 'პროდიუსერმა დააკავა' : 'ელოდება პროდიუსერს'})</i></p>`
          : `<textarea id="ed-answer" rows="3" maxlength="400" placeholder="შენი პასუხი (ეთერში შენი სახელით გავა, პროდიუსერის დადასტურების შემდეგ)"></textarea><button id="ed-send" class="primary">პასუხის გაგზავნა</button>`}`
        : `<p class="fine">${g?.window?.open ? 'მოდერატორს კითხვა ჯერ არ შეურჩევია.' : 'კითხვა-პასუხი ახლა არ მიმდინარეობს.'}</p>`}
    </div>`;
  $('#ed-hold') && ($('#ed-hold').onclick = act(() => api('POST', '/api/slots/hold', {segmentId: wseg.id, start: +$('#ed-start').value, duration: +$('#ed-dur').value})));
  $('#ed-consent').onchange = act(() => api('POST', '/api/qa/consent', {agentMayAnswer: $('#ed-consent').checked}));
  $('#ed-send') && ($('#ed-send').onclick = act(() => api('POST', `/api/qa/questions/${q.id}/answer`, {text: $('#ed-answer').value})));
}

async function refresh() {
  if (!me || !state?.episode?.format) return;
  if (me.role === 'producer') { [desk, queue] = await Promise.all([api('GET', '/api/editorial'), api('GET', '/api/qa')]); renderProducer(); }
  else if (me.type === 'person' && state.segments[state.episode.workSegmentId]?.ownerId === me.id) {
    // Keep a half-typed answer while the board refreshes.
    const typing = $('#ed-answer')?.value; guest = await api('GET', '/api/qa/guest'); renderGuest(); if (typing && $('#ed-answer')) $('#ed-answer').value = typing;
  }
}
async function start() {
  if (!token) return;
  try { me = await (await fetch('/api/me', {headers: {authorization: `Bearer ${token}`}})).json(); } catch { return; }
  if (!me?.id) return;
  root.innerHTML = `<h2>რედაქცია და მაყურებლის კითხვები</h2><p id="ed-error" class="error" role="alert" hidden></p><div id="ed-main" class="ed-grid"></div><div id="ed-qa"></div>`;
  const events = new EventSource('/api/events');
  let pending = null;
  events.addEventListener('state', e => {
    state = JSON.parse(e.data);
    root.hidden = state.episode?.format !== 'editorial';
    document.body.classList.toggle('editorial-format', !root.hidden); // the 3.1 negotiation guide does not apply to this format
    // Do not re-render while a person is typing an answer; otherwise refresh at most twice a second.
    if (root.hidden || document.activeElement?.id === 'ed-answer' || document.activeElement?.tagName === 'INPUT') return;
    clearTimeout(pending); pending = setTimeout(() => refresh().catch(() => {}), 300);
  });
}
start();
document.head.insertAdjacentHTML('beforeend', `<style>
.editorial-format #guide{display:none}
.editorial-desk h3{font:16px Georgia,serif;margin:14px 0 6px}.editorial-desk h4{margin:6px 0}
.ed-grid{display:grid;grid-template-columns:minmax(260px,1fr) minmax(0,2fr);gap:18px}.ed-col{min-width:0}
@media (max-width:900px){.ed-grid{grid-template-columns:1fr}}
.editorial-desk .ok{color:var(--sage)}.editorial-desk .wait li{color:var(--amber)}
.facts{list-style:none;padding:0}.facts li{border:1px solid var(--line);padding:8px 10px;margin:0 0 8px}.facts p{margin:0 0 6px}
.rd-list{padding-left:18px}.rd{border:1px solid var(--line);padding:10px 12px;margin-top:8px;background:#0e1f19}
.rd-blocks{padding-left:18px}.rd-blocks>li{margin:0 0 10px}.rd-blocks small{color:var(--muted)}
.ln span{display:block;font-size:11px;color:var(--muted)}.ln-quote{font-style:italic;color:var(--a)}.ln-fact{color:var(--amber)}
.tag{font-size:11px;border:1px solid var(--amber);color:var(--amber);padding:0 6px;border-radius:10px}
.qs{list-style:none;padding:0}.q{border:1px solid var(--line);padding:8px 10px;margin:0 0 8px}.q p{margin:0 0 6px}.q-selected,.q-answered{border-color:var(--sage)}
.q-blocked{opacity:.6}.ans{border-top:1px solid var(--line);margin-top:6px;padding-top:6px}
.editorial-desk label{display:block;margin:6px 0}.editorial-desk input[type=number]{width:90px;margin-left:6px;padding:6px;background:#0e1f19;color:inherit;border:1px solid var(--line)}
.editorial-desk textarea{width:100%;padding:8px;background:#0e1f19;color:inherit;border:1px solid var(--line);font:inherit}
.qbox{font:17px Georgia,serif;border-left:3px solid var(--red);padding-left:10px}.check small{display:block;color:var(--muted)}
</style>`);
