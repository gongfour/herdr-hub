'use strict';
// The sideways gestures' motion (public/motion.js): rubber band, release speed, spring.
const test = require('node:test');
const assert = require('node:assert/strict');
const { rubber, velocity, springStep, stiffness, frames, W_GO, W_BACK, GO_EPS } = require('../public/motion.js');

test('rubber: gives less the further it is pulled, never past the page, both ways', () => {
  assert.equal(rubber(0, 390), 0);
  assert.equal(rubber(50, 0), 0);
  const a = rubber(50, 390);
  const b = rubber(100, 390);
  const c = rubber(300, 390);
  assert.ok(a > 0 && a < 50 && b > a && c > b, `${a} ${b} ${c}`);
  assert.ok(b - a > c - b - 1e-9 || (c - b) / 200 < (b - a) / 50, 'resistance grows');
  assert.ok(rubber(1e6, 390) < 390);
  assert.equal(rubber(-100, 390), -b);
  // A little pull follows the finger at about c (0.55).
  assert.ok(Math.abs(rubber(2, 390) / 2 - 0.55) < 0.01);
});

test('velocity: px/ms over the last 100 ms; 0 when the finger had stopped', () => {
  const s = [
    { t: 0, x: 0 },
    { t: 16, x: 4 },
    { t: 200, x: 10 },
    { t: 216, x: 26 },
    { t: 232, x: 50 },
  ];
  assert.equal(velocity(s, 232), (50 - 10) / 32);
  assert.equal(velocity(s, 400), 0); // held still before lifting
  assert.equal(velocity([{ t: 0, x: 0 }], 0), 0);
  assert.equal(velocity([], 0), 0);
  // Only two samples far apart: still the last pair.
  assert.equal(velocity([{ t: 0, x: 0 }, { t: 150, x: 30 }], 150), 0.2);
  assert.equal(velocity([{ t: 0, x: 30 }, { t: 10, x: 20 }], 10), -1);
});

test('springStep: at rest on the target stays; any dt converges without crossing from rest', () => {
  assert.deepEqual(springStep(100, 0, 100, 1 / 60, 20), { x: 100, v: 0 });
  let x = 0;
  let v = 0;
  for (let i = 0; i < 120; i++) {
    ({ x, v } = springStep(x, v, 390, 1 / 60, W_GO));
    assert.ok(x <= 390 + 1e-9, 'no overshoot from rest');
  }
  assert.ok(390 - x < 0.5);
  // One long step lands about where many short ones do (exact solution).
  const one = springStep(0, 0, 100, 0.1, 20).x;
  let y = 0;
  let w = 0;
  for (let i = 0; i < 10; i++) ({ x: y, v: w } = springStep(y, w, 100, 0.01, 20));
  assert.ok(Math.abs(one - y) < 1e-6);
});

test('frames: a flick finishes sooner than a slow release; the end is exactly the target', () => {
  const slow = frames(100, 0, 390, stiffness(0, W_GO), GO_EPS);
  const fast = frames(100, 2, 390, stiffness(2, W_GO), GO_EPS);
  assert.equal(slow[slow.length - 1], 390);
  assert.equal(fast[fast.length - 1], 390);
  assert.ok(fast.length < slow.length * 0.75, `${fast.length} < ${slow.length}`);
  assert.equal(stiffness(0, W_GO), W_GO);
  assert.equal(stiffness(-100, W_GO), W_GO * 1.7);
  assert.ok(slow.length * (1000 / 60) < 450, `slow finish ${slow.length} frames`);
  // Moving along the way: never backwards.
  for (let i = 1; i < slow.length; i++) assert.ok(slow[i] >= slow[i - 1]);
});

test('frames: snapping back never goes past the edge, even thrown toward it', () => {
  for (const v of [0, -0.5, -3, 1]) {
    const f = frames(60, v, 0, W_BACK);
    for (const x of f) assert.ok(x >= 0, `v ${v}: ${x}`);
    assert.equal(f[f.length - 1], 0);
  }
  // Thrown away from the target first: carries on a little, then comes back.
  const f = frames(60, 1, 0, W_BACK);
  assert.ok(Math.max(...f) > 60);
});
