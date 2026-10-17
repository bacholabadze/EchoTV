// Timing from character alignment (e.g. ElevenLabs "with-timestamps"): viseme cues for the studio rig, phrase
// captions and speaker turns. Pure functions, no I/O. The letter-to-viseme mapping is approximate (spelling, not
// phonemes), like the Piper mapping in tools/host-voice.py; it is not measured lip-sync.

// Georgian (Mkhedruli) spelling is close to phonemic, so letters map directly to the rig's viseme keys.
const GEORGIAN = {aa: 'ა', E: 'ე', I: 'ი', O: 'ო', U: 'უ', PP: 'ბპფმ', FF: 'ვ', DD: 'დტთ', nn: 'ნლ', SS: 'სზცძწ', CH: 'შჟჩჯჭ', kk: 'კქგყღხჰ', RR: 'რ'};
// Latin letters, rough (English has no letter-phoneme correspondence; good enough for mouth shapes).
const LATIN = {aa: 'a', E: 'e', I: 'iy', O: 'o', U: 'uw', PP: 'bpm', FF: 'fv', DD: 'td', nn: 'nl', SS: 'szc', CH: 'j', kk: 'kgqx', RR: 'r'};
const VISEME = new Map();
for (const table of [GEORGIAN, LATIN]) for (const [key, letters] of Object.entries(table)) for (const ch of letters) VISEME.set(ch, key);
export const visemeOf = ch => VISEME.get(ch.toLowerCase()) ?? null;
export const GEORGIAN_LETTERS = Object.values(GEORGIAN).join('');

export const normalizeText = text => String(text ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();

// alignment = {characters, character_start_times_seconds, character_end_times_seconds}; optional [from, to) slice.
function chars(alignment, from = 0, to = alignment?.characters?.length ?? 0) {
  const out = [];
  for (let i = from; i < to; i++) out.push({ch: alignment.characters[i], start: alignment.character_start_times_seconds[i], end: alignment.character_end_times_seconds[i]});
  return out;
}
const round = t => Math.round(t * 10000) / 10000;

// Consecutive letters with the same mouth shape merge into one cue; spaces and punctuation produce no cue.
export function cuesFromAlignment(alignment, {from, to, presenter} = {}) {
  const cues = [];
  for (const c of chars(alignment, from, to)) {
    const key = visemeOf(c.ch);
    if (!key || !(c.end > c.start)) continue;
    const last = cues.at(-1);
    if (last && last.key === key && Math.abs(last.end - c.start) < .02) last.end = round(c.end);
    else cues.push({start: round(c.start), end: round(c.end), key, ...(presenter ? {presenter} : {})});
  }
  return cues;
}

// Words, then phrases of at most maxChars, broken after sentence punctuation (and after commas once long enough).
export function captionsFromAlignment(alignment, {from, to, presenter, maxChars = 42} = {}) {
  const words = [];
  let word = null;
  for (const c of chars(alignment, from, to)) {
    if (/\s/.test(c.ch)) { if (word) words.push(word); word = null; continue; }
    if (!word) word = {text: '', start: c.start, end: c.end};
    word.text += c.ch; word.end = Math.max(word.end, c.end);
  }
  if (word) words.push(word);
  const captions = [];
  let phrase = null;
  for (const w of words) {
    if (phrase && phrase.text.length + 1 + w.text.length > maxChars) { captions.push(phrase); phrase = null; }
    if (!phrase) phrase = {start: round(w.start), end: round(w.end), text: w.text, ...(presenter ? {presenter} : {})};
    else { phrase.text += ` ${w.text}`; phrase.end = round(w.end); }
    if (/[.!?…]["»”]?$/.test(w.text) || (/[,;:—]$/.test(w.text) && phrase.text.length >= 20)) { captions.push(phrase); phrase = null; }
  }
  if (phrase) captions.push(phrase);
  return captions;
}

// Dialogue: ElevenLabs voice_segments index into one alignment for all lines; dialogue_input_index names the line.
export function dialogueTiming(alignment, segments, lines) {
  const turns = [], captions = [], cues = [];
  for (const s of segments) {
    const presenter = lines[s.dialogue_input_index]?.presenter;
    const range = {from: s.character_start_index, to: s.character_end_index, presenter};
    turns.push({presenter, line: s.dialogue_input_index, start: round(s.start_time_seconds), end: round(s.end_time_seconds)});
    captions.push(...captionsFromAlignment(alignment, range)); cues.push(...cuesFromAlignment(alignment, range));
  }
  return {turns, captions, cues};
}

// When a provider returns no alignment: spread the characters evenly over the audio. Marked approximate.
export function approximateAlignment(text, duration, offset = 0) {
  const characters = [...text], step = duration / Math.max(1, characters.length);
  return {characters, character_start_times_seconds: characters.map((_, i) => offset + i * step), character_end_times_seconds: characters.map((_, i) => offset + (i + 1) * step)};
}
