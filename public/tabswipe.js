'use strict';
// A sideways swipe on 작업공간 or 설정 moves to the other tab, as on Android.
// The page follows the finger; past TAB_SWIPE_MIN px (or a quick flick) it changes tab the
// moment the finger lifts, the way the tab bar's own link would (split with a detail open: the
// list column only), and the new tab slides in from the side the finger went. Each tab's page is
// kept (list.js showTab), so the switch itself is cheap.
// Not from the left screen edge, not on anything that scrolls sideways itself (key rows, wide
// tables, the host segment when it overflows) or a text field, and never in a detail view.

const TAB_ORDER = ['#/', '#/settings'];
const TAB_SWIPE_MIN = 70; // px
const TAB_SWIPE_FLICK = 0.5; // px/ms
const tabSwipe = { g: null };

function tabPageShown() {
  return listShown() || settingsShown();
}
// The tab content that moves with the finger: everything in the list root but the tab bar.
const tabSwipeParts = () => [...listRoot().children].filter((el) => !el.classList.contains('tabbar'));
const TAB_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
function tabSwipeStyle(parts, dx, fade, ms, ease = TAB_EASE) {
  for (const el of parts) {
    el.style.transition = ms ? `transform ${ms}ms ${ease}, opacity ${ms}ms ${ease}` : 'none';
    el.style.transform = dx ? `translate3d(${dx}px, 0, 0)` : '';
    el.style.opacity = fade < 1 ? String(fade) : '';
  }
}
function tabSwipeClear(parts) {
  for (const el of parts) el.style.transition = el.style.transform = el.style.opacity = el.style.willChange = '';
}
const TAB_IN_MS = 200;
// Commit: change tab now, then one short slide of the new tab in after the finger.
function tabSwipeGo(dir, next, link) {
  const w = listRoot().clientWidth || innerWidth;
  const out = tabSwipeParts();
  tabSwipeClear(out); // the old page is kept as it was, back in place
  if (split && isDetail()) link.click(); // app.js: the list column only, drawn at once
  else {
    // The link's own navigation, but drawn now rather than on hashchange a task later.
    history.pushState(null, '', next);
    route();
  }
  if (reduced()) return;
  const parts = tabSwipeParts();
  tabSwipeStyle(parts, dir * Math.min(w * 0.3, 120), 0.4, 0);
  void listRoot().offsetWidth;
  tabSwipeStyle(parts, 0, 1, TAB_IN_MS);
  setTimeout(() => tabSwipeClear(parts), TAB_IN_MS + 40);
}
function currentTabIndex() {
  const cur = listRoot().querySelector('.tabbar a.tab[aria-current="page"]');
  return cur ? TAB_ORDER.indexOf(cur.getAttribute('href')) : -1;
}

document.addEventListener(
  'touchstart',
  (e) => {
    tabSwipe.g = null;
    if (e.touches.length !== 1 || !tabPageShown() || document.querySelector('.sheet-back')) return;
    const t = e.touches[0];
    const root = listRoot();
    if (!root.contains(e.target) || e.target.closest('.tabbar') || t.clientX < 20) return;
    tabSwipe.g = { x: t.clientX, y: t.clientY, target: e.target, axis: null, dx: 0, lastX: t.clientX, lastT: Date.now(), v: 0, raf: 0 };
  },
  { passive: true }
);
document.addEventListener(
  'touchmove',
  (e) => {
    const g = tabSwipe.g;
    if (!g || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - g.x;
    const dy = t.clientY - g.y;
    if (!g.axis) {
      if (Math.hypot(dx, dy) < 10) return;
      g.axis = Math.abs(dx) > Math.abs(dy) * 1.2 && !canScroll(g.target, 'x') ? 'x' : 'y';
      if (g.axis === 'x') {
        g.i = currentTabIndex();
        g.parts = tabSwipeParts();
        for (const el of g.parts) el.style.willChange = 'transform';
      }
    }
    if (g.axis !== 'x') return;
    if (e.cancelable) e.preventDefault();
    // No tab past either end: the page only gives a little.
    const edge = (dx > 0 && g.i <= 0) || (dx < 0 && g.i >= TAB_ORDER.length - 1);
    g.dx = edge ? dx / 4 : dx;
    const now = Date.now();
    if (now > g.lastT) g.v = (t.clientX - g.lastX) / (now - g.lastT);
    g.lastX = t.clientX;
    g.lastT = now;
    // One style write per frame, 1:1 with the finger.
    if (!g.raf) g.raf = requestAnimationFrame(() => ((g.raf = 0), tabSwipe.g === g && tabSwipeStyle(g.parts, g.dx, 1, 0)));
  },
  { passive: false }
);
function tabSwipeEnd() {
  const g = tabSwipe.g;
  tabSwipe.g = null;
  if (!g || g.axis !== 'x') return;
  cancelAnimationFrame(g.raf);
  const dir = g.dx <= -TAB_SWIPE_MIN || g.v <= -TAB_SWIPE_FLICK ? 1 : g.dx >= TAB_SWIPE_MIN || g.v >= TAB_SWIPE_FLICK ? -1 : 0;
  const next = TAB_ORDER[g.i + dir];
  const link = dir && g.i >= 0 && next && listRoot().querySelector(`.tabbar a.tab[href="${next}"]`);
  if (link) return tabSwipeGo(dir, next, link);
  // Not far enough: back into place.
  tabSwipeStyle(g.parts, 0, 1, reduced() ? 0 : 240);
  setTimeout(() => tabSwipeClear(g.parts), 280);
}
document.addEventListener('touchend', tabSwipeEnd);
document.addEventListener('touchcancel', tabSwipeEnd);
