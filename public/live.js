'use strict';
// The shell view's live channel, the page's rules (shell.js has the socket): when to open it,
// how soon to try again, when to give up and read over HTTP, and the screen out of its frames.
// Pure: a plain script in the page (window.Live), required by the tests.
(function (root) {
  const API = 2; // the hosts that have it (lib/hub.js LIVE_API)
  const RETRY_MS = [300, 1000, 3000, 6000]; // after a drop: the first quickly, then slower
  const FAILS_MAX = 2; // channels in a row that did not open
  const DROPS_MAX = 3; // channels that dropped within DROPS_WINDOW_MS
  const DROPS_WINDOW_MS = 60000;
  const OFF_MS = 2 * 60000; // then HTTP for this host for a while, then the channel again
  const SILENT_MS = 40000; // the host's heartbeat is every 15 s: this long without a word is a dead link

  // Can the shell on this host use the channel? host: its state.hosts entry; off: { [host]: until }.
  function usable(host, { off = {}, now = 0, hasSocket = true } = {}) {
    if (!hasSocket || !host || !host.online || !(host.api >= API)) return false;
    return !(off[host.id] > now);
  }

  // The history of one host's channels: { fails, drops: [times] }. A channel ended: was it ever
  // open? Returns { log, delay, off }: the next try after delay ms, or off (true: HTTP from now on,
  // for OFF_MS).
  function ended(log, { opened, now }) {
    const l = { fails: opened ? 0 : (log.fails || 0) + 1, drops: (log.drops || []).filter((t) => now - t < DROPS_WINDOW_MS) };
    if (opened) l.drops.push(now);
    if (l.fails >= FAILS_MAX || l.drops.length >= DROPS_MAX) return { log: { fails: 0, drops: [] }, off: true, delay: null };
    const n = opened ? l.drops.length - 1 : l.fails;
    return { log: l, off: false, delay: RETRY_MS[Math.min(n, RETRY_MS.length - 1)] };
  }

  // A screen frame from the host: { lines, screen } for the view, { full: true } when a change
  // does not fit what the page has (ask for the whole screen), or null for other messages.
  // cur: { rev, lines, meta } or null.
  function screenFrame(cur, m, Diff) {
    if (m.t === 'f') {
      const meta = { format: m.format, source: m.source, truncated: Boolean(m.truncated) };
      return { rev: m.r, lines: Diff.lines(m.text), meta, screen: { text: String(m.text), ...meta } };
    }
    if (m.t !== 'd') return null;
    if (!cur || cur.rev !== m.b) return { full: true };
    const lines = Diff.apply(cur.lines, m);
    if (!lines) return { full: true };
    const meta = m.format ? { format: m.format, source: m.source, truncated: Boolean(m.truncated) } : cur.meta;
    return { rev: m.r, lines, meta, screen: { text: lines.join('\n'), ...meta } };
  }

  // The keys sent and not yet acknowledged, after an ack (up to s) or a failure (from..to).
  const acked = (sent, s) => sent.filter((x) => x.s > s);
  const failed = (sent, from, to) => ({ lost: sent.filter((x) => x.s >= from && x.s <= to), left: sent.filter((x) => x.s < from || x.s > to) });

  // Keys held after a channel dropped (or the page hid) with no ack: how long they wait for a
  // channel to say what got there (resume) before they show as not sent.
  const RESUME_WAIT_MS = 10000;
  // The host's answer to resume: the keys it applied (up to s) are done, the rest go again in
  // order. s null (it doesn't know this page: a restart, or too long): none can be told apart.
  const resumeSplit = (held, s) => (s == null ? { lost: held, resend: [] } : { lost: [], resend: held.filter((x) => x.s > s) });

  const api = { RESUME_WAIT_MS, resumeSplit, API, RETRY_MS, FAILS_MAX, DROPS_MAX, DROPS_WINDOW_MS, OFF_MS, SILENT_MS, usable, ended, screenFrame, acked, failed };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Live = api;
})(typeof self !== 'undefined' ? self : this);
