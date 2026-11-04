'use strict';
// The fixed app shell and the on-screen keyboard: --app-h / --app-top from the visual viewport, and
// iOS's rubber-band guard.

// ------------------------------------------------------------ app shell and keyboard

// The page never scrolls: #app is a fixed shell and only the regions inside it scroll.
// iOS keeps the layout viewport when the keyboard opens, shrinks the visual one and scrolls
// the page to show the field, which pushed the header off the top. So the shell follows the
// visual viewport (--app-top/--app-h), any page scroll is undone, and a chat or screen that
// was following the bottom stays there. Pinch-zoomed, the layout is left alone.
const vv = window.visualViewport || null;
const mainScroller = () => document.getElementById('ss-body') || document.querySelector('#d-body, #t-body, #app > main, #app > form.panel, #detail-pane > main, #detail-pane > form.panel');
const editable = (el) =>
  Boolean(el) && (el.tagName === 'TEXTAREA' || el.isContentEditable || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'file', 'range', 'color'].includes(el.type)));

function setVar(name, value) {
  const st = document.documentElement.style;
  if (st.getPropertyValue(name) === (value || '')) return false;
  if (value) st.setProperty(name, value);
  else st.removeProperty(name);
  return true;
}

function fit(e) {
  const de = document.documentElement;
  const zoomed = !vv || vv.scale > 1.01;
  // Pinch-zoomed, iOS scrolls the page to keep the focused field in view: undoing that each
  // time made the page jump between two positions twice a second (the shell view, whose
  // 15px field made iOS zoom in). Only an unzoomed page is put back at the top.
  if (!zoomed && (window.scrollY || de.scrollTop || document.body.scrollTop)) window.scrollTo(0, 0);
  const sc = mainScroller();
  // Measured before the shell changes size.
  const pinned = Boolean(sc) && (scr && scr.body === sc ? scr.follow : atBottom(sc));
  // Never taller than the layout viewport (some engines report a stale height at load).
  const h = zoomed ? '' : `${Math.round(Math.min(vv.height, de.clientHeight))}px`;
  const top = zoomed || vv.offsetTop < 0.5 ? '' : `${Math.round(vv.offsetTop)}px`;
  const changed = setVar('--app-h', h) | setVar('--app-top', top);
  de.classList.toggle('kb', !zoomed && de.clientHeight - vv.height > 120 && editable(document.activeElement));
  if (changed && pinned) requestAnimationFrame(() => (sc.scrollTop = sc.scrollHeight));
  if (changed) requestAnimationFrame(placeToasts);
}

if (vv) {
  vv.addEventListener('resize', fit);
  vv.addEventListener('scroll', fit);
}
window.addEventListener('resize', fit);
window.addEventListener('scroll', fit);
window.addEventListener('orientationchange', (e) => {
  fit(e);
  setTimeout(fit, 400);
});
// The keyboard animates in and out; look again once it has settled.
for (const type of ['focusin', 'focusout'])
  document.addEventListener(type, (e) => {
    fit(e);
    setTimeout(fit, 350);
  });

// iOS rubber-bands the whole document on a drag that starts outside a scroller, and drags it
// sideways from inside the screen box. Cancel a touch drag unless something under the finger
// can scroll in that direction (the first move decides the axis); scrollers themselves have
// overscroll-behavior: contain so their edges don't chain to the page. Pinch zoom stays.
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function canScroll(el, axis) {
  for (; el && el.nodeType === 1 && el !== document.body; el = el.parentElement) {
    if (el.matches('textarea, input, select, [contenteditable]')) return true; // caret and selection drags
    const cs = getComputedStyle(el);
    const ov = axis === 'x' ? cs.overflowX : cs.overflowY;
    if ((ov === 'auto' || ov === 'scroll') && (axis === 'x' ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight) > 1) return true;
  }
  return false;
}
if (IOS) {
  let touch = null;
  document.addEventListener(
    'touchstart',
    (e) => {
      const t = e.touches[0];
      touch = e.touches.length === 1 ? { x: t.clientX, y: t.clientY, target: e.target, allow: null } : null;
    },
    { passive: true }
  );
  document.addEventListener(
    'touchmove',
    (e) => {
      if (!touch || e.touches.length !== 1 || (vv && vv.scale > 1.01)) return;
      if (touch.allow == null) {
        const t = e.touches[0];
        const axis = Math.abs(t.clientX - touch.x) > Math.abs(t.clientY - touch.y) ? 'x' : 'y';
        touch.allow = canScroll(touch.target, axis); // a sideways page swipe is tabswipe.js's
      }
      if (!touch.allow && e.cancelable) e.preventDefault();
    },
    { passive: false }
  );
}
