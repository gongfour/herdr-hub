'use strict';
// Back into the chat just left (forward.js decides; this file draws and listens).
// 「방금 본 대화」 chip: leaving an agent or a shell for the 작업공간 list on the phone (back swipe,
// ‹, Esc) puts a small chip above the tab bar, 「방금 본 대화 · <name> ›」 (셸: 「방금 본 셸」). A tap
// opens it again as its row would (a new history entry: back from there is the list again). It
// goes after CHIP_MS, once the list is scrolled CHIP_SCROLL px, when anything else opens, or by
// its ✕ or a swipe down. While it stands the list has room under its last row. Split has the
// list beside the detail and no chip. Alt+` (lastView) from the list opens the same one.
// Right-edge swipe (pref edgeForward: on for iOS, off elsewhere, as Android's gesture navigation
// takes both edges for Back): on the phone's list, a right-to-left drag that starts within EDGE px
// of the right edge goes forward into it, the back swipe mirrored. The chat is opened at once,
// off the screen to the right, over the list kept behind it (backswipe.js peekBuild: dimmed, a
// little to the left), and follows the finger; past BACK_SWIPE_MIN px (or a quick flick) it
// springs into place, else it springs back out and the route goes back to the list. With nothing
// to go forward to, the drag from the edge is an ordinary host swipe (tabswipe.js asks
// forwardEdge first).

const fwd = { target: null, shownAt: null, top0: 0, dismissed: true, el: null, html: '', timer: 0, g: null };

const fwdHash = (t) => link(t.host || localId(), `/${t.kind}/${encodeURIComponent(t.pane)}`);
// The agent or shell it points at, still there (else nothing to go forward to).
function fwdItem(t = fwd.target) {
  if (!t) return null;
  const host = t.host || localId();
  return (t.kind === 'agent' ? state.agents : state.terminals || []).find((x) => same(x, host, t.pane)) || null;
}
const fwdTarget = () => (fwdItem() ? fwd.target : null);

// A route change (app.js route, last thing): what there is to go forward to, and the chip.
function forwardRouted(from, to, relayout) {
  if (!relayout) {
    const t = Forward.nextTarget(fwd.target, from, to);
    const left = to.name === 'list' && t && t !== fwd.target;
    fwd.target = t;
    fwd.dismissed = !left; // the chip comes only as an agent or shell is left
    if (left) {
      fwd.shownAt = Date.now();
      const main = tabMain();
      fwd.top0 = main ? main.scrollTop : 0;
    }
  }
  syncChip();
}

function chipLive() {
  if (split || view.name !== 'list' || !fwdItem()) return false;
  const main = tabMain();
  const scrolled = main ? main.scrollTop - fwd.top0 : 0;
  return Forward.chipLive({ target: fwd.target, shownAt: fwd.shownAt, now: Date.now(), scrolled, dismissed: fwd.dismissed });
}

function chipHtml() {
  const t = fwd.target;
  const x = fwdItem();
  const name = rowLabel(t.kind, x);
  const what = t.kind === 'agent' ? '방금 본 대화' : '방금 본 셸';
  return `<button type="button" class="fwd-go" aria-label="${esc(`${what} 다시 열기: ${name}`)}"${keyAttrs('lastView', '다시 열기')}>
      <span class="fwd-ic" aria-hidden="true">${t.kind === 'agent' ? agentIcon(x) : ICON.term}</span>
      <span class="fwd-k">${what}</span><span class="fwd-name">${esc(name)}</span>
      <span class="fwd-arrow" aria-hidden="true">${ICON.back}</span>
    </button>
    <button type="button" class="fwd-x" aria-label="${what} 알림 닫기">${ICON.x}</button>`;
}

// The chip as it should be now: drawn, refreshed (a rename), or gone.
function syncChip() {
  clearTimeout(fwd.timer);
  if (!chipLive()) return void hideChip();
  const html = chipHtml();
  if (!fwd.el) {
    const el = document.createElement('div');
    el.className = 'fwd-chip';
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', '방금 본 대화');
    document.body.appendChild(el);
    fwd.el = el;
    bindChip(el);
    document.documentElement.classList.add('fwd-on');
  }
  if (fwd.html !== html) fwd.el.innerHTML = fwd.html = html;
  fwd.timer = setTimeout(syncChip, Math.max(50, fwd.shownAt + Forward.CHIP_MS - Date.now()));
}
function hideChip() {
  const el = fwd.el;
  if (!el) return;
  fwd.el = null;
  fwd.html = '';
  clearTimeout(fwd.timer);
  document.documentElement.classList.remove('fwd-on');
  if (document.activeElement && el.contains(document.activeElement)) {
    const main = tabMain();
    if (main) main.focus({ preventScroll: true });
  }
  if (reduced()) return el.remove();
  el.classList.add('closing');
  el.inert = true;
  setTimeout(() => el.remove(), 200);
}
function dismissChip() {
  fwd.dismissed = true;
  hideChip();
}

// Into it again: as its row is opened (hashchange → route).
function openForward() {
  const t = fwdTarget();
  if (!t) return false;
  location.hash = fwdHash(t);
  return true;
}

function bindChip(el) {
  el.addEventListener('click', (e) => {
    if (e.target.closest('.fwd-x')) dismissChip();
    else if (e.target.closest('.fwd-go')) openForward();
  });
  // A swipe down sends it away; it follows the finger down (never up).
  let s = null;
  el.addEventListener('touchstart', (e) => (s = e.touches.length === 1 ? { y0: e.touches[0].clientY, x0: e.touches[0].clientX, dy: 0, on: false, samples: [] } : null), { passive: true });
  el.addEventListener(
    'touchmove',
    (e) => {
      if (!s || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dy = t.clientY - s.y0;
      if (!s.on) {
        if (Math.hypot(dy, t.clientX - s.x0) < 8) return;
        if (!(dy > 0 && dy > Math.abs(t.clientX - s.x0))) return void (s = null);
        s.on = true;
        el.classList.add('dragging');
      }
      if (e.cancelable) e.preventDefault();
      s.dy = Math.max(0, dy);
      s.samples.push({ t: e.timeStamp, x: t.clientY });
      if (s.samples.length > 8) s.samples.shift();
      el.style.setProperty('--fwd-dy', `${s.dy}px`);
      el.style.opacity = String(Math.max(0.2, 1 - s.dy / 80));
    },
    { passive: false }
  );
  const end = (e) => {
    const g = s;
    s = null;
    if (!g || !g.on) return;
    el.classList.remove('dragging');
    if (g.dy > 36 || Motion.velocity(g.samples, e.timeStamp) > 0.4) return void dismissChip();
    el.style.removeProperty('--fwd-dy');
    el.style.opacity = '';
  };
  el.addEventListener('touchend', end);
  el.addEventListener('touchcancel', end);
}

// The list scrolled far enough (either way): the chip goes.
document.addEventListener(
  'scroll',
  (e) => {
    if (fwd.el && e.target && e.target.matches && e.target.matches('main.home') && !chipLive()) dismissChip();
  },
  true
);

// ---- the right-edge swipe

// A touch at x on the list starts the forward swipe (tabswipe.js leaves it alone then).
function forwardEdge(x) {
  return Forward.edgeStart({ x, width: innerWidth, on: Prefs.get('edgeForward'), target: fwdTarget(), listView: view.name === 'list' && !topLayer() && !document.querySelector('.sheet-back'), split });
}

// The chat is in: everything back as it was, the list kept behind as list.js keeps it.
const fwdSwipeDone = (g) => backSwipeDone(g);

document.addEventListener(
  'touchstart',
  (e) => {
    fwd.g = null;
    if (e.touches.length !== 1 || backSwipe.anim || tabSwipe.anim) return;
    const t = e.touches[0];
    if (!forwardEdge(t.clientX) || !listRoot().contains(e.target) || e.target.closest('.tabbar')) return;
    fwd.g = { x0: t.clientX, y0: t.clientY, t0: Date.now(), axis: null, dx: 0, samples: [], raf: 0, parts: [], target: fwdTarget() };
  },
  { passive: true }
);
document.addEventListener(
  'touchmove',
  (e) => {
    const g = fwd.g;
    if (!g || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - g.x0;
    const dy = t.clientY - g.y0;
    if (!g.axis) {
      if (Math.hypot(dx, dy) < 10) return;
      g.axis = dx < 0 && -dx > Math.abs(dy) * 1.2 ? 'x' : 'no';
      if (g.axis !== 'x') return void (fwd.g = null);
      if (!reduced()) fwdOpen(g);
    }
    if (e.cancelable) e.preventDefault();
    g.dx = Math.min(0, dx);
    g.samples.push({ t: e.timeStamp, x: t.clientX });
    if (g.samples.length > 12) g.samples.shift();
    if (g.parts.length && !g.raf) g.raf = requestAnimationFrame(() => ((g.raf = 0), fwd.g === g && backFrame(g, Math.max(0, g.w + g.dx))));
  },
  { passive: false }
);
// Open the chat now, in this task, and put it off the screen to the right over the kept list
// before anything is painted: from here the back swipe's frame (backFrame) draws it.
function fwdOpen(g) {
  hideChip();
  history.pushState(null, '', fwdHash(g.target));
  route();
  const root = detailRoot();
  g.parts = backParts(root);
  g.w = root.clientWidth || innerWidth;
  g.peek = peekBuild(root);
  for (const el of g.parts) {
    el.classList.add('bs-front');
    el.style.willChange = 'transform';
  }
  backSwipe.anim = g; // state updates wait (backSwipeBusy), a back swipe can't start, a route releases it
  backFrame(g, g.w);
}
function fwdEnd(e) {
  const g = fwd.g;
  fwd.g = null;
  if (!g || g.axis !== 'x') return;
  cancelAnimationFrame(g.raf);
  const v = Motion.velocity(g.samples, e && e.timeStamp); // px/ms, negative: leftward
  const go = -g.dx >= BACK_SWIPE_MIN || v <= -BACK_SWIPE_FLICK;
  if (!g.parts.length) return void (go && openForward()); // reduced motion: no drag, just the route
  if (backSwipe.anim !== g) return; // a route came in between and put it back
  const from = Math.max(0, g.w + g.dx);
  if (go) {
    if (reduced()) return fwdSwipeDone(g);
    g.stop = Motion.run(from, v, 0, Motion.stiffness(v, Motion.W_GO), (x) => backFrame(g, x), () => fwdSwipeDone(g));
    return;
  }
  // Not far enough: back out to the right, and back to the list.
  if (reduced()) return backFrame(g, g.w), backSwipeGo(g, homeHash());
  g.stop = Motion.run(from, v, g.w, Motion.stiffness(v, Motion.W_BACK), (x) => backFrame(g, x), () => backSwipeGo(g, homeHash()), Motion.GO_EPS);
}
document.addEventListener('touchend', fwdEnd);
document.addEventListener('touchcancel', fwdEnd);
