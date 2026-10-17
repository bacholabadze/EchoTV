// Live Production Board. Reads the shared state over SSE; signed-in people act with their own token.
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const fromHash = new URLSearchParams(location.hash.slice(1)).get('token');
if (fromHash) { try { sessionStorage.setItem('echo-token', fromHash); } catch {} history.replaceState(null, '', location.pathname); }
let token = fromHash; try { token ||= sessionStorage.getItem('echo-token'); } catch {}
let me = null, state = null, clockOffset = 0, seenSeq = 0;

async function api(method, path, body) {
  const res = await fetch(path, {method, headers: {'content-type': 'application/json', ...(token ? {authorization: `Bearer ${token}`} : {})}, body: body && JSON.stringify(body)});
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error);
  return data;
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
  $('#publish').textContent = s.broadcast.publishRevision ? `r${s.broadcast.publishRevision} · ${s.broadcast.manifest.hash.slice(0, 10)}` : 'not published';
  $('#broadcast-state').textContent = s.broadcast.state.replace('_', ' ');
  const ruler = [0, 20, 40, 50, 60, 80, 100, 120].filter(t => t <= s.episode.durationSec);
  $('#ruler').innerHTML = ruler.map(t => `<span style="left:${t / s.episode.durationSec * 100}%">${t}s</span>`).join('');
  track($('#track-current'), s.layout);

  const open = Object.values(s.proposals).filter(p => ['negotiating', 'awaiting_proposer', 'awaiting_approval'].includes(p.status)).pop();
  const latest = open || Object.values(s.proposals).pop();
  if (open) {
    const d = Object.fromEntries(s.layout.map(e => [e.segmentId, e.duration]));
    const changes = [...open.changes, ...open.concessions, ...open.houseChanges];
    for (const c of changes) if (c.duration !== undefined) d[c.segmentId] = c.duration;
    let at = 0; const preview = s.order.map(id => { const e = {segmentId: id, start: at, duration: d[id]}; at += d[id]; return e; });
    $('#preview-wrap').hidden = false; $('#preview-label').textContent = `${open.id} v${open.version} · ${at}s total`;
    track($('#track-preview'), preview, new Set(changes.map(c => c.segmentId)));
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
    const seg = s.segments[id], valid = s.segmentsValid[id], canReview = me?.role === 'producer' && !valid && seg.state !== 'rejected';
    const mine = me?.type === 'person' && me.id === seg.ownerId && seg.assets.length;
    return `<tr><td>${esc(seg.title)}${seg.house ? ' <span class="fine">house</span>' : ''}</td><td>${esc(name(seg.ownerId))}</td><td>r${seg.revision}</td>
      <td class="mono">${seg.assets.map(a => `${esc(a.id)} ${esc(a.sha256.slice(0, 8))}`).join('<br>') || '—'}</td>
      <td>${valid ? `<span class="status ok">approved r${seg.approval.revision}</span>` : `<span class="status">${esc(seg.state)}</span>`}</td>
      <td>${canReview ? `<button data-review="${id}" data-rev="${seg.revision}">Approve r${seg.revision}</button>` : ''}${mine ? `<label class="fine"><input type="file" data-upload="${id}" accept="image/*,audio/*" hidden><button data-pick="${id}">Replace media</button></label>` : ''}</td></tr>`;
  }).join('');
  for (const b of document.querySelectorAll('[data-review]')) b.onclick = act(() => api('POST', `/api/segments/${b.dataset.review}/review`, {revision: +b.dataset.rev, decision: 'approved'}), b);
  for (const b of document.querySelectorAll('[data-pick]')) b.onclick = () => document.querySelector(`[data-upload="${b.dataset.pick}"]`).click();
  for (const input of document.querySelectorAll('[data-upload]')) input.onchange = act(() => upload(input.dataset.upload, input.files[0]));

  $('#revisions').innerHTML = s.revisions.slice().reverse().map(r => `<li value="${r.revision}"><b>r${r.revision}</b> ${r.proposalId ? `from ${r.proposalId} (base r${r.baseRevision}) · ${time(r.at)}` : 'seeded programme'}
    ${r.diff.map(d => `<div class="diff">${esc(s.segments[d.segmentId].title)}: ${d.before.start}s+${d.before.duration}s → <b>${d.after.start}s+${d.after.duration}s</b></div>`).join('')}</li>`).join('');

  if (me?.role === 'producer') {
    $('#producer-actions').hidden = false;
    $('#live-btn').disabled = s.broadcast.state !== 'ready';
    $('#publish-btn').disabled = s.broadcast.state === 'on_air' || !!open;
  }
  playhead();
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
  const res = await fetch(`/api/segments/${segmentId}/media/${assetId}`, {method: 'POST', body: file, headers: {authorization: `Bearer ${token}`, 'x-filename': file.name, 'x-rights-declared': 'yes', 'x-title': encodeURIComponent(file.name)}});
  if (!res.ok) throw new Error((await res.json()).message);
}

function playhead() {
  const b = state?.broadcast, el = $('#playhead');
  if (!b || b.state !== 'on_air') { el.hidden = true; return; }
  const t = (Date.now() + clockOffset - b.onAirAt) / 1000, track = $('#track-current');
  if (t < 0 || t > b.manifest.durationSec) { el.hidden = true; return; }
  el.hidden = false; el.style.left = `${track.offsetLeft + track.offsetWidth * t / b.manifest.durationSec}px`;
}
setInterval(playhead, 250);

$('#publish-btn').onclick = act(() => api('POST', '/api/publish'), $('#publish-btn'));
$('#live-btn').onclick = act(() => api('POST', '/api/golive', {delayMs: 5000}), $('#live-btn'));
$('#reset-btn').onclick = act(async () => { if (confirm('Reset the rehearsal to the seeded programme? Audit history is cleared.')) await api('POST', '/api/reset'); });

async function start() {
  if (token) {
    try { me = await api('GET', '/api/me'); $('#who').textContent = `${me.name || me.label} · ${me.role || me.type}`; }
    catch { token = null; try { sessionStorage.removeItem('echo-token'); } catch {} $('#who').textContent = 'Viewer · link not recognised'; }
  }
  const events = new EventSource('/api/events');
  events.addEventListener('state', e => { state = JSON.parse(e.data); clockOffset = state.serverTime - Date.now(); render(); });
  events.addEventListener('clock', e => { clockOffset = +e.data - Date.now(); });
  events.onopen = () => { $('#connection').dataset.state = 'live'; $('#connection').textContent = 'Live'; };
  events.onerror = () => { $('#connection').dataset.state = 'lost'; $('#connection').textContent = 'Reconnecting'; };
}
start();
