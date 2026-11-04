'use strict';
// A sideways swipe on 홈, 작업공간 or 설정 moves to the next or previous tab, as on Android.
// The page follows the finger; past TAB_SWIPE_MIN px (or a quick flick) it changes tab
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
// Commit: the old tab slides out the way the finger went, the new one slides in after it.
function tabSwipeGo(dir, next, link, from) {
  const w = listRoot().clientWidth || innerWidth;
  const out = tabSwipeParts();
  if (reduced()) return void (tabSwipeClear(out), link.click());
  tabSwipeStyle(out, from - dir * w * 0.25, 0, 110, 'ease-in'); // on from where the finger let go
  setTimeout(() => {
    link.click();
    let tries = 0;
    // The new tab renders on hashchange (or at once in split view); catch it before its first paint.
    const wait = () => {
      const cur = listRoot().querySelector('.tabbar a.tab[aria-current="page"]');
      if ((!cur || cur.getAttribute('href') !== next) && ++tries < 20) return void requestAnimationFrame(wait);
      const parts = tabSwipeParts();
      tabSwipeStyle(parts, dir * w * 0.25, 0, 0);
      void listRoot().offsetWidth;
      tabSwipeStyle(parts, 0, 1, 220);
      setTimeout(() => tabSwipeClear(parts), 260);
      tabSwipeClear(out.filter((el) => !parts.includes(el)));
    };
    requestAnimationFrame(wait);
  }, 110);
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
  if (link) return tabSwipeGo(dir, next, link, g.dx);
  // Not far enough: back into place.
  tabSwipeStyle(g.parts, 0, 1, reduced() ? 0 : 240);
  setTimeout(() => tabSwipeClear(g.parts), 280);
}
document.addEventListener('touchend', tabSwipeEnd);
document.addEventListener('touchcancel', tabSwipeEnd);
