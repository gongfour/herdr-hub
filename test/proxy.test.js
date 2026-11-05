'use strict';
// The hub's leg to a peer through two real servers (each over its own fake herdr): what is asked
// for /api/peers/<host>/… lands on that peer's herdr and never on the hub's own; answers come back
// as the peer gave them; an offline peer is a 503, or its last chat window (its ghost).
const test = require('node:test');
const assert = require('node:assert/strict');
const ws = require('../lib/ws');
const { startHub, until, freePort, sleep } = require('./fixtures/hub');
const { parseChoices, choiceKeys } = require('../public/choices');

const BASH = `
 Bash command

   echo hi > note.txt

 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don't ask again for echo commands in /tmp/x
   3. No, and tell Claude what to do differently (esc)
`;
const agent = (pane, status, seq, kind = 'claude') => ({ pane_id: pane, workspace_id: 'w1', agent: kind, agent_status: status, state_change_seq: seq, terminal_title: kind });
const callsOf = (herdr, method) => herdr.calls.filter((c) => c.method === method).map((c) => c.params);
const ACTING = /^(agent\.(prompt|send_keys|rename|start)|pane\.(send_|close|rename|split)|workspace\.(close|rename|create)|tab\.create)/;
const acting = (herdr) => herdr.calls.filter((c) => ACTING.test(c.method));

async function pair(t) {
  const peer = await startHub(t, { id: 'pa', agents: [agent('w1-p2', 'blocked', 5), agent('w1-p3', 'working', 4)] });
  peer.herdr.screens['w1-p2'] = BASH;
  const dead = await freePort();
  const hub = await startHub(t, {
    id: 'hub',
    agents: [agent('w1-p2', 'blocked', 5)],
    env: { HERDR_HUB_PEERS: `pa=http://127.0.0.1:${peer.port},pb=http://127.0.0.1:${dead}` },
  });
  hub.herdr.screens['w1-p2'] = BASH; // the same pane name on both hosts: only the asked one answers
  await until(async () => (await hub.request('GET', '/api/state')).body.agents.some((a) => a.host === 'pa'), 'peer online');
  return { hub, peer };
}

test('proxy: requests reach the peer named, with their path and query; the hub herdr is never touched', async (t) => {
  const { hub, peer } = await pair(t);
  const s = (await hub.request('GET', '/api/state')).body;
  assert.deepEqual(s.hosts.map((h) => [h.id, h.online]), [['hub', true], ['pa', true], ['pb', false]]);
  assert.deepEqual(s.agents.filter((a) => a.host === 'pa').map((a) => a.pane).sort(), ['w1-p2', 'w1-p3']);

  // GETs: the peer's own answer, its query passed on.
  const host = await hub.request('GET', '/api/peers/pa/host');
  assert.equal(host.status, 200);
  assert.equal(host.body.id, 'pa');
  const reads = callsOf(peer.herdr, 'pane.read').length;
  assert.equal((await hub.request('GET', '/api/peers/pa/panes/w1-p1/screen?lines=7&source=recent')).status, 200);
  const read = callsOf(peer.herdr, 'pane.read').slice(reads);
  assert.equal(read.length, 1);
  assert.equal(read[0].lines, 7);
  assert.equal(read[0].pane_id, 'w1-p1');

  // A prompt, keys, sendnow, an answer, a close, a workspace close: on the peer's herdr only.
  const before = acting(hub.herdr).length;
  assert.deepEqual((await hub.request('POST', '/api/peers/pa/agents/w1-p3/prompt', { text: 'hi' })).body, { ok: true });
  assert.deepEqual(callsOf(peer.herdr, 'agent.prompt'), [{ target: 'w1-p3', text: 'hi' }]);
  assert.deepEqual((await hub.request('POST', '/api/peers/pa/agents/w1-p3/sendnow', {})).body, { ok: true, sent: true });
  assert.deepEqual(callsOf(peer.herdr, 'agent.send_keys').at(-1), { target: 'w1-p3', keys: ['ctrl+x', 'ctrl+s'] });
  const ans = await hub.request('POST', '/api/peers/pa/agents/w1-p2/answer', { stateSeq: 5, n: 1 });
  assert.equal(ans.status, 200, ans.text);
  assert.deepEqual(ans.body, { ok: true, n: 1, label: 'Yes' });
  const again = await hub.request('POST', '/api/peers/pa/agents/w1-p2/answer', { stateSeq: 5, n: 1 });
  assert.deepEqual([again.status, again.body], [409, { error: 'answered' }]);
  assert.deepEqual((await hub.request('POST', '/api/peers/pa/panes/w1-p1/close', {})).body, { ok: true });
  assert.deepEqual(callsOf(peer.herdr, 'pane.close'), [{ pane_id: 'w1-p1' }]);
  assert.deepEqual((await hub.request('POST', '/api/peers/pa/workspaces/w1/close', {})).body, { ok: true });
  assert.deepEqual(callsOf(peer.herdr, 'workspace.close'), [{ workspace_id: 'w1' }]);
  assert.equal(acting(hub.herdr).length, before, JSON.stringify(acting(hub.herdr)));
  // The peer's refusals come back as they are.
  const r404 = await hub.request('POST', '/api/peers/pa/agents/w1-p9/prompt', { text: 'hi' });
  assert.deepEqual([r404.status, r404.body], [404, { error: 'agent_not_found' }]);
  const r400 = await hub.request('POST', '/api/peers/pa/agents/w1-p3/prompt', { text: '' });
  assert.deepEqual([r400.status, r400.body], [400, { error: 'empty_prompt' }]);
});

test('proxy: what is not passed on', async (t) => {
  const { hub, peer } = await pair(t);
  const before = peer.herdr.calls.length;
  const peerActing = acting(peer.herdr).length;
  for (const [m, p, status, error] of [
    ['GET', '/api/peers/nope/host', 404, 'unknown_host'],
    ['POST', '/api/peers/nope/agents/w1-p2/prompt', 404, 'unknown_host'],
    // Only per-host endpoints: the state, stream, push and hosts stay with the hub.
    ['GET', '/api/peers/pa/state', 404, 'not_found'],
    ['GET', '/api/peers/pa/stream', 404, 'not_found'],
    ['GET', '/api/peers/pa/hosts', 404, 'not_found'],
    ['POST', '/api/peers/pa/push/test', 404, 'not_found'],
    ['POST', '/api/peers/pa/answer', 404, 'not_found'],
    ['GET', '/api/peers/pa', 404, 'not_found'],
    ['GET', '/api/peers/%E0%A4%A/host', 400, 'bad_path'],
  ]) {
    const r = await hub.request(m, p, m === 'GET' ? null : {});
    assert.equal(r.status, status, `${m} ${p} ${r.text}`);
    assert.equal(r.body.error, error, `${m} ${p}`);
  }
  // A mutation without the header stops at the hub.
  const nh = await hub.request('POST', '/api/peers/pa/agents/w1-p3/prompt', { text: 'hi' }, { 'X-Herdr-Hub': null });
  assert.deepEqual([nh.status, nh.body], [403, { error: 'missing_header' }]);
  // An encoded slash stays inside the pane id: the peer is asked for agent "w1-p3/../x", not a path.
  const enc = await hub.request('POST', '/api/peers/pa/agents/w1-p3%2F..%2Fx/prompt', { text: 'hi' });
  assert.deepEqual([enc.status, enc.body], [404, { error: 'agent_not_found' }]);
  const enc2 = await hub.request('GET', '/api/peers/pa/agents/w1-p3%2Fscreen');
  assert.equal(enc2.status, 404);
  // A broken escape after the host: the hub's own decode refuses it.
  const bad = await hub.request('GET', '/api/peers/pa/agents/%E0%A4%A/screen');
  assert.equal(bad.status, 400);
  assert.equal(acting(peer.herdr).length, peerActing);
  assert.ok(peer.herdr.calls.slice(before).every((c) => !ACTING.test(c.method)));
});

test('proxy: an offline peer is 503 for everything but its last chat window', { timeout: 30000 }, async (t) => {
  const { hub, peer } = await pair(t);
  // pb never answered.
  for (const [m, p] of [
    ['GET', '/api/peers/pb/host'],
    ['POST', '/api/peers/pb/agents/w1-p2/prompt'],
    ['POST', '/api/peers/pb/agents/w1-p2/answer'],
    ['POST', '/api/peers/pb/panes/w1-p1/close'],
  ]) {
    const r = await hub.request(m, p, m === 'GET' ? null : { text: 'x', stateSeq: 1, n: 1 });
    assert.deepEqual([r.status, r.body.error], [503, 'peer_offline'], `${m} ${p}`);
  }
  const ghostless = await hub.request('GET', '/api/peers/pb/agents/w1-p2/transcript');
  assert.equal(ghostless.status, 200);
  assert.deepEqual(ghostless.body, { supported: true, found: false, messages: [], ghostless: true });
  const nb = await hub.request('POST', '/api/answer', { host: 'pb', pane: 'w1-p2', stateSeq: 5, n: 1 });
  assert.deepEqual([nb.status, nb.body], [503, { error: 'peer_offline' }]);

  // pa's chat window passes by once, then pa goes away: it is still there, read-only.
  const live = await hub.request('GET', '/api/peers/pa/agents/w1-p3/transcript?limit=50');
  assert.equal(live.status, 200);
  peer.stop();
  await until(async () => (await hub.request('GET', '/api/state')).body.hosts.find((h) => h.id === 'pa' && !h.online), 'pa offline', 20000);
  const kept = await hub.request('GET', '/api/peers/pa/agents/w1-p3/transcript?limit=50');
  assert.deepEqual([kept.status, kept.text], [200, live.text]);
  // Only a full window: a request for what changed since is not answered from the copy.
  const since = await hub.request('GET', '/api/peers/pa/agents/w1-p3/transcript?since=x');
  assert.equal(since.status, 503);
  // An older page (?before=) of a ghost's chat: not from the copy; said to be all there is.
  for (const host of ['pa', 'pb']) {
    const older = await hub.request('GET', `/api/peers/${host}/agents/w1-p3/transcript?before=m12&limit=100`);
    assert.equal(older.status, 200, host);
    assert.deepEqual(older.body, { supported: true, found: true, before: 'm12', messages: [], more: false, ghost: true });
  }
  const s = (await hub.request('GET', '/api/state')).body;
  assert.ok(s.agents.filter((a) => a.host === 'pa').every((a) => a.stale), 'listed as a ghost');
  const a = await hub.request('POST', '/api/peers/pa/agents/w1-p2/answer', { stateSeq: 5, n: 1 });
  assert.equal(a.status, 503);
  const n = await hub.request('POST', '/api/answer', { host: 'pa', pane: 'w1-p2', stateSeq: 5, n: 1 });
  assert.equal(n.status, 503);
  assert.deepEqual(callsOf(hub.herdr, 'agent.send_keys'), []);
});

test('POST /api/answer with host: forwarded to that peer only', async (t) => {
  const { hub, peer } = await pair(t);
  const r = await hub.request('POST', '/api/answer', { host: 'pa', pane: 'w1-p2', stateSeq: 5, n: 2, own: true, extra: 'x' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.n, 2);
  const keys = choiceKeys(parseChoices(BASH.replace(/\s+$/, '')), 2);
  assert.deepEqual(callsOf(peer.herdr, 'agent.send_keys'), [{ target: 'w1-p2', keys }]);
  assert.deepEqual(callsOf(hub.herdr, 'agent.send_keys'), []);
  // Stale on the peer: its refusal comes back.
  const s = await hub.request('POST', '/api/answer', { host: 'pa', pane: 'w1-p2', stateSeq: 4, n: 1 });
  assert.deepEqual([s.status, s.body], [409, { error: 'stale' }]);
  // The hub's own pane of the same name: answered here, the peer untouched.
  const h = await hub.request('POST', '/api/answer', { pane: 'w1-p2', stateSeq: 5, n: 1 });
  assert.equal(h.status, 200, h.text);
  assert.deepEqual(callsOf(hub.herdr, 'agent.send_keys'), [{ target: 'w1-p2', keys: choiceKeys(parseChoices(BASH.replace(/\s+$/, '')), 1) }]);
  assert.equal(callsOf(peer.herdr, 'agent.send_keys').length, 1);
});

test('live bridge: the page\'s keys reach the peer\'s pane; refusals before the upgrade', async (t) => {
  const { hub, peer } = await pair(t);
  const url = (p) => `ws://127.0.0.1:${hub.port}${p}`;
  const opts = { headers: { 'X-Herdr-Hub': '1' } };
  for (const [p, status] of [
    ['/api/peers/nope/panes/w1-p1/live', 404],
    ['/api/peers/pb/panes/w1-p1/live', 503],
    ['/api/peers/pa/panes/w1-p9/live', 404],
  ]) {
    const err = await ws.connect(url(p), opts).then((c) => (c.close(), null), (e) => e);
    assert.ok(err, `${p} upgraded`);
    assert.equal(err.status, status, p);
  }
  const c = await ws.connect(url('/api/peers/pa/panes/w1-p1/live?lines=20'), opts);
  t.after(() => c.close());
  const msgs = [];
  c.on('message', (m) => msgs.push(JSON.parse(m)));
  await until(() => msgs.some((m) => m.t === 'f'), 'first screen');
  assert.equal(msgs[0].t, 'hello');
  c.send(JSON.stringify({ t: 'k', s: 1, x: 'pwd', y: ['enter'] }));
  c.send(JSON.stringify({ t: 'k', s: 2, x: '', y: ['rm -rf'] }));
  await until(() => msgs.some((m) => m.t === 'ack' && m.s === 1) && msgs.some((m) => m.t === 'kerr'), 'ack and kerr');
  assert.deepEqual(msgs.find((m) => m.t === 'kerr'), { t: 'kerr', from: 2, to: 2, error: 'bad_keys', message: 'bad_keys' });
  await until(() => peer.herdr.shell.screen === '$ pwd\n$ ', 'typed on the peer');
  assert.equal(hub.herdr.shell.screen, '$ ');
  assert.equal(acting(hub.herdr).length, 0);
  await sleep(50);
});
