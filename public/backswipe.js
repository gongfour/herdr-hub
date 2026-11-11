'use strict';
// A swipe from left to right on an agent's chat, a shell, a workspace or 설정 leaves it, as its
// ‹ (✕ in the split layout; 설정 on the phone goes back to 작업공간, as Ctrl+, does) does.
// The whole page follows the finger (every child of its root but the tab bar), casting a soft
// shadow on its left; behind it the page it goes back to waits, as on iOS: on the phone the
// 작업공간 list as it was left (list.js keeps its DOM while a detail is open, so it is the
// real list, scroll and all), a little to the left and dimmed, coming into place with the
// finger; in the split layout the empty right pane. Past BACK_SWIPE_MIN px (or a quick flick)
// the page carries on from the finger's speed and goes off (motion.js spring) and the view
// goes back; else it settles back. Where back leads elsewhere (설정 opened over an agent, split)
// nothing waits behind and the page fades as it goes, as before.
// Not on anything that can still scroll left under the finger (a wide table, the shell screen
// scrolled sideways, the key row), not in a text field, not under a sheet, not on the header,
// and not from the left 20px (the system's own edge gesture on Android, the browser's on iOS).

const BACK_SWIPE_MIN = 80; // px
const BACK_SWIPE_FLICK = 0.5; // px/ms
const PEEK_SHIFT = 0.3; // the page behind starts this much of the width to the left
// g: the finger on the page; anim: the page finishing (or waiting off screen for the route)
// after it lifted. While either is on, state updates wait (app.js onState) so the page under
// the finger stays the one it moves.
const backSwipe = { g: null, anim: null, pending: false };

const backSwipeView = () => ['agent', 'term', 'ws', 'settings'].includes(view.name);
const backSwipeBusy = () => Boolean(backSwipe.anim || (backSwipe.g && backSwipe.g.axis === 'x' && Date.now() - backSwipe.g.t0 < 10000));
// Where the gesture leads: the view's ‹ / ✕, or (phone 설정, a tab with no ‹) 작업공간.
function backTarget() {
  if (view.name === 'settings' && !split) return homeHash();
  const a = detailRoot().querySelector('a[data-back]');
  return a ? a.getAttribute('href') : null;
}
// What moves: the whole page in the root, not the tab bar (phone 설정 keeps it) nor the page behind.
const backParts = (root) => [...root.children].filter((el) => !el.classList.contains('tabbar') && !el.classList.contains('peek'));

// Something under the finger that a rightward drag would scroll (it is scrolled away from its left edge).
function scrollsLeft(el) {
  for (; el && el.nodeType === 1 && el !== document.body; el = el.parentElement) {
    if (el.matches('textarea, input, select, [contenteditable]')) return true;
    const ov = getComputedStyle(el).overflowX;
    if ((ov === 'auto' || ov === 'scroll') && el.scrollWidth - el.clientWidth > 1 && el.scrollLeft > 0) return true;
  }
  return false;
}

// The page behind, under the moving one: the kept 작업공간 page (phone) or the empty right pane
// (split), with a dimming layer and the moving page's shadow over it. Null when back leads
// somewhere that isn't there to show.
function peekBuild(root) {
  if (normHash(backTarget()) !== normHash(homeHash())) return null;
  let kept = null;
  if (!split) {
    kept = tabPages.spaces;
    if (!kept) return null; // the list was never drawn (opened straight onto this view)
    tabPages.spaces = null;
  }
  const box = document.createElement('div');
  box.className = 'peek';
  box.setAttribute('aria-hidden', 'true');
  box.inert = true;
  const page = document.createElement('div');
  page.className = 'peek-page';
  if (split) page.innerHTML = emptyDetailHtml();
  else {
    for (const [el] of kept) page.appendChild(el);
    if (!root.querySelector(':scope > .tabbar')) page.insertAdjacentHTML('beforeend', tabBar('spaces'));
  }
  const dim = document.createElement('div');
  dim.className = 'peek-dim';
  const shade = document.createElement('div');
  shade.className = 'peek-shade';
  box.append(page, dim, shade);
  const bar = root.querySelector(':scope > .tabbar'); // phone 설정: the tab bar stays in front
  if (bar) box.style.bottom = `${bar.offsetHeight}px`;
  root.prepend(box);
  if (kept)
    for (const [el, top, left] of kept) {
      if (top) el.scrollTop = top;
      if (left) el.scrollLeft = left;
    }
  return { box, page, dim, shade, kept: kept && kept.map(([el]) => el) };
}
// The kept list back where list.js keeps it (its scroll as it is now), unless the layout
// changed (drop: it was drawn for the other one).
function peekRelease(p, drop) {
  if (!p) return;
  if (p.kept && !drop && !tabPages.spaces) tabPages.spaces = p.kept.map((el) => [el, el.scrollTop, el.scrollLeft]);
  p.box.remove();
}

// One frame: the page at x; the page behind from PEEK_SHIFT to the left into place, its dimming
// and the shadow fading as it comes.
function backFrame(g, x) {
  const p = Math.min(1, Math.max(0, x / g.w));
  const tr = `translate3d(${x}px,0,0)`;
  for (const el of g.parts) el.style.transform = tr;
  const k = g.peek;
  if (k) {
    k.page.style.transform = `translate3d(${-PEEK_SHIFT * g.w * (1 - p)}px,0,0)`;
    k.dim.style.opacity = String(1 - p);
    k.shade.style.transform = tr;
    k.shade.style.opacity = String(1 - p * p);
  } else for (const el of g.parts) el.style.opacity = String(Math.max(0.4, 1 - p));
}

// Everything back as it was: no inline styles, the kept list back in list.js's keeping.
function backSwipeDone(g, drop = false) {
  if (g.stop) g.stop();
  clearTimeout(g.timer);
  if (backSwipe.anim === g) backSwipe.anim = null;
  for (const el of g.parts) {
    el.classList.remove('bs-front');
    el.style.transform = el.style.opacity = el.style.willChange = '';
  }
  peekRelease(g.peek, drop);
  g.peek = null;
  if (backSwipe.pending) {
    backSwipe.pending = false;
    setTimeout(() => backSwipe.anim || onState(), 0);
  }
}
// The page is off the screen: go back. The route (app.js route → backSwipeRelease) takes the
// list from behind and puts it in place in the same task, so nothing blank shows in between;
// the page stays off the screen until then (goBack may wait for history.back()'s popstate).
function backSwipeGo(g, href) {
  backSwipe.anim = g;
  g.timer = setTimeout(() => backSwipe.anim === g && backSwipeDone(g), 1000); // no route came
  goBack(href);
}
// A route change (app.js, first thing): the gesture's page and the one behind are put back.
function backSwipeRelease(drop = false) {
  const g = backSwipe.anim || (backSwipe.g && backSwipe.g.axis === 'x' ? backSwipe.g : null);
  backSwipe.g = null;
  if (g) backSwipeDone(g, drop);
}

document.addEventListener(
  'touchstart',
  (e) => {
    backSwipe.g = null;
    if (e.touches.length !== 1 || backSwipe.anim || !backSwipeView() || topLayer() || !backTarget()) return;
    const t = e.touches[0];
    const root = detailRoot();
    if (!root.contains(e.target) || e.target.closest('.bar, .tabbar') || t.clientX - root.getBoundingClientRect().left < 20) return;
    backSwipe.g = { x0: t.clientX, y0: t.clientY, t0: Date.now(), target: e.target, axis: null, dx: 0, samples: [], raf: 0, parts: [] };
  },
  { passive: true }
);
document.addEventListener(
  'touchmove',
  (e) => {
    const g = backSwipe.g;
    if (!g || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - g.x0;
    const dy = t.clientY - g.y0;
    if (!g.axis) {
      if (Math.hypot(dx, dy) < 10) return;
      g.axis = dx > 0 && dx > Math.abs(dy) * 1.2 && !scrollsLeft(g.target) ? 'x' : 'no';
      if (g.axis === 'x') {
        const root = detailRoot();
        g.parts = backParts(root);
        if (!g.parts.length) return void (g.axis = 'no');
        g.w = root.clientWidth || innerWidth;
        g.peek = peekBuild(root);
        for (const el of g.parts) {
          el.classList.add('bs-front');
          el.style.willChange = 'transform';
        }
      }
    }
    if (g.axis !== 'x') return;
    if (e.cancelable) e.preventDefault();
    g.dx = Math.max(0, dx);
    g.samples.push({ t: e.timeStamp, x: t.clientX });
    if (g.samples.length > 12) g.samples.shift();
    // One style write per frame, with the finger.
    if (!g.raf) g.raf = requestAnimationFrame(() => ((g.raf = 0), backSwipe.g === g && backFrame(g, g.dx)));
  },
  { passive: false }
);
function backSwipeEnd(e) {
  const g = backSwipe.g;
  backSwipe.g = null;
  if (!g || g.axis !== 'x') return;
  cancelAnimationFrame(g.raf);
  const v = Motion.velocity(g.samples, e && e.timeStamp);
  const href = backTarget();
  backSwipe.anim = g;
  if (href && (g.dx >= BACK_SWIPE_MIN || v >= BACK_SWIPE_FLICK)) {
    if (reduced()) return backFrame(g, g.w), backSwipeGo(g, href);
    g.stop = Motion.run(g.dx, v, g.w, Motion.stiffness(v, Motion.W_GO), (x) => backFrame(g, x), () => backSwipeGo(g, href), Motion.GO_EPS);
    return;
  }
  // Not far enough: back into place.
  if (reduced()) return backSwipeDone(g);
  g.stop = Motion.run(g.dx, v, 0, Motion.stiffness(v, Motion.W_BACK), (x) => backFrame(g, x), () => backSwipeDone(g));
}
document.addEventListener('touchend', backSwipeEnd);
document.addEventListener('touchcancel', backSwipeEnd);
