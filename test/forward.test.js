'use strict';
// Back into the chat just left (public/forward.js): what to go forward to, the chip's life, the edge.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EDGE, CHIP_MS, CHIP_SCROLL, nextTarget, chipLive, edgeStart } = require('../public/forward.js');
const { parse } = require('../public/route.js');

const r = (h) => parse(h);

test('nextTarget: leaving an agent or a shell for the list leaves it to come back to', () => {
  assert.deepEqual(nextTarget(null, r('/agent/p3'), r('/')), { kind: 'agent', host: null, pane: 'p3' });
  assert.deepEqual(nextTarget(null, r('/h/server/agent/p3/screen'), r('/')), { kind: 'agent', host: 'server', pane: 'p3' });
  assert.deepEqual(nextTarget(null, r('/h/desktop/term/pA'), r('/h/desktop/spaces')), { kind: 'term', host: 'desktop', pane: 'pA' });
  // A newer one replaces it.
  const old = { kind: 'agent', host: null, pane: 'p1' };
  assert.deepEqual(nextTarget(old, r('/agent/p2'), r('/')), { kind: 'agent', host: null, pane: 'p2' });
});

test('nextTarget: opening anything drops it; tabs and the list from elsewhere keep it', () => {
  const t = { kind: 'agent', host: null, pane: 'p1' };
  for (const h of ['/agent/p1', '/agent/p9', '/term/p2', '/ws/w1', '/new', '/start/ws/w1']) assert.equal(nextTarget(t, r('/'), r(h)), null, h);
  for (const h of ['/settings', '/keys']) assert.equal(nextTarget(t, r('/'), r(h)), t, h);
  assert.equal(nextTarget(t, r('/settings'), r('/')), t);
  assert.equal(nextTarget(t, r('/ws/w1'), r('/')), t); // a workspace page left is no chat
  assert.equal(nextTarget(t, null, r('/')), t); // the first route
  assert.equal(nextTarget(null, null, r('/')), null);
});

test('chipLive: until CHIP_MS, CHIP_SCROLL px of scroll either way, ✕ or a swipe down', () => {
  const t = { kind: 'agent', host: null, pane: 'p1' };
  const base = { target: t, shownAt: 1000, now: 1000 };
  assert.equal(chipLive(base), true);
  assert.equal(chipLive({ ...base, now: 1000 + CHIP_MS - 1 }), true);
  assert.equal(chipLive({ ...base, now: 1000 + CHIP_MS }), false);
  assert.equal(chipLive({ ...base, scrolled: CHIP_SCROLL - 1 }), true);
  assert.equal(chipLive({ ...base, scrolled: CHIP_SCROLL }), false);
  assert.equal(chipLive({ ...base, scrolled: -CHIP_SCROLL }), false);
  assert.equal(chipLive({ ...base, dismissed: true }), false);
  assert.equal(chipLive({ ...base, target: null }), false);
  assert.equal(chipLive({ ...base, shownAt: null }), false);
  assert.ok(CHIP_MS >= 20000 && CHIP_MS <= 60000);
});

test('edgeStart: within EDGE px of the right edge, on the phone list, with a target and the pref on', () => {
  const t = { kind: 'agent', host: null, pane: 'p1' };
  const ok = { width: 390, on: true, target: t, listView: true, split: false };
  assert.equal(EDGE, 24);
  assert.equal(edgeStart({ ...ok, x: 389 }), true);
  assert.equal(edgeStart({ ...ok, x: 390 - EDGE }), true);
  assert.equal(edgeStart({ ...ok, x: 390 - EDGE - 1 }), false); // mid-screen: the host swipe
  assert.equal(edgeStart({ ...ok, x: 200 }), false);
  assert.equal(edgeStart({ ...ok, x: 10 }), false);
  assert.equal(edgeStart({ ...ok, x: 389, on: false }), false); // Android by default
  assert.equal(edgeStart({ ...ok, x: 389, target: null }), false); // nothing to go to: host swipe
  assert.equal(edgeStart({ ...ok, x: 389, listView: false }), false);
  assert.equal(edgeStart({ ...ok, x: 389, split: true }), false);
  assert.equal(edgeStart({ ...ok, x: 389, width: 0 }), false);
});
