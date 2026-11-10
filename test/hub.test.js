'use strict';
// lib/hub.js createServer in this process: its configuration checks, a clock the test moves (the
// answer hold), and close() leaving nothing running (node --test would not end otherwise).
const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../lib/hub');
const { hubInProcess, herdrAt, until } = require('./fixtures/hub');

const BASH = `
 Do you want to proceed?
 ❯ 1. Yes
   2. No
`;

test('createServer refuses a configuration it cannot run with', () => {
  const herdr = herdrAt('/nonexistent.sock');
  assert.throws(() => createServer({ herdr, env: { HERDR_HUB_HOST_ID: 'hub' } }), /HERDR_HUB_ALLOWED_LOGINS/);
  assert.throws(() => createServer({ herdr, env: { HERDR_HUB_ALLOW_LOCAL: '1', HERDR_HUB_HOST_ID: 'all' } }), /HERDR_HUB_HOST_ID/);
  assert.throws(() => createServer({ herdr, env: { HERDR_HUB_ALLOW_LOCAL: '1', HERDR_HUB_HOST_ID: 'Bad Id' } }), /HERDR_HUB_HOST_ID/);
});

test('the answer hold follows the hub clock: refused within 5 s, taken after', async (t) => {
  let clock = 1_000_000;
  const h = await hubInProcess(t, {
    id: 'clock',
    now: () => clock,
    agents: [{ pane_id: 'w1-p2', workspace_id: 'w1', agent: 'claude', agent_status: 'blocked', state_change_seq: 5 }],
  });
  h.herdr.screens['w1-p2'] = BASH;
  const answer = () => h.request('POST', '/api/agents/w1-p2/answer', { stateSeq: 5, n: 1 });
  assert.equal((await answer()).status, 200);
  clock += 4999;
  assert.deepEqual((await answer()).body, { error: 'answered' });
  clock += 2;
  assert.equal((await answer()).status, 200);
  assert.equal(h.herdr.calls.filter((c) => c.method === 'agent.send_keys').length, 2);
  // The state's time is the hub's too.
  assert.equal((await h.request('GET', '/api/state')).body.updatedAt, clock);
});

test('an in-process hub answers its routes like the process does', async (t) => {
  const h = await hubInProcess(t, { id: 'inproc' });
  const s = await h.request('GET', '/api/state');
  assert.equal(s.body.hostId, 'inproc');
  assert.deepEqual((await h.request('POST', '/api/panes/w1-p1/close', {}, { 'X-Herdr-Hub': null })).body, { error: 'missing_header' });
  assert.deepEqual((await h.request('POST', '/api/panes/w1-p1/close', {})).body, { ok: true });
  assert.deepEqual(h.herdr.calls.filter((c) => c.method === 'pane.close').map((c) => c.params), [{ pane_id: 'w1-p1' }]);
});

// ALLOW_LOCAL admits a page opened on this machine at its loopback address, nothing else without a
// login: tailscale serve passes the tailnet name as Host and puts no login on a tagged node's (or
// Funnel's) requests, which must not count as local.
test('ALLOW_LOCAL: no login is local only at a loopback Host; a tailnet name without a login is refused', async (t) => {
  const { request } = await hubInProcess(t, { id: 'localonly', env: { HERDR_HUB_HOSTS: 'myhost.example.ts.net', HERDR_HUB_ALLOWED_LOGINS: 'you@example.com' } });
  assert.equal((await request('GET', '/api/state')).status, 200); // Host 127.0.0.1:<port>
  const viaServe = { Host: 'myhost.example.ts.net' };
  assert.equal((await request('GET', '/api/state', null, viaServe)).status, 403);
  assert.equal((await request('POST', '/api/agents/w1:p1/keys', { keys: ['esc'] }, viaServe)).status, 403);
  assert.equal((await request('GET', '/api/state', null, { ...viaServe, 'Tailscale-User-Login': 'you@example.com' })).status, 200);
  assert.equal((await request('GET', '/api/state', null, { ...viaServe, 'Tailscale-User-Login': 'someone@example.com' })).status, 403);
});

// A stream client that doesn't read (a phone asleep, a half-open connection): past the backlog it
// is dropped (and comes back on its own) instead of keeping every frame in the hub's memory.
test('state stream: a client that stopped reading is dropped, a reading one gets the frame', async (t) => {
  const { herdr, hub, request } = await hubInProcess(t, { id: 'backlog' });
  const fake = (backlog) => {
    const r = { writableLength: backlog, frames: [], destroyed: false };
    r.write = (f) => r.frames.push(f);
    r.destroy = () => (r.destroyed = true);
    r.end = () => {}; // the hub's close() ends every client
    return r;
  };
  const stuck = fake(5 << 20);
  const fine = fake(0);
  hub.hub.clients.add(stuck);
  hub.hub.clients.add(fine);
  t.after(() => hub.hub.clients.delete(stuck) && hub.hub.clients.delete(fine));
  herdr.workspaces.push({ workspace_id: 'w2', label: 'more' });
  await request('POST', '/api/workspaces/w1/rename', { label: 'proj' }); // a refresh that changes the state
  await until(() => fine.frames.some((f) => f.includes('event: state')), 'frame sent');
  assert.equal(stuck.destroyed, true);
  assert.equal(stuck.frames.length, 0);
  assert.equal(hub.hub.clients.has(stuck), false);
  assert.equal(hub.hub.clients.has(fine), true);
  hub.hub.clients.delete(fine);
});
