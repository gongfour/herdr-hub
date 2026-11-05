'use strict';
// lib/wsdirs: each workspace's 기본 폴더, kept only while that workspace is the same one.
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../lib/wsdirs');

const ws = (...xs) => xs.map(([workspace_id, label]) => ({ workspace_id, label }));

test('clean keeps only well-formed entries', () => {
  assert.deepEqual(W.clean(null), {});
  assert.deepEqual(W.clean([1]), {});
  assert.deepEqual(W.clean({ w1: { cwd: '/a', label: 'a' }, w2: { cwd: '', label: 'b' }, w3: { cwd: '/c' }, w4: 'x' }), { w1: { cwd: '/a', label: 'a' } });
});

test('set and get; an empty folder clears', () => {
  let e = W.set({}, 'w1', '/a', 'proj');
  assert.equal(W.get(e, 'w1'), '/a');
  assert.equal(W.get(e, 'w2'), null);
  e = W.set(e, 'w1', '', 'proj');
  assert.deepEqual(e, {});
});

test('reconcile: unchanged entries stay the same object', () => {
  const e = { w1: { cwd: '/a', label: 'proj' } };
  const r = W.reconcile(e, ws(['w1', 'proj']), null);
  assert.equal(r.changed, false);
  assert.equal(r.entries, e);
});

test('reconcile: a workspace gone from herdr takes its folder with it', () => {
  const r = W.reconcile({ w1: { cwd: '/a', label: 'proj' }, w2: { cwd: '/b', label: 'two' } }, ws(['w1', 'proj']), new Set(['w1', 'w2']));
  assert.equal(r.changed, true);
  assert.deepEqual(r.entries, { w1: { cwd: '/a', label: 'proj' } });
});

test('reconcile: a rename seen (the id in the last list) moves the label along', () => {
  const r = W.reconcile({ w1: { cwd: '/a', label: 'proj' } }, ws(['w1', 'new name']), new Set(['w1']));
  assert.deepEqual(r.entries, { w1: { cwd: '/a', label: 'new name' } });
});

test('reconcile: another label on first sight is taken for another workspace (herdr reuses ids)', () => {
  // The Hub's first list (seen null), or an id not in its last one.
  assert.deepEqual(W.reconcile({ w3: { cwd: '/a', label: 'old' } }, ws(['w3', 'new']), null).entries, {});
  assert.deepEqual(W.reconcile({ w3: { cwd: '/a', label: 'old' } }, ws(['w3', 'new']), new Set(['w1'])).entries, {});
});
