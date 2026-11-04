'use strict';
// Row actions in the lists: long-press or right-click a row for its menu. A sideways swipe
// belongs to the page (tabswipe.js: the next host), so it only cancels the long press here.

// ---- row actions: long-press or right-click for a menu

// The first move decides: vertical scrolls the list, horizontal is the page swipe; either
// cancels the long press.
const SWIPE_SLOP = 8; // px before the axis is decided
const LONG_MS = 500;
// g: the finger on a row; mute: until then a click is the end of a long press, not a tap;
// pending: a render that waited for the finger (list.js).
const swipe = { g: null, mute: 0, pending: false };

function bindList(main) {
  main.addEventListener('touchstart', rowTouchStart, { passive: true });
  main.addEventListener('touchmove', rowTouchMove, { passive: false });
  main.addEventListener('touchend', rowTouchEnd);
  main.addEventListener('touchcancel', rowTouchEnd);
  main.addEventListener('scroll', () => (listScroll = main.scrollTop), { passive: true });
  main.addEventListener('click', rowClick, true);
  // Right-click (and a long press where the browser makes one of it) opens the same menu.
  main.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('[data-kind]');
    if (!row) return;
    e.preventDefault();
    if ((swipe.g && swipe.g.long) || Date.now() < swipe.mute) return;
    rowMenu(row);
  });
}

function rowTouchStart(e) {
  clearTimeout(swipe.g && swipe.g.timer);
  if (e.touches.length !== 1) return void (swipe.g = null);
  const t = e.touches[0];
  const row = e.target.closest('[data-kind]');
  const g = { x: t.clientX, y: t.clientY, t0: Date.now(), axis: null, long: false, timer: null };
  if (row) g.timer = setTimeout(() => {
    g.long = true;
    rowMenu(row);
  }, LONG_MS);
  swipe.g = g;
}

function rowTouchMove(e) {
  const g = swipe.g;
  if (!g || e.touches.length !== 1) return;
  if (!g.axis) {
    const t = e.touches[0];
    const dx = t.clientX - g.x;
    const dy = t.clientY - g.y;
    if (Math.hypot(dx, dy) < SWIPE_SLOP) return;
    clearTimeout(g.timer);
    g.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'; // sideways: tabswipe.js
  }
  if (g.axis === 'x' && e.cancelable) e.preventDefault(); // sideways: never the page
}

function rowTouchEnd(e) {
  const g = swipe.g;
  swipe.g = null;
  if (!g) return;
  clearTimeout(g.timer);
  if (g.long || g.axis === 'x') {
    // Not a tap: the menu is open, or the page moved under the finger.
    swipe.mute = Date.now() + 450;
    if (e.cancelable) e.preventDefault();
  }
  if (swipe.pending) {
    swipe.pending = false;
    if (listShown()) render();
  }
}

function rowClick(e) {
  if (Date.now() < swipe.mute) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const more = e.target.closest('.ws-more');
  if (!more) return;
  // The card's ⋯ opens the same menu as a long press, not another page.
  e.preventDefault();
  rowMenu(more.closest('[data-kind]'));
}

function rowTarget(el) {
  const { kind, id } = el.dataset;
  const host = el.dataset.host || localId();
  if (kind === 'ws') return wsFor(host, id);
  return (kind === 'agent' ? state.agents : state.terminals || []).find((x) => same(x, host, id));
}
const rowLabel = (kind, x) => (kind === 'ws' ? x.label : kind === 'agent' ? x.name || x.title : termTitle(x));

async function rowMenu(el) {
  const kind = el.dataset.kind;
  const x = rowTarget(el);
  if (!x) return;
  if (kind === 'ws') wsMenu(x, { fromRow: true }); // actions.js: the same menus as the views' ⋯
  else paneMenu(kind, x, { fromRow: true });
}
