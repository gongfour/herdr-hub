'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { diff, apply, lines } = require('../public/screendiff');

const L = (n, from = 0) => Array.from({ length: n }, (_, i) => `line ${from + i}`);

test('output that moves by a line: one line dropped off the top, one new line, the rest kept', () => {
  const prev = [...L(199), '❯ '];
  const next = [...L(198, 1), 'line 199', '❯ '];
  const d = diff(prev, next);
  assert.equal(d.k, 1);
  assert.deepEqual(d.a, ['line 199']);
  assert.deepEqual(apply(prev, d), next);
});

test('a key on the prompt line: only that line goes', () => {
  const prev = [...L(50), '❯ ec'];
  const next = [...L(50), '❯ ech'];
  const d = diff(prev, next);
  assert.deepEqual(d, { k: 0, h: 50, a: ['❯ ech'], z: 0 });
  assert.deepEqual(apply(prev, d), next);
});

test('nothing changed, everything changed, empty screens', () => {
  assert.deepEqual(diff(L(5), L(5)), { k: 0, h: 5, a: [], z: 0 });
  const other = L(5, 100);
  assert.deepEqual(apply(L(5), diff(L(5), other)), other);
  assert.deepEqual(apply([''], diff([''], L(3))), L(3));
  assert.deepEqual(apply(L(3), diff(L(3), [''])), ['']);
});

test('apply: a change for another screen is refused', () => {
  assert.equal(apply(L(3), { k: 2, h: 2, a: [], z: 0 }), null);
  assert.equal(apply(L(3), { k: -1, h: 0, a: [], z: 0 }), null);
  assert.equal(apply(L(3), { k: 0, h: 0, z: 0 }), null);
});

test('random screens: apply(prev, diff(prev, next)) is next, and a scroll costs little', () => {
  let seed = 7;
  const rnd = (n) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n);
  for (let round = 0; round < 500; round++) {
    const prev = Array.from({ length: rnd(60) }, () => `l${rnd(8)}`);
    let next;
    const kind = rnd(4);
    if (kind === 0) next = Array.from({ length: rnd(60) }, () => `l${rnd(8)}`);
    else if (kind === 1) next = [...prev.slice(rnd(5)), ...Array.from({ length: rnd(4) }, () => `n${rnd(9)}`)];
    else if (kind === 2) next = prev.map((l) => (rnd(10) ? l : `c${rnd(9)}`));
    else next = [...prev.slice(0, rnd(prev.length + 1)), 'x', ...prev.slice(rnd(prev.length + 1))];
    const d = diff(prev, next);
    assert.deepEqual(apply(prev, d), next, JSON.stringify({ prev, next, d }));
  }
  const prev = L(400);
  const next = [...L(397, 3), 'a', 'b', 'c'];
  assert.equal(diff(prev, next).a.length, 3);
});

test('lines: the screen text split on newlines', () => {
  assert.deepEqual(lines('a\nb'), ['a', 'b']);
  assert.deepEqual(lines(''), ['']);
  assert.deepEqual(lines(null), ['']);
});
