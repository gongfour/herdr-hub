'use strict';
// A sideways swipe on the 작업공간 list moves to the next host (전체 → desktop → server …), as
// Alt+←/→ and the host segment do (list.js stepHostFilter). 설정 is the tab bar's.
// The hosts' lists lie side by side: the list follows the finger and the neighbour host's list
// (drawn off to the side when the finger first reveals it) comes in with it, while the host
// segment's pill slides toward that host, its label's colour going with it, and the line under
// 작업공간 fades into that host's. Past TAB_SWIPE_MIN px (or a quick flick) the pages
// carry on from the finger's speed until the neighbour is in place (motion.js spring), and the
// host changes; else they settle back. With no host beyond, the list gives less the further it
// is pulled (rubber band). The header stays put. Phone, and the split layout's sidebar.
// Not from the left screen edge, not on anything that scrolls sideways itself (key rows, wide
// tables, the host segment when it overflows) or a text field, and never in a detail view.

const TAB_SWIPE_MIN = 70; // px
const TAB_SWIPE_FLICK = 0.5; // px/ms
// g: the finger on the list; anim: the pages finishing after it lifted. While either is on,
// list renders wait (pending) so the pages under the finger stay the ones it moves.
const tabSwipe = { g: null, anim: null, pending: false, lastNbMs: null };

const hostOrder = () => ['all', ...hosts().map((h) => h.id)];
function tabPageShown() {
  return multi() && (split || listShown());
}
const tabMain = () => listRoot().querySelector(':scope > main.home');
const tabSwipeBusy = () => Boolean(tabSwipe.anim || (tabSwipe.g && tabSwipe.g.axis === 'x' && Date.now() - tabSwipe.g.t0 < 10000));
function currentTabIndex() {
  return hostOrder().indexOf(filter());
}

// The list of the host one step along (dir ±1), drawn once beside the list (list.js homeParts,
// for that host): a plain copy to look at, the real list takes over when the host changes.
function tabNeighbour(g, dir) {
  if (dir in g.nb) return g.nb[dir];
  const f = hostOrder()[g.i + dir];
  if (!f) return (g.nb[dir] = null);
  const t0 = performance.now();
  const el = document.createElement('div');
  el.className = 'list home nb';
  el.setAttribute('aria-hidden', 'true');
  el.inert = true;
  el.innerHTML = withFilter(f, () => homeParts(f).map(([, html]) => html).join(''));
  fillTimes(el);
  const b = g.box;
  el.style.cssText = `left:${b.left}px;top:${b.top}px;width:${b.width}px;height:${b.height}px;transform:translate3d(${g.x + dir * g.w}px,0,0)`;
  listRoot().appendChild(el);
  tabSwipe.lastNbMs = performance.now() - t0;
  return (g.nb[dir] = el);
}

// The host segment's pill, lifted out so it can slide between two hosts with the pages.
function tabPill(g) {
  const nav = listRoot().querySelector(':scope > .seg.hosts');
  const btns = nav ? [...nav.querySelectorAll('button[data-host]')] : [];
  const cur = btns[g.i];
  if (!cur) return null;
  const r = (b) => b && { left: b.offsetLeft, width: b.offsetWidth };
  const el = document.createElement('span');
  el.className = 'seg-ind';
  el.style.cssText = `top:${cur.offsetTop}px;height:${cur.offsetHeight}px;width:${cur.offsetWidth}px;transform:translate3d(${cur.offsetLeft}px,0,0)`;
  nav.prepend(el);
  nav.classList.add('tracking');
  // The labels go with it: the host it leaves fades as it goes, the one it nears comes up.
  cur.style.setProperty('--on', '1');
  cur.classList.add('ind-on');
  return { nav, el, btns, from: r(cur), to: { 1: r(btns[g.i + 1]), '-1': r(btns[g.i - 1]) } };
}

// The line under 작업공간 (the host shown), with the next host's over it: one fades as the other
// comes, as far as the pages have gone, so it too has changed already when the host does.
function tabSub(g) {
  const sub = listRoot().querySelector(':scope > header.bar h1 > .sub');
  if (!sub) return null;
  const h1 = sub.parentElement;
  h1.style.position = 'relative'; // first, so the offsets below are from the heading
  const next = document.createElement('span');
  next.className = 'sub sub-next';
  next.setAttribute('aria-hidden', 'true');
  next.style.cssText = `position:absolute;left:${sub.offsetLeft}px;top:${sub.offsetTop}px;width:${sub.offsetWidth}px;opacity:0`;
  h1.appendChild(next);
  return { sub, h1, next, dir: 0 };
}

// One frame: the list at x, its neighbours a page to either side, the pill part of the way.
function tabFrame(g, x) {
  g.x = x;
  g.main.style.transform = `translate3d(${x}px,0,0)`;
  for (const d of [1, -1]) if (g.nb[d]) g.nb[d].style.transform = `translate3d(${x + d * g.w}px,0,0)`;
  if (g.pill) {
    const { from, to, btns } = g.pill;
    const dir = x < 0 ? 1 : -1;
    const t = to[dir];
    const p = t ? Math.min(1, Math.abs(x) / g.w) : 0;
    const left = t ? from.left + (t.left - from.left) * p : from.left;
    const width = t ? from.width + (t.width - from.width) * p : from.width;
    // Its real width, not a scaleX: a stretched pill stretches its corners and shadow too.
    g.pill.el.style.transform = `translate3d(${left}px,0,0)`;
    g.pill.el.style.width = `${width}px`;
    // The labels' colour follows the pill; the bold moves over once it is past halfway, so the
    // host it lands on already looks chosen when the list there takes over.
    const src = btns[g.i];
    const dst = t ? btns[g.i + dir] : null;
    for (const b of btns) if (b !== src && b !== dst) b.style.setProperty('--on', '0'), b.classList.remove('ind-on');
    src.style.setProperty('--on', String(1 - p));
    src.classList.toggle('ind-on', p < 0.5);
    if (dst) {
      dst.style.setProperty('--on', String(p));
      dst.classList.toggle('ind-on', p >= 0.5);
    }
  }
  if (g.sub) {
    const dir = x < 0 ? 1 : -1;
    const f = hostOrder()[g.i + dir];
    const p = f ? Math.min(1, Math.abs(x) / g.w) : 0;
    if (g.sub.dir !== dir) {
      g.sub.dir = dir;
      g.sub.next.textContent = f ? hostLineFor(f) : '';
    }
    g.sub.sub.style.opacity = String(1 - p);
    g.sub.next.style.opacity = String(p);
  }
}

// Everything back as it was: no neighbours, no pill, no inline styles on the list.
function tabSwipeDone(g, { flush = true } = {}) {
  if (g.stop) g.stop();
  if (tabSwipe.anim === g) tabSwipe.anim = null;
  g.main.style.transform = g.main.style.willChange = '';
  for (const d of [1, -1]) if (g.nb[d]) g.nb[d].remove();
  g.nb = {};
  if (g.pill) {
    g.pill.el.remove();
    for (const b of g.pill.btns) b.style.removeProperty('--on'), b.classList.remove('ind-on');
    g.pill.nav.classList.remove('tracking');
    g.pill = null;
  }
  if (g.sub) {
    g.sub.next.remove();
    g.sub.sub.style.opacity = g.sub.h1.style.position = '';
    g.sub = null;
  }
  if (flush && tabSwipe.pending) {
    tabSwipe.pending = false;
    if (listShown()) render();
  }
}
// The neighbour is in place: the real list becomes that host's, at the neighbour's scroll, in
// the same task, so no frame shows anything in between.
function tabSwipeCommit(g, dir) {
  const top = g.nb[dir] ? g.nb[dir].scrollTop : 0;
  tabSwipeDone(g, { flush: false });
  tabSwipe.pending = false;
  stepHostFilter(dir);
  const main = tabMain();
  if (main) main.scrollTop = top;
}
// A route change (app.js) mid-finish: drop it, as it was.
function tabSwipeRelease() {
  const g = tabSwipe.anim || (tabSwipe.g && tabSwipe.g.axis === 'x' ? tabSwipe.g : null);
  tabSwipe.g = null;
  if (g) tabSwipeDone(g, { flush: false });
  tabSwipe.pending = false;
}

document.addEventListener(
  'touchstart',
  (e) => {
    tabSwipe.g = null;
    if (e.touches.length !== 1 || tabSwipe.anim || !tabPageShown() || document.querySelector('.sheet-back')) return;
    const t = e.touches[0];
    const root = listRoot();
    if (!root.contains(e.target) || e.target.closest('.tabbar') || t.clientX < 20) return;
    tabSwipe.g = { x0: t.clientX, y0: t.clientY, t0: Date.now(), target: e.target, axis: null, dx: 0, x: 0, samples: [], raf: 0, nb: {} };
  },
  { passive: true }
);
document.addEventListener(
  'touchmove',
  (e) => {
    const g = tabSwipe.g;
    if (!g || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - g.x0;
    const dy = t.clientY - g.y0;
    if (!g.axis) {
      if (Math.hypot(dx, dy) < 10) return;
      g.axis = Math.abs(dx) > Math.abs(dy) * 1.2 && !canScroll(g.target, 'x') ? 'x' : 'y';
      if (g.axis === 'x') {
        g.main = tabMain();
        g.i = currentTabIndex();
        if (!g.main || g.i < 0) return void (g.axis = 'y');
        // Layout read once, before anything is written.
        g.box = { left: g.main.offsetLeft, top: g.main.offsetTop, width: g.main.offsetWidth, height: g.main.offsetHeight };
        g.w = g.box.width || innerWidth;
        g.main.style.willChange = 'transform';
        g.pill = tabPill(g);
        g.sub = tabSub(g);
      }
    }
    if (g.axis !== 'x') return;
    if (e.cancelable) e.preventDefault();
    g.dx = dx;
    const dir = dx < 0 ? 1 : -1;
    // The neighbour the finger reveals; none past either end: the rubber band.
    const nb = dx && tabNeighbour(g, dir);
    g.pos = nb ? Math.max(-g.w, Math.min(g.w, dx)) : Motion.rubber(dx, g.w);
    g.samples.push({ t: e.timeStamp, x: t.clientX });
    if (g.samples.length > 12) g.samples.shift();
    // One style write per frame, with the finger.
    if (!g.raf) g.raf = requestAnimationFrame(() => ((g.raf = 0), tabSwipe.g === g && tabFrame(g, g.pos)));
  },
  { passive: false }
);
function tabSwipeEnd(e) {
  const g = tabSwipe.g;
  tabSwipe.g = null;
  if (!g || g.axis !== 'x') return;
  cancelAnimationFrame(g.raf);
  const v = Motion.velocity(g.samples, e && e.timeStamp);
  const want = g.dx <= -TAB_SWIPE_MIN || v <= -TAB_SWIPE_FLICK ? 1 : g.dx >= TAB_SWIPE_MIN || v >= TAB_SWIPE_FLICK ? -1 : 0;
  const dir = want && tabNeighbour(g, want) ? want : 0;
  tabSwipe.anim = g;
  const from = g.pos != null ? g.pos : g.x;
  if (reduced()) return dir ? tabSwipeCommit(g, dir) : tabSwipeDone(g);
  const frame = (x) => tabFrame(g, x);
  if (dir) g.stop = Motion.run(from, v, -dir * g.w, Motion.stiffness(v, Motion.W_GO), frame, () => tabSwipeCommit(g, dir), Motion.GO_EPS);
  else g.stop = Motion.run(from, v, 0, Motion.stiffness(v, Motion.W_BACK), frame, () => tabSwipeDone(g));
}
document.addEventListener('touchend', tabSwipeEnd);
document.addEventListener('touchcancel', tabSwipeEnd);
