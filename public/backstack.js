'use strict';
// Back closes the top layer (core.js openLayer). With CloseWatcher (Chrome 120+) a watcher per
// layer does it; this is the fallback where there is none (iOS Safari): each layer opened by a tap or a key pushes one
// history entry at the same address, state.layer = how many layer entries are under and at it.
// Android's Back (a Galaxy Tab cover's Esc is Back, the page never sees the key), the browser's
// back and an iOS edge swipe then pop that entry: popstate, and the layer closes; the page stays.
// Pure: loaded as a plain script in the page (window.BackStack), required by the tests.
(function (root) {
  // The layer depth an entry's state stands for (0: a page's own entry).
  const depthOf = (state) => (state && Number.isInteger(state.layer) && state.layer > 0 ? state.layer : 0);

  // What a popstate onto an entry of depth `to` means with layers open to depth `open`:
  //   { close: n }  close the layers above depth `to` (Back over n layer entries at once is rare)
  //   { skip: true } an entry of a layer no longer open (left behind by a route change): step
  //                  back over it, so Back never needs two presses
  //   {}            nothing to do
  function onPop(to, open) {
    if (to < open) return { close: open - to };
    if (to > open) return { skip: true };
    return {};
  }

  // CloseWatcher where the browser has it (core.js); history entries only where it does not.
  const useWatcher = (win) => Boolean(win && typeof win.CloseWatcher === 'function');

  const api = { depthOf, onPop, useWatcher };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BackStack = api;
})(typeof self !== 'undefined' ? self : this);
