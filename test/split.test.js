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

test('stepRow: a workspace open steps from its card; a step never lands on a card head', () => {
  // card W1 (rows a, b), card W2 (rows c, d), card W3 (no rows), card W4 (row e)
  const hrefs = ['#w1', '#a', '#b', '#w2', '#c', '#d', '#w3', '#w4', '#e'];
  const heads = ['#w1', '#w2', '#w3', '#w4'];
  assert.equal(stepRow(hrefs, '#w2', 1, heads), '#c'); // its first row, not the top of the list
  assert.equal(stepRow(hrefs, '#w2', -1, heads), '#b'); // the card before's last row
  assert.equal(stepRow(hrefs, '#w4', -1, heads), '#d'); // past an empty card
  assert.equal(stepRow(hrefs, '#w3', 1, heads), '#e');
  assert.equal(stepRow(hrefs, '#w1', -1, heads), null); // nothing above
  assert.equal(stepRow(hrefs, '#b', 1, heads), '#c'); // rows step over the heads
  assert.equal(stepRow(hrefs, '#c', -1, heads), '#b');
  assert.equal(stepRow(hrefs, null, 1, heads), '#a');
  assert.equal(stepRow(hrefs, null, -1, heads), '#e');
  assert.equal(stepRow(['#w1'], '#w1', 1, ['#w1']), null);
});
