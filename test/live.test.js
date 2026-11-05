'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { liveSession, hedge, idleFromEnv, POLL_MS, IDLE_POLL_MS, ACTIVE_MS, HEARTBEAT_MS } = require('../lib/live');
const ScreenDiff = require('../public/screendiff');
const Live = require('../public/live');

// A virtual clock: timers run in time order; every herdr call takes callMs of it.
function clock() {
  let t = 0;
  let timers = [];
  let id = 0;
  const flush = () => new Promise((r) => setImmediate(r));
  return {
    now: () => t,
    setTimeout(f, ms) {
      const tm = { id: ++id, at: t + Math.max(0, ms), f };
      timers.push(tm);
      return tm;
    },
    clearTimeout(tm) {
      timers = timers.filter((x) => x !== tm);
    },
    async advance(ms) {
      const end = t + ms;
      await flush();
      for (;;) {
        timers.sort((a, b) => a.at - b.at || a.id - b.id);
        const next = timers[0];
        if (!next || next.at > end) break;
        timers.shift();
        t = next.at;
        next.f();
        await flush();
      }
      t = end;
      await flush();
    },
  };
}

// A shell whose screen is `screen`; typed text lands on its last line. Records herdr calls.
function rig({ callMs = 1, inputFails = null, shape = { lines: 200, format: 'ansi' } } = {}) {
  const c = clock();
  const sh = { screen: 'out\n❯ ', calls: [], buffered: 0 };
  const wait = (ms) => new Promise((r) => c.setTimeout(r, ms));
  const io = {
    now: c.now,
    setTimeout: c.setTimeout,
    clearTimeout: c.clearTimeout,
    touch: () => sh.calls.push(['touch', c.now()]),
    buffered: () => sh.buffered,
    read: async (s) => {
      sh.calls.push(['read', c.now(), s.lines, s.format]);
      await wait(callMs);
      return { text: sh.screen, format: s.format, source: 'recent_unwrapped', truncated: false };
    },
    input: async (text, keys) => {
      sh.calls.push(['input', c.now(), text, keys]);
      await wait(callMs);
      if (inputFails && inputFails(text, keys)) throw Object.assign(new Error('herdr says no'), { code: 'boom' });
      sh.screen += text;
      if (keys.includes('enter')) sh.screen += '\nran\n❯ ';
      if (keys.includes('backspace')) sh.screen = sh.screen.slice(0, -1);
    },
    echo: async (arg, s) => {
      sh.calls.push(['echo', c.now(), arg.text]);
      await wait(callMs);
      return { text: sh.screen, format: s.format, source: 'recent_unwrapped', truncated: false };
    },
  };
  const out = [];
  // The page's side: the screen put together from the frames.
  const page = { cur: null, screens: [] };
  const send = (m) => {
    out.push(m);
    const f = Live.screenFrame(page.cur, m, ScreenDiff);
    if (f && !f.full) {
      page.cur = f;
      page.screens.push(f.screen.text);
    } else if (f && f.full) page.full = true;
  };
  const s = liveSession({ io, send, pane: 'w1:p1', shape, api: 2 });
  return { c, sh, out, page, s, kinds: () => out.map((m) => m.t) };
}

test('hello, then the whole screen, then nothing while it does not change', async () => {
  const r = rig();
  await r.c.advance(2000);
  assert.deepEqual(r.out[0], { t: 'hello', api: 2, pane: 'w1:p1' });
  assert.equal(r.out[1].t, 'f');
  assert.equal(r.out[1].text, 'out\n❯ ');
  assert.equal(r.out.length, 2);
  r.s.stop();
});

test('keys: applied in order, acknowledged, the echo pushed as a line change', async () => {
  const r = rig();
  await r.c.advance(100);
  r.s.message({ t: 'k', s: 1, x: 'l', y: [] });
  await r.c.advance(20);
  r.s.message({ t: 'k', s: 2, x: 's', y: [] });
  r.s.message({ t: 'k', s: 3, x: '', y: ['enter'] });
  await r.c.advance(50);
  const acks = r.out.filter((m) => m.t === 'ack').map((m) => m.s);
  assert.deepEqual(acks, [1, 3]); // 2 and 3 came during 1's call: one herdr call
  const inputs = r.sh.calls.filter((x) => x[0] === 'input').map((x) => [x[2], x[3]]);
  assert.deepEqual(inputs, [['l', []], ['s', ['enter']]]);
  assert.equal(r.page.screens.at(-1), r.sh.screen);
  // Only lines went, not the whole screen again.
  assert.ok(r.out.filter((m) => m.t === 'f').length === 1);
  assert.ok(r.sh.calls.some((x) => x[0] === 'touch'));
  r.s.stop();
});

test('a repeated or older sequence number is ignored', async () => {
  const r = rig();
  await r.c.advance(10);
  r.s.message({ t: 'k', s: 5, x: 'a', y: [] });
  r.s.message({ t: 'k', s: 5, x: 'a', y: [] });
  r.s.message({ t: 'k', s: 4, x: 'b', y: [] });
  await r.c.advance(50);
  assert.deepEqual(r.sh.calls.filter((x) => x[0] === 'input').map((x) => x[2]), ['a']);
  r.s.stop();
});

test('a failed key drops the ones queued after it, and says which', async () => {
  const r = rig({ callMs: 10, inputFails: (text) => text === 'b' });
  await r.c.advance(30);
  r.s.message({ t: 'k', s: 1, x: '', y: ['up'] });
  r.s.message({ t: 'k', s: 2, x: 'b', y: [] });
  await r.c.advance(5); // 1 in herdr, 2 waits
  r.s.message({ t: 'k', s: 3, x: '', y: ['tab'] });
  r.s.message({ t: 'k', s: 4, x: 'c', y: [] });
  await r.c.advance(100);
  const kerr = r.out.find((m) => m.t === 'kerr');
  assert.equal(kerr.from, 2);
  assert.equal(kerr.to, 4);
  assert.equal(kerr.error, 'boom');
  assert.deepEqual(r.out.filter((m) => m.t === 'ack').map((m) => m.s), [1]);
  // Keys after the failure work again.
  r.s.message({ t: 'k', s: 5, x: 'd', y: [] });
  await r.c.advance(50);
  assert.deepEqual(r.out.filter((m) => m.t === 'ack').map((m) => m.s), [1, 5]);
  r.s.stop();
});

test('moving output: a read every POLL_MS, a push per change; slower once idle', async () => {
  const r = rig();
  await r.c.advance(10);
  let n = 0;
  const tick = () => {
    r.sh.screen = `${r.sh.screen}\n${++n}`;
    if (n < 30) r.c.setTimeout(tick, 100);
  };
  r.c.setTimeout(tick, 0);
  await r.c.advance(3000);
  const pushes = r.out.filter((m) => m.t === 'd').length;
  assert.ok(pushes >= 28 && pushes <= 31, `pushes ${pushes}`);
  assert.equal(r.page.screens.at(-1), r.sh.screen);
  const reads = (from, to) => r.sh.calls.filter((x) => x[0] === 'read' && x[1] >= from && x[1] < to).length;
  const quick = reads(1000, 2000);
  assert.ok(quick >= 1000 / (POLL_MS + 1) - 2, `quick ${quick}`);
  // Long after the last change: the idle pace.
  await r.c.advance(ACTIVE_MS + 2000);
  const t = r.c.now();
  await r.c.advance(3000);
  const idle = reads(t, t + 3000);
  assert.ok(idle <= 3000 / IDLE_POLL_MS + 1 && idle >= 3000 / IDLE_POLL_MS - 2, `idle ${idle}`);
  r.s.stop();
});

test('shape: a new size or format sends the whole screen again; full asks for it too', async () => {
  const r = rig();
  await r.c.advance(100);
  r.s.message({ t: 'shape', lines: 400, format: 'ansi' });
  await r.c.advance(100);
  assert.equal(r.out.filter((m) => m.t === 'f').length, 2);
  assert.ok(r.sh.calls.some((x) => x[0] === 'read' && x[2] === 400));
  r.s.message({ t: 'shape', lines: 400, format: 'ansi' }); // the same: nothing
  r.s.message({ t: 'full' });
  await r.c.advance(100);
  assert.equal(r.out.filter((m) => m.t === 'f').length, 3);
  r.s.stop();
});

test('a socket that is not keeping up: changes wait, the next one carries them', async () => {
  const r = rig();
  await r.c.advance(50);
  r.sh.buffered = 1e6;
  r.sh.screen += 'x';
  await r.c.advance(200);
  assert.equal(r.out.filter((m) => m.t === 'd').length, 0);
  r.sh.buffered = 0;
  r.sh.screen += 'y';
  await r.c.advance(200);
  assert.equal(r.page.screens.at(-1), r.sh.screen);
  r.s.stop();
});

test('herdr down: one err, retried, the whole screen when it is back; heartbeats meanwhile', async () => {
  const c = clock();
  let down = true;
  const out = [];
  const io = {
    now: c.now,
    setTimeout: c.setTimeout,
    clearTimeout: c.clearTimeout,
    touch() {},
    read: async () => {
      if (down) throw Object.assign(new Error('herdr socket: ENOENT'), { code: 'unreachable' });
      return { text: 'ok', format: 'text', source: 'recent_unwrapped' };
    },
    input: async () => {},
    echo: async () => ({ text: 'ok', format: 'text' }),
  };
  const s = liveSession({ io, send: (m) => out.push(m), pane: 'p', shape: { lines: 200, format: 'text' }, api: 2 });
  await c.advance(HEARTBEAT_MS + 100);
  assert.equal(out.filter((m) => m.t === 'err').length, 1);
  assert.ok(out.some((m) => m.t === 'hb'));
  down = false;
  await c.advance(2000);
  assert.equal(out.filter((m) => m.t === 'f').length, 1);
  s.stop();

  // A closed pane: gone, then no more reads.
  const out2 = [];
  let reads = 0;
  const s2 = liveSession({
    io: { ...io, read: async () => (reads++, Promise.reject(Object.assign(new Error('no pane'), { code: 'pane_not_found' }))) },
    send: (m) => out2.push(m),
    pane: 'p',
    shape: { lines: 200, format: 'text' },
    api: 2,
  });
  await c.advance(1000);
  assert.deepEqual(out2.map((m) => m.t), ['hello', 'gone']);
  assert.equal(reads, 1);
  assert.equal(s2.stopped, true);
});

test('page rules (live.js): which hosts, retries, giving up', () => {
  const h = { id: 'server', online: true, api: 2 };
  assert.equal(Live.usable(h), true);
  assert.equal(Live.usable({ ...h, api: 1 }), false);
  assert.equal(Live.usable({ ...h, api: null }), false);
  assert.equal(Live.usable({ ...h, online: false }), false);
  assert.equal(Live.usable(h, { hasSocket: false }), false);
  assert.equal(Live.usable(h, { off: { server: 2000 }, now: 1000 }), false);
  assert.equal(Live.usable(h, { off: { server: 2000 }, now: 3000 }), true);
  // Did not open twice in a row: off.
  let r = Live.ended({}, { opened: false, now: 0 });
  assert.equal(r.off, false);
  assert.equal(r.delay, Live.RETRY_MS[1]);
  r = Live.ended(r.log, { opened: false, now: 1 });
  assert.equal(r.off, true);
  // Dropped after opening: quick first, three within a minute: off; spread out: never off.
  r = Live.ended({}, { opened: true, now: 0 });
  assert.equal(r.delay, Live.RETRY_MS[0]);
  r = Live.ended(r.log, { opened: true, now: 1000 });
  assert.equal(r.off, false);
  r = Live.ended(r.log, { opened: true, now: 2000 });
  assert.equal(r.off, true);
  let log = {};
  for (let i = 0; i < 10; i++) {
    r = Live.ended(log, { opened: true, now: i * 40000 });
    assert.equal(r.off, false);
    log = r.log;
  }
  // An open after a failure clears the failure count (shell.js sets fails 0 on hello).
  // Frames: a change for another revision asks for the whole screen.
  const D = ScreenDiff;
  const f = Live.screenFrame(null, { t: 'f', r: 1, text: 'a\nb', format: 'ansi', source: 's' }, D);
  assert.equal(f.screen.text, 'a\nb');
  const d = Live.screenFrame(f, { t: 'd', r: 2, b: 1, k: 0, h: 1, a: ['c'], z: 0 }, D);
  assert.equal(d.screen.text, 'a\nc');
  assert.equal(d.screen.format, 'ansi');
  assert.deepEqual(Live.screenFrame(d, { t: 'd', r: 4, b: 3, k: 0, h: 0, a: [], z: 0 }, D), { full: true });
  assert.equal(Live.screenFrame(d, { t: 'ack', s: 1 }, D), null);
  const sent = [{ s: 1 }, { s: 2 }, { s: 3 }];
  assert.deepEqual(Live.acked(sent, 2), [{ s: 3 }]);
  assert.deepEqual(Live.failed(sent, 2, 3), { lost: [{ s: 2 }, { s: 3 }], left: [{ s: 1 }] });
});

test('hedge: a read held by herdr goes out again, the first answer wins; failures', async () => {
  const c = clock();
  const opts = { setTimeout: c.setTimeout, clearTimeout: c.clearTimeout };
  // The first try is held 105 ms, the second answers in 2.
  const takes = [105, 2, 2];
  let tries = 0;
  const fn = () => {
    const n = tries++;
    return new Promise((r) => c.setTimeout(() => r(`try ${n}`), takes[n]));
  };
  let got = null;
  hedge(fn, opts).then((v) => (got = [v, c.now()]));
  await c.advance(200);
  assert.deepEqual(got, ['try 1', 17]);
  assert.equal(tries, 2); // the third was not needed
  // A quick answer: one try only.
  tries = 0;
  takes[0] = 3;
  got = null;
  hedge(fn, opts).then((v) => (got = [v, c.now() - 200]));
  await c.advance(100);
  assert.deepEqual(got, ['try 0', 3]);
  assert.equal(tries, 1);
  // A try that fails while none other is out: the error at once.
  let err = null;
  hedge(() => Promise.reject(Object.assign(new Error('x'), { code: 'pane_not_found' })), opts).catch((e) => (err = e.code));
  await c.advance(1);
  assert.equal(err, 'pane_not_found');
  assert.equal(idleFromEnv(undefined), POLL_MS);
  assert.equal(idleFromEnv('150'), 150);
  assert.equal(idleFromEnv('x'), POLL_MS);
});

test('a key does not wait for a read herdr is holding, and that read is not pushed', async () => {
  // A rig whose reads after the first are held.
  const c = clock();
  const calls = [];
  let screen = '❯ ';
  let n = 0;
  const out = [];
  const s = liveSession({
    io: {
      now: c.now, setTimeout: c.setTimeout, clearTimeout: c.clearTimeout, touch() {},
      read: (shape) => {
        const at = c.now(); const text = screen; const ms = n++ ? 105 : 1;
        calls.push(['read', at]);
        return new Promise((res) => c.setTimeout(() => res({ text, format: 'text', source: 's' }), ms));
      },
      input: (text) => (calls.push(['input', c.now()]), new Promise((res) => c.setTimeout(() => ((screen += text), res()), 1))),
      echo: () => new Promise((res) => c.setTimeout(() => res({ text: screen, format: 'text', source: 's' }), 1)),
    },
    send: (m) => out.push([c.now(), m]),
    pane: 'p', shape: { lines: 200, format: 'text' }, api: 2,
  });
  await c.advance(50); // the first read is out and held
  const t0 = c.now();
  s.message({ t: 'k', s: 1, x: 'a', y: [] });
  await c.advance(10);
  const input = calls.find((x) => x[0] === 'input');
  assert.ok(input && input[1] - t0 <= 1, `the key went at ${input && input[1] - t0}`);
  await c.advance(200);
  // The held read (from before the key, showing '❯ ') did not overwrite the echo.
  const last = out.filter(([, m]) => m.t === 'd').at(-1)[1];
  assert.deepEqual(last.a, ['❯ a']);
  s.stop();
});
