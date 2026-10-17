// Shared helpers for the interview tests. Answers are test fixtures, not a real creator.
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createEchoServer} from '../../server/server.mjs';

export const SECRET = 'ზღვის ხმამ შთამაგონა — სატესტო პასუხი';
export async function start(options = {}) {
  const echo = createEchoServer({dataDir: mkdtempSync(join(tmpdir(), 'echo-iv-')), quiet: true, hostVoiceEnabled: false, ...options});
  await new Promise(r => echo.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${echo.server.address().port}`, s = echo.desk.state;
  const T = {A: s.people['creator-a'].token, B: s.people['creator-b'].token, P: s.people.producer.token, a: s.agents['agent-a'].token, b: s.agents['agent-b'].token};
  const req = async (method, path, token, body, headers = {}) => {
    const r = await fetch(base + path, {method, headers: {...(token ? {authorization: `Bearer ${token}`} : {}), ...(Buffer.isBuffer(body) ? {} : {'content-type': 'application/json'}), ...headers}, body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body)});
    const type = r.headers.get('content-type') || '';
    return {status: r.status, body: type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer())};
  };
  const upload = (token, bytes, filename, title = filename) => req('POST', '/api/library/media', token, bytes, {'x-filename': encodeURIComponent(filename), 'x-title': encodeURIComponent(title)});
  return {echo, base, T, req, upload, stop: () => new Promise(r => { echo.server.closeAllConnections(); echo.server.close(r); })};
}
export async function completeInterview(x, token, mediaId) {
  const iv = (await x.req('POST', '/api/interviews', token)).body, act = (a, body) => x.req('POST', `/api/interviews/${iv.id}/${a}`, token, body);
  await act('answer', {stepId: 'who', text: 'მუსიკოსი ვარ.', fields: {displayName: 'ტესტ შემქმნელი', workTitle: 'სატესტო სიმღერა', category: 'music'}});
  await act('answer', {stepId: 'inspiration', text: SECRET});
  await act('answer', {stepId: 'process', text: 'ყველაფერი თავად ჩავწერე.', fields: {aiInvolvement: 'none'}});
  await act('answer', {stepId: 'focus', text: 'რეფრენი.', fields: {preferredFormat: 'premiere', desiredAirtimeSec: 60}});
  await act('answer', {stepId: 'media', text: 'ეს ტრეკი.', fields: {mediaIds: mediaId ? [mediaId] : []}});
  if (!mediaId) await act('answer', {stepId: 'media', text: ''});
  const last = await act('answer', {stepId: 'notes', text: ''});
  return {id: iv.id, act, view: last.body};
}

