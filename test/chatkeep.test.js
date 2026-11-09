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

// ---- older pages
const { oldestId, addOlder, joinSince, olderState, WINDOW_MAX } = require('../public/chatkeep.js');
const page = (before, ids, more) => ({ supported: true, found: true, before, messages: ids.map((id) => ({ role: 'user', id, text: id })), more });

test('older pages go above the window, one run, and only for the oldest id here', () => {
  let t = { ...T(3), truncated: true };
  assert.equal(olderState(t), 'more');
  assert.equal(oldestId(t), 'm0');
  t = addOlder(t, page('m0', ['o3', 'o4'], true));
  assert.deepEqual(t.older.map((m) => m.id), ['o3', 'o4']);
  assert.equal(oldestId(t), 'o3');
  // An answer for an id that is no longer the oldest (asked twice, or the window was replaced).
  assert.equal(addOlder(t, page('m0', ['x'], true)), t);
  t = addOlder(t, page('o3', ['o1', 'o2'], false));
  assert.deepEqual(t.older.map((m) => m.id), ['o1', 'o2', 'o3', 'o4']);
  assert.equal(olderState(t), 'start');
  // A ghost (host offline) and a host from before paging (it answers with its window).
  assert.equal(olderState({ ...T(3), truncated: true }, { stale: true }), 'ghost');
  assert.equal(olderState(addOlder({ ...T(3), truncated: true }, { supported: true, found: true, before: 'm0', messages: [], more: false, ghost: true })), 'ghost');
  assert.equal(olderState(addOlder({ ...T(3), truncated: true }, { supported: true, found: true, truncated: true, messages: msgs(3) })), 'old');
  // Nothing older: the whole chat is in the window; a short copy says nothing yet.
  assert.equal(olderState(T(3)), null);
  assert.equal(olderState({ ...T(3), truncated: true, partial: true }), null);
});

test('a since answer keeps the older pages; what drops off the window joins them', () => {
  const win = { ...T(WINDOW_MAX), truncated: true };
  const t = addOlder(win, page('m0', ['o1'], true));
  const r = { supported: true, found: true, rev: '11:1', since: `m${WINDOW_MAX - 1}`, messages: [{ role: 'assistant', id: `m${WINDOW_MAX - 1}`, text: 'grown' }, { role: 'user', id: 'n1', text: 'new' }] };
  const out = joinSince(t, r, WINDOW_MAX - 1);
  assert.equal(out.messages.length, WINDOW_MAX);
  assert.deepEqual(out.older.map((m) => m.id), ['o1', 'm0']);
  assert.equal(out.messages[out.messages.length - 2].text, 'grown');
  assert.equal(out.olderMore, true);
  // No older pages: the top just drops off, as before.
  const plain = joinSince(win, r, WINDOW_MAX - 1);
  assert.equal(plain.older, undefined);
  assert.equal(plain.messages[0].id, 'm1');
});

const { cmdSeen, lastCmd } = require('../public/chatkeep.js');
test('cmdSeen: a slash command sent from here is answered by a command after where it was sent', () => {
  const t = { messages: [{ id: 'u1' }, { id: 'a1' }], commands: [{ text: '/clear', id: 'c0', after: null }, { text: '/model opus', id: 'c1', after: 'a1' }] };
  assert.equal(cmdSeen({ text: '/model  opus ', after: 'a1' }, t), true);
  assert.equal(cmdSeen({ text: '/model opus', after: 'u1' }, t), true);
  assert.equal(cmdSeen({ text: '/model sonnet', after: 'a1' }, t), false);
  // Sent after a1 and after the command c1 was known: the same command again is still to come.
  assert.equal(cmdSeen({ text: '/model opus', after: 'a1', cmd: 'c1' }, t), false);
  assert.equal(lastCmd(t), 'c1');
  // /clear opens a new conversation with the command at its top: the old message and command are not in it.
  const fresh = { messages: [], commands: [{ text: '/clear', id: 'c9', after: null }] };
  assert.equal(cmdSeen({ text: '/clear', after: 'a1', cmd: 'c1' }, fresh), true);
  // Before the message it was sent after (an older /clear in this window): not this one.
  assert.equal(cmdSeen({ text: '/clear', after: 'a1' }, t), false);
  // A command after a message out of the window is older than the window.
  assert.equal(cmdSeen({ text: '/x' }, { messages: [{ id: 'u5' }], commands: [{ text: '/x', id: 'c', after: 'gone' }] }), false);
  // Not a command, or a host that sends none.
  assert.equal(cmdSeen({ text: 'hi' }, { messages: [], commands: [{ text: 'hi', id: 'c', after: null }] }), false);
  assert.equal(cmdSeen({ text: '/clear' }, { messages: [] }), false);
  assert.equal(lastCmd({ messages: [] }), null);
});
