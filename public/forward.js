'use strict';
// Back into the chat just left (fwdchip.js): what there is to go forward to, how long the
// 「방금 본 대화」 chip stays, and where a right-edge swipe on the list may start.
// Pure: loaded as a plain script in the page (window.Forward), required by the tests.
(function (root) {
  const EDGE = 24; // px from the right edge where the forward swipe starts
  const CHIP_MS = 30000; // the chip goes after this long
  const CHIP_SCROLL = 200; // px of list scroll (either way) that sends it away

  // What there is to go forward to after a route change from `from` to `to` (Route.parse shapes),
  // given what there was (`cur`, or null). Leaving an agent or a shell for the list leaves it to
  // come back to; opening anything (an agent, a shell, a workspace, a form) drops it, it being
  // either the thing itself or something else; 설정 and 단축키 (tabs, not things) keep it.
  function nextTarget(cur, from, to) {
    if (!to) return cur;
    if (to.name === 'list') {
      if (from && (from.name === 'agent' || from.name === 'term') && from.pane) return { kind: from.name, host: from.host || null, pane: from.pane };
      return cur;
    }
    return to.name === 'settings' || to.name === 'keys' ? cur : null;
  }

  // Whether the chip still stands: shownAt and now in ms, scrolled the list's scroll since it came
  // (px, either sign). Dismissed (✕, a swipe down) or no target: gone.
  function chipLive({ target, shownAt, now, scrolled = 0, dismissed = false }) {
    if (!target || dismissed || shownAt == null) return false;
    return now - shownAt < CHIP_MS && Math.abs(scrolled) < CHIP_SCROLL;
  }

  // Whether a touch at x (px from the left of a page `width` wide) starts the forward swipe: on
  // the phone's list, with something to go forward to, the pref on, within EDGE of the right edge.
  function edgeStart({ x, width, on, target, listView, split }) {
    return Boolean(on && target && listView && !split && width > 0 && x >= width - EDGE && x <= width);
  }

  const api = { EDGE, CHIP_MS, CHIP_SCROLL, nextTarget, chipLive, edgeStart };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Forward = api;
})(typeof self !== 'undefined' ? self : this);
