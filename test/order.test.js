'use strict';
// The order someone gave hosts, workspace cards and rows: lib/order.js (stored on the hub, pure
// parts), public/order.js (the list's sorting and moving), and the /api/order routes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const order = require('../lib/order');
const Order = require('../public/order');
const { hubInProcess, until } = require('./fixtures/hub');

const id = (x) => x.id;
const ids = (xs) => xs.map(id);

test('sortBy: named first in that order, the rest after as they came; nothing named is the same order', () => {
  const xs = ['a', 'b', 'c', 'd'].map((i) => ({ id: i }));
  assert.deepEqual(ids(order.sortBy(xs, [], id)), ['a', 'b', 'c', 'd']);
  assert.deepEqual(ids(order.sortBy(xs, undefined, id)), ['a', 'b', 'c', 'd']);
  assert.deepEqual(ids(order.sortBy(xs, ['c', 'a'], id)), ['c', 'a', 'b', 'd']);
  // Gone ids are passed over; a new one goes at the end in herdr's order.
  assert.deepEqual(ids(order.sortBy(xs, ['gone', 'd', 'b'], id)), ['d', 'b', 'a', 'c']);
  assert.deepEqual(ids(xs), ['a', 'b', 'c', 'd'], 'not changed in place');
  // The page's copy sorts the same.
  for (const named of [[], ['c', 'a'], ['gone', 'd', 'b']]) assert.deepEqual(ids(Order.sortBy(xs, named, id)), ids(order.sortBy(xs, named, id)));
});

test('clean: a hand-edited file keeps what makes sense', () => {
  assert.deepEqual(order.clean(null), order.empty());
  assert.deepEqual(order.clean([1, 2]), order.empty());
  assert.deepEqual(
    order.clean({ hosts: ['b', 'a', 'b', 5, ''], workspaces: { d: ['w2', 'w1'], x: 'no', y: [] }, panes: { d: { w1: ['p2', 'p1'], w2: 7 }, e: [] } }),
    { hosts: ['b', 'a'], workspaces: { d: ['w2', 'w1'] }, panes: { d: { w1: ['p2', 'p1'] } } }
  );
});

test('set*: one list replaced, an empty list clears it, bad lists refused', () => {
  let o = order.empty();
  o = order.setHosts(o, ['server', 'desktop']);
  o = order.setWorkspaces(o, 'desktop', ['w2', 'w1', 'w2']);
  o = order.setPanes(o, 'desktop', 'w1', ['p3', 'p1']);
  assert.deepEqual(o, { hosts: ['server', 'desktop'], workspaces: { desktop: ['w2', 'w1'] }, panes: { desktop: { w1: ['p3', 'p1'] } } });
  assert.deepEqual(order.setPanes(o, 'desktop', 'w1', []).panes, {});
  assert.deepEqual(order.setWorkspaces(o, 'desktop', []).workspaces, {});
  for (const bad of [null, 'w1', [1], ['a\nb'], ['x'.repeat(200)], Array.from({ length: 300 }, (_, i) => `w${i}`)])
    assert.throws(() => order.setWorkspaces(o, 'desktop', bad), (e) => e.code === 'bad_order' && e.status === 400, JSON.stringify(bad)?.slice(0, 40));
});

test('prune: ids gone from a known host leave; an unknown (offline) host keeps its lists', () => {
  const o = { hosts: [], workspaces: { d: ['w2', 'w9', 'w1'], s: ['x'] }, panes: { d: { w1: ['p2', 'gone'], w9: ['p1'] }, s: { x: ['q'] } } };
  const known = new Map([['d', { workspaces: new Set(['w1', 'w2']), panes: new Map([['w1', new Set(['p2', 'p5'])]]) }]]);
  assert.deepEqual(order.prune(o, known), { hosts: [], workspaces: { d: ['w2', 'w1'], s: ['x'] }, panes: { d: { w1: ['p2'] }, s: { x: ['q'] } } });
  const same = { hosts: [], workspaces: { d: ['w1'] }, panes: {} };
  assert.equal(order.prune(same, known), same, 'nothing gone: the same object (no write)');
});

test('move and moveTo (the page): one step, to a place, not past the ends', () => {
  assert.deepEqual(Order.move(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c']);
  assert.deepEqual(Order.move(['a', 'b', 'c'], 'b', 1), ['a', 'c', 'b']);
  assert.equal(Order.move(['a', 'b', 'c'], 'a', -1), null);
  assert.equal(Order.move(['a', 'b', 'c'], 'c', 1), null);
  assert.equal(Order.move(['a', 'b', 'c'], 'z', 1), null);
  assert.deepEqual(Order.moveTo(['a', 'b', 'c', 'd'], 'a', 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(Order.moveTo(['a', 'b', 'c', 'd'], 'd', 0), ['d', 'a', 'b', 'c']);
  assert.equal(Order.moveTo(['a', 'b'], 'a', 0), null);
});

test('the list model: cards in the hosts\' order, then the stored order inside a host; status never moves a card', () => {
  const cards = [
    { host: 'd', id: 'w1', rank: 2 },
    { host: 'd', id: 'w2', rank: 2 },
    { host: 'd', id: 'w3', rank: 0 },
    { host: 's', id: 'x1', rank: 2 },
  ];
  const hostIds = ['d', 's'];
  const stored = { d: ['w2', 'w3', 'w1'] };
  const key = (c) => `${c.host}/${c.id}`;
  // Nothing stored: herdr's order (a blocked w3 stays where it is).
  assert.deepEqual(Order.sortCards(cards, {}, hostIds).map(key), ['d/w1', 'd/w2', 'd/w3', 's/x1']);
  assert.deepEqual(Order.sortCards(cards, stored, hostIds).map(key), ['d/w2', 'd/w3', 'd/w1', 's/x1']);
  assert.deepEqual(Order.sortCards(cards, stored, ['s', 'd']).map(key), ['s/x1', 'd/w2', 'd/w3', 'd/w1']);
});

test('/api/order: stored on the hub, in the state at once, kept over a restart; bad bodies change nothing', async (t) => {
  const h = await hubInProcess(t, { id: 'desk', env: { HERDR_HUB_PEERS: 'srv=http://127.0.0.1:9' } });
  const state = async () => (await h.request('GET', '/api/state')).body;
  assert.deepEqual((await state()).hosts.map(id), ['desk', 'srv'], 'herdr order when nothing was stored');
  assert.deepEqual((await state()).order, { workspaces: {}, panes: {} });
  for (const [p, body, status, error] of [
    ['/api/order/hosts', { ids: 'srv' }, 400, 'bad_order'],
    ['/api/order/workspaces', { host: 'nope', ids: ['w1'] }, 404, 'unknown_host'],
    ['/api/order/workspaces', { ids: ['w1'] }, 404, 'unknown_host'],
    ['/api/order/panes', { host: 'desk', ids: ['p1'] }, 400, 'bad_order'],
    ['/api/order/bogus', { host: 'desk' }, 404, 'not_found'],
  ]) {
    const r = await h.request('POST', p, body);
    assert.equal(r.status, status, p);
    assert.equal(r.body.error, error, p);
  }
  assert.equal((await h.request('POST', '/api/order/hosts', { ids: ['srv'] }, { 'X-Herdr-Hub': null })).status, 403);
  assert.deepEqual((await h.request('GET', '/api/order')).body, order.empty());

  const r = await h.request('POST', '/api/order/hosts', { ids: ['srv', 'desk'] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.order.hosts, ['srv', 'desk']);
  assert.deepEqual((await state()).hosts.map(id), ['srv', 'desk']);
  h.herdr.workspaces.push({ workspace_id: 'w2', label: 'two' });
  h.herdr.event();
  await until(async () => (await state()).workspaces.length === 2, 'second workspace');
  assert.equal((await h.request('POST', '/api/order/workspaces', { host: 'desk', ids: ['w2', 'w1'] })).status, 200);
  // A peer's cards may be ordered on the hub too (not passed to the peer).
  assert.equal((await h.request('POST', '/api/order/workspaces', { host: 'srv', ids: ['a', 'b'] })).status, 200);
  assert.equal((await h.request('POST', '/api/order/panes', { host: 'desk', workspace: 'w1', ids: ['w1-p1'] })).status, 200);
  assert.deepEqual((await state()).order, { workspaces: { desk: ['w2', 'w1'], srv: ['a', 'b'] }, panes: { desk: { w1: ['w1-p1'] } } });
  const file = path.join(h.tmp, 'data', 'order.json');
  await until(() => fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).panes.desk, 'order.json written');
  assert.deepEqual(order.load(file).hosts, ['srv', 'desk'], 'read back at the next start');

  // A workspace that closes leaves the order (its host is known: up); the offline peer's stays.
  h.herdr.workspaces.splice(1, 1);
  h.herdr.event();
  await until(async () => (await state()).order.workspaces.desk.length === 1, 'pruned');
  assert.deepEqual((await state()).order.workspaces, { desk: ['w1'], srv: ['a', 'b'] });
  // Cleared: herdr's order again.
  await h.request('POST', '/api/order/hosts', { ids: [] });
  assert.deepEqual((await state()).hosts.map(id), ['desk', 'srv']);
});
