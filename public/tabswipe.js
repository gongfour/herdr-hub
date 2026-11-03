'use strict';
// A sideways swipe on 홈, 작업공간 or 설정 moves to the next or previous tab, as on Android.
// The page follows the finger a little; past TAB_SWIPE_MIN px (or a quick flick) it changes tab
// through the tab bar's own link, so split view (the list column only) behaves like a tap there.
// Not from the left screen edge, not on anything that scrolls sideways itself (key rows, wide
// tables, the host segment when it overflows) or a text field, and never in a detail view.

const TAB_ORDER = ['#/', '#/spaces', '#/settings'];
const TAB_SWIPE_MIN = 70; // px
const TAB_SWIPE_FLICK = 0.5; // px/ms
const tabSwipe = { g: null };

function tabPageShown() {
  return listShown() || settingsShown();
}
// The tab content that moves with the finger: everything in the list root but the tab bar.
const tabSwipeParts = () => [...listRoot().children].filter((el) => !el.classList.contains('tabbar'));
function tabSwipeMove(dx, animate) {
  for (const el of tabSwipeParts()) {
    el.style.transition = animate && !reduced() ? 'transform 0.18s ease-out' : 'none';
    el.style.transform = dx ? `translateX(${dx}px)` : '';
  }
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
    tabSwipe.g = { x: t.clientX, y: t.clientY, target: e.target, axis: null, dx: 0, lastX: t.clientX, lastT: Date.now(), v: 0 };
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
      if (g.axis === 'x') g.i = currentTabIndex();
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
    tabSwipeMove(g.dx * 0.5, false);
  },
  { passive: false }
);
function tabSwipeEnd() {
  const g = tabSwipe.g;
  tabSwipe.g = null;
  if (!g || g.axis !== 'x') return;
  tabSwipeMove(0, true);
  const dir = g.dx <= -TAB_SWIPE_MIN || g.v <= -TAB_SWIPE_FLICK ? 1 : g.dx >= TAB_SWIPE_MIN || g.v >= TAB_SWIPE_FLICK ? -1 : 0;
  const next = TAB_ORDER[g.i + dir];
  if (!dir || g.i < 0 || !next) return;
  const link = listRoot().querySelector(`.tabbar a.tab[href="${next}"]`);
  if (link) link.click();
}
document.addEventListener('touchend', tabSwipeEnd);
document.addEventListener('touchcancel', tabSwipeEnd);
