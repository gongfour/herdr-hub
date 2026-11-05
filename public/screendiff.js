'use strict';
// The shell's live channel sends a screen once, then only what changed: lines, not the whole
// 200 again. A screen is its text split on '\n'. A change is { k, h, a, z }: drop k lines off the
// top (output scrolled them away), keep the next h, then the lines in a, then the last z of the
// old screen. Output that moves by a line is one line in a and the rest kept.
// Pure: a plain script in the page (window.ScreenDiff), required by the server and the tests.
(function (root) {
  const SHIFT_MAX = 400; // how far up the old screen to look for where the new one starts

  // How many lines a and b share from the start (a from offset i, b from 0).
  function run(a, i, b) {
    let n = 0;
    while (i + n < a.length && n < b.length && a[i + n] === b[n]) n++;
    return n;
  }

  function diff(prev, next) {
    // The shift: where the new first line sits in the old screen, the one sharing the longest run.
    let k = 0;
    let h = run(prev, 0, next);
    if (h < next.length) {
      for (let i = 1; i < prev.length && i <= SHIFT_MAX; i++) {
        if (prev[i] !== next[0]) continue;
        const n = run(prev, i, next);
        if (n > h) (k = i), (h = n);
        if (h === next.length || i + h >= prev.length) break;
      }
    }
    // Shared lines at the end, not overlapping what was kept at the start.
    let z = 0;
    while (z < prev.length - k - h && z < next.length - h && prev[prev.length - 1 - z] === next[next.length - 1 - z]) z++;
    return { k, h, a: next.slice(h, next.length - z), z };
  }

  // The new screen from the old one and a change. null when the change does not fit the old
  // screen (it was for another one): the caller asks for the whole screen again.
  function apply(prev, d) {
    if (!d || !Array.isArray(d.a) || [d.k, d.h, d.z].some((n) => !Number.isInteger(n) || n < 0)) return null;
    if (d.k + d.h + d.z > prev.length) return null;
    return prev.slice(d.k, d.k + d.h).concat(d.a, d.z ? prev.slice(prev.length - d.z) : []);
  }

  const lines = (text) => String(text == null ? '' : text).split('\n');

  const api = { diff, apply, lines, SHIFT_MAX };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ScreenDiff = api;
})(typeof self !== 'undefined' ? self : this);
