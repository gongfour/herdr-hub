'use strict';
// The shell view's live channel, on the host that owns the pane: keys come in as they are typed
// and are applied in order; the screen goes out whenever it changed, as a line change
// (public/screendiff.js) after the first whole one.
//
// One worker per channel makes every herdr call for it, one at a time: keys first (merged the
// way the page's queue merges them, so 5 keys that came in during a slow call go as one
// send_input), then the echo (lib/echo: wait for it, cap 40 ms) when nothing else is waiting,
// else a read every POLL_MS while keys or output are recent (ACTIVE_MS), every IDLE_POLL_MS
// otherwise. A screen goes out only when it differs from the one sent before.
//
// Messages (JSON text). Page → host:
//   { t: 'k', s, x, y }    keys: sequence number s (rising), text x typed first, then keys y
//   { t: 'shape', lines, format }   read more lines (scrolled up) or the other format (colour)
//   { t: 'full' }          send the whole screen again (the page lost track)
//   { t: 'hb' }            heartbeat
// Host → page:
//   { t: 'hello', api, pane }
//   { t: 'f', r, text, format, source, truncated }   the whole screen, revision r
//   { t: 'd', r, b, k, h, a, z, format?, source?, truncated? }   a change from revision b
//   { t: 'ack', s }        keys up to s are with the shell
//   { t: 'kerr', from, to, error, message }   keys from..to did not get there (the rest after a
//                          failed one are dropped too: they would land out of order)
//   { t: 'err', error, message }   the screen cannot be read now (herdr down); tried again
//   { t: 'gone', error }   the pane is gone; the channel closes
//   { t: 'hb' }            heartbeat, every HEARTBEAT_MS

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
function liveSession({ io, send, pane, shape: shape0, api, pollMs = POLL_MS, idlePollMs = IDLE_POLL_MS, activeMs = ACTIVE_MS, heartbeatMs = HEARTBEAT_MS }) {
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
  const stats = { reads: 0, pushes: 0, full: 0, keys: 0, groups: 0, skipped: 0 };

  const out = (msg) => {
    if (!stopped) send(msg);
  };

  // Push a screen if it changed (or the page needs it whole).
  function push(screen) {
    const lines = ScreenDiff.lines(screen.text);
    const meta = { format: screen.format, source: screen.source, truncated: Boolean(screen.truncated) };
    if (sent && io.buffered && io.buffered() > BACKPRESSURE) {
      stats.skipped++;
      return;
    }
    if (!sent) {
      rev++;
      stats.full++;
      stats.pushes++;
      out({ t: 'f', r: rev, text: screen.text, ...meta });
      sent = { lines, ...meta };
      activeAt = now();
      return;
    }
    const same = sent.format === meta.format && sent.source === meta.source && sent.truncated === meta.truncated;
    if (same && lines.length === sent.lines.length && lines.every((l, i) => l === sent.lines[i])) return;
    const d = ScreenDiff.diff(sent.lines, lines);
    const b = rev++;
    stats.pushes++;
    out({ t: 'd', r: rev, b, k: d.k, h: d.h, a: d.a, z: d.z, ...(same ? {} : meta) });
    sent = { lines, ...meta };
    activeAt = now();
  }

  async function read() {
    stats.reads++;
    readAt = now();
    const screen = await io.read(shape);
    errorShown = null;
    return screen;
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

  async function step() {
    if (queue.length) {
      const g = takeGroup();
      stats.groups++;
      io.touch();
      try {
        await io.input(g.text, g.keys);
      } catch (err) {
        const dropped = queue.splice(0);
        const to = dropped.length ? dropped[dropped.length - 1].s : g.to;
        out({ t: 'kerr', from: g.from, to, error: err.code || 'error', message: err.message });
        fail(err);
        return;
      }
      out({ t: 'ack', s: g.to });
      activeAt = now();
      if (queue.length) return; // the last of a burst brings the echo
      try {
        const before = sent ? { text: sent.lines.join('\n') } : null;
        const screen = await io.echo({ text: g.keys.length ? '' : g.text, before }, shape);
        stats.reads++;
        readAt = now();
        push(screen);
      } catch (err) {
        fail(err);
      }
      return;
    }
    const pace = now() - activeAt < activeMs ? pollMs : idlePollMs;
    const due = readAt + pace - now();
    if (due > 0 && sent) return sleep(due);
    try {
      push(await read());
    } catch (err) {
      if (fail(err)) return;
      const key = `${err.code}:${err.message}`;
      if (errorShown !== key) out({ t: 'err', error: err.code || 'error', message: err.message });
      errorShown = key;
      sent = null; // back: the whole screen, which also clears the page's error line
      return sleep(RETRY_MS);
    }
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
    out({ t: 'hello', api, pane });
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
        queue.push({ s: m.s, x: typeof m.x === 'string' ? m.x : '', y: Array.isArray(m.y) ? m.y : [] });
        poke();
      } else if (m.t === 'shape') {
        const lines = Math.min(Math.floor(Number(m.lines)) || shape.lines, 400);
        const format = m.format === 'ansi' ? 'ansi' : 'text';
        if (lines !== shape.lines || format !== shape.format) {
          shape = { ...shape, lines, format };
          sent = null; // the next read goes out whole
          readAt = 0;
          poke();
        }
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

module.exports = { liveSession, POLL_MS, IDLE_POLL_MS, ACTIVE_MS, HEARTBEAT_MS, MAX_KEYS, BACKPRESSURE };
