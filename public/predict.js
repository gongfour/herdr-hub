'use strict';
// 셸 예측 입력: in 키 직접 입력, a character typed at the shell's prompt is drawn at the caret
// at once, before the host's echo comes back; the host's screen then confirms it (the prediction
// goes, the same text is there) or disagrees (every prediction goes at once, nothing wrong is
// left). As mosh does it.
//
// herdr gives no cursor position, so the caret is found from the echo itself: the first key of
// an epoch is only noted (tentative, not drawn). When the screen shows it, where it landed is
// the caret: the screen's last line that isn't blank, its other lines unchanged. From then on
// keys typed are drawn at once while each echo keeps confirming; the epoch ends (the next key is
// tentative again) on any key that moves the caret or runs something (Enter, Tab, arrows,
// Ctrl/Alt chords, …), when the screen disagrees, and when a key the shell has taken shows no
// echo within ECHO_WAIT_MS (a password prompt: it never echoes, so nothing is ever drawn).
// A full-screen program (vim, less, htop, Claude Code) fails the same checks: its typed keys
// don't land at the end of the last line with the rest of the screen unchanged.
//
// Positions are UTF-16 offsets in the line's plain text (colour codes out, Ansi.strip), the
// same text the box shows. Beyond its end a line counts as blanks (a trailing space typed at the
// prompt isn't in the trimmed text).
// Pure: a plain script in the page (window.Predict), required by the tests.
(function (root) {
  const ECHO_WAIT_MS = 600; // a key with the shell this long with no echo: the shell doesn't echo
  const SENT_WAIT_MS = 5000; // a key not even acknowledged this long: give up the epoch
  const FLAG_MS = 250; // a prediction drawn this long unconfirmed is underlined
  const MAX_OPS = 64;
  const MAX_TEXT = 16; // a longer text (a paste) is not predicted
  const SHOW_ABOVE_MS = 30; // 자동: drawn while the key round trip is above this…
  const HIDE_BELOW_MS = 20; // …until it falls below this (mosh's adaptive display)
  const PRINTABLE = /^[^\x00-\x1f\x7f-\x9f]+$/;

  const lastRow = (lines) => {
    for (let i = lines.length - 1; i >= 0; i--) if (lines[i].trim()) return i;
    return -1;
  };
  // Does line (blanks beyond its end) start with prefix?
  const startsPadded = (line, prefix) => (line.length >= prefix.length ? line.startsWith(prefix) : prefix.startsWith(line) && !prefix.slice(line.length).trim());
  const lcp = (a, b) => {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return i;
  };
  const dropLast = (s) => Array.from(s).slice(0, -1).join('');
  // The caret prefix after the ops.
  const after = (prefix, ops) => ops.reduce((p, o) => (o.kind === 'bs' ? dropLast(p) : p + o.ch), prefix);
  // The lines above the caret's the same as when it was found (the guard against full-screen
  // programs, which redraw elsewhere); below it there is nothing (it is the last line not blank).
  const othersSame = (a, b, row) => {
    for (let i = 0; i < row; i++) if (a[i] !== b[i]) return false;
    return true;
  };

  function create({ strip = (s) => s } = {}) {
    let plain = null; // the last screen, plain lines
    let ep = null; // { anchor: plain lines, row, line, prefix (null: caret not found yet), start, sure }
    let ops = []; // { kind: 'ch' | 'bs', ch, s, at, ackAt, screens (seen since its ack) }
    let ackS = 0;
    let srtt = null;
    let showing = false;
    const sentAt = new Map(); // s → when sent (the round trip)
    const stats = { confirmed: 0, wrong: 0, noEcho: 0, ends: 0 };

    const end = (why) => {
      if (why) stats[why] = (stats[why] || 0) + 1;
      const had = Boolean(ep && ep.sure && ops.length);
      ep = null;
      ops = [];
      return had;
    };

    // A key went to the shell: { text } or { key }, its sequence number on the live channel (s;
    // null when it went another way). Returns true when what is drawn changed.
    function typed(press, s, now) {
      if (s == null) return end();
      sentAt.set(s, now);
      if (sentAt.size > 256) sentAt.delete(sentAt.keys().next().value);
      const text = press && typeof press.text === 'string' ? press.text : null;
      const chars = text ? Array.from(text) : null;
      if (chars && chars.length && chars.length <= MAX_TEXT && PRINTABLE.test(text)) {
        if (!plain || lastRow(plain) < 0) return end();
        if (!ep) {
          const row = lastRow(plain);
          ep = { anchor: plain, row, line: plain[row], prefix: null, start: null, sure: false };
        }
        if (ops.length + chars.length > MAX_OPS) return end();
        for (const ch of chars) ops.push({ kind: 'ch', ch, s, at: now, ackAt: null, screens: 0 });
        return Boolean(ep.sure);
      }
      // Backspace over what was typed in this epoch (never into the prompt).
      if (press && press.key === 'backspace' && ep && ep.prefix != null && after(ep.prefix, ops).length > ep.start) {
        ops.push({ kind: 'bs', s, at: now, ackAt: null, screens: 0 });
        return Boolean(ep.sure);
      }
      return end('ends');
    }

    function acked(s, now) {
      if (s > ackS) ackS = s;
      for (const o of ops) if (o.s <= s && o.ackAt == null) o.ackAt = now;
      const t = sentAt.get(s);
      if (t != null) {
        const r = Math.max(0, now - t);
        srtt = srtt == null ? r : srtt + (r - srtt) / 8;
        for (const k of sentAt.keys()) if (k <= s) sentAt.delete(k);
      }
    }

    // A new screen from the host (its raw lines). Returns true when what is drawn changed.
    function screen(rawLines, now) {
      plain = rawLines.map((l) => strip(l));
      if (!ep) return false;
      const was = view(now);
      const row = lastRow(plain);
      const L = row >= 0 ? plain[row] : '';
      if (row !== ep.row || !othersSame(ep.anchor, plain, row)) return end('wrong') || Boolean(was);
      if (ep.prefix == null) {
        // Tentative: where did the first key land?
        if (L === ep.line) return false; // not there yet
        const first = ops[0];
        if (!first || first.kind !== 'ch') return end('wrong');
        const O = ep.line;
        let p = lcp(O, L);
        if (!L.startsWith(first.ch, p) && !O.slice(p).trim()) while (L[p] === ' ') p++;
        // A caret at the start of a line has no prompt before it: vim's or less's command line.
        if (!L.startsWith(first.ch, p) || first.ackAt == null || !L.slice(0, p).trim()) return end('wrong');
        ep.prefix = L.slice(0, p).padEnd(p, ' ');
        ep.start = p;
      }
      // The most acknowledged keys the screen shows.
      let n = 0;
      while (n < ops.length && ops[n].s <= ackS) n++;
      for (let i = n; i >= 0; i--) {
        if (!startsPadded(L, after(ep.prefix, ops.slice(0, i)))) continue;
        if (i) stats.confirmed += i;
        ep.prefix = after(ep.prefix, ops.slice(0, i));
        ops = ops.slice(i);
        if (i) ep.sure = true;
        ep.anchor = plain;
        ep.line = L;
        // A key the shell has taken shows on the screen after it at the latest: one read that
        // started before it may still come after its ack, the next one has it or disagrees.
        const o = ops[0];
        if (o && o.ackAt != null && ++o.screens >= 2) return end('wrong') || Boolean(was);
        return Boolean(was) || Boolean(view(now));
      }
      return end('wrong') || Boolean(was);
    }

    // Time passing: keys with the shell and no echo end the epoch. Returns true when a drawn
    // prediction went.
    function tick(now) {
      if (!ops.length) return false;
      const o = ops[0];
      if ((o.ackAt != null && now - o.ackAt > ECHO_WAIT_MS) || now - o.at > SENT_WAIT_MS) return end('noEcho');
      return false;
    }

    // What to draw: null, or on line row keep the first `keep` characters, put text after them,
    // drop `skip` of the line's characters after them (overwritten, or deleted by Backspace) and
    // keep the rest; flag: underline it (waiting long).
    function view(now) {
      if (!ep || !ep.sure || ep.prefix == null || !ops.length) return null;
      const p = after(ep.prefix, ops);
      const keep = lcp(ep.prefix, p);
      return { row: ep.row, keep, text: p.slice(keep), skip: Math.max(ep.prefix.length, p.length) - keep, flag: now - ops[0].at > FLAG_MS };
    }

    // 자동: drawn only while the round trip is long enough to feel (with a gap, so it doesn't
    // flicker on and off around the line). on/off: always/never.
    function show(mode) {
      if (mode === 'on') return true;
      if (mode !== 'auto' || srtt == null) return (showing = false);
      showing = showing ? srtt >= HIDE_BELOW_MS : srtt > SHOW_ABOVE_MS;
      return showing;
    }

    return {
      typed, acked, screen, tick, view, show, end: () => end(),
      get srtt() {
        return srtt;
      },
      get pending() {
        return ops.length;
      },
      stats,
    };
  }

  // A view drawn into a line's text: the text the line shows with it (for tests and checks).
  const applyView = (line, v) => {
    const padded = line.length < v.keep ? line.padEnd(v.keep, ' ') : line;
    return padded.slice(0, v.keep) + v.text + padded.slice(v.keep + v.skip);
  };

  const api = { create, applyView, ECHO_WAIT_MS, FLAG_MS, SHOW_ABOVE_MS, HIDE_BELOW_MS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Predict = api;
})(typeof self !== 'undefined' ? self : this);
