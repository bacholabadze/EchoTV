// Creator Interview (3.2): one deterministic engine for both paths, a person (typed or spoken, Georgian first)
// or the creator's own agent over MCP. It asks one question at a time, at most one follow-up per question and only
// when something required is missing or contradictory, and never invents anything: every brief field is the
// creator's own words, the creator's own selection, or listed as missing. Pure functions over a plain object;
// permissions, storage and media live in domain.mjs / server.mjs.
import {createHash} from 'node:crypto';

const sha256 = data => createHash('sha256').update(data).digest('hex');
const canonical = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x);
const MAX_TEXT = 2000, MAX_FIELD = 200;
export class InterviewError extends Error { constructor(code, message) { super(message); this.code = code; } }
const fail = (code, message) => { throw new InterviewError(code, message); };
// Untrusted text (from people or agents) is stored as plain data: control characters removed, length bounded.
export const cleanText = (v, max = MAX_TEXT) => String(v ?? '').normalize('NFC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, max);

export const CHOICES = {
  category: {music: ['მუსიკა', 'Music'], art: ['ვიზუალური ხელოვნება', 'Visual art'], film: ['ფილმი ან ვიდეო', 'Film or video'], other: ['სხვა', 'Other']},
  aiInvolvement: {none: ['AI არ გამომიყენებია', 'No AI used'], assisted: ['AI დამეხმარა', 'AI assisted'], substantial: ['ნამუშევრის დიდი ნაწილი AI-მ შექმნა', 'AI created much of the work'], unsure: ['ჯერ არ ვიცი, დავაზუსტებ', 'Not sure yet']},
  preferredFormat: {premiere: ['პრემიერა', 'Premiere'], showcase: ['ჩვენება', 'Showcase'], conversation: ['საუბარი წამყვანთან', 'Conversation with the presenter'], any: ['ECHO-მ შემომთავაზოს', 'Let ECHO suggest']},
};
// Fields: kind text (≤200), choice (CHOICES key), seconds (1–600), mediaIds (creator's own library items).
export const STEPS = [
  {id: 'who', ask: ['ვინ ხარ და რა შექმენი?', 'Who are you, and what have you created?'], hint: ['მოგვიყევი მოკლედ — შენი სიტყვებით.', 'Tell us briefly, in your own words.'],
    answerField: 'workDescription', fields: {displayName: 'text', workTitle: 'text', category: 'choice'}, required: ['displayName', 'workTitle', 'category'],
    followUps: {displayName: ['როგორ წარგადგინოთ ეთერში?', 'How should we introduce you on air?'], workTitle: ['რა ჰქვია ნამუშევარს?', 'What is the work called?'], category: ['რა ტიპის ნამუშევარია: მუსიკა, ვიზუალური ხელოვნება, ფილმი თუ სხვა?', 'What kind of work is it: music, visual art, film or other?']}},
  {id: 'inspiration', ask: ['რამ შთაგაგონა?', 'What inspired this work?'], answerField: 'inspiration', fields: {}, required: []},
  {id: 'process', ask: ['რა გააკეთე შენ თავად და რა როლი ჰქონდა AI-ს?', 'What did you create yourself, and how was AI involved?'], answerField: 'creationProcess', fields: {aiInvolvement: 'choice'}, required: ['aiInvolvement'],
    followUps: {aiInvolvement: ['მოკლედ: AI საერთოდ არ გამოგიყენებია, დაგეხმარა, თუ ნამუშევრის დიდი ნაწილი მან შექმნა?', 'Briefly: no AI at all, AI assisted, or AI created much of the work?']}},
  {id: 'focus', ask: ['რომელი ნაწილი გინდა, რომ ECHO-მ ეთერში აჩვენოს?', 'Which part would you like ECHO to present?'], answerField: 'presentationFocus', fields: {preferredFormat: 'choice', desiredAirtimeSec: 'seconds'}, required: ['desiredAirtimeSec'],
    followUps: {desiredAirtimeSec: ['რამდენი დრო გჭირდება ეთერში? მაგალითად, 60 წამი.', 'How much airtime do you need? For example, 60 seconds.']}},
  {id: 'media', ask: ['რომელი ფაილების გამოყენების უფლებას გვაძლევ?', 'Which media files can you legally authorise ECHO to use?'], answerField: 'mediaNote', fields: {mediaIds: 'mediaIds'}, required: ['mediaIds'],
    followUps: {mediaIds: ['ჯერ ფაილი არ აგირჩევია. ატვირთე ან აირჩიე შენი ბიბლიოთეკიდან — ან გამოტოვე და მოგვიანებით დაამატე.', 'No file chosen yet. Upload or pick one from your library, or skip and add it later.']}},
  {id: 'notes', ask: ['კიდევ რამე უნდა იცოდეს წამყვანმა?', 'Is there anything else the presenter should know?'], answerField: 'presenterNotes', fields: {}, required: []},
];
const STEP = Object.fromEntries(STEPS.map(s => [s.id, s]));
const REQUIRED_FOR_BRIEF = ['displayName', 'workTitle', 'category', 'aiInvolvement', 'desiredAirtimeSec', 'mediaIds'];
// Mentions of AI tools or generation, used only to ask the creator to clarify (never to decide for them).
const AI_TERMS = /(\bA\.?I\.?\b|ხელოვნურ\S* ინტელექტ\S*|\bChatGPT\b|ჩატჯიპიტ\S*|\bSuno\b|\bUdio\b|Midjourney|\bDALL|Stable Diffusion|გენერირ\S*|\bgenerat\w*|ნეირო\S*|\bneural\b)/i;

export function createInterview({id, ownerId, startedBy, now}) {
  return {id, ownerId, status: 'in_progress', step: 'who', answers: {}, followUpsAsked: {}, history: [{at: now, by: startedBy, action: 'started'}], brief: null, briefRevisions: [], createdAt: now, updatedAt: now};
}

function parseFields(step, fields = {}, {source, mediaOwned}) {
  const out = {};
  for (const [key, value] of Object.entries(fields || {})) {
    const kind = step.fields[key];
    if (!kind) fail('bad_request', `Field ${key} does not belong to question "${step.id}"`);
    if (value === null || value === '') { out[key] = null; continue; }
    if (kind === 'text') out[key] = cleanText(value, MAX_FIELD) || null;
    else if (kind === 'choice') { if (!CHOICES[key][value]) fail('bad_request', `${key} must be one of ${Object.keys(CHOICES[key]).join(', ')}`); out[key] = value; }
    else if (kind === 'seconds') { const n = Number(value); if (!Number.isInteger(n) || n < 1 || n > 600) fail('bad_request', 'desiredAirtimeSec must be a whole number of seconds, 1–600'); out[key] = n; }
    else if (kind === 'mediaIds') {
      if (!Array.isArray(value) || value.length > 12) fail('bad_request', 'mediaIds must be a list (max 12)');
      for (const m of value) if (!mediaOwned(m)) fail('forbidden', `Media ${m} is not in this creator's library`);
      out[key] = [...new Set(value)];
    }
  }
  return out;
}
// The value a field has now: the latest answer that set it.
export function fieldValue(iv, key) {
  for (const s of STEPS) { const a = iv.answers[s.id]; if (a && !a.skipped && key in (a.fields || {})) return a.fields[key]; if (a && !a.skipped && s.answerField === key) return a.text || null; }
  return null;
}
const missingIn = (iv, step) => step.required.filter(k => { const v = fieldValue(iv, k); return v === null || v === undefined || (Array.isArray(v) && !v.length); });

export function contradictions(iv, {library = []} = {}) {
  const out = [], ai = fieldValue(iv, 'aiInvolvement'), told = ['workDescription', 'inspiration', 'creationProcess'].map(k => fieldValue(iv, k) || '').join(' ');
  if (ai === 'none' && AI_TERMS.test(told)) out.push({fields: ['aiInvolvement', 'creationProcess'], ka: `შენ მონიშნე, რომ AI არ გამოგიყენებია, მაგრამ ახსენე „${told.match(AI_TERMS)[0]}“. დააზუსტებ?`, en: `You marked "no AI", but mentioned "${told.match(AI_TERMS)[0]}". Can you clarify?`});
  const category = fieldValue(iv, 'category'), media = (fieldValue(iv, 'mediaIds') || []).map(id => library.find(m => m.id === id)).filter(Boolean);
  if (category === 'music' && media.length && !media.some(m => m.kind === 'audio')) out.push({fields: ['category', 'mediaIds'], ka: 'მუსიკა მონიშნე, მაგრამ აუდიო ფაილი არ აგირჩევია.', en: 'You chose music, but no audio file is selected.'});
  if (category === 'art' && media.length && !media.some(m => m.kind === 'image')) out.push({fields: ['category', 'mediaIds'], ka: 'ვიზუალური ხელოვნება მონიშნე, მაგრამ სურათი არ აგირჩევია.', en: 'You chose visual art, but no image is selected.'});
  return out;
}

// Any question's definition, with the creator's current values (for answering or correcting it).
export function promptFor(iv, stepId, follow = null) {
  const step = STEP[stepId], idx = STEPS.indexOf(step);
  return {stepId: step.id, index: idx + 1, total: STEPS.length, question: follow ? {ka: follow.ka, en: follow.en} : {ka: step.ask[0], en: step.ask[1]}, followUp: !!follow,
    hint: step.hint ? {ka: step.hint[0], en: step.hint[1]} : null, answerField: step.answerField, fields: Object.entries(step.fields).map(([key, kind]) => ({key, kind, ...(kind === 'choice' ? {options: Object.entries(CHOICES[key]).map(([v, [ka, en]]) => ({value: v, ka, en}))} : {}), value: fieldValue(iv, key)})),
    current: iv.answers[step.id] && !iv.answers[step.id].skipped ? {text: iv.answers[step.id].text, fields: iv.answers[step.id].fields, source: iv.answers[step.id].source} : null, skipped: !!iv.answers[step.id]?.skipped};
}
// The question to show now: the current step's follow-up (if one is due), else the step's main question.
export function nextPrompt(iv) { return iv.status === 'in_progress' ? promptFor(iv, iv.step, iv.pendingFollowUp) : null; }

function advance(iv, ctx) {
  // A follow-up only when it is useful: a required field of this step is missing, or this step created a contradiction.
  const step = STEP[iv.step], missing = missingIn(iv, step), clash = contradictions(iv, ctx).find(c => c.fields.some(f => step.fields[f] || step.answerField === f));
  const key = missing[0] ? `missing:${missing[0]}` : clash ? `clash:${clash.fields.join(',')}` : null;
  if (key && !iv.followUpsAsked[`${step.id}:${key}`]) {
    iv.followUpsAsked[`${step.id}:${key}`] = true;
    iv.pendingFollowUp = missing[0] ? {ka: step.followUps[missing[0]][0], en: step.followUps[missing[0]][1], field: missing[0]} : {ka: clash.ka, en: clash.en, fields: clash.fields};
    return;
  }
  iv.pendingFollowUp = null;
  const next = STEPS.find((s, i) => i > STEPS.indexOf(step) && !iv.answers[s.id]) || STEPS.find(s => !iv.answers[s.id]);
  if (next) iv.step = next.id; else { iv.status = 'review'; iv.step = null; }
}

// Answer (or correct) one question. source: 'typed' | 'voice' | 'agent'. Rights are never taken from an answer:
// they are declared per file in the creator's library, by the creator.
export function answer(iv, {stepId, text, fields, source, by, now, transcript, clear = false}, ctx = {}) {
  if (iv.status === 'withdrawn') fail('closed', 'This interview was withdrawn');
  const step = STEP[stepId] || fail('bad_request', `Unknown question ${stepId}`);
  if (!['typed', 'voice', 'agent'].includes(source)) fail('bad_request', 'source must be typed, voice or agent');
  const parsed = parseFields(step, fields, {source, mediaOwned: ctx.mediaOwned || (() => false)});
  const prev = iv.answers[step.id], clean = cleanText(text);
  const merged = {...(prev && !prev.skipped ? prev.fields : {}), ...parsed};
  // Empty text keeps the earlier words (e.g. a follow-up that only fills a field); clear: true removes them.
  iv.answers[step.id] = {text: clear ? '' : clean || (prev && !prev.skipped ? prev.text : ''), fields: merged, source, by, at: now, revision: (prev?.revision || 0) + 1,
    ...(transcript ? {transcript: {provider: transcript.provider, recognised: cleanText(transcript.recognised), corrected: clean !== cleanText(transcript.recognised)}} : {})};
  iv.history.push({at: now, by, action: prev ? 'corrected' : 'answered', step: step.id, source});
  iv.updatedAt = now;
  if (iv.status === 'in_progress' && iv.step === step.id) advance(iv, ctx);
  else reopen(iv, {by, now, reason: `${step.id} corrected`}, ctx);
  return iv;
}
export function skip(iv, {stepId, by, now}, ctx = {}) {
  if (iv.status !== 'in_progress' || iv.step !== stepId) fail('bad_request', 'Only the current question can be skipped');
  iv.answers[stepId] = {skipped: true, by, at: now, revision: (iv.answers[stepId]?.revision || 0) + 1};
  iv.history.push({at: now, by, action: 'skipped', step: stepId}); iv.updatedAt = now;
  iv.pendingFollowUp = null;
  const next = STEPS.find((s, i) => i > STEPS.indexOf(STEP[stepId]) && !iv.answers[s.id]) || STEPS.find(s => !iv.answers[s.id]);
  if (next) iv.step = next.id; else { iv.status = 'review'; iv.step = null; }
  return iv;
}
// Go back to any question (to review or correct it). Correcting after review or approval reopens the brief.
export function goTo(iv, {stepId, by, now}) {
  if (iv.status === 'withdrawn') fail('closed', 'This interview was withdrawn');
  if (!STEP[stepId]) fail('bad_request', `Unknown question ${stepId}`);
  if (iv.status === 'in_progress') { iv.step = stepId; iv.pendingFollowUp = null; }
  iv.history.push({at: now, by, action: 'revisited', step: stepId}); iv.updatedAt = now;
  return iv;
}
// After review or approval, any change rebuilds the brief. If its content changed, an approval no longer counts.
export function refresh(iv, {by, now, reason}, ctx) { reopen(iv, {by, now, reason}, ctx); return iv; }
function reopen(iv, {by, now, reason}, ctx) {
  if (iv.status !== 'approved' && iv.status !== 'review') return;
  const brief = buildBrief(iv, ctx, {now});
  if (iv.status === 'approved' && brief.hash === iv.brief.approval?.hash) { iv.brief = {...iv.brief, missing: brief.missing, contradictions: brief.contradictions}; return; }
  if (iv.status === 'approved') iv.history.push({at: now, by, action: 'approval_void', reason});
  iv.status = 'review'; iv.brief = brief;
}

const BRIEF_FIELDS = ['displayName', 'workTitle', 'category', 'workDescription', 'inspiration', 'creationProcess', 'aiInvolvement', 'presentationFocus', 'preferredFormat', 'desiredAirtimeSec', 'mediaIds', 'mediaNote', 'presenterNotes'];
// The brief: the creator's own words and selections, plus what is missing, unverified or contradictory.
export function buildBrief(iv, {library = [], person} = {}, {now} = {}) {
  const v = Object.fromEntries(BRIEF_FIELDS.map(k => [k, fieldValue(iv, k)]));
  const media = (v.mediaIds || []).map(id => library.find(m => m.id === id)).filter(Boolean).map(m => ({id: m.id, kind: m.kind, title: m.title, sha256: m.sha256, technical: m.technical?.decodable ? 'passed' : 'failed',
    rights: m.rights ? {publicBroadcast: !!m.rights.publicBroadcast, editing: !!m.rights.editing, replays: !!m.rights.replays, promoExcerpts: !!m.rights.promoExcerpts, declaredBy: m.rights.declaredBy, declaredAt: m.rights.at} : null}));
  const missing = REQUIRED_FOR_BRIEF.filter(k => v[k] === null || v[k] === undefined || (Array.isArray(v[k]) && !v[k].length));
  for (const m of media) { if (!m.rights) missing.push(`rights:${m.id}`); else if (!m.rights.publicBroadcast) missing.push(`broadcastPermission:${m.id}`); if (m.technical !== 'passed') missing.push(`technicalCheck:${m.id}`); }
  const content = {
    creator: {personId: iv.ownerId, displayName: v.displayName}, work: {title: v.workTitle, category: v.category, description: v.workDescription},
    story: {inspiration: v.inspiration, quotes: (iv.quotes || []).map(q => cleanText(q, 400)).filter(Boolean)},
    process: {text: v.creationProcess, aiInvolvement: v.aiInvolvement},
    presentation: {focus: v.presentationFocus, preferredFormat: v.preferredFormat, desiredAirtimeSec: v.desiredAirtimeSec},
    media, mediaNote: v.mediaNote, presenterNotes: v.presenterNotes,
    prepared: [...new Set(Object.values(iv.answers).filter(a => !a.skipped).map(a => a.source))],
  };
  const version = (iv.briefRevisions.at(-1)?.version || 0) + 1, hash = sha256(canonical(content));
  if (iv.brief && iv.briefRevisions.at(-1)?.hash === hash) return {...iv.brief, status: 'draft', approval: null, missing, contradictions: contradictions(iv, {library})};
  iv.briefRevisions.push({version, hash, at: now});
  return {version, hash, status: 'draft', ...content, missing, contradictions: contradictions(iv, {library}),
    unverified: ['identity', 'authorship', 'aiInvolvement', ...media.filter(m => m.rights).map(m => `rights:${m.id}`)], // creator-declared, not independently verified
    approval: null};
}
export function review(iv, ctx = {}, {now} = {}) {
  if (iv.status === 'withdrawn') fail('closed', 'This interview was withdrawn');
  if (iv.status === 'in_progress' && STEPS.some(s => !iv.answers[s.id])) fail('incomplete', `Answer or skip every question first (${STEPS.filter(s => !iv.answers[s.id]).map(s => s.id).join(', ')})`);
  iv.status = 'review'; iv.step = null; iv.pendingFollowUp = null; iv.brief = buildBrief(iv, ctx, {now});
  return iv.brief;
}
export function setQuotes(iv, {quotes, by, now}, ctx = {}) {
  if (!Array.isArray(quotes) || quotes.length > 5) fail('bad_request', 'quotes: up to 5 sentences in the creator\'s own words');
  const own = ['workDescription', 'inspiration', 'creationProcess', 'presenterNotes'].map(k => fieldValue(iv, k) || '').join(' \n ');
  for (const q of quotes) if (!own.includes(cleanText(q, 400))) fail('bad_request', 'A quote must be copied from the creator\'s own answers');
  iv.quotes = quotes.map(q => cleanText(q, 400)); iv.history.push({at: now, by, action: 'quotes_set'}); iv.updatedAt = now;
  reopen(iv, {by, now, reason: 'quotes changed'}, ctx);
  return iv;
}
// Only the creator approves, and only the exact brief version (and hash) they reviewed.
export function approve(iv, {version, hash, by, now}) {
  if (iv.status !== 'review' || !iv.brief) fail('bad_request', 'Review the brief before approving it');
  if (version !== iv.brief.version || hash !== iv.brief.hash) fail('stale_version', `You reviewed version ${version}; the brief is now version ${iv.brief.version}. Review it again.`);
  if (iv.brief.missing.some(k => ['displayName', 'workTitle', 'category', 'aiInvolvement'].includes(k))) fail('incomplete', `The brief still needs: ${iv.brief.missing.join(', ')}`);
  if (iv.brief.contradictions.length) fail('incomplete', `Resolve first: ${iv.brief.contradictions.map(c => c.en).join(' ')}`);
  iv.status = 'approved'; iv.brief = {...iv.brief, status: 'approved', approval: {version, hash, by, at: now}};
  iv.history.push({at: now, by, action: 'approved', version}); iv.updatedAt = now;
  return iv.brief;
}
export function withdraw(iv, {by, now, reason}) {
  iv.status = 'withdrawn'; if (iv.brief) iv.brief = {...iv.brief, status: 'withdrawn'};
  iv.history.push({at: now, by, action: 'withdrawn', reason: cleanText(reason, 300)}); iv.updatedAt = now;
  return iv;
}
