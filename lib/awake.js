'use strict';
// Keep this host's herdr awake while someone is using a shell here.
//
// herdr 0.9.3 on the Mac stalls ~105 ms on an API call when it has been idle for a moment, and a
// key costs 2–3 calls in a row. A trivial `ping` every few tens of ms keeps it from going idle
// (measured: spaced pane.get p50 104 → 1.3 ms). Desktop's 0.9.4-preview does not stall, so its
// run.cmd turns this off (HERDR_HUB_AWAKE_MS=0).
//
// One timer per process, not per pane. touch() on shell activity (a key, a screen read); the timer
// runs until idleMs after the last touch, then stops — no timer at all while idle. A ping still
// in flight when the next one is due is not overlapped: that tick is skipped.

const DEFAULT_MS = 50;
const IDLE_MS = 5000;

function keepAwake({ ping, intervalMs = DEFAULT_MS, idleMs = IDLE_MS, now = Date.now, timers = { setTimeout, clearTimeout } } = {}) {
  let until = 0;
  let timer = null;
  let inFlight = false;
  const stats = { pings: 0, skipped: 0, runs: 0 };

  const tick = () => {
    timer = null;
    if (now() >= until) return; // idle: stop until the next touch
    if (inFlight) stats.skipped++;
    else {
      inFlight = true;
      stats.pings++;
      Promise.resolve()
        .then(ping)
        .catch(() => {}) // herdr down: the requests that touched us report it
        .finally(() => (inFlight = false));
    }
    schedule();
  };
  const schedule = () => {
    timer = timers.setTimeout(tick, intervalMs);
    if (timer && timer.unref) timer.unref();
  };

  return {
    touch() {
      if (!(intervalMs > 0)) return;
      until = now() + idleMs;
      if (!timer) {
        stats.runs++;
        schedule();
      }
    },
    stop() {
      until = 0;
      if (timer) timers.clearTimeout(timer);
      timer = null;
    },
    get running() {
      return timer != null;
    },
    stats,
  };
}

// HERDR_HUB_AWAKE_MS: the ping interval; 0 (or anything not a positive number) turns it off.
function intervalFromEnv(v) {
  if (v == null || v === '') return DEFAULT_MS;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.max(10, n) : 0;
}

module.exports = { keepAwake, intervalFromEnv, DEFAULT_MS, IDLE_MS };
