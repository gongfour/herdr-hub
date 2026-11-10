'use strict';
// The live stream's state as patches (public/statepatch.js, lib/hub.js sendState, /api/stream?delta=1).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { diff, apply } = require('../public/statepatch.js');
const { hubInProcess, until } = require('./fixtures/hub');

const ag = (pane, status, extra = {}) => ({ host: 'd', pane, status, title: `t ${pane}`, ...extra });
const base = () => ({
  hostId: 'd',
  herdr: 'up',
  hosts: [{ id: 'd', online: true }],
  agents: [ag('p1', 'idle'), ag('p2', 'working'), ag('p3', 'idle')],
  terminals: [],
  workspaces: [{ host: 'd', workspace_id: 'w1', label: 'a' }],
  updatedAt: 1,
});
const roundTrip = (a, b) => assert.deepEqual(apply(a, JSON.parse(JSON.stringify(diff(a, b)))), b);

test('diff/apply: one agent changed goes whole, the rest as their keys', () => {
  const a = base();
  const b = { ...base(), agents: [ag('p2', 'blocked'), ag('p1', 'idle'), ag('p3', 'idle')], updatedAt: 2 };
  const p = diff(a, b);
  assert.deepEqual(p.lists.agents, [ag('p2', 'blocked'), 'd|p1', 'd|p3']);
  assert.deepEqual(Object.keys(p.set), ['updatedAt']);
  assert.equal(p.lists.hosts, undefined); // unchanged lists are not sent
  roundTrip(a, b);
});

test('diff/apply: added, removed and reordered items, a field gone, a field new', () => {
  const a = base();
  const b = { ...base(), agents: [ag('p3', 'idle'), ag('p4', 'working')], workspaces: [], extra: { x: 1 } };
  delete b.terminals;
  const p = diff(a, b);
  assert.deepEqual(p.del, ['terminals']);
  assert.deepEqual(p.lists.agents, ['d|p3', ag('p4', 'working')]);
  roundTrip(a, b);
});

test('diff: nothing changed is null; a key twice or an item without one sends the list whole', () => {
  assert.equal(diff(base(), base()), null);
  const dup = { ...base(), agents: [ag('p1', 'idle'), ag('p1', 'done')] };
  assert.deepEqual(diff(base(), dup).set.agents, dup.agents);
  roundTrip(base(), dup);
  const odd = { ...base(), agents: [ag('p1', 'idle'), 'x'] };
  assert.deepEqual(diff(base(), odd).set.agents, odd.agents);
});

test('apply: a ref to an item the state does not have throws (start again from a whole state)', () => {
  assert.throws(() => apply(base(), { lists: { agents: ['d|p9'] } }), /no agents d\|p9/);
  assert.throws(() => apply({ hostId: 'd' }, { lists: { agents: ['d|p1'] } }), /no list agents/);
});

// The stream itself: whole state first (with its id), then patches whose base is the last id, and
// the page's copy after each one is exactly /api/state.
test('stream ?delta=1: patches from the whole state make the same state as /api/state; without it every state is whole', async (t) => {
  const h = await hubInProcess(t, { id: 'patch', agents: [{ pane_id: 'w1-p1', workspace_id: 'w1', agent: 'claude', agent_status: 'idle', state_change_seq: 1, terminal_title: 'one', name: 'one' }] });
  const open = (q) => {
    const events = [];
    const req = http.get({ host: '127.0.0.1', port: h.port, path: `/api/stream${q}`, headers: { Host: `127.0.0.1:${h.port}` }, agent: false }, (res) => {
      res.setEncoding('utf8');
      let buf = '';
      res.on('data', (c) => {
        buf += c;
        let end;
        while ((end = buf.indexOf('\n\n')) >= 0) {
          const e = { event: 'message', id: null, data: '' };
          for (const line of buf.slice(0, end).split('\n')) {
            if (line.startsWith('event:')) e.event = line.slice(6).trim();
            else if (line.startsWith('id:')) e.id = Number(line.slice(3).trim());
            else if (line.startsWith('data:')) e.data += line.slice(5).trim();
          }
          buf = buf.slice(end + 2);
          if (e.event === 'state' || e.event === 'patch') events.push({ ...e, data: JSON.parse(e.data) });
        }
      });
    });
    t.after(() => req.destroy());
    return events;
  };
  const delta = open('?delta=1');
  const whole = open('');
  await until(() => delta.length && whole.length, 'first states');
  assert.equal(delta[0].event, 'state');

  h.herdr.agents[0].agent_status = 'working';
  h.herdr.agents[0].state_change_seq = 2;
  h.herdr.agents.push({ pane_id: 'w1-p2', workspace_id: 'w1', agent: 'claude', agent_status: 'idle', state_change_seq: 1, terminal_title: 'two', name: 'two' });
  h.herdr.event();
  await until(() => delta.length >= 2 && whole.length >= 2, 'a change');
  h.herdr.agents.shift();
  h.herdr.event();
  await until(async () => (await h.request('GET', '/api/state')).body.agents.length === 1 && delta.at(-1).event === 'patch' && delta.length === whole.length, 'a removal');

  assert.ok(whole.every((e) => e.event === 'state'));
  assert.ok(delta.slice(1).every((e) => e.event === 'patch'));
  let s = delta[0].data;
  let rev = delta[0].id;
  for (const e of delta.slice(1)) {
    assert.equal(e.data.base, rev);
    s = apply(s, e.data);
    rev = e.id;
  }
  const at0 = (x) => ({ ...x, updatedAt: 0 }); // the state's time moves on with no change sent
  assert.deepEqual(at0(s), at0((await h.request('GET', '/api/state')).body));
  assert.deepEqual(s, whole.at(-1).data);
  // Smaller: the unchanged agent went as its key.
  assert.ok(JSON.stringify(delta.at(-1).data).length < JSON.stringify(whole.at(-1).data).length);
});

// A hub following a peer (lib/peers.js frame): the peer's whole state, then its patches; a patch
// not from the state held asks for the stream again.
test('peer: follows patches from the whole state; a patch out of step restarts the stream', () => {
  const { Peer } = require('../lib/peers');
  const p = new Peer({ id: 'd', url: 'http://127.0.0.1:1' });
  p.setOnline = () => (p.online = true);
  const a = base();
  const b = { ...base(), agents: [ag('p1', 'blocked'), ag('p3', 'idle')] };
  assert.equal(p.frame(`id: 4\nevent: state\ndata: ${JSON.stringify(a)}`), undefined);
  assert.equal(p.state.agents.length, 3);
  assert.equal(p.frame(`id: 5\nevent: patch\ndata: ${JSON.stringify({ base: 4, ...diff(a, b) })}`), undefined);
  assert.deepEqual(p.state.agents, b.agents);
  assert.equal(p.frame(`id: 7\nevent: patch\ndata: ${JSON.stringify({ base: 6, ...diff(b, a) })}`), 'patch out of step');
  assert.deepEqual(p.state.agents, b.agents);
});
