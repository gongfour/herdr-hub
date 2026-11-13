'use strict';
// 답 필요 answered: the hub takes its notification off the devices (lib/hub.js notifyTransitions,
// lib/push.js sendClear), once, and only for an agent whose 답 필요 went out. web-push is stubbed.
const test = require('node:test');
const assert = require('node:assert/strict');
const webpush = require('web-push');
const { hubInProcess, until } = require('./fixtures/hub');

const agent = (status, seq) => ({ pane_id: 'w1-p2', workspace_id: 'w1', agent: 'claude', agent_status: status, state_change_seq: seq, terminal_title: 't', name: 'shop-api' });

test('blocked, then answered: a 답 필요 push, then one clear with the count still waiting', async (t) => {
  const sent = [];
  t.mock.method(webpush, 'sendNotification', async (sub, body) => sent.push(JSON.parse(body)));
  const h = await hubInProcess(t, { id: 'pc', agents: [agent('working', 1)], env: { HERDR_HUB_PUSH: '1' } });
  await h.hub.hub.push.add({ endpoint: 'https://push.invalid/phone', keys: { p256dh: 'x', auth: 'y' } });
  const set = async (status, seq) => {
    h.herdr.agents.splice(0, 1, agent(status, seq));
    h.herdr.event();
  };
  await set('blocked', 2);
  await until(() => sent.some((p) => p.kind === 'blocked'), 'the 답 필요 push');
  assert.equal(sent.find((p) => p.kind === 'blocked').blocked, 1);
  await set('working', 3);
  await until(() => sent.some((p) => p.type === 'clear'), 'the clear');
  assert.deepEqual(sent.find((p) => p.type === 'clear'), { type: 'clear', tag: 'pc|w1-p2', blocked: 0 });
  // Blocked and answered again without a push in between (none went out): no clear for it.
  const n = sent.length;
  await set('idle', 4);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(sent.filter((p) => p.type === 'clear').length, 1);
  assert.equal(sent.length, n);
});
