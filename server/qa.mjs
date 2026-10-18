// Audience Q&A safety (editorial wave). Viewer text is untrusted: it is cleaned, bounded and screened before any
// person sees it, and it is only ever stored and displayed as data. Nothing in it can reach an agent as an
// instruction, change the programme, a booking or approved media: no code path reads it for those.
// verdict: ok (a person may select it) · flagged (a person may select it, with the reasons shown) · blocked (never shown).
const ZERO_WIDTH = /[\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g;
export const clean = (v, max) => String(v ?? '').normalize('NFC').replace(ZERO_WIDTH, '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

const BLOCK = [
  ['link', /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|ge|net|org|io|ru|info|xyz)\b)/i, 'ბმულები არ მიიღება.'],
  ['email', /\b[\w.+-]+@[\w-]+\.[\w.]+\b/, 'ელფოსტის მისამართი არ მიიღება.'],
  ['phone', /(\+?\d[\d\s().-]{6,}\d)/, 'ტელეფონის ნომრები და გრძელი რიცხვები არ მიიღება.'],
  ['markup', /<\s*\/?\s*(script|iframe|img|a|style|svg)\b|javascript:/i, 'კოდი და HTML არ მიიღება.'],
  ['abuse', /(იდიოტ|სულელ|ბრიყვ|ნაბიჭვ|დედა(ს|შენ)|შენი დედა|ყლე|ტრაკ|მუტელ|ბოზ|\bfuck|\bshit\b|\bbitch|\bcunt|\bnigg|\bfag)/i, 'შეურაცხმყოფელი სიტყვები არ მიიღება.'],
  ['spam', /(.)\1{7,}/u, 'ტექსტი სპამს ჰგავს.'],
];
const FLAG = [
  ['instruction', /(ignore (all |the )?(previous|above)|system prompt|you are (now )?an?\b|act as|pretend|jailbreak|developer mode|დაივიწყე|წინა ინსტრუქცი|უგულებელყავი|შენ ახლა ხარ|როლი შეასრულე|სისტემურ)/i, 'ტექსტი ცდილობს აგენტს ბრძანება მისცეს. ის მხოლოდ კითხვაა — ბრძანებად არ შესრულდება.'],
  ['control', /(approve|publish|go ?live|booking|reschedul|delete|დაამტკიცე|გამოაქვეყნე|წაშალე|გადაიტანე|გააუქმე|ჯავშან|ეთერის დრო შეცვალე)/i, 'ტექსტი პროგრამის ან ჯავშნის შეცვლას ითხოვს. მაყურებლის კითხვას ამის ძალა არ აქვს.'],
  ['personal', /(მისამართ|ტელეფონ|პირად(ი)? ნომერ|პაროლ|ბარათ|address|password|\bssn\b|where (do|does) .* live|სად ცხოვრობ)/i, 'კითხვა შეიძლება პირად ინფორმაციას ითხოვდეს. ფრთხილად განიხილეთ.'],
];

export function moderateAudienceText(raw, {max = 280, min = 8} = {}) {
  const text = clean(raw, max + 1), reasons = [];
  if (text.length < min) reasons.push({code: 'too_short', ka: `ტექსტი მოკლეა (მინიმუმ ${min} სიმბოლო).`, block: true});
  if (text.length > max) reasons.push({code: 'too_long', ka: `ტექსტი გრძელია (მაქსიმუმ ${max} სიმბოლო).`, block: true});
  for (const [code, re, ka] of BLOCK) if (re.test(text)) reasons.push({code, ka, block: true});
  for (const [code, re, ka] of FLAG) if (re.test(text)) reasons.push({code, ka, block: false});
  const verdict = reasons.some(r => r.block) ? 'blocked' : reasons.length ? 'flagged' : 'ok';
  return {text: text.slice(0, max), verdict, reasons: reasons.map(({code, ka}) => ({code, ka}))};
}
// A display name is optional; anything that does not pass is dropped (the viewer appears as anonymous).
export function cleanName(raw) {
  const name = clean(raw, 40);
  if (!name) return null;
  const m = moderateAudienceText(name, {max: 40, min: 1});
  return m.verdict === 'ok' ? m.text : null;
}

// In-memory sliding-window limiter, per viewer address and overall.
export function rateLimiter({perKey = [[3, 60e3], [10, 600e3]], global = [[40, 60e3]], now = () => Date.now()} = {}) {
  const hits = new Map(), all = [];
  const over = (list, rules, t) => rules.find(([n, ms]) => list.filter(x => t - x < ms).length >= n);
  return key => {
    const t = now(), mine = hits.get(key) || [];
    const rule = over(mine, perKey, t) || over(all, global, t);
    if (rule) return {ok: false, retryInSec: Math.ceil(rule[1] / 1000)};
    mine.push(t); hits.set(key, mine.filter(x => t - x < 600e3)); all.push(t); while (all.length && t - all[0] > 600e3) all.shift();
    if (hits.size > 5000) for (const k of [...hits.keys()].slice(0, 1000)) hits.delete(k);
    return {ok: true};
  };
}
