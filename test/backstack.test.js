'use strict';
// Back closes the top layer (public/backstack.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { depthOf, onPop, useWatcher } = require('../public/backstack.js');

test('depthOf: a layer entry, else a page entry', () => {
  assert.equal(depthOf({ prev: '#/', layer: 2 }), 2);
  assert.equal(depthOf({ prev: '#/' }), 0);
  assert.equal(depthOf(null), 0);
  assert.equal(depthOf({ layer: 'x' }), 0);
  assert.equal(depthOf({ layer: -1 }), 0);
});

test('onPop: Back closes the top layer, keeps the page', () => {
  assert.deepEqual(onPop(0, 1), { close: 1 });
  assert.deepEqual(onPop(1, 2), { close: 1 });
  assert.deepEqual(onPop(0, 2), { close: 2 });
});

test('onPop: a stale layer entry is stepped over; a page entry with nothing open is left alone', () => {
  assert.deepEqual(onPop(1, 0), { skip: true });
  assert.deepEqual(onPop(0, 0), {});
  assert.deepEqual(onPop(1, 1), {});
});

test('useWatcher: CloseWatcher where there is one, else history entries', () => {
  assert.equal(useWatcher({ CloseWatcher: class {} }), true);
  assert.equal(useWatcher({}), false);
  assert.equal(useWatcher({ CloseWatcher: undefined }), false);
  assert.equal(useWatcher(undefined), false);
});
