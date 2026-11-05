'use strict';
// Wide screens (a landscape tablet, a laptop): the list on the left, the open agent, shell or
// workspace on the right. These are the layout's decisions that need no page: when to split,
// and which row a keyboard shortcut moves to (the keys themselves are keymap.js).
// Pure: loaded as a plain script in the page (window.Split), required by the tests.
(function (root) {
  // CSS px. A landscape Galaxy Tab S7+ (about 1400, or 1138 at a larger display size) and a
  // laptop split; the same tablet upright (876), half of a split screen and phones do not.
  const SPLIT_MIN = 1000;
  const isSplit = (width) => Number(width) >= SPLIT_MIN;

  // The row after (dir 1) or before (dir -1) the open one, from the list's links in order.
  // An agent can be listed twice (the 답 필요 strip and its workspace card): once is enough.
  // With nothing open, ↓ starts at the top and ↑ at the bottom; past either end, nothing.
  // heads: the workspace cards' links, in hrefs where they stand. One can be what is open (the
  // workspace view), and then the step starts there (↓ its first row, ↑ the card before's last);
  // a step never lands on one.
  function stepRow(hrefs, current, dir, heads) {
    const all = [...new Set((hrefs || []).filter(Boolean))];
    const head = new Set(heads || []);
    const rows = all.filter((h) => !head.has(h));
    if (!rows.length) return null;
    const i = current ? all.indexOf(current) : -1;
    if (i < 0) return dir > 0 ? rows[0] : rows[rows.length - 1];
    for (let j = i + (dir > 0 ? 1 : -1); j >= 0 && j < all.length; j += dir > 0 ? 1 : -1) if (!head.has(all[j])) return all[j];
    return null;
  }

  // The host segment (전체 / each machine) one step along, round from either end (Alt+←/→,
  // keymap.js). Nothing with one choice.
  function stepHost(ids, current, dir) {
    const list = [...new Set((ids || []).filter(Boolean))];
    if (list.length < 2) return null;
    const i = Math.max(0, list.indexOf(current));
    return list[(i + (dir > 0 ? 1 : list.length - 1)) % list.length];
  }

  const api = { SPLIT_MIN, isSplit, stepRow, stepHost };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Split = api;
})(typeof self !== 'undefined' ? self : this);
