'use strict';
// A swipe from left to right on an agent's chat, a shell or a workspace leaves it, as its ‹ (✕
// in the split layout) does: the page follows the finger, and past BACK_SWIPE_MIN px (or a
// quick flick) it slides out and goes back the moment the finger lifts.
// Not on anything that can still scroll left under the finger (a wide table, the shell screen
// scrolled sideways, the key row), not in a text field, not under a sheet, and not from the
// left 20px (the system's own edge gesture on Android, the browser's on iOS).

const BACK_SWIPE_MIN = 80; // px
const BACK_SWIPE_FLICK = 0.5; // px/ms
const backSwipe = { g: null };

const backSwipeView = () => ['agent', 'term', 'ws'].includes(view.name);
const backLinkHere = () => detailRoot().querySelector('a[data-back]');
// Something under the finger that a rightward drag would scroll (it is scrolled away from its left edge).
function scrollsLeft(el) {
  for (; el && el.nodeType === 1 && el !== document.body; el = el.parentElement) {
    if (el.matches('textarea, input, select, [contenteditable]')) return true;
    const ov = getComputedStyle(el).overflowX;
    if ((ov === 'auto' || ov === 'scroll') && el.scrollWidth - el.clientWidth > 1 && el.scrollLeft > 0) return true;
  }
  return false;
}
function backSwipeStyle(el, dx, ms) {
  el.style.transition = ms ? `transform ${ms}ms ${TAB_EASE}, opacity ${ms}ms ${TAB_EASE}` : 'none';
  el.style.transform = dx ? `translate3d(${dx}px, 0, 0)` : '';
  el.style.opacity = dx ? String(Math.max(0.4, 1 - dx / (detailRoot().clientWidth || innerWidth))) : '';
}
const backSwipeClear = (el) => (el.style.transition = el.style.transform = el.style.opacity = el.style.willChange = '');

document.addEventListener(
  'touchstart',
  (e) => {
    backSwipe.g = null;
    if (e.touches.length !== 1 || !backSwipeView() || topLayer() || !backLinkHere()) return;
    const t = e.touches[0];
    const root = detailRoot();
    if (!root.contains(e.target) || e.target.closest('.bar') || t.clientX - root.getBoundingClientRect().left < 20) return;
    backSwipe.g = { x: t.clientX, y: t.clientY, target: e.target, axis: null, dx: 0, lastX: t.clientX, lastT: Date.now(), v: 0, raf: 0 };
  },
  { passive: true }
);
document.addEventListener(
  'touchmove',
  (e) => {
    const g = backSwipe.g;
    if (!g || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - g.x;
    const dy = t.clientY - g.y;
    if (!g.axis) {
      if (Math.hypot(dx, dy) < 10) return;
      g.axis = dx > 0 && dx > Math.abs(dy) * 1.2 && !scrollsLeft(g.target) ? 'x' : 'no';
      if (g.axis === 'x') {
        g.el = detailRoot().firstElementChild;
        if (!g.el) return (g.axis = 'no');
        g.el.style.willChange = 'transform';
      }
    }
    if (g.axis !== 'x') return;
    if (e.cancelable) e.preventDefault();
    g.dx = Math.max(0, dx);
    const now = Date.now();
    if (now > g.lastT) g.v = (t.clientX - g.lastX) / (now - g.lastT);
    g.lastX = t.clientX;
    g.lastT = now;
    if (!g.raf) g.raf = requestAnimationFrame(() => ((g.raf = 0), backSwipe.g === g && backSwipeStyle(g.el, g.dx, 0)));
  },
  { passive: false }
);
function backSwipeEnd() {
  const g = backSwipe.g;
  backSwipe.g = null;
  if (!g || g.axis !== 'x') return;
  cancelAnimationFrame(g.raf);
  const a = backLinkHere();
  if (a && (g.dx >= BACK_SWIPE_MIN || g.v >= BACK_SWIPE_FLICK)) {
    const w = detailRoot().clientWidth || innerWidth;
    const go = () => (backSwipeClear(g.el), goBack(a.getAttribute('href')));
    if (reduced()) return go();
    backSwipeStyle(g.el, w, 160);
    return setTimeout(go, 160);
  }
  // Not far enough: back into place.
  backSwipeStyle(g.el, 0, reduced() ? 0 : 220);
  setTimeout(() => backSwipeClear(g.el), 260);
}
document.addEventListener('touchend', backSwipeEnd);
document.addEventListener('touchcancel', backSwipeEnd);
