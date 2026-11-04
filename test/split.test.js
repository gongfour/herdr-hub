'use strict';
// The wide-screen layout's pure decisions (public/split.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { SPLIT_MIN, isSplit, stepRow, stepHost } = require('../public/split.js');

test('isSplit: landscape tablets and laptops split, portrait tablets and phones do not', () => {
  assert.equal(SPLIT_MIN, 1000);
  for (const w of [1400, 1138, 1440, 1000]) assert.equal(isSplit(w), true, String(w));
  for (const w of [876, 999, 700, 390, 0, undefined]) assert.equal(isSplit(w), false, String(w));
});

test('stepRow: next and previous in list order, each row once', () => {
  const rows = ['#a', '#b', '#a', '#c'];
  assert.equal(stepRow(rows, '#a', 1), '#b');
  assert.equal(stepRow(rows, '#b', 1), '#c');
  assert.equal(stepRow(rows, '#b', -1), '#a');
  assert.equal(stepRow(rows, '#c', 1), null); // past the end
  assert.equal(stepRow(rows, '#a', -1), null);
});

test('stepRow: nothing open starts at the top (down) or the bottom (up)', () => {
  assert.equal(stepRow(['#a', '#b'], null, 1), '#a');
  assert.equal(stepRow(['#a', '#b'], null, -1), '#b');
  assert.equal(stepRow(['#a', '#b'], '#gone', 1), '#a');
  assert.equal(stepRow([], '#a', 1), null);
  assert.equal(stepRow(null, null, 1), null);
});

test('stepHost: round the segment from either end; nothing with one choice', () => {
  const ids = ['all', 'macbook', 'desktop', 'server'];
  assert.equal(stepHost(ids, 'all', 1), 'macbook');
  assert.equal(stepHost(ids, 'server', 1), 'all');
  assert.equal(stepHost(ids, 'all', -1), 'server');
  assert.equal(stepHost(ids, 'desktop', -1), 'macbook');
  assert.equal(stepHost(ids, 'gone', 1), 'macbook'); // a host that left counts as 전체
  assert.equal(stepHost(['all'], 'all', 1), null);
});
