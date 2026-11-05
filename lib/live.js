'use strict';
// The shell view's live channel, on the host that owns the pane: keys come in as they are typed
// and are applied in order; the screen goes out whenever it changed, as a line change
// (public/screendiff.js) after the first whole one.
//
// One worker per channel makes the key calls for it, one at a time: keys first (merged the
// way the page's queue merges them, so 5 keys that came in during a slow call go as one
// send_input), then the echo (lib/echo: wait for it, cap 40 ms) when nothing else is waiting,
// else a read every POLL_MS while keys or output are recent (ACTIVE_MS), every IDLE_POLL_MS
// otherwise. In a burst (more keys waiting after a call) a read goes out beside the next call,
// so keys typed on keep showing while herdr holds a later one. A screen goes out only when it
// differs from the one sent before, and only if it was read after the last one sent: a read
// that took longer never puts back an older screen.
//
// Messages (JSON text). Page → host:
//   { t: 'k', s, x, y }    keys: sequence number s (rising), text x typed first, then keys y
//   { t: 'shape', lines, format }   read more lines (scrolled up) or the other format (colour)
//   { t: 'full' }          send the whole screen again (the page lost track)
//   { t: 'hb' }            heartbeat
//   { t: 'resume', c, s }  first on a new channel: the page (c, a random id it keeps while it is
//                          loaded) and the last key sequence it sent this pane. The host answers
//                          resumed with the last one it applied, from an earlier channel too
//                          (resumeBook), so the page sends again only what never got there.
//   a key with tr: 1 is traced (a debug aid, off unless the page asks: shell.js window.liveTrace)
// Host → page:
//   { t: 'hello', api, pane, resume: true }   resume: it answers resume (an older host doesn't)
//   { t: 'resumed', s }    the last key sequence applied for that page and pane (s: null when it
//                          doesn't know: a new page, or more than RESUME_TTL_MS since)
//   { t: 'f', r, text, format, source, truncated }   the whole screen, revision r
//   { t: 'd', r, b, k, h, a, z, format?, source?, truncated? }   a change from revision b
//   { t: 'ack', s }        keys up to s are with the shell
//   { t: 'kerr', from, to, error, message }   keys from..to did not get there (the rest after a
//                          failed one are dropped too: they would land out of order)
//   { t: 'err', error, message }   the screen cannot be read now (herdr down); tried again
//   { t: 'gone', error }   the pane is gone; the channel closes
//   { t: 'hb' }            heartbeat, every HEARTBEAT_MS
//   { t: 'tr', from, to, q, in, prime, echo, how, reads, pushed, at }   for a traced group of keys:
//                          ms from the first key's arrival to its herdr call (q), the call (in,
//                          the ping before it: prime), the echo wait (null in a burst: the last
//                          group brings it), whether a screen went out, and when (at, from arrival)

const ScreenDiff = require('../public/screendiff');

const POLL_MS = 40;
const IDLE_POLL_MS = 150;
const ACTIVE_MS = 5000;
const HEARTBEAT_MS = 15000;
const RETRY_MS = 1000;
const MAX_TEXT = 2000;
const MAX_KEYS = 8; // the most herdr takes in one call
const MAX_QUEUE = 512;
const BACKPRESSURE = 256 * 1024; // bytes waiting on the socket: skip a screen, send the next

// io: { read(shape) → screen, input(text, keys), echo({ text, before }, shape) → screen,
//       touch(), now(), setTimeout, clearTimeout, buffered() → bytes }
// send(obj): to the page. Returns { message(obj), stop(), stats }.
function liveSession({ io, send, pane, shape: shape0, api, book = null, pollMs = POLL_MS, idlePollMs = IDLE_POLL_MS, activeMs = ACTIVE_MS, heartbeatMs = HEARTBEAT_MS }) {
  const now = io.now;
  let shape = { ...shape0 };
  let stopped = false;
  const queue = []; // { s, x, y }
  let lastSeq = 0;
  let sent = null; // { lines, format, source, truncated } as the page has it
  let rev = 0;
  let activeAt = now(); // a key or a change: reads at the quick pace until activeMs after it
  let readAt = 0;
  let wake = null;
  let sleeper = null;
  let errorShown = null;
  let mine = null; // this page's entry in the book, once it said resume
  const stats = { reads: 0, pushes: 0, full: 0, keys: 0, groups: 0, skipped: 0, stale: 0, side: 0 };

  const out = (msg) => {
    if (!stopped) send(msg);
  };

  // Push a screen if it changed (or the page needs it whole).
  let readNo = 0; // reads started
  let pushedNo = 0; // the read behind the screen the page has (the newest read pushed)
  function push(screen, no) {
    if (no < pushedNo) {
      stats.stale++;
      return false;
    }
    pushedNo = no;
    const lines = ScreenDiff.lines(screen.text);
    const meta = { format: screen.format, source: screen.source, truncated: Boolean(screen.truncated) };
    if (sent && io.buffered && io.buffered() > BACKPRESSURE) {
      stats.skipped++;
      return false;
    }
    if (!sent) {
      rev++;
      stats.full++;
      stats.pushes++;
      out({ t: 'f', r: rev, text: screen.text, ...meta });
      sent = { lines, ...meta };
      activeAt = now();
      return true;
    }
    const same = sent.format === meta.format && sent.source === meta.source && sent.truncated === meta.truncated;
    if (same && lines.length === sent.lines.length && lines.every((l, i) => l === sent.lines[i])) return false;
    const d = ScreenDiff.diff(sent.lines, lines);
    const b = rev++;
    stats.pushes++;
    out({ t: 'd', r: rev, b, k: d.k, h: d.h, a: d.a, z: d.z, ...(same ? {} : meta) });
    sent = { lines, ...meta };
    activeAt = now();
    return true;
  }

  // Traced keys (tr: 1): when each came in, until its group's trace goes out.
  const traced = new Map(); // s → arrival
  const MAX_TRACED = 256;

  async function read() {
    stats.reads++;
    readAt = now();
    const no = ++readNo;
    const screen = await io.read(shape);
    errorShown = null;
    return { screen, no };
  }

  // The next run of queued keys as one herdr call: text joins text until keys come; keys join
  // after it (no new text) up to MAX_KEYS. Same rule as the page's queue (public/keys.js).
  function takeGroup() {
    const first = queue.shift();
    const g = { from: first.s, to: first.s, text: first.x, keys: [...first.y] };
    while (queue.length) {
      const n = queue[0];
      if (n.x && (g.keys.length || g.text.length + n.x.length > MAX_TEXT)) break;
      if (g.keys.length + n.y.length > MAX_KEYS) break;
      queue.shift();
      g.text += n.x;
      g.keys.push(...n.y);
      g.to = n.s;
    }
    return g;
  }

  function fail(err) {
    const code = err && err.code;
    if (code === 'pane_not_found') {
      out({ t: 'gone', error: code });
      stop('gone');
      return true;
    }
    return false;
  }

  // A poll read runs beside the keys, not in front of them: a key that comes in while one is out
  // goes to herdr at once (herdr 0.9.3 holds some calls ~105 ms, and the key would wait for it).
  // Its screen goes out unless a read started after it went out first (push).
  let polling = null;
  function poll() {
    polling = read()
      .then(
        ({ screen, no }) => {
          push(screen, no);
        },
        (err) => {
          if (fail(err)) return;
          const key = `${err.code}:${err.message}`;
          if (errorShown !== key) out({ t: 'err', error: err.code || 'error', message: err.message });
          errorShown = key;
          sent = null; // back: the whole screen, which also clears the page's error line
          retryAt = now() + RETRY_MS;
        }
      )
      .finally(() => {
        polling = null;
        poke();
      });
  }
  let retryAt = 0;

  async function step() {
    if (queue.length) {
      const g = takeGroup();
      stats.groups++;
      io.touch();
      const rx = traced.get(g.from);
      const tr = rx == null ? null : { from: g.from, to: g.to, q: now() - rx, prime: 0, echo: null, pushed: false };
      if (tr) for (let s = g.from; s <= g.to; s++) traced.delete(s);
      const t0 = now();
      // A channel that opens meanwhile for this page waits for this call before it says what
      // was applied (resume).
      const entry = mine;
      let settle = null;
      if (entry) entry.busy = new Promise((r) => (settle = r));
      const settled = (ok) => {
        if (!entry) return;
        if (ok) entry.applied = Math.max(entry.applied, g.to);
        book.touch(entry);
        entry.busy = null;
        settle();
      };
      try {
        try {
          await io.input(g.text, g.keys, tr || {});
          if (tr) tr.in = now() - t0;
          settled(true);
        } catch (err) {
          settled(false);
          const dropped = queue.splice(0);
          const to = dropped.length ? dropped[dropped.length - 1].s : g.to;
          out({ t: 'kerr', from: g.from, to, error: err.code || 'error', message: err.message });
          fail(err);
          return;
        }
        out({ t: 'ack', s: g.to });
        activeAt = now();
        if (queue.length) {
          // More keys waiting: they go next, and a read beside them shows these (the last group
          // of the burst waits for its echo).
          if (!polling && sent) {
            stats.side++;
            poll();
            if (tr) tr.side = true;
          }
          return;
        }
        try {
          const before = sent ? { text: sent.lines.join('\n') } : null;
          const t1 = now();
          const no = ++readNo;
          const screen = await io.echo({ text: g.keys.length ? '' : g.text, before }, shape, tr || {});
          if (tr) tr.echo = now() - t1;
          stats.reads++;
          readAt = now();
          if (push(screen, no) && tr) tr.pushed = true;
        } catch (err) {
          fail(err);
        }
      } finally {
        if (tr) {
          const r = (v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v);
          out({ t: 'tr', ...Object.fromEntries(Object.entries(tr).map(([k, v]) => [k, r(v)])), at: r(now() - rx) });
        }
      }
      return;
    }
    if (polling) return sleep(RETRY_MS); // its end wakes us
    const pace = now() - activeAt < activeMs ? pollMs : idlePollMs;
    // After a failed read: not before retryAt. Otherwise at the pace, or at once for a page
    // that has no screen yet.
    const due = retryAt > now() ? retryAt - now() : sent ? readAt + pace - now() : 0;
    if (due > 0) return sleep(due);
    poll();
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      wake = resolve;
      sleeper = io.setTimeout(resolve, ms);
    }).finally(() => {
      io.clearTimeout(sleeper);
      wake = sleeper = null;
    });
  }
  const poke = () => wake && wake();

  (async () => {
    out({ t: 'hello', api, pane, ...(book ? { resume: true } : {}) });
    while (!stopped) {
      try {
        await step();
      } catch (err) {
        console.error(`live ${pane}: ${err.stack || err}`);
        await sleep(RETRY_MS);
      }
    }
  })();

  const beat = () => {
    if (stopped) return;
    out({ t: 'hb' });
    hbTimer = io.setTimeout(beat, heartbeatMs);
  };
  let hbTimer = io.setTimeout(beat, heartbeatMs);

  function stop() {
    if (stopped) return;
    stopped = true;
    if (mine) {
      mine.open--;
      book.touch(mine);
    }
    io.clearTimeout(hbTimer);
    poke();
  }

  return {
    // One message from the page, already parsed and checked by the caller (server.js): keys
    // carry a valid text and key list.
    message(m) {
      if (stopped || !m || typeof m !== 'object') return;
      if (m.t === 'k') {
        if (!Number.isInteger(m.s) || m.s <= lastSeq) return;
        lastSeq = m.s;
        if (queue.length >= MAX_QUEUE) {
          out({ t: 'kerr', from: m.s, to: m.s, error: 'too_many', message: 'too many keys waiting' });
          return;
        }
        stats.keys++;
        if (m.tr) {
          traced.set(m.s, now());
          if (traced.size > MAX_TRACED) traced.delete(traced.keys().next().value);
        }
        queue.push({ s: m.s, x: typeof m.x === 'string' ? m.x : '', y: Array.isArray(m.y) ? m.y : [] });
        poke();
      } else if (m.t === 'shape') {
        const lines = Math.max(1, Math.min(Math.floor(Number(m.lines)) || shape.lines, 400)); // as validate cleanLines
        const format = m.format === 'ansi' ? 'ansi' : 'text';
        if (lines !== shape.lines || format !== shape.format) {
          shape = { ...shape, lines, format };
          sent = null; // the next read goes out whole
          readAt = 0;
          poke();
        }
      } else if (m.t === 'resume') {
        if (!book || mine || typeof m.c !== 'string' || !RESUME_ID.test(m.c)) return;
        const key = `${pane}\u0000${m.c}`;
        const known = book.known(key);
        mine = book.entry(key);
        mine.open++;
        // An earlier channel's call still out: what it applied, once it is back.
        (async () => {
          while (mine.busy) await mine.busy;
          if (!known) return out({ t: 'resumed', s: null });
          lastSeq = Math.max(lastSeq, mine.applied);
          out({ t: 'resumed', s: mine.applied });
        })();
      } else if (m.t === 'full') {
        sent = null;
        readAt = 0;
        poke();
      }
    },
    stop,
    get stopped() {
      return stopped;
    },
    stats,
  };
}

// What each page's keys reached on each pane, for a channel that opens after one dropped
// (resume): { applied, at, busy, open } by pane and page id. Kept RESUME_TTL_MS after the page's
// last channel for the pane ended; at most max entries (the oldest go).
const RESUME_TTL_MS = 60000;
const RESUME_ID = /^[A-Za-z0-9_-]{8,64}$/;
function resumeBook({ now = Date.now, ttl = RESUME_TTL_MS, max = 512 } = {}) {
  const m = new Map();
  const prune = () => {
    const t = now();
    for (const [k, e] of m) if (!e.open && !e.busy && t - e.at > ttl) m.delete(k);
    for (const [k, e] of m) {
      if (m.size <= max) break;
      if (!e.open) m.delete(k);
    }
  };
  return {
    known(key) {
      prune();
      return m.has(key);
    },
    entry(key) {
      prune();
      let e = m.get(key);
      if (!e) m.set(key, (e = { applied: 0, at: now(), busy: null, open: 0 }));
      return e;
    },
    // Its time is the book's own clock (the session's may be another).
    touch(e) {
      e.at = now();
    },
    size: () => m.size,
  };
}

// herdr on the Mac holds a call made the Node way ~105 ms now and then (about a third of a live
// session's reads; never one through lib/herdr's connect helper, so server.js hedges only without
// it), but a second call sent meanwhile usually answers at once (measured: 36 of 47). So a read
// (no side effects: a pane read, a wait for output) that has not answered after AFTER_MS goes out
// again, and the first answer wins: spaced reads p50 107 → 18 ms. Never for keys.
const AFTER_MS = [15, 30];
function hedge(fn, { after = AFTER_MS, setTimeout: st = setTimeout, clearTimeout: ct = clearTimeout } = {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    let pending = 0; // tries out now
    const timers = [];
    const finish = (f, v) => {
      if (done) return;
      done = true;
      timers.forEach((t) => ct(t));
      f(v);
    };
    const start = () => {
      pending++;
      Promise.resolve()
        .then(fn)
        .then(
          (v) => finish(resolve, v),
          // Every try out failed (herdr down, the pane gone): the error, no waiting for the next.
          (err) => {
            if (--pending === 0) finish(reject, err);
          }
        );
    };
    start();
    for (const ms of after)
      timers.push(
        st(() => {
          if (!done) start();
        }, ms)
      );
  });
}

// HERDR_HUB_LIVE_IDLE_MS: the read pace while nothing moves. herdr on the Mac stalls calls made the
// Node way unless it is called every few tens of ms, so without the connect helper the quick pace
// (POLL_MS) is the default; server.js passes IDLE_POLL_MS as the fallback when the helper is on.
function idleFromEnv(v, fallback = POLL_MS) {
  const n = Number(v);
  return v != null && v !== '' && Number.isFinite(n) && n >= 10 ? n : fallback;
}

module.exports = { hedge, idleFromEnv, AFTER_MS, liveSession, resumeBook, RESUME_TTL_MS, POLL_MS, IDLE_POLL_MS, ACTIVE_MS, HEARTBEAT_MS, MAX_KEYS, BACKPRESSURE };
