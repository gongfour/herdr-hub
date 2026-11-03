'use strict';
// Viewport diagnostics (temporary): snapshots to the hub's data/viewport.log, behind the 설정 switch
// 화면 진단 보내기. To remove it: this file and its script tag, the calls marked "diag.js" (fit()
// in viewport.js, the composer's paste handler in agent.js, 설정 in settings.js), and
// /api/debug/viewport with lib/viewport-log.js on the server.

// ---- viewport diagnostics: snapshots to the hub's data/viewport.log (settings switch)

const DIAG_KEY = 'herdr-hub.vpdiag';
let memDiag = false;
function diagOn() {
  try {
    return localStorage.getItem(DIAG_KEY) === '1'; // off unless switched on
  } catch {
    return memDiag;
  }
}
function setDiag(on) {
  memDiag = on;
  try {
    localStorage.setItem(DIAG_KEY, on ? '1' : '0');
  } catch {
    /* private mode: lasts until reload */
  }
}

const DIAG_MS = 500; // at most two a second
let diagLast = '';
let diagAt = 0;
let diagTimer = null;
let diagReason = '';

function viewportSnapshot(reason) {
  const de = document.documentElement;
  const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r1(r.top), bottom: r1(r.bottom), height: r1(r.height) };
  };
  const a = document.activeElement;
  return {
    reason,
    route: location.hash || '#/',
    innerHeight: window.innerHeight,
    clientHeight: de.clientHeight,
    vvHeight: vv && r1(vv.height),
    offsetTop: vv && r1(vv.offsetTop),
    pageTop: vv && r1(vv.pageTop),
    scale: vv && r1(vv.scale),
    scrollY: r1(window.scrollY),
    scrollingTop: r1((document.scrollingElement || de).scrollTop),
    appH: de.style.getPropertyValue('--app-h') || null,
    appTop: de.style.getPropertyValue('--app-top') || null,
    kb: de.classList.contains('kb'),
    header: rect(document.querySelector('#app .bar')),
    composer: rect(document.querySelector('#app .composer')),
    scroller: rect(mainScroller()),
    focused: a && a !== document.body ? `${a.tagName.toLowerCase()}${a.id ? `#${a.id}` : ''}` : null,
    standalone: Boolean(navigator.standalone || window.matchMedia('(display-mode: standalone)').matches),
    userAgent: navigator.userAgent,
    ts: Date.now(),
  };
}

// One line per paste: what the clipboard offered (types and sizes, never the content).
function pasteDiag(e) {
  if (!diagOn()) return;
  const dt = e.clipboardData;
  const snap = {
    reason: 'paste',
    route: location.hash || '#/',
    types: dt ? [...dt.types] : null,
    items: dt && dt.items ? [...dt.items].map((it) => ({ kind: it.kind, type: it.type })) : null,
    fileCount: dt && dt.files ? dt.files.length : null,
    files: dt && dt.files ? [...dt.files].map((f) => ({ type: f.type, size: f.size })) : null,
    target: e.target && e.target.id ? e.target.id : null,
    standalone: Boolean(navigator.standalone || window.matchMedia('(display-mode: standalone)').matches),
    userAgent: navigator.userAgent,
    ts: Date.now(),
  };
  fetch('/api/debug/viewport', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Herdr-Hub': '1' }, body: JSON.stringify(snap), keepalive: true }).catch(() => {});
}

// Throttled, and only when something but the reason and time changed. Always to the hub
// itself (never a peer path): the log is the hub's.
function viewportDiag(reason) {
  if (!diagOn()) return;
  diagReason = reason;
  if (diagTimer) return;
  diagTimer = setTimeout(() => {
    diagTimer = null;
    const snap = viewportSnapshot(diagReason);
    const key = JSON.stringify({ ...snap, reason: 0, ts: 0 });
    if (key === diagLast) return;
    diagLast = key;
    diagAt = Date.now();
    fetch('/api/debug/viewport', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Herdr-Hub': '1' }, body: JSON.stringify(snap), keepalive: true }).catch(() => {});
  }, Math.max(0, DIAG_MS - (Date.now() - diagAt)));
}
