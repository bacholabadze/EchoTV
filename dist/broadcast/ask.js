// Viewer questions (editorial wave). No account: the server screens and rate-limits every question; a person
// selects one. The viewer keeps only an id and a random check code for their own questions (this browser only).
const $ = s => document.querySelector(s);
const KEY = 'echo-my-questions';
const mine = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const remember = q => { try { localStorage.setItem(KEY, JSON.stringify([...mine(), q].slice(-5))); } catch {} };
const STATUS = {pending: 'მოდერატორთან განხილვაშია', shortlisted: 'რედაქციის აგენტმა მოდერატორს შესთავაზა', selected: 'შეირჩა ეთერისთვის!', answered: 'შეირჩა და პასუხი ეთერშია', rejected: 'ამჯერად არ შეირჩა', blocked: 'ფილტრმა არ მიიღო'};
let qa = null;

async function send(e) {
  e.preventDefault();
  const button = $('#ask-send'); button.disabled = true;
  try {
    const r = await fetch('/api/qa/questions', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({text: $('#ask-text').value, name: $('#ask-name').value})});
    const x = await r.json();
    if (!r.ok) { $('#ask-mine').textContent = x.ka || (x.error === 'rate_limited' ? 'ძალიან ბევრი კითხვა მოკლე დროში. ცოტა ხანში სცადეთ.' : x.error === 'closed' ? 'კითხვების მიღება ახლა დახურულია.' : 'კითხვა ვერ გაიგზავნა.'); return; }
    remember({id: x.id, secret: x.secret, text: $('#ask-text').value.slice(0, 80)});
    $('#ask-text').value = '';
    $('#ask-mine').textContent = x.status === 'blocked' ? `ფილტრმა კითხვა არ მიიღო: ${x.reasons.map(r => r.ka).join(' ')}` : 'კითხვა მიღებულია. მოდერატორი განიხილავს.';
    poll();
  } catch { $('#ask-mine').textContent = 'კავშირი ვერ დამყარდა. სცადეთ თავიდან.'; }
  finally { button.disabled = false; }
}
async function poll() {
  const list = mine();
  if (!list.length) return;
  const rows = await Promise.all(list.map(q => fetch(`/api/qa/questions/${q.id}?secret=${encodeURIComponent(q.secret)}`).then(r => r.ok ? r.json() : null).catch(() => null)));
  const last = rows.map((r, i) => r && {...r, text: list[i].text}).filter(Boolean).at(-1);
  if (last) $('#ask-mine').textContent = `თქვენი ბოლო კითხვა („${last.text}${last.text.length >= 80 ? '…' : ''}“): ${STATUS[last.status] || last.status}.`;
}
function render(state) {
  qa = state.qa;
  const section = $('#ask');
  if (!qa) { section.hidden = true; return; }
  section.hidden = false;
  const b = state.broadcast;
  $('#ask-form').hidden = !qa.open;
  $('#ask-state').textContent = qa.open ? (b.state === 'ready' ? 'გადაცემა მალე დაიწყება. კითხვების მიღება უკვე ღიაა — ის მიიღება კითხვა-პასუხის ბლოკის დასრულებამდე.' : 'კითხვების მიღება ღიაა კითხვა-პასუხის ბლოკის დასრულებამდე.')
    : b.state === 'queued' ? 'ეთერი ახლა არ მიდის. კითხვის დასმა გადაცემის გამოქვეყნების შემდეგ შეიძლება.' : 'კითხვების მიღება ამ გადაცემაზე დასრულებულია.';
  // After the show: the selected question and a released answer stay readable here, clearly labelled.
  const ended = b.state === 'completed' || (b.state === 'on_air' && qa.closesAt && state.serverTime > qa.closesAt);
  $('#after').hidden = !(ended && qa.selected);
  if (ended && qa.selected) {
    $('#after-q').textContent = `კითხვა (${qa.selected.from || 'ანონიმური მაყურებელი'}): ${qa.selected.text}`;
    $('#after-a').textContent = !qa.answer ? 'პასუხი ეთერში არ გასულა.' : `${qa.answer.source === 'human' ? `${qa.answer.label} (ავტორი, პირადად)` : `${qa.answer.onBehalfOf || 'ავტორის'} AI აგენტი${qa.answer.client ? ` (${qa.answer.client})` : ''}, ავტორის ნებართვით`}${qa.answer.afterShow ? ' · უპასუხა ბლოკის დასრულების შემდეგ' : ''}: ${qa.answer.text}`;
  }
}
$('#ask-form').addEventListener('submit', send);
let lastSel = null;
new EventSource('/api/events').addEventListener('state', e => { const st = JSON.parse(e.data); render(st); const sel = JSON.stringify([st.qa?.selected?.id, st.qa?.answer?.releasedAt]); if (sel !== lastSel) { lastSel = sel; poll(); } });
setInterval(poll, 6000); poll();
