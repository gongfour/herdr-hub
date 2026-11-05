'use strict';
// The / list's order (public/slash.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const Slash = require('../public/slash');

const list = ['add-dir', 'agents', 'clear', 'compact', 'config', 'cost', 'model', 'resume', 'review', 'plugin:code-review', 'security-review', 'mcp'].map((name) => ({ name }));
const names = (l) => l.map((c) => c.name);

test('empty query: recent first, then the common ones, then the host order', () => {
  assert.deepEqual(names(Slash.rank(list, '', ['mcp', 'cost'])), ['mcp', 'cost', 'compact', 'clear', 'model', 'resume', 'review', 'add-dir', 'agents', 'config', 'plugin:code-review', 'security-review']);
  assert.deepEqual(names(Slash.rank(list, '', [])).slice(0, 5), Slash.COMMON);
  // A recent name the agent no longer has is skipped.
  assert.equal(names(Slash.rank(list, '', ['gone']))[0], 'compact');
});

test('one letter: recent and common among the prefix matches first', () => {
  assert.deepEqual(names(Slash.rank(list, 'c', ['cost'])), ['cost', 'compact', 'clear', 'config', 'plugin:code-review', 'security-review', 'mcp']);
  // A recent substring match does not jump ahead of the prefix ones.
  assert.deepEqual(names(Slash.rank(list, 'c', ['mcp'])), ['compact', 'clear', 'config', 'cost', 'plugin:code-review', 'security-review', 'mcp']);
  assert.deepEqual(names(Slash.rank(list, 'r', [])).slice(0, 2), ['resume', 'review']);
});

test('two letters or more: the order is unchanged', () => {
  assert.deepEqual(names(Slash.rank(list, 're', ['security-review'])), names(Slash.filter(list, 're')));
  assert.deepEqual(names(Slash.filter(list, 'co')), ['compact', 'config', 'cost', 'plugin:code-review']);
});

test('used / note: the command a message starts with, newest first, at most RECENT_MAX', () => {
  assert.equal(Slash.used('/model sonnet'), 'model');
  assert.equal(Slash.used('  /compact\n'), 'compact');
  assert.equal(Slash.used('/plugin:code-review x'), 'plugin:code-review');
  assert.equal(Slash.used('hi /model'), null);
  assert.equal(Slash.used('/'), null);
  assert.equal(Slash.used('/usr/bin/env'), 'usr');
  let r = [];
  for (const n of ['a', 'b', 'a', 'c']) r = Slash.note(r, n);
  assert.deepEqual(r, ['c', 'a', 'b']);
  for (let i = 0; i < 20; i++) r = Slash.note(r, `x${i}`);
  assert.equal(r.length, Slash.RECENT_MAX);
  assert.deepEqual(Slash.note(null, 'a'), ['a']);
});
