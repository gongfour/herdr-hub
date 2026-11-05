'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { keepAwake, intervalFromEnv, DEFAULT_MS } = require('../lib/awake');

// A virtual clock with its own timers; run(ms) advances it and fires what is due, letting
// promise callbacks settle between timers.
function clock() {
  let t = 0;
  let id = 0;
  const due = new Map();
  const timers = {
    setTimeout: (fn, ms) => (due.set(++id, { at: t + ms, fn }), id),
    clearTimeout: (k) => due.delete(k),
  };
  const flush = () => new Promise((r) => setImmediate(r));
  async function run(ms) {
    const end = t + ms;
    for (;;) {
      const next = [...due.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      due.delete(next[0]);
      t = next[1].at;
      next[1].fn();
      await flush();
    }
    t = end;
    await flush();
  }
  return { now: () => t, timers, run, pending: () => due.size };
}

test('no timer until touched, and none again once idle', async () => {
  const c = clock();
  let pings = 0;
  const a = keepAwake({ ping: async () => pings++, intervalMs: 50, idleMs: 1000, now: c.now, timers: c.timers });
  assert.equal(c.pending(), 0);
  await c.run(5000);
  assert.equal(pings, 0);
  a.touch();
  assert.equal(a.running, true);
  await c.run(1000);
  assert.equal(pings, 19); // 50, 100, … 950; the tick at 1000 finds it idle
  await c.run(5000);
  assert.equal(pings, 19);
  assert.equal(a.running, false);
  assert.equal(c.pending(), 0);
});

test('each touch pushes the end out; many touches share one timer', async () => {
  const c = clock();
  let pings = 0;
  const a = keepAwake({ ping: async () => pings++, intervalMs: 100, idleMs: 500, now: c.now, timers: c.timers });
  for (let i = 0; i < 10; i++) {
    a.touch();
    a.touch();
    assert.ok(c.pending() <= 1);
    await c.run(300);
  }
  assert.equal(a.stats.runs, 1);
  await c.run(1000);
  assert.equal(a.running, false);
  assert.equal(pings, 31); // every 100 ms from 100 to 3100 (last touch at 2700, idle at 3200)
  a.touch();
  assert.equal(a.stats.runs, 2);
});

test('a slow ping is never overlapped: due ticks are skipped', async () => {
  const c = clock();
  let inFlight = 0;
  let most = 0;
  let pings = 0;
  const a = keepAwake({
    intervalMs: 20,
    idleMs: 1000,
    now: c.now,
    timers: c.timers,
    ping: () => {
      pings++;
      most = Math.max(most, ++inFlight);
      return new Promise((r) => c.timers.setTimeout(() => (inFlight--, r()), 110)); // a herdr stall
    },
  });
  a.touch();
  await c.run(1200);
  assert.equal(most, 1);
  assert.ok(a.stats.skipped > 0);
  assert.ok(pings >= 8 && pings <= 10, `pings ${pings}`);
});

test('a failing ping does not stop the timer or throw', async () => {
  const c = clock();
  let pings = 0;
  const a = keepAwake({ ping: async () => (pings++, Promise.reject(new Error('down'))), intervalMs: 50, idleMs: 300, now: c.now, timers: c.timers });
  a.touch();
  await c.run(300);
  assert.equal(pings, 5);
});

test('interval 0 means off: touch starts nothing', async () => {
  const c = clock();
  const a = keepAwake({ ping: async () => assert.fail('pinged'), intervalMs: 0, now: c.now, timers: c.timers });
  a.touch();
  assert.equal(c.pending(), 0);
  await c.run(1000);
});

test('HERDR_HUB_AWAKE_MS', () => {
  assert.equal(intervalFromEnv(undefined), DEFAULT_MS);
  assert.equal(intervalFromEnv(''), DEFAULT_MS);
  assert.equal(intervalFromEnv('0'), 0);
  assert.equal(intervalFromEnv('off'), 0);
  assert.equal(intervalFromEnv('-5'), 0);
  assert.equal(intervalFromEnv('100'), 100);
  assert.equal(intervalFromEnv('1'), 10);
});
