'use strict';

// ------------------------------------------------------------ live state

// EventSource retries a dropped connection by itself, but gives up for good on a non-200
// answer such as the 502 tailscale serve returns while Herdr Hub restarts. Reopen it then,
// and whenever the app comes back to the foreground (iOS suspends home-screen apps).
let stream = null;
let retryTimer = null;
let retryDelay = 1000;
let live = false; // the live stream is open and has sent a state
// A small dot in a detail header while the live stream is down (statuses may be stale).
const liveDot = () => (live ? '' : '<span class="live-dot" role="img" aria-label="실시간 연결 끊김" title="실시간 연결 끊김 — 다시 붙는 중"></span>');

function connect() {
  clearTimeout(retryTimer);
  if (stream) stream.close();
  const es = (stream = new EventSource('/api/stream'));
  lastHeard = Date.now();
  es.addEventListener('ping', () => (lastHeard = Date.now()));
  es.addEventListener('state', (e) => {
    lastHeard = Date.now();
    retryDelay = 1000;
    live = true;
    state = JSON.parse(e.data);

    resolveReady();
    onState();
  });
  es.onerror = () => {
    state = { ...state, herdr: 'offline' };
    live = false;
    if (listShown()) render();
    if (view.name === 'agent') renderDetailHeader();
    if (view.name === 'term') renderTerminalHeader();
    if (es.readyState === EventSource.CLOSED && es === stream) {
      retryTimer = setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 15000);
    }
  };
}

// iOS suspends a home-screen app in the background and can hand the stream back still marked
// OPEN though its socket is dead, so readyState can't be trusted. The hub pings every 15s: when
// nothing has arrived for a while, or the app comes back to the foreground, open a fresh stream.
let lastHeard = 0;
const STALE_MS = 35000;
function revive(reason) {
  if (stream && stream.readyState === EventSource.OPEN && Date.now() - lastHeard < (reason === 'watchdog' ? STALE_MS : 4000)) return;
  live = false;
  if (listShown()) render();
  retryDelay = 1000;
  connect();
}
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && revive('visible'));
window.addEventListener('pageshow', (e) => e.persisted && revive('pageshow'));
window.addEventListener('online', () => revive('online'));
setInterval(() => document.visibilityState === 'visible' && revive('watchdog'), 10000);

function onState() {
  if (split) {
    renderCol();
    if (!isDetail()) return renderEmpty();
  } else if (view.name === 'list') return render();
  if (view.name === 'ws') return renderWorkspace();
  if (view.name === 'settings') return renderSettings();
  if (view.name === 'term') {
    renderTerminalHeader();
    if (!detail.screen) loadTerminal(); // a pane opened just now appears with this state
  }
  if (view.name === 'agent') {
    const a = currentAgent();
    const changed = a && a.stateSeq !== detail.lastSeq;
    // The screen read for the previous state must not label buttons for the next prompt.
    if (changed && detail.lastSeq !== -1) detail.blockedText = null;
    renderDetailHeader();
    markSeen(a);
    if (changed) {
      detail.lastSeq = a.stateSeq;
      loadDetail();
    }
  }
}

const currentAgent = () => state.agents.find((a) => same(a, curHost(), detail.pane));

// ------------------------------------------------------------ routing

// Where each history entry came from (history.state.prev), so 뒤로 can go back to the list
// instead of stacking a new entry (an iOS edge swipe would then re-enter the agent).
let lastHash = null;
const normHash = (h) => String(h || '').replace(/^#/, '') || '/';
function goBack(target) {
  const st = history.state;
  if (st && st.prev != null && normHash(st.prev) === normHash(target)) history.back();
  else {
    history.replaceState({ prev: null }, '', target);
    route();
  }
}

// Unsent text and photos per agent (host|pane), kept while the page lives.
const drafts = new Map();
function stashDraft() {
  if (view.name !== 'agent' || !detail.pane) return;
  const input = document.getElementById('d-input');
  const text = input ? input.value : '';
  const key = rowKey(curHost(), detail.pane);
  if (text.trim() || (detail.files && detail.files.length)) drafts.set(key, { text, files: detail.files });
  else drafts.delete(key);
}

// relayout: the same route drawn again for the other layout (the screen crossed the split
// width); an open agent keeps what it had loaded and its terminal sheet.
function route(e, { relayout = false } = {}) {
  if (!history.state || !('prev' in history.state)) history.replaceState({ ...(history.state || {}), prev: lastHash }, '');
  lastHash = location.hash || '#/';
  if (!relayout) stashDraft(); // relayout() kept it before the old composer went away
  const was = relayout ? { view, detail, sheet: Boolean(detail.sheet) } : null;
  clearInterval(pollTimer);
  clearInterval(tickTimer);
  tickTimer = null;
  closeScreenSheet();
  if (split) closeRow(); // the list stays on screen: don't leave a row slid open
  swipe.open = swipe.g = null;
  setTimeout(() => fit({ type: 'route' }), 0);
  scr = null;
  let h = location.hash.replace(/^#/, '') || '/';
  // The app opens on the tab it was left on.
  if (!routed && h === '/' && getTab() === 'spaces') {
    history.replaceState(history.state, '', '#/spaces');
    lastHash = '#/spaces';
    h = '/spaces';
  }
  routed = true;
  // The route as data (route.js); the views below keep the shapes they always had.
  const r = Route.parse(h);
  const host = r.host;
  if (r.name === 'agent') {
    // An agent always shows its chat. …/screen (the old 화면 tab) opens the terminal sheet over it.
    const pane = r.pane;
    view = { name: 'agent', host };
    const draft = drafts.get(rowKey(curHost(), pane));
    detail = { host, pane, transcript: null, screen: null, blockedText: null, lastSeq: -1, files: draft ? draft.files : [], sheet: null, wantSheet: r.sub === 'screen', activity: null };
    if (was && was.view.name === 'agent' && was.detail.pane === pane && (was.view.host || localId()) === curHost()) {
      const d = was.detail;
      Object.assign(detail, { transcript: d.transcript, blockedText: d.blockedText, lastSeq: d.lastSeq, mode: d.mode, activity: d.activity, seen: d.seen, lock: d.lock, answerMode: d.answerMode, showScreen: d.showScreen, showKeys: d.showKeys, openTools: d.openTools, openShell: d.openShell, wantSheet: was.sheet });
    }
    if (r.sub) history.replaceState(history.state, '', location.hash.replace(/\/(?:screen|chat)$/, ''));
    renderDetail();
    if (draft) {
      document.getElementById('d-input').value = draft.text;
      renderTray();
    }
    loadDetail();
    closeNotes(curHost(), pane);
    ready.then(() => view.name === 'agent' && detail.pane === pane && markSeen(currentAgent()));
    pollTimer = setInterval(() => {
      const a = currentAgent();
      // Also retry a screen read that failed, whatever the status; the sheet keeps reading while open.
      if (a && (a.status === 'working' || a.status === 'blocked' || detail.sheet || (scr && scr.error))) loadDetail();
    }, 3000);
  } else if (r.name === 'term') {
    view = { name: 'term', host, pane: r.pane };
    detail = { host, pane: view.pane, screen: null };
    renderTerminal();
    loadTerminal();
    pollTimer = setInterval(pollTerminal, TERM_TICK_MS);
  } else if (r.name === 'ws') {
    view = { name: 'ws', host, id: r.id };
    renderWorkspace();
  } else if (r.name === 'form') {
    view = r.mode === 'new' ? { name: 'form', mode: 'new', host } : { name: 'form', mode: r.mode, host, target: r.target };
    renderForm();
  } else if (r.name === 'settings') {
    view = { name: 'settings' };
    if (split) colTab = 'settings';
    renderSettings();
  } else {
    view = { name: 'list', tab: r.tab };
    setTab(view.tab);
    if (split) colTab = view.tab;
    render();
  }
  if (split) {
    if (isDetail()) renderCol();
    else renderEmpty();
  }
}

// ---- split layout: the shell, the list column, the placeholder, the selected row

// Build #app for the current layout and draw the route into it again. Called when the screen
// crosses the split width (rotation, resize, DeX or split-screen windows); the focus goes back
// to the composer or the shell's input when it was there.
function relayout() {
  const want = splitMq.matches;
  if (want === split) return;
  const f = document.activeElement;
  const refocus = f && ['d-input', 't-input'].includes(f.id) ? f.id : null;
  stashDraft();
  split = want;
  colTab = split ? (view.name === 'list' ? view.tab : view.name === 'settings' ? 'settings' : getTab()) : null;
  document.documentElement.classList.toggle('split', split);
  $app.innerHTML = split ? '<div class="col" id="list-pane"></div><div class="col" id="detail-pane"></div>' : '';
  route(null, { relayout: true });
  const el = refocus && document.getElementById(refocus);
  if (el) {
    el.focus({ preventScroll: true });
    if (el.isContentEditable) caretToEnd(el);
  }
}

// The list column: 설정 or the list of the tab it shows.
function renderCol() {
  if (colTab === 'settings') renderSettings();
  else render();
}

// Nothing open on the right: a calm placeholder, with a way to what is waiting.
function renderEmpty() {
  const root = detailRoot();
  if (!root) return;
  const blocked = state.agents.filter((a) => a.status === 'blocked' && shown(a));
  const first = blocked[0];
  const html = `<div class="empty-detail">
      <span class="ed-ic" aria-hidden="true">${ICON.panel}</span>
      <h2>왼쪽에서 에이전트를 고르세요</h2>
      ${first ? `<a class="ed-attn" href="${link(first.host, `/agent/${encodeURIComponent(first.pane)}`)}">답 필요 ${blocked.length} · ${esc(first.name || first.title)} 열기</a>` : ''}
      <p class="ed-keys"><kbd>Alt</kbd> + <kbd>↑</kbd> <kbd>↓</kbd> 또는 <kbd>[</kbd> <kbd>]</kbd> 로 목록을 옮겨 다니고, <kbd>Esc</kbd> 로 닫습니다.</p>
    </div>`;
  const cur = root.firstElementChild;
  if (cur && cur.classList.contains('empty-detail') && cur._html === html) return;
  root.innerHTML = html;
  root.firstElementChild._html = html;
}

// The row of what is open on the right, marked in the list (aria-current) so it stands out.
function markSelected() {
  const main = split && listRoot() && listRoot().querySelector(':scope > main.home');
  if (!main) return;
  const kind = view.name === 'agent' ? 'agent' : view.name === 'term' ? 'term' : view.name === 'ws' ? 'ws' : null;
  const id = kind === 'ws' ? view.id : detail.pane;
  const on = new Set();
  if (kind)
    for (const row of main.querySelectorAll(`[data-kind="${kind}"]`))
      if (row.dataset.id === id && (row.dataset.host || localId()) === curHost()) on.add(row.querySelector(':scope > a, :scope > .sw-front'));
  for (const el of main.querySelectorAll('[aria-current]')) if (!on.has(el)) el.removeAttribute('aria-current');
  for (const el of on) if (el) el.setAttribute('aria-current', 'page');
}

// Alt+↑/↓ (or [ ]): the previous or next agent or shell in the list column, opened on the right.
function stepList(dir) {
  const main = listRoot() && listRoot().querySelector(':scope > main.home');
  if (!main) return false;
  const links = [...main.querySelectorAll('a.attn-row, a.sw-front')].map((a) => a.getAttribute('href'));
  const cur = main.querySelector('a[aria-current]');
  const next = Split.stepRow(links, cur && cur.getAttribute('href'), dir);
  if (!next) return true;
  location.hash = next;
  const el = [...main.querySelectorAll('a.attn-row, a.sw-front')].find((a) => a.getAttribute('href') === next);
  if (el) el.scrollIntoView({ block: 'nearest' });
  return true;
}

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
  viewportDiag(e && e.type ? e.type : 'timer');
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
        // A list row slides sideways itself (rowTouchMove), so it counts as scrollable on x.
        touch.allow = canScroll(touch.target, axis) || (axis === 'x' && Boolean(touch.target.closest && touch.target.closest('main.home .sw')));
      }
      if (!touch.allow && e.cancelable) e.preventDefault();
    },
    { passive: false }
  );
}

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

// ------------------------------------------------------------ boot

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  // A tapped notification while the app is open: just the route changes (sw.js).
  navigator.serviceWorker.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.type !== 'open' || typeof d.url !== 'string') return;
    let u;
    try {
      u = new URL(d.url, location.origin);
    } catch {
      return;
    }
    if (u.origin !== location.origin) return;
    const hash = u.hash || '#/';
    if (hash !== location.hash) location.hash = hash;
  });
}
window.addEventListener('hashchange', route);
// Links marked data-back go back in history when that is where they lead (see goBack).
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[data-back]');
  if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
  e.preventDefault();
  goBack(a.getAttribute('href'));
});
// Keyboard: Escape closes the top sheet or menu, else leaves a field, else goes back;
// "/" puts the caret in the composer (or the shell's command line).
document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.isComposing) return;
  if (e.key === 'Escape') {
    const top = topLayer();
    if (top) {
      e.preventDefault();
      return closeLayer(top);
    }
    if (swipe.open) return closeRow();
    if (editable(document.activeElement)) return document.activeElement.blur();
    const back = view.name !== 'list' && $app.querySelector('a[data-back]');
    if (back) {
      e.preventDefault();
      goBack(back.getAttribute('href'));
    }
    return;
  }
  if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !topLayer() && !editable(document.activeElement)) {
    const f = document.getElementById('d-input') || document.getElementById('t-input');
    if (!f || f.disabled) return;
    e.preventDefault();
    f.focus();
    // At the end of what is there.
    if (f.isContentEditable) caretToEnd(f);
    return;
  }
  // Split: Alt+↑/↓ or [ ] open the previous or next row of the list on the right (split.js
  // says which keys count; never while the shell's input has the focus).
  if (split) {
    const a = document.activeElement;
    const dir = Split.listKey(e, { editable: editable(a), shell: Boolean(a && a.id === 't-input'), layer: Boolean(topLayer()) });
    if (dir && stepList(dir === 'next' ? 1 : -1)) e.preventDefault();
  }
});
// Split: a tab press while a detail is open changes only the list column (홈 / 작업공간 /
// 설정); the detail stays. With nothing open it is an ordinary link to that tab's route.
document.addEventListener('click', (e) => {
  const a = split && e.target.closest && e.target.closest('#list-pane .tabbar a.tab');
  if (!a || !isDetail() || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
  e.preventDefault();
  const h = a.getAttribute('href');
  colTab = h === '#/settings' ? 'settings' : h === '#/spaces' ? 'spaces' : 'home';
  if (colTab !== 'settings') setTab(colTab);
  renderCol();
  // ✕ in the detail header leads to where the list column now is.
  const close = detailRoot().querySelector('a.close-detail');
  if (close) close.setAttribute('href', homeHash());
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && view.name === 'agent') loadDetail();
});
splitMq.addEventListener('change', relayout);
connect();
if (splitMq.matches) relayout();
else route();
