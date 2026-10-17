// ECHO broadcast server: one process serialises every mutation of the shared state.
// node:http only; serves the static site, media, the API, and live updates (SSE).
import http from 'node:http';
import {readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, statSync, createReadStream} from 'node:fs';
import {join, normalize, extname, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {timingSafeEqual} from 'node:crypto';
import {BroadcastDesk, DomainError, sha256} from './domain.mjs';
import {seedState} from './seed.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary',
  '.hdr': 'application/octet-stream', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8'};
const STATUS = {unauthorized: 401, forbidden: 403, not_found: 404, bad_request: 422, out_of_bounds: 422, bad_content: 422, rights_required: 422, too_large: 413};
const MAX_UPLOAD = 25 * 1024 * 1024;

// Demo media shipped in the repo; uploads are stored in the data directory.
export function demoMedia(mediaDir) {
  const manifestPath = join(mediaDir, 'media.json');
  if (!existsSync(manifestPath)) return {};
  const list = JSON.parse(readFileSync(manifestPath, 'utf8'));
  return Object.fromEntries(Object.entries(list).map(([id, meta]) => [id, {...meta, sha256: sha256(readFileSync(join(mediaDir, meta.file)))}]));
}

export function createEchoServer({dataDir = join(ROOT, 'data'), mediaDir = join(ROOT, 'media'), staticDir = join(ROOT, 'dist'), now = () => Date.now(), requestTtlMs = 180000, seedOptions = {}, quiet = false} = {}) {
  mkdirSync(join(dataDir, 'uploads'), {recursive: true});
  const statePath = join(dataDir, 'state.json');
  const fresh = () => seedState({...seedOptions, media: demoMedia(mediaDir)});
  let desk = new BroadcastDesk(existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : fresh(), {now});
  const clients = new Set();
  const persist = () => { const tmp = statePath + '.tmp'; writeFileSync(tmp, JSON.stringify(desk.state)); renameSync(tmp, statePath); };
  persist();

  const tokenMatch = (a, b) => typeof a === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  function actorFor(token) {
    if (!token) return null;
    for (const p of Object.values(desk.state.people)) if (tokenMatch(token, p.token)) return {type: 'person', id: p.id};
    for (const a of Object.values(desk.state.agents)) if (tokenMatch(token, a.token)) return {type: 'agent', id: a.id};
    return null;
  }
  // Public view: everything on the board except credentials.
  function publicState() {
    const s = structuredClone(desk.state);
    for (const p of Object.values(s.people)) delete p.token;
    for (const a of Object.values(s.agents)) delete a.token;
    s.serverTime = now();
    s.layout = desk.layout();
    s.segmentsValid = Object.fromEntries(Object.keys(s.segments).map(id => [id, desk.approvalValid(desk.state.segments[id])]));
    return s;
  }
  let lastSent = -1;
  function broadcast(force = false) {
    if (!force && lastSent === desk.state.seq) return;
    lastSent = desk.state.seq;
    const data = `event: state\ndata: ${JSON.stringify(publicState())}\n\n`;
    for (const res of clients) res.write(data);
    for (const waiter of [...waiters]) waiter();
  }
  const waiters = new Set();
  const mutate = fn => { const result = fn(desk); persist(); broadcast(); return result; };

  const timer = setInterval(() => {
    const seq = desk.state.seq;
    desk.tick(); desk.expireRequests(requestTtlMs);
    if (desk.state.seq !== seq) { persist(); broadcast(); }
    for (const res of clients) res.write(`event: clock\ndata: ${now()}\n\n`);
  }, 1000);
  timer.unref();

  const send = (res, status, body) => { res.writeHead(status, {'content-type': 'application/json', 'cache-control': 'no-store'}); res.end(JSON.stringify(body)); };
  const readBody = (req, limit) => new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(new DomainError('too_large', 'Upload too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject);
  });
  const json = async req => { const raw = await readBody(req, 1e6); try { return raw.length ? JSON.parse(raw) : {}; } catch { throw new DomainError('bad_request', 'Body must be JSON'); } };

  function serveFile(req, res, file) {
    const size = statSync(file).size, type = TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (range) {
      const start = range[1] ? +range[1] : size - +range[2], end = range[1] && range[2] ? Math.min(+range[2], size - 1) : size - 1;
      if (start >= size || start > end) { res.writeHead(416, {'content-range': `bytes */${size}`}); return res.end(); }
      res.writeHead(206, {'content-type': type, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes'});
      return createReadStream(file, {start, end}).pipe(res);
    }
    res.writeHead(200, {'content-type': type, 'content-length': size, 'accept-ranges': 'bytes', 'cache-control': 'no-cache'});
    createReadStream(file).pipe(res);
  }
  function serveStatic(req, res, pathname) {
    let file = normalize(join(staticDir, decodeURIComponent(pathname)));
    if (!file.startsWith(staticDir)) return send(res, 403, {error: 'forbidden'});
    if (existsSync(file) && statSync(file).isDirectory()) {
      if (!pathname.endsWith('/')) { res.writeHead(301, {location: pathname + '/'}); return res.end(); }
      file = join(file, 'index.html');
    }
    if (!existsSync(file)) return send(res, 404, {error: 'not_found'});
    serveFile(req, res, file);
  }
  function serveMedia(req, res, id) {
    for (const seg of Object.values(desk.state.segments)) {
      const asset = seg.assets.find(a => a.id === id);
      if (!asset) continue;
      const file = asset.upload ? join(dataDir, 'uploads', asset.file) : join(mediaDir, asset.file || '');
      if (asset.file && existsSync(file)) return serveFile(req, res, file);
    }
    send(res, 404, {error: 'not_found'});
  }

  const routes = [
    ['GET', /^\/api\/state$/, () => publicState()],
    ['GET', /^\/api\/me$/, ({actor}) => {
      if (!actor) throw new DomainError('unauthorized', 'Sign in with your link');
      const who = actor.type === 'agent' ? desk.state.agents[actor.id] : desk.state.people[actor.id];
      const {token, ...safe} = who; return {type: actor.type, ...safe};
    }],
    // Agents long-poll their inbox; returns as soon as a request is addressed to them.
    ['GET', /^\/api\/agent\/inbox$/, async ({actor, url, res}) => {
      const agent = desk.requireAgent(actor);
      const wait = Math.min(+url.searchParams.get('wait') || 0, 55) * 1000;
      const pending = () => Object.values(desk.state.requests).filter(r => r.toAgentId === agent.id && r.status === 'open');
      if (!pending().length && wait) await new Promise(resolve => {
        const check = () => pending().length && done(), done = () => { waiters.delete(check); clearTimeout(timeout); resolve(); };
        const timeout = setTimeout(done, wait); waiters.add(check); res.on('close', done);
      });
      return {showRevision: desk.state.showRevision, requests: pending()};
    }],
    ['POST', /^\/api\/proposals$/, async ({actor, req}) => { const body = await json(req); return mutate(d => d.proposeChange(actor, body)); }],
    ['POST', /^\/api\/proposals\/(\w+)\/revise$/, async ({actor, req, m}) => { const body = await json(req); return mutate(d => d.reviseProposal(actor, {...body, proposalId: m[1]})); }],
    ['POST', /^\/api\/proposals\/(\w+)\/withdraw$/, async ({actor, req, m}) => { const body = await json(req); return mutate(d => d.withdrawProposal(actor, {...body, proposalId: m[1]})); }],
    ['POST', /^\/api\/proposals\/(\w+)\/decision$/, async ({actor, req, m}) => { const body = await json(req); return mutate(d => d.decideProposal(actor, {...body, proposalId: m[1]})); }],
    ['POST', /^\/api\/requests\/(\w+)\/respond$/, async ({actor, req, m}) => { const body = await json(req); return mutate(d => d.respondToRequest(actor, {...body, requestId: m[1]})); }],
    ['POST', /^\/api\/slots\/(hold|confirm|release)$/, async ({actor, req, m}) => { const body = await json(req); return mutate(d => d[{hold: 'holdSlot', confirm: 'confirmSlot', release: 'releaseSlot'}[m[1]]](actor, body)); }],
    ['POST', /^\/api\/segments\/(\w+)\/review$/, async ({actor, req, m}) => { const body = await json(req); return mutate(d => d.reviewSegment(actor, {...body, segmentId: m[1]})); }],
    // Owner uploads authorised existing media. The hash binds any later approval to these exact bytes.
    ['POST', /^\/api\/segments\/(\w+)\/media\/([\w-]+)$/, async ({actor, req, m}) => {
      desk.requireHuman(actor);
      const ext = extname(req.headers['x-filename'] || '').toLowerCase();
      if (!['.png', '.jpg', '.jpeg', '.webp', '.mp3', '.wav', '.ogg', '.m4a'].includes(ext)) throw new DomainError('bad_request', 'Supported media: png, jpg, webp, mp3, wav, ogg, m4a');
      const body = await readBody(req, MAX_UPLOAD), hash = sha256(body), file = `${hash}${ext}`;
      const meta = {upload: true, file, rightsDeclared: req.headers['x-rights-declared'] === 'yes', kind: ext.match(/png|jpe?g|webp/) ? 'image' : 'audio',
        title: decodeURIComponent(req.headers['x-title'] || ''), credit: decodeURIComponent(req.headers['x-credit'] || ''), license: decodeURIComponent(req.headers['x-license'] || '')};
      const segment = mutate(d => d.replaceAsset(actor, {segmentId: m[1], assetId: m[2], sha256: hash, meta}));
      writeFileSync(join(dataDir, 'uploads', file), body);
      return segment;
    }],
    ['POST', /^\/api\/publish$/, ({actor}) => mutate(d => d.publish(actor))],
    ['POST', /^\/api\/golive$/, async ({actor, req}) => { const body = await json(req); return mutate(d => d.goLive(actor, {delayMs: body.delayMs ?? 3000})); }],
    ['POST', /^\/api\/broadcast\/fail$/, async ({actor, req}) => { const body = await json(req); return mutate(d => d.failBroadcast(actor, body)); }],
    // Rehearsal reset keeps identities and tokens so connected agents stay valid.
    ['POST', /^\/api\/reset$/, ({actor}) => {
      desk.requireProducer(actor);
      const keep = {people: desk.state.people, agents: desk.state.agents};
      const next = fresh(); next.people = keep.people; next.agents = keep.agents;
      desk = new BroadcastDesk(next, {now});
      desk.log(actor, 'reset', 'Rehearsal reset to the seeded programme');
      persist(); broadcast(true); return {ok: true};
    }],
  ];

  async function handle(req, res) {
    const url = new URL(req.url, 'http://local');
    if (url.pathname === '/api/events') {
      res.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive'});
      res.write(`retry: 1500\nevent: state\ndata: ${JSON.stringify(publicState())}\n\n`);
      clients.add(res); req.on('close', () => clients.delete(res));
      return;
    }
    if (url.pathname.startsWith('/media/')) return serveMedia(req, res, url.pathname.slice(7));
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
    const route = routes.find(([method, re]) => method === req.method && re.test(url.pathname));
    if (!route) return send(res, 404, {error: 'not_found'});
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const actor = actorFor(token);
    if (actor?.type === 'agent') {
      const agent = desk.state.agents[actor.id];
      agent.lastSeenAt = now(); if (req.headers['x-echo-client']) agent.client = String(req.headers['x-echo-client']).slice(0, 60);
    }
    try {
      if (route[0] === 'POST' && !actor) throw new DomainError('unauthorized', 'Missing or unknown token');
      send(res, 200, await route[2]({actor, req, res, url, m: url.pathname.match(route[1])}));
    } catch (error) {
      if (error instanceof DomainError) send(res, STATUS[error.code] || 409, {error: error.code, message: error.message, details: error.details});
      else { if (!quiet) console.error(error); send(res, 500, {error: 'internal', message: 'Internal error'}); }
    }
  }

  const server = http.createServer((req, res) => { handle(req, res).catch(() => { if (!res.headersSent) send(res, 500, {error: 'internal'}); }); });
  server.on('close', () => { clearInterval(timer); for (const res of clients) res.end(); });
  return {server, get desk() { return desk; }, publicState};
}

// Local links for the people and MCP settings for the agents. Never published.
export function credentialsText(state, base) {
  const lines = ['ECHO local credentials — keep private', ''];
  for (const p of Object.values(state.people)) lines.push(`${p.name} (${p.role}) board: ${base}/board/#token=${p.token}`);
  lines.push('');
  for (const a of Object.values(state.agents)) lines.push(`${a.label}: ECHO_URL=${base} ECHO_AGENT_TOKEN=${a.token}`);
  return lines.join('\n') + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = +process.env.PORT || 8787, host = process.env.HOST || '127.0.0.1';
  const people = process.env.ECHO_PEOPLE ? JSON.parse(process.env.ECHO_PEOPLE) : {};
  const echo = createEchoServer({seedOptions: {people}});
  echo.server.listen(port, host, () => {
    const base = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`;
    writeFileSync(join(ROOT, 'data', 'credentials.txt'), credentialsText(echo.desk.state, base), {mode: 0o600});
    console.log(`ECHO broadcast server on ${base}\n  Board:     ${base}/board/\n  Broadcast: ${base}/broadcast/\n  Credentials written to data/credentials.txt`);
  });
}
