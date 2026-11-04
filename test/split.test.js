'use strict';
// The wide-screen layout's pure decisions (public/split.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { SPLIT_MIN, isSplit, stepRow, listKey, hostKey, stepHost } = require('../public/split.js');

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

test('listKey: Alt+arrows anywhere, brackets outside fields', () => {
  const k = (key, mods = {}) => ({ key, ...mods });
  assert.equal(listKey(k('ArrowDown', { altKey: true })), 'next');
  assert.equal(listKey(k('ArrowUp', { altKey: true })), 'prev');
  assert.equal(listKey(k('ArrowDown', { altKey: true }), { editable: true }), 'next');
  assert.equal(listKey(k(']')), 'next');
  assert.equal(listKey(k('[')), 'prev');
  assert.equal(listKey(k(']'), { editable: true }), null); // typed into the composer
  assert.equal(listKey(k('ArrowDown')), null);
  assert.equal(listKey(k('ArrowDown', { altKey: true, shiftKey: true })), null);
  assert.equal(listKey(k('ArrowDown', { altKey: true, metaKey: true })), null);
  assert.equal(listKey(k(']', { ctrlKey: true })), null);
});

test('listKey: never while a sheet is open or an IME composes; in the shell only Alt+↑/↓', () => {
  const down = { key: 'ArrowDown', altKey: true };
  assert.equal(listKey(down, { layer: true }), null);
  assert.equal(listKey(down, { shell: true }), 'next');
  assert.equal(listKey({ key: ']' }, { shell: true }), null);
  assert.equal(listKey({ ...down, isComposing: true }), null);
  assert.equal(listKey({ ...down, keyCode: 229 }), null);
  assert.equal(listKey(null), null);
});

test('hostKey: Alt+←/→ anywhere but the shell view, never with other modifiers or a sheet open', () => {
  const k = (key, mods = {}) => ({ key, keyCode: 0, isComposing: false, altKey: true, ...mods });
  assert.equal(hostKey(k('ArrowRight')), 1);
  assert.equal(hostKey(k('ArrowLeft')), -1);
  assert.equal(hostKey(k('ArrowDown')), null); // the split layout's next row
  assert.equal(hostKey(k('ArrowRight', { altKey: false })), null);
  assert.equal(hostKey(k('ArrowRight', { ctrlKey: true })), null);
  assert.equal(hostKey(k('ArrowRight', { shiftKey: true })), null);
  assert.equal(hostKey(k('ArrowRight'), { shell: true }), null); // the shell's word keys
  assert.equal(hostKey(k('ArrowRight'), { layer: true }), null);
  assert.equal(hostKey(k('ArrowRight', { isComposing: true })), null);
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
