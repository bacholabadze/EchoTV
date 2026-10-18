// Live Production Board. Reads the shared state over SSE; signed-in people act with their own token.
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const fromHash = new URLSearchParams(location.hash.slice(1)).get('token');
if (fromHash) { try { sessionStorage.setItem('echo-token', fromHash); } catch {} history.replaceState(null, '', location.pathname); }
let token = fromHash; try { token ||= sessionStorage.getItem('echo-token'); } catch {}
let me = null, state = null, clockOffset = 0, seenSeq = 0;

// 128-bit random request key. crypto.randomUUID exists only in secure contexts (HTTPS/localhost); a plain-HTTP
// LAN board falls back to crypto.getRandomValues, which every context provides.
const requestKey = () => crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
// Every click gets one Idempotency-Key; a network retry of that click reuses it, so it can never act twice.
async function api(method, path, body) {
  const key = method === 'POST' ? requestKey() : null;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(path, {method, headers: {'content-type': 'application/json', ...(token ? {authorization: `Bearer ${token}`} : {}), ...(key ? {'idempotency-key': key} : {})}, body: body && JSON.stringify(body)});
      const data = await res.json();
      if (!res.ok) throw Object.assign(new Error(data.message || data.error), {handled: true});
      return data;
    } catch (e) { if (e.handled || attempt >= 1) throw e; await new Promise(r => setTimeout(r, 800)); }
  }
}
const act = (fn, button) => async () => {
  $('#error').hidden = true; if (button) button.disabled = true;
  try { await fn(); } catch (e) { $('#error').textContent = e.message; $('#error').hidden = false; } finally { if (button) button.disabled = false; }
};

const name = id => state.people[id]?.name || state.agents[id]?.label || (id === 'showrunner' ? 'Showrunner' : id === 'playout' ? 'Playout' : id);
const ownerClass = id => id === 'creator-a' ? 'a' : id === 'creator-b' ? 'b' : 'human';
const time = ms => new Date(ms).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'});

function track(el, layout, changedIds = new Set()) {
  el.innerHTML = layout.map(e => {
    const seg = state.segments[e.segmentId], confirmed = state.bookings[seg.id]?.state === 'confirmed';
    return `<div class="seg${e.duration ? '' : ' empty'}${changedIds.has(seg.id) ? ' changed' : ''}" data-owner="${seg.ownerId}" style="flex:${Math.max(e.duration, .001)} 1 0" title="${esc(seg.title)} ${e.start}s–${e.start + e.duration}s">
      ${confirmed ? '<span class="lock" aria-label="Confirmed slot">🔒</span>' : ''}<b>${esc(seg.title)}</b><small>${e.start}s · ${e.duration}s</small></div>`;
  }).join('');
}

function render() {
  const s = state;
  $('#episode').textContent = s.episode.title;
  $('#revision').textContent = `r${s.showRevision}`;
  const w = s.broadcast.withdrawn;
  $('#publish').textContent = s.broadcast.publishRevision ? `#${s.broadcast.manifest.publicationId ?? '–'} · r${s.broadcast.publishRevision} · ${s.broadcast.manifest.hash.slice(0, 10)}` : w ? `#${w.publicationId} withdrawn` : 'not published';
  $('#publish').title = w && !s.broadcast.manifest ? `Withdrawn by ${name(w.by)}: ${w.reason}` : '';
  broadcastLabel();
  const ruler = [0, 20, 40, 50, 60, 80, 100, 120].filter(t => t <= s.episode.durationSec);
  $('#ruler').innerHTML = ruler.map(t => `<span style="left:${t / s.episode.durationSec * 100}%">${t}s</span>`).join('');
  track($('#track-current'), s.layout);

  const open = Object.values(s.proposals).filter(p => ['negotiating', 'awaiting_proposer', 'awaiting_approval'].includes(p.status)).pop();
  const latest = open || Object.values(s.proposals).pop();
  // Only a plan the Showrunner has validated (awaiting approval) is drawn. Before that the request is shown as
  // text: drawing the raw request would show the confirmed slot moving, which the rules never allow.
  if (open) {
    const changes = [...open.changes, ...open.concessions, ...open.houseChanges];
    $('#preview-wrap').hidden = false;
    if (open.status === 'awaiting_approval' && open.preview) {
      const total = open.preview.reduce((n, e) => n + e.duration, 0);
      $('#preview-label').textContent = `${open.id} v${open.version} · ${total}s total · waiting for approval`;
      $('#track-preview').hidden = false; track($('#track-preview'), open.preview, new Set(changes.map(c => c.segmentId)));
    } else {
      const asked = (open.history[0]?.changes || open.changes).map(c => `${s.segments[c.segmentId].title} → ${c.duration ?? s.segments[c.segmentId].duration}s`).join(', ');
      $('#preview-label').textContent = `${open.id} v${open.version} · requested ${asked} · does not fit yet: the Showrunner is negotiating`;
      $('#track-preview').hidden = true;
    }
  } else $('#preview-wrap').hidden = true;

  $('#people').innerHTML = Object.values(s.people).map(p => {
    const agents = Object.values(s.agents).filter(a => a.ownerId === p.id);
    return `<li data-id="${p.id}"><strong>${esc(p.name)}</strong> <span class="fine">${p.role === 'producer' ? 'Producer · editorial approval' : `Creator · ${esc(p.specialty || '')}`}</span>
      ${agents.map(a => { const on = a.lastSeenAt && s.serverTime - a.lastSeenAt < 90000; return `<div class="agent"><span class="dot${on ? ' on' : ''}"></span>${esc(a.label)} · ${esc(a.client || (a.lastSeenAt ? 'API client' : 'not connected yet'))}${on ? '' : a.lastSeenAt ? ` · seen ${time(a.lastSeenAt)}` : ''}</div>`; }).join('')}
      ${p.role === 'producer' ? '<div class="agent"><span class="dot on"></span>Showrunner · deterministic rules (no LLM)</div>' : ''}</li>`;
  }).join('');

  renderNegotiation(latest);

  const fresh = s.seq > seenSeq && seenSeq > 0;
  $('#feed').innerHTML = s.audit.slice(-60).reverse().map((e, i) => `<li value="${e.seq}" class="${fresh && e.seq > seenSeq ? 'fresh' : ''}"><span class="time">${time(e.at)}</span>${e.summary.startsWith(name(e.actor?.id)) ? '' : `<b>${esc(name(e.actor?.id))}</b> `}${esc(e.summary)}</li>`).join('');
  seenSeq = s.seq;

  $('#segments').innerHTML = s.order.map(id => {
    const seg = s.segments[id], valid = s.segmentsValid[id], declined = seg.declined?.revision === seg.revision;
    const canReview = me?.role === 'producer' && !valid && !declined, canReject = me?.role === 'producer' && !declined;
    const mine = me?.type === 'person' && me.id === seg.ownerId && seg.assets.length;
    return `<tr><td>${esc(seg.title)}${seg.house ? ' <span class="fine">house</span>' : ''}</td><td>${esc(name(seg.ownerId))}</td><td>r${seg.revision}</td>
      <td class="mono">${seg.assets.map(a => `${esc(a.id)} ${esc(a.sha256.slice(0, 8))}`).join('<br>') || '—'}</td>
      <td>${valid ? `<span class="status ok">approved r${seg.approval.revision}</span>` : `<span class="status">${esc(seg.state)}</span>`}</td>
      <td>${canReview ? `<button data-review="${id}" data-rev="${seg.revision}">Approve r${seg.revision}</button>` : ''}${canReject ? `<button class="quiet" data-reject="${id}" data-rev="${seg.revision}">Reject r${seg.revision}…</button>` : ''}${mine ? `<label class="fine"><input type="file" data-upload="${id}" accept="image/*,audio/*" hidden><button data-pick="${id}">Replace media</button></label>` : ''}</td></tr>`;
  }).join('');
  for (const b of document.querySelectorAll('[data-review]')) b.onclick = act(() => api('POST', `/api/segments/${b.dataset.review}/review`, {revision: +b.dataset.rev, decision: 'approved'}), b);
  // Rejecting content in a ready publication, or in one counting down to air, withdraws it (N04); a reason is
  // required and logged. The server's clock decides; this text only warns.
  for (const b of document.querySelectorAll('[data-reject]')) b.onclick = act(async () => {
    const seg = state.segments[b.dataset.reject], bs = state.broadcast, starting = bs.state === 'on_air' && Date.now() + clockOffset < bs.onAirAt;
    const inPublication = (bs.state === 'ready' || starting) && bs.manifest?.segments.some(x => x.id === seg.id && x.revision === +b.dataset.rev);
    const reason = prompt(`Reject “${seg.title}” r${b.dataset.rev}? ${inPublication ? (starting ? 'This cancels the start and withdraws the publication before air. ' : 'This withdraws the ready publication before air. ') : ''}Reason (logged):`);
    if (!reason?.trim()) return;
    await api('POST', `/api/segments/${b.dataset.reject}/review`, {revision: +b.dataset.rev, decision: 'rejected', note: reason.trim()});
  }, b);
  for (const b of document.querySelectorAll('[data-pick]')) b.onclick = () => document.querySelector(`[data-upload="${b.dataset.pick}"]`).click();
  for (const input of document.querySelectorAll('[data-upload]')) input.onchange = act(() => upload(input.dataset.upload, input.files[0]));
  renderVoicePanel(s);

  $('#revisions').innerHTML = s.revisions.slice().reverse().map(r => `<li value="${r.revision}"><b>r${r.revision}</b> ${r.proposalId ? `from ${r.proposalId} (base r${r.baseRevision}) · ${time(r.at)}` : 'seeded programme'}
    ${r.diff.map(d => `<div class="diff">${esc(s.segments[d.segmentId].title)}: ${d.before.start}s+${d.before.duration}s → <b>${d.after.start}s+${d.after.duration}s</b></div>`).join('')}</li>`).join('');

  if (me?.role === 'producer') {
    $('#producer-actions').hidden = false;
    $('#live-btn').disabled = s.broadcast.state !== 'ready';
    // Publish only when nothing is open and the current revision is not already the ready publication.
    $('#publish-btn').disabled = s.broadcast.state === 'on_air' || !!open || (s.broadcast.state === 'ready' && s.broadcast.publishRevision === s.showRevision);
  }
  playhead(); renderGuide();
}

// "starting" during the countdown, "on air" from onAirAt (server clock); refreshed on the clock tick, not only on events.
function broadcastLabel() {
  const b = state?.broadcast; if (!b) return;
  const text = b.state === 'on_air' && Date.now() + clockOffset < b.onAirAt ? 'starting' : b.state.replace('_', ' ');
  if ($('#broadcast-state').textContent !== text) $('#broadcast-state').textContent = text;
}
// ---------- guided flow (3.2, judge-facing) ----------
// Five steps derived only from the server state; the buttons call the same API as the board below and the server
// decides. Georgian first, English underneath. Nothing here reports success before the server state shows it.
const STEPS = [['აირჩიე სეგმენტი', 'Choose a segment'], ['მოითხოვე თავისუფალი დრო', 'Request available airtime'], ['გადახედე ცვლილებას', 'Review the change'], ['დაადასტურე', 'Approve'], ['უყურე ეთერს', 'Watch the broadcast']];
const mmss = t => `${Math.floor(Math.max(0, t) / 60)}:${String(Math.floor(Math.max(0, t) % 60)).padStart(2, '0')}`;
const line = (ka, en, cls = '') => `<p class="g-line ${cls}"><span lang="ka">${esc(ka)}</span><small>${esc(en)}</small></p>`;
function confirmedOutcome(s, layout) {
  return Object.values(s.bookings).filter(b => b.state === 'confirmed').map(b => {
    const at = layout.find(e => e.segmentId === b.segmentId)?.start, kept = at === b.start, title = s.segments[b.segmentId].title;
    return kept ? line(`🔒 ${title} — ისევ ${mmss(b.start)}-ზეა`, `🔒 ${title} still starts at ${mmss(b.start)} (confirmed slot protected)`, 'ok')
      : line(`⚠ ${title}: ${mmss(at)} (დადასტურებული ${mmss(b.start)})`, `⚠ ${title} would start at ${mmss(at)}, confirmed ${mmss(b.start)}`, 'bad');
  }).join('');
}
function renderGuide() {
  const s = state, el = $('#guide');
  if (!s || !el) return;
  const b = s.broadcast, now = Date.now() + clockOffset, props = Object.values(s.proposals), open = props.filter(p => ['negotiating', 'awaiting_proposer', 'awaiting_approval'].includes(p.status)).pop(), latest = open || props.pop();
  const person = me?.type === 'person' ? me : null, producer = person?.role === 'producer';
  let step = 0, body = '', action = '';
  if (b.state === 'on_air' || (b.state === 'ready' && b.publishRevision === s.showRevision) || b.state === 'completed' || b.state === 'failed' || (b.withdrawn && !open && s.showRevision === b.withdrawn.publishRevision)) {
    step = 4;
    if (b.state === 'ready') { body = line(`გამოქვეყნდა #${b.manifest.publicationId} — ეთერისთვის მზადაა`, `Published #${b.manifest.publicationId}: ready for air`); if (producer) action = `<button class="primary" data-g="golive">ეთერში გაშვება <small>Go live</small></button>`; }
    else if (b.state === 'on_air' && now < b.onAirAt) body = line(`ეთერამდე ${Math.ceil((b.onAirAt - now) / 1000)} წამი`, `Going live in ${Math.ceil((b.onAirAt - now) / 1000)} s`);
    else if (b.state === 'on_air') body = line(`პირდაპირ ეთერში · ${mmss((now - b.onAirAt) / 1000)} / ${mmss(b.manifest.durationSec)}`, `Live · ${mmss((now - b.onAirAt) / 1000)} / ${mmss(b.manifest.durationSec)}`, 'live');
    else if (b.state === 'completed') body = line('ეთერი დასრულდა', 'Ended');
    else if (b.state === 'failed') body = line('ეთერი შეწყდა — პროდიუსერმა გააჩერა', 'Stopped by the producer', 'bad');
    else body = line(`გამოქვეყნება #${b.withdrawn.publicationId} გაუქმდა — ეთერში არ გავა`, `Publication #${b.withdrawn.publicationId} withdrawn: will not air (${b.withdrawn.reason})`, 'bad');
    if (b.manifest) body += confirmedOutcome(s, b.manifest.segments.map(x => ({segmentId: x.id, start: x.start})));
    if (b.state !== 'failed' && !b.withdrawn) action += `<a class="g-open" href="/broadcast/" target="_blank" rel="noopener">ეთერის გახსნა <small>Open broadcast ↗</small></a>`;
  } else if (open && open.status !== 'awaiting_approval') {
    step = 1;
    const waiting = Object.values(s.requests).filter(r => r.proposalId === open.id && r.status === 'open').map(r => s.agents[r.toAgentId]);
    body = line('აგენტები თანხმდებიან…', 'Agents are negotiating with the Showrunner') + (waiting.length ? line(`ველოდებით აგენტს: ${waiting.map(a => name(a.ownerId)).join(', ')}`, `Waiting for: ${waiting.map(a => a.label).join(', ')}`) : '')
      + line('დადასტურებული დრო დაცულია', 'Confirmed airtime is protected: it cannot move without its owner', 'ok');
  } else if (open) {
    const waiting = open.requiredApprovals.filter(id => open.approvals[id]?.version !== open.version), done = open.requiredApprovals.length - waiting.length;
    step = person && waiting.includes(person.id) ? 3 : 2;
    const changed = open.preview.filter(e => e.duration !== s.layout.find(x => x.segmentId === e.segmentId)?.duration)
      .map(e => `${s.segments[e.segmentId].title}: ${s.layout.find(x => x.segmentId === e.segmentId).duration}s → ${e.duration}s`);
    body = line(`ცვლილება · ვერსია ${open.version}: ${changed.join(' · ')}`, `Change · version ${open.version}: ${changed.join(' · ')}`) + confirmedOutcome(s, open.preview)
      + line(`დაადასტურა ${done}/${open.requiredApprovals.length}: ${open.requiredApprovals.map(id => `${name(id)}${open.approvals[id]?.version === open.version ? ' ✓' : ''}`).join(' · ')}`, `Approved ${done} of ${open.requiredApprovals.length}. Agents cannot approve, only people.`);
    if (person && waiting.includes(person.id)) action = `<p class="g-turn" lang="ka">შენი ჯერია — შენს დადასტურებას ველოდებით <small>Your turn: your approval is needed</small></p><button class="primary" data-g="approve">ვადასტურებ · ვერსია ${open.version} <small>Approve version ${open.version}</small></button><button data-g="reject">უარყოფა <small>Reject</small></button>`;
  } else if (latest && ['no_agreement', 'rejected', 'stale'].includes(latest.status) && s.showRevision === latest.baseRevision) {
    step = 1; body = line('შეთანხმება ვერ შედგა — გადაცემა უცვლელია', 'No agreement: the programme is unchanged', 'bad');
  } else if (s.showRevision > 1) {
    step = 4; body = line('ყველამ დაადასტურა', 'Everyone approved the change') + confirmedOutcome(s, s.layout);
    if (producer) action = `<button class="primary" data-g="publish">გამოქვეყნება <small>Publish</small></button>`;
    else body += line('ველოდებით პროდიუსერს: გამოქვეყნება', 'Waiting for the producer to publish');
  } else {
    step = 0;
    const mine = person && !producer ? s.order.map(id => s.segments[id]).filter(x => x.ownerId === person.id) : [];
    body = mine.length ? line('შენი სეგმენტები — უთხარი შენს აგენტს, რა გინდა', 'Your segments: tell your agent what you want') + mine.map(x => { const locked = s.bookings[x.id]?.state === 'confirmed'; return line(`${x.title} · ${x.duration}წმ${locked ? ' 🔒' : ` · შეიძლება ${x.minDuration}–${x.maxDuration}წმ`}`, `${x.title} · ${x.duration}s${locked ? ' · confirmed slot' : ` · can be ${x.minDuration}–${x.maxDuration}s`}`); }).join('')
      : line('შემქმნელები ირჩევენ სეგმენტს და ავალებენ თავიანთ აგენტებს', 'Creators choose a segment and instruct their own agents');
    body += confirmedOutcome(s, s.layout);
    // Two ways for a creator to prepare their appearance; both end in a brief the creator approves.
    if (person && !producer) {
      const agent = Object.values(s.agents).find(a => a.ownerId === person.id), on = agent?.lastSeenAt && s.serverTime - agent.lastSeenAt < 90000;
      action = `<a class="g-open primary-link" href="/interview/">ესაუბრე ECHO-ს <small>Talk to ECHO: a short interview, by voice or text</small></a>
        <details class="g-agent"><summary>დააკავშირე შენი აგენტი <small>Connect your own agent</small></summary>
          <p lang="ka">შენს AI აგენტს შეუძლია ECHO-ს კითხვებს შენ ნაცვლად უპასუხოს — მხოლოდ იმით, რაც შენ უთხარი. ბრიფს, ფაილებს და უფლებებს მაინც შენ ადასტურებ.</p>
          <p lang="ka">მიეცი დავალება: „მოამზადე ჩემი ECHO-ს ბრიფი ECHO-ს ხელსაწყოებით“. შემდეგ გახსენი „ესაუბრე ECHO-ს“ და გადახედე.</p>
          <p class="fine">${esc(agent?.label || 'Your agent')}: ${on ? `connected (${esc(agent.client || 'MCP client')})` : agent?.lastSeenAt ? `last seen ${time(agent.lastSeenAt)}` : 'not connected yet'}</p>
          <details class="fine"><summary>Technical details</summary>MCP (stdio) with the agent's own token, issued by the producer. Interview tools: start_interview, get_interview, answer_interview, skip_interview_question, review_creator_brief, list_my_library, prepare_segment_from_brief (only after you approve the brief). No tool can approve, declare rights, upload, publish or move confirmed airtime.</details>
        </details>`;
    }
  }
  renderTech();
  el.innerHTML = `<ol class="g-steps">${STEPS.map(([ka, en], i) => `<li class="${i < step ? 'done' : i === step ? 'current' : ''}"${i === step ? ' aria-current="step"' : ''}><b lang="ka">${i + 1}. ${ka}</b><small>${en}</small></li>`).join('')}</ol><div class="g-card">${body}<div class="g-actions">${action}</div></div>`;
  const button = n => el.querySelector(`[data-g="${n}"]`);
  if (button('approve')) { button('approve').onclick = act(() => api('POST', `/api/proposals/${open.id}/decision`, {version: open.version, decision: 'approve'}), button('approve')); button('reject').onclick = act(() => api('POST', `/api/proposals/${open.id}/decision`, {version: open.version, decision: 'reject'}), button('reject')); }
  if (button('publish')) button('publish').onclick = act(() => api('POST', '/api/publish'), button('publish'));
  if (button('golive')) button('golive').onclick = act(() => api('POST', '/api/golive', {delayMs: 5000, publicationId: b.manifest.publicationId, hash: b.manifest.hash}), button('golive'));
}

// Technical view for judges: what agents actually called and what changed, straight from server state.
function renderTech() {
  const s = state, el = $('#tech-body');
  if (!el || !$('#tech').open) return;
  const calls = (s.agentCalls || []).slice(-40).reverse();
  const events = s.audit.filter(e => /^(brief_|segment_prepared|segment_unauthorised|proposal_|revision_committed|approvals_reset|published|on_air|publication_withdrawn|voice_rendered)/.test(e.action)).slice(-30).reverse();
  el.innerHTML = `<h3>Agent tool calls <small>(${calls.length})</small></h3><table class="tech-table"><thead><tr><th>Time</th><th>Agent</th><th>Client</th><th>Tool</th><th>Request</th><th>Result</th></tr></thead><tbody>${calls.map(c => `<tr><td>${time(c.at)}</td><td>${esc(name(c.agentId))}</td><td>${esc(c.client || '—')}</td><td class="mono">${esc(c.tool || '—')}</td><td class="mono">${esc(c.method)} ${esc(c.path)}</td><td class="${c.status < 300 ? 'ok' : 'bad'}">${c.status}</td></tr>`).join('') || '<tr><td colspan="6">No agent calls yet.</td></tr>'}</tbody></table>
    <h3>State changes and approvals</h3><ol class="feed">${events.map(e => `<li><span class="time">${time(e.at)}</span><b>${esc(e.action)}</b> ${esc(e.summary)}</li>`).join('') || '<li>—</li>'}</ol>
    <p class="fine">Programme revision r${s.showRevision}${s.broadcast.manifest ? ` · publication #${s.broadcast.manifest.publicationId} · ${esc(s.broadcast.manifest.hash.slice(0, 16))}` : ''}. Interview answers and creator libraries are private and never appear here.</p>`;
}

function renderNegotiation(p) {
  const el = $('#negotiation');
  if (!p) { el.innerHTML = '<p class="empty">No proposal yet. The seeded programme stands.</p>'; return; }
  const s = state, steps = [];
  const agentStep = (agentId, text, quote) => { const a = s.agents[agentId]; steps.push(`<div class="step ${ownerClass(a.ownerId)}"><div class="who-line">${esc(a.label)} · ${esc(a.client || 'agent')}</div>${esc(text)}${quote ? `<blockquote>“${esc(quote)}”</blockquote>` : ''}</div>`); };
  const first = p.history[0]?.changes || p.changes;
  agentStep(p.agentId, `proposed ${first.map(c => `${s.segments[c.segmentId].title} → ${c.duration ?? s.segments[c.segmentId].duration}s`).join(', ')} on r${p.baseRevision}`, p.note);
  for (const c of p.conflicts || []) steps.push(`<div class="step showrunner"><div class="who-line">Showrunner · rules</div>Conflict: ${esc(c.explanation)}</div>`);
  for (const h of p.houseChanges) steps.push(`<div class="step showrunner"><div class="who-line">Showrunner · rules</div>Offers ECHO house time: ${esc(s.segments[h.segmentId].title)} ${h.from ?? s.segments[h.segmentId].duration}s → ${h.offered ?? h.duration}s</div>`);
  for (const r of Object.values(s.requests).filter(r => r.proposalId === p.id)) {
    if (r.type === 'concede') {
      steps.push(`<div class="step showrunner"><div class="who-line">Showrunner → ${esc(s.agents[r.toAgentId].label)}</div>${esc(r.message)}</div>`);
      if (r.response) agentStep(r.toAgentId, r.response.decision === 'accept' ? `accepts: ${s.segments[r.segmentId].title} → ${r.response.duration}s` : `declines to change ${s.segments[r.segmentId].title}`, r.response.message);
      else if (r.status === 'expired') steps.push(`<div class="step showrunner"><div class="who-line">Showrunner</div>No answer in time: treated as no change.</div>`);
      else steps.push(`<div class="step"><span class="status">waiting for ${esc(s.agents[r.toAgentId].label)}</span></div>`);
    } else {
      steps.push(`<div class="step showrunner"><div class="who-line">Showrunner → ${esc(s.agents[r.toAgentId].label)}</div>${esc(r.message)}</div>`);
      if (r.status === 'open') steps.push(`<div class="step"><span class="status">waiting for ${esc(s.agents[r.toAgentId].label)} to adapt</span></div>`);
    }
  }
  if (p.history.length) agentStep(p.agentId, `adapted (v${p.version}): ${p.changes.map(c => `${s.segments[c.segmentId].title} → ${c.duration ?? s.segments[c.segmentId].duration}s${c.content?.slides ? ` (${c.content.slides.map(x => x.seconds + 's').join(' / ')})` : ''}`).join(', ')}`,
    s.audit.filter(e => e.proposalId === p.id && e.action === 'proposal_revised').pop()?.summary.split('— “')[1]?.replace(/”$/, ''));
  for (const [id, a] of Object.entries(p.approvals || {})) steps.push(`<div class="step human"><div class="who-line">${esc(name(id))} · human</div>approved v${a.version}</div>`);
  const statusText = {negotiating: 'agents negotiating', awaiting_proposer: 'waiting for proposer', awaiting_approval: 'waiting for human approval', committed: `committed as r${p.committedRevision}`, no_agreement: 'NO AGREEMENT — programme unchanged', rejected: 'rejected — programme unchanged', stale: 'stale — nothing applied'}[p.status];
  let approve = '';
  if (p.status === 'awaiting_approval') {
    const waiting = p.requiredApprovals.filter(id => p.approvals[id]?.version !== p.version);
    approve = `<div class="approve-row"><span class="fine">Needs: ${p.requiredApprovals.map(id => `${esc(name(id))}${p.approvals[id]?.version === p.version ? ' ✓' : ''}`).join(' · ')}</span>
      ${me?.type === 'person' && waiting.includes(me.id) ? `<button class="primary" id="approve">Approve v${p.version}</button><button id="reject">Reject</button>` : ''}</div>`;
  }
  el.innerHTML = `<p><b>${esc(p.id)}</b> · v${p.version} · base r${p.baseRevision} <span class="status ${p.status === 'committed' ? 'ok' : ['no_agreement', 'rejected', 'stale'].includes(p.status) ? 'bad' : ''}">${esc(statusText)}</span></p>${steps.join('')}${approve}`;
  if ($('#approve')) { $('#approve').onclick = act(() => api('POST', `/api/proposals/${p.id}/decision`, {version: p.version, decision: 'approve'}), $('#approve')); $('#reject').onclick = act(() => api('POST', `/api/proposals/${p.id}/decision`, {version: p.version, decision: 'reject'}), $('#reject')); }
}

async function upload(segmentId, file) {
  if (!file) return;
  const seg = state.segments[segmentId], assetId = seg.assets.find(a => a.kind === (file.type.startsWith('audio') ? 'audio' : 'image'))?.id || seg.assets[0].id;
  if (!confirm(`Replace ${assetId} in “${seg.title}” with ${file.name}?\n\nConfirm you own or are licensed to broadcast this media. The segment will need editorial approval again.`)) return;
  const res = await fetch(`/api/segments/${segmentId}/media/${assetId}`, {method: 'POST', body: file, headers: {authorization: `Bearer ${token}`, 'idempotency-key': requestKey(), 'x-filename': file.name, 'x-rights-declared': 'yes', 'x-title': encodeURIComponent(file.name)}});
  if (!res.ok) throw new Error((await res.json()).message);
}

let clockSynced = false, bestRtt = Infinity;
async function syncClock() {
  try { const t0 = Date.now(), {serverTime} = await (await fetch('/api/time', {cache: 'no-store'})).json(), t1 = Date.now();
    if (t1 - t0 <= bestRtt * 1.5) { bestRtt = Math.min(bestRtt, t1 - t0); clockOffset = serverTime - (t0 + t1) / 2; clockSynced = true; } } catch {}
}
function playhead() {
  const b = state?.broadcast, el = $('#playhead');
  if (!b || b.state !== 'on_air') { el.hidden = true; return; }
  const t = (Date.now() + clockOffset - b.onAirAt) / 1000, track = $('#track-current');
  if (t < 0 || t > b.manifest.durationSec) { el.hidden = true; return; }
  el.hidden = false; el.style.left = `${track.offsetLeft + track.offsetWidth * t / b.manifest.durationSec}px`;
}
setInterval(() => { playhead(); broadcastLabel(); if (state?.broadcast.state === 'on_air') renderGuide(); }, 250);

$('#tech').addEventListener('toggle', () => renderTech());
$('#publish-btn').onclick = act(() => api('POST', '/api/publish'), $('#publish-btn'));
// Go live with exactly the publication shown on this board; the server refuses if it is no longer current.
$('#live-btn').onclick = act(() => api('POST', '/api/golive', {delayMs: 5000, publicationId: state.broadcast.manifest?.publicationId, hash: state.broadcast.manifest?.hash}), $('#live-btn'));
$('#reset-btn').onclick = act(async () => { if (confirm('Reset the rehearsal to the seeded programme? Audit history is cleared.')) await api('POST', '/api/reset'); });

async function start() {
  if (token) {
    try { me = await api('GET', '/api/me'); $('#who').textContent = `${me.name || me.label} · ${me.role || me.type}`; }
    catch { token = null; try { sessionStorage.removeItem('echo-token'); } catch {} $('#who').textContent = 'Viewer · link not recognised'; }
  }
  const events = new EventSource('/api/events');
  events.addEventListener('state', e => { state = JSON.parse(e.data); if (!clockSynced) clockOffset = state.serverTime - Date.now(); render(); });
  syncClock(); setInterval(syncClock, 15000);
  events.onopen = () => { $('#connection').dataset.state = 'live'; $('#connection').textContent = 'Live'; };
  events.onerror = () => { $('#connection').dataset.state = 'lost'; $('#connection').textContent = 'Reconnecting'; };
}
start();

// ---------- unified build: the producer gives the house host segments an approved Georgian voice ----------
// Fixed, already-paid ElevenLabs samples only (exact scripts); the rendered audio is a new revision the producer
// must approve as exact bytes, then publish. No dynamic TTS, no paid call. Captions are approximate.
let sampleCatalogue = null;
async function renderVoicePanel(s) {
  const panel = $('#voice-panel');
  if (me?.role !== 'producer') { panel.hidden = true; return; }
  if (!sampleCatalogue) { try { sampleCatalogue = (await api('GET', '/api/voice/samples')).samples; } catch { sampleCatalogue = []; } }
  const hosts = s.order.map(id => s.segments[id]).filter(seg => seg.module === 'host' && seg.house);
  const WHO = {'presenter-1': 'Manana · ECHO-ს წამყვანი', 'presenter-2': 'Luka · სტუმარი (Atlas)', 'presenter-3': 'Tamar · ანალიტიკოსი (Nova)'};
  panel.hidden = false;
  panel.innerHTML = `<h3>ქართული ხმა წამყვანის სეგმენტებისთვის <small class="fine">Georgian voice for house segments · fixed approved samples, no new generation</small></h3>` + hosts.map(seg => {
    const v = seg.content?.voice, a = v && seg.assets.find(x => x.id === v.assetId);
    const now = v ? `<div class="now">ახლა: „${esc(v.lines.map(l => l.text).join(' '))}" · ${esc(a?.voice?.provider || '')}${a?.voice?.approximateTiming ? ' · სუბტიტრები მიახლოებით' : ''} · r${seg.revision}${s.segmentsValid[seg.id] ? ' ✓ დამტკიცებული' : ' · საჭიროა დამტკიცება ზემოთ'}</div>` : `<div class="now">ახლა: ინგლისური სტანდარტული ხაზი (Piper ან მხოლოდ სუბტიტრები)</div>`;
    const opts = sampleCatalogue.map(x => { const fits = x.duration <= seg.duration + .05; return `<option value="${esc(x.id)}" ${fits ? '' : 'disabled'}>${esc(WHO[x.presenter] || x.presenter)} · ${x.duration.toFixed(1)} წმ${fits ? '' : ' · არ ჯდება'} — ${esc(x.text.slice(0, 70))}${x.text.length > 70 ? '…' : ''}</option>`; }).join('');
    return `<div class="row"><b>${esc(seg.title)}</b> <span class="fine">${seg.duration} წმ</span></div>${now}<div class="row"><select data-voice-for="${seg.id}" aria-label="sample for ${esc(seg.title)}"><option value="">— აირჩიე ნიმუში —</option>${opts}</select><button data-voice="${seg.id}">ხმის დაყენება</button></div>`;
  }).join('') + `<p class="fine">ხმის დაყენების შემდეგ სეგმენტი ახალ რევიზიად ითვლება: დაამტკიცე „Approve rN" ზემოთ, შემდეგ გამოაქვეყნე. ხმა საჯარო ხდება მხოლოდ გამოქვეყნებისას.</p>`;
  for (const b of panel.querySelectorAll('[data-voice]')) b.onclick = act(async () => {
    const sel = panel.querySelector(`[data-voice-for="${b.dataset.voice}"]`), x = sampleCatalogue.find(z => z.id === sel.value);
    if (!x) return;
    await api('POST', `/api/segments/${b.dataset.voice}/voice`, {lines: [{presenter: x.presenter, text: x.text}], lang: 'ka'});
  }, b);
}
