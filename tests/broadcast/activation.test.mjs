// N04 activation boundary (Codex, d0e5ae5): viewers start a scheduled publication only on the server's answer, given
// once the server clock reaches onAirAt. These tests drive the server clock directly.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createEchoServer} from '../../server/server.mjs';

async function start({dataDir = mkdtempSync(join(tmpdir(), 'echo-act-')), clock} = {}) {
  const echo = createEchoServer({dataDir, quiet: true, hostVoiceEnabled: false, now: () => clock.t});
  await new Promise(r => echo.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${echo.server.address().port}`, P = echo.desk.state.people.producer.token;
  const post = async (path, body) => { const r = await fetch(base + path, {method: 'POST', headers: {authorization: `Bearer ${P}`, 'content-type': 'application/json'}, body: JSON.stringify(body || {})}); return {status: r.status, body: await r.json()}; };
  const ask = (m, onAirAt, hash = m.hash) => fetch(`${base}/api/broadcast/activation?publicationId=${m.publicationId}&hash=${hash}&onAirAt=${onAirAt}`).then(r => r.json());
  const reject = () => post('/api/segments/gallery/review', {revision: echo.desk.state.segments.gallery.revision, decision: 'rejected', note: 'late rights problem'});
  const scheduled = async (delayMs = 5000) => { const m = (await post('/api/publish')).body; const onAirAt = (await post('/api/golive', {delayMs, publicationId: m.publicationId, hash: m.hash})).body.onAirAt; return {m, onAirAt}; };
  return {echo, post, ask, reject, scheduled, dataDir, stop: () => new Promise(r => { echo.server.closeAllConnections(); echo.server.close(r); })};
}
const settled = async (promise, ms = 400) => Promise.race([promise.then(v => ({v})), new Promise(r => setTimeout(() => r(null), ms))]);

test('the answer waits for onAirAt on the server clock; a rejection 493 ms before the start during that wait is final', async () => {
  const clock = {t: 1_000_000}, x = await start({clock});
  try {
    const {m, onAirAt} = await x.scheduled();
    clock.t = onAirAt - 2000;
    const answer = x.ask(m, onAirAt);
    assert.equal(await settled(answer), null, 'no answer before the start');
    clock.t = onAirAt - 493;
    assert.equal((await x.reject()).status, 200);
    assert.equal(await settled(answer), null, 'still no answer: the start instant decides');
    clock.t = onAirAt;
    const a = (await settled(answer, 1000)).v;
    assert.equal(a.permitted, false); assert.match(a.reason, /withdrawn before air: late rights problem/);
  } finally { await x.stop(); }
});

test('no rejection: permitted exactly at onAirAt; a rejection at or after the start does not revoke it (N04 on air)', async () => {
  const clock = {t: 2_000_000}, x = await start({clock});
  try {
    const {m, onAirAt} = await x.scheduled();
    clock.t = onAirAt - 1;
    const answer = x.ask(m, onAirAt);
    assert.equal(await settled(answer), null);
    clock.t = onAirAt;
    assert.equal((await settled(answer, 1000)).v.permitted, true);
    assert.equal((await x.reject()).status, 200);
    assert.equal(x.echo.desk.state.broadcast.state, 'on_air');
    assert.equal((await x.ask(m, onAirAt)).permitted, true, 'late joiner / reconnect after an on-air rejection still plays');
  } finally { await x.stop(); }
});

test('late joiners get an immediate answer; wrong publication, hash or start time, a stopped show and an early ask are not permitted', async () => {
  const clock = {t: 3_000_000}, x = await start({clock});
  try {
    const {m, onAirAt} = await x.scheduled();
    clock.t = onAirAt - 9000;
    const early = await x.ask(m, onAirAt);
    assert.equal(early.permitted, false); assert.equal(early.pending, true, 'asked more than 5 s early: try again later');
    clock.t = onAirAt + 30000;
    assert.equal((await x.ask(m, onAirAt)).permitted, true);
    assert.equal((await x.ask(m, onAirAt, 'f'.repeat(64))).permitted, false);
    assert.equal((await x.ask({...m, publicationId: m.publicationId + 1}, onAirAt)).permitted, false);
    assert.equal((await x.ask(m, onAirAt + 1)).permitted, false);
    assert.equal((await x.post('/api/broadcast/fail', {reason: 'test stop'})).status, 200);
    const stopped = await x.ask(m, onAirAt);
    assert.equal(stopped.permitted, false); assert.match(stopped.reason, /stopped by the producer/);
  } finally { await x.stop(); }
});

test('a publication withdrawn during the countdown stays denied after a server restart', async () => {
  const clock = {t: 4_000_000}, x = await start({clock});
  let m, onAirAt;
  try {
    ({m, onAirAt} = await x.scheduled());
    clock.t = onAirAt - 493;
    await x.reject();
  } finally { await x.stop(); }
  clock.t = onAirAt + 100;
  const y = await start({clock, dataDir: x.dataDir});
  try {
    const a = await y.ask(m, onAirAt);
    assert.equal(a.permitted, false); assert.match(a.reason, /withdrawn/);
  } finally { await y.stop(); }
});
