'use strict';
// lib/hub.js createServer in this process: its configuration checks, a clock the test moves (the
// answer hold), and close() leaving nothing running (node --test would not end otherwise).
const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../lib/hub');
const { hubInProcess, herdrAt } = require('./fixtures/hub');

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
