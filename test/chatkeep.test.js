'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Lru, entryFor, restore, prune, gone } = require('../public/chatkeep.js');

const msgs = (n, text = 'x') => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', id: `m${i}`, text }));
const T = (n, text) => ({ supported: true, found: true, rev: '10:1', truncated: false, messages: msgs(n, text) });

test('Lru: a use moves to the back; the oldest goes past max', () => {
  const l = new Lru(3);
  l.set('a', 1).set('b', 2).set('c', 3);
  assert.equal(l.get('a'), 1);
  l.set('d', 4);
  assert.deepEqual(l.keys(), ['c', 'a', 'd']);
  assert.equal(l.get('b'), undefined);
  l.set('c', 5);
  assert.deepEqual(l.keys(), ['a', 'd', 'c']);
  assert.equal(l.peek('a'), 1);
  assert.deepEqual(l.keys(), ['a', 'd', 'c']); // peek is not a use
});

test('entryFor: the latest messages with rev and session; oldest dropped to fit', () => {
  const e = entryFor(T(50), { session: 's1', mode: 'auto', at: 5 });
  assert.equal(e.messages.length, 30);
  assert.equal(e.messages[0].id, 'm20');
  assert.equal(e.messages[29].id, 'm49');
  assert.deepEqual([e.session, e.rev, e.mode, e.at, e.v], ['s1', '10:1', 'auto', 5, 1]);
  const big = entryFor(T(30, 'y'.repeat(1000)), { session: 's1' }, 30, 10000);
  assert.ok(JSON.stringify(big).length <= 10000);
  assert.equal(big.messages[big.messages.length - 1].id, 'm29');
  assert.ok(big.messages.length < 30 && big.messages.length > 5);
  assert.equal(entryFor(T(1, 'z'.repeat(50000)), { session: 's1' }), null); // one message too large
  assert.equal(entryFor(T(5), {}), null); // no session: nothing to tie it to
  assert.equal(entryFor({ supported: false, messages: [] }, { session: 's' }), null);
  assert.equal(entryFor({ supported: true, found: false, messages: [] }, { session: 's' }), null);
});

test('restore: a partial transcript, or nothing for a bad entry', () => {
  const t = restore(entryFor(T(3), { session: 's' }));
  assert.equal(t.partial, true);
  assert.equal(t.rev, '10:1');
  assert.equal(t.messages.length, 3);
  assert.equal(restore(null), null);
  assert.equal(restore({ v: 2, messages: msgs(2) }), null);
  assert.equal(restore({ v: 1, messages: [] }), null);
});

test('prune: the newest agents, then oldest out until it fits', () => {
  const store = {};
  for (let i = 0; i < 14; i++) store[`h|p${i}`] = { at: i, messages: msgs(1, 'a'.repeat(100)) };
  const p = prune(store, 10, 1e6);
  assert.equal(Object.keys(p).length, 10);
  assert.ok(!('h|p3' in p) && 'h|p4' in p && 'h|p13' in p);
  const small = prune(store, 10, 900);
  assert.ok(JSON.stringify(small).length <= 900);
  assert.ok('h|p13' in small && !('h|p4' in small));
  assert.deepEqual(prune(null), {});
});

test('gone: only for hosts that report; a pane with another session counts as gone', () => {
  const state = {
    hosts: [{ id: 'd', online: true, herdr: 'up' }, { id: 's', online: false, herdr: 'offline' }],
    agents: [{ host: 'd', pane: 'p1', session: 'a' }, { host: 'd', pane: 'p2', session: 'b' }],
  };
  const sessions = { 'd|p1': 'a', 'd|p2': 'old', 'd|p3': 'c', 's|p1': 'x', 'n|p1': 'y' };
  const out = gone(Object.keys(sessions), state, (a) => `${a.host}|${a.pane}`, (k) => sessions[k]);
  assert.deepEqual(out, ['d|p2', 'd|p3']);
});
