'use strict';
// Wide screens (a landscape tablet, a laptop): the list on the left, the open agent, shell or
// workspace on the right. These are the layout's decisions that need no page: when to split,
// which row a keyboard shortcut moves to, and which keys are shortcuts at all.
// Pure: loaded as a plain script in the page (window.Split), required by the tests.
(function (root) {
  // CSS px. A landscape Galaxy Tab S7+ (about 1400, or 1138 at a larger display size) and a
  // laptop split; the same tablet upright (876), half of a split screen and phones do not.
  const SPLIT_MIN = 1000;
  const isSplit = (width) => Number(width) >= SPLIT_MIN;

  // The row after (dir 1) or before (dir -1) the open one, from the list's links in order.
  // An agent can be listed twice (the 답 필요 strip and its workspace card): once is enough.
  // With nothing open, ↓ starts at the top and ↑ at the bottom; past either end, nothing.
  function stepRow(hrefs, current, dir) {
    const list = [...new Set((hrefs || []).filter(Boolean))];
    if (!list.length) return null;
    const i = current ? list.indexOf(current) : -1;
    if (i < 0) return dir > 0 ? list[0] : list[list.length - 1];
    return list[i + (dir > 0 ? 1 : -1)] || null;
  }

  // 'next', 'prev' or null for a keydown. Alt+↓/↑ works anywhere, the composer and the shell
  // included (the shell gets no Alt+↑/↓: it is the way out of a shell that has every other
  // key); ] and [ only where they would not be typed, and never in the shell view, where they
  // are typed. Nothing while a sheet is open.
  function listKey(e, { editable = false, shell = false, layer = false } = {}) {
    if (!e || e.isComposing || e.keyCode === 229 || layer) return null;
    if (e.ctrlKey || e.metaKey) return null;
    if (e.altKey && !e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) return e.key === 'ArrowDown' ? 'next' : 'prev';
    if (!e.altKey && !editable && !shell && (e.key === ']' || e.key === '[')) return e.key === ']' ? 'next' : 'prev';
    return null;
  }

  // The host segment (전체 / each machine): Alt+→ the next, Alt+← the one before, round from
  // either end. 1, -1 or null for a keydown. Anywhere but the shell view, whose Alt+←/→ are the
  // shell's word keys (keys.js rawKeyName); nothing while a sheet is open.
  function hostKey(e, { shell = false, layer = false } = {}) {
    if (!e || e.isComposing || e.keyCode === 229 || layer || shell) return null;
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
    return e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : null;
  }
  function stepHost(ids, current, dir) {
    const list = [...new Set((ids || []).filter(Boolean))];
    if (list.length < 2) return null;
    const i = Math.max(0, list.indexOf(current));
    return list[(i + (dir > 0 ? 1 : list.length - 1)) % list.length];
  }

  const api = { SPLIT_MIN, isSplit, stepRow, listKey, hostKey, stepHost };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Split = api;
})(typeof self !== 'undefined' ? self : this);
