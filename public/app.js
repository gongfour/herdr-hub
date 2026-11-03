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

// Cards for the workspace view (agents and shells of one workspace).
function termCard(t) {
  return `<a class="card" href="${link(t.host, `/term/${encodeURIComponent(t.pane)}`)}">
    <div class="main">
      <div class="title">${esc(termTitle(t))}</div>
      <div class="meta">${hostChip(t)}셸 · ${esc(t.workspaceLabel)} · ${esc(basename(t.cwd))}</div>
    </div>
    <span class="badge idle">셸</span>
  </a>`;
}

function card(a) {
  return `<a class="card" href="${link(a.host, `/agent/${encodeURIComponent(a.pane)}`)}">
    <div class="main">
      <div class="title">${esc(agentTitle(a))}</div>
      <div class="meta">${hostChip(a)}${esc(a.agent)} · ${esc(wsAndDir(a.workspaceLabel, a.cwd))}</div>
    </div>
    ${timeTag(a)}
    <span class="badge ${esc(a.status)}">${esc(STATUS_LABEL[a.status] || a.status)}</span>
  </a>`;
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

// ------------------------------------------------------------ workspace view

function renderWorkspace() {
  const host = curHost();
  const w = (state.workspaces || []).find((x) => same(x, host, view.id, 'workspace_id'));
  const agents = state.agents.filter((a) => same(a, host, view.id, 'workspace'));
  const terms = (state.terminals || []).filter((t) => same(t, host, view.id, 'workspace'));
  const id = encodeURIComponent(view.id);
  const missing = !online(host) ? `${esc(hostLabel(host))} 오프라인` : '닫혔거나 찾을 수 없습니다';
  detailRoot().innerHTML = `
    <header class="bar">
      ${backLink(homeHash())}
      <h1>${w ? esc(w.label) : '워크스페이스 없음'}<span class="sub">${w ? `${multi() ? `${esc(hostLabel(host))} · ` : ''}${esc(w.workspace_id)} · 탭 ${w.tab_count} · 에이전트 ${agents.length} · 셸 ${terms.length}` : missing}</span></h1>
    </header>
    <main class="list">
      ${w ? `
      <div class="row">
        <a class="btn" href="${link(host, `/start/ws/${id}`)}">에이전트 시작</a>
        <button type="button" class="btn secondary" id="w-tab">새 탭</button>
        <button type="button" class="btn secondary" id="w-rename">이름 바꾸기</button>
      </div>
      ${agents.length ? `<section class="group"><h2>에이전트 · ${agents.length}</h2><div class="cards">${agents.map(card).join('')}</div></section>` : ''}
      ${terms.length ? `<section class="group"><h2>셸 · ${terms.length}</h2><div class="cards">${terms.map(termCard).join('')}</div></section>` : ''}
      <section class="group danger-zone"><button type="button" class="btn secondary danger-text wide" id="w-close">워크스페이스 닫기</button></section>` : ''}
    </main>`;
  if (!w) return;
  tickList();
  document.getElementById('w-tab').onclick = () => newTab(w);
  document.getElementById('w-rename').onclick = () => renameWorkspace(w);
  document.getElementById('w-close').onclick = () => closeWorkspace(w);
}

// ------------------------------------------------------------ new workspace / start agent

async function renderForm() {
  await ready; // the host list and ids come with the first state
  if (view.name !== 'form') return;
  const isNew = view.mode === 'new';
  const host = curHost();
  const ws = view.mode === 'ws' ? (state.workspaces || []).find((x) => same(x, host, view.target, 'workspace_id')) : null;
  const term = view.mode === 'pane' ? (state.terminals || []).find((t) => same(t, host, view.target)) : null;
  const on = isNew ? '' : multi() ? ` · ${hostLabel(host)}` : '';
  const where = isNew ? '' : ws ? `${ws.label} 워크스페이스의 새 탭${on}` : term ? `${termTitle(term)} 셸 (${term.workspaceLabel})${on}` : '찾을 수 없음';
  const back = isNew ? homeHash() : ws ? link(host, `/ws/${encodeURIComponent(ws.workspace_id)}`) : term ? link(host, `/term/${encodeURIComponent(term.pane)}`) : homeHash();
  detailRoot().innerHTML = `
    <header class="bar">
      ${backLink(back, '뒤로')}
      <h1>${isNew ? '새 워크스페이스' : '에이전트 시작'}${where ? `<span class="sub">${esc(where)}</span>` : ''}</h1>
    </header>
    <form class="panel" id="f-form">
      ${isNew ? `
      <section>
        ${multi() ? `
        <h2>호스트</h2>
        <select class="field" id="f-host">${hosts().map((x) => `<option value="${esc(x.id)}" ${x.id === host ? 'selected' : ''} ${x.online ? '' : 'disabled'}>${esc(x.label)}${x.online ? '' : ' (오프라인)'}</option>`).join('')}</select>` : ''}
        <h2>폴더</h2>
        <div class="picked" id="f-picked" aria-live="polite"></div>
        <div class="dir-rows" id="f-recent"></div>
        <button type="button" class="btn secondary wide" id="f-browse">폴더 찾아보기</button>
        <details class="manual" id="f-manual">
          <summary>경로 직접 입력</summary>
          <input class="field" id="f-cwd" list="f-cwds" autocomplete="off" autocapitalize="off" spellcheck="false">
          <datalist id="f-cwds"></datalist>
        </details>
        <h2>이름 (선택)</h2>
        <input class="field" id="f-label" placeholder="폴더 이름" autocomplete="off">
        <label class="check"><input type="checkbox" id="f-with" checked> 에이전트도 바로 시작</label>
      </section>` : ''}
      <section id="f-agent">
        <h2>에이전트</h2>
        <select class="field" id="f-kind"></select>
        <h2>인자 (선택)</h2>
        <input class="field" id="f-args" placeholder="--model haiku" autocomplete="off" autocapitalize="off" spellcheck="false">
        <h2>이름 (선택)</h2>
        <input class="field" id="f-name" placeholder="비우면 폴더·워크스페이스 이름" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="f-name-hint">
        <p class="hint" id="f-name-hint" aria-live="polite"></p>
        ${isNew ? '<p>새 폴더에서 Claude 를 처음 띄우면 폴더 신뢰 질문이 나옵니다. 에이전트 화면에 나오는 버튼으로 답하세요.</p>' : ''}
      </section>
      <div class="row end"><button type="submit" class="btn" id="f-submit" disabled>${isNew ? '만들기' : '시작'}</button></div>
    </form>`;
  const withAgent = document.getElementById('f-with');
  if (withAgent) withAgent.onchange = () => (document.getElementById('f-agent').hidden = !withAgent.checked);
  const fname = document.getElementById('f-name');
  fname.oninput = () => {
    const hint = agentNameHint(fname.value);
    document.getElementById('f-name-hint').textContent = hint;
    fname.setAttribute('aria-invalid', String(Boolean(hint)));
  };
  document.getElementById('f-form').onsubmit = submitForm;
  const pick = document.getElementById('f-host');
  if (pick) pick.onchange = () => fillForm(pick.value);
  if (isNew) {
    const cwd = document.getElementById('f-cwd');
    cwd.oninput = () => showPicked();
    document.getElementById('f-browse').onclick = () => browseDirs(view.formHost || host);
  }
  if (isNew || ws || term) fillForm(host);
}

// ---- folder choice: recent rows, a browser sheet, or a typed path

let browseAt = { host: null, path: null }; // where the browser was left, per form host
const RECENT_SHOWN = 5;

function pickCwd(p) {
  const cwd = document.getElementById('f-cwd');
  if (!cwd) return;
  cwd.value = p;
  showPicked();
}

function showPicked() {
  const p = (document.getElementById('f-cwd')?.value || '').trim();
  const box = document.getElementById('f-picked');
  if (!box) return;
  box.classList.toggle('on', Boolean(p));
  box.innerHTML = p ? `<span class="k">선택됨</span><b>${esc(basename(p))}</b><span class="p">${esc(p)}</span>` : '<span class="k">아래에서 폴더를 고르세요</span>';
  document.getElementById('f-label').placeholder = p ? basename(p) : '폴더 이름';
  document.querySelectorAll('#f-recent .dir-row').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cwd === p)));
}

function renderRecent(list, all = false) {
  const box = document.getElementById('f-recent');
  if (!box) return;
  const rows = all ? list : list.slice(0, RECENT_SHOWN);
  box.innerHTML = rows.length
    ? `<div class="dir-cap">최근 폴더</div>${rows.map((c) => `<button type="button" class="dir-row" data-cwd="${esc(c)}"><b>${esc(basename(c))}</b><span>${esc(c)}</span></button>`).join('')}${
        list.length > rows.length ? `<button type="button" class="dir-more" id="f-more">${list.length - rows.length}개 더 보기</button>` : ''
      }`
    : '';
  box.querySelectorAll('.dir-row').forEach((b) => (b.onclick = () => pickCwd(b.dataset.cwd)));
  const more = document.getElementById('f-more');
  if (more) more.onclick = () => renderRecent(list, true);
  showPicked();
}

// A tall sheet over the form: breadcrumb, shortcuts, subfolders, and a sticky footer.
async function browseDirs(host) {
  let info;
  try {
    info = await hostInfo(host);
  } catch (err) {
    return toast(`불러오지 못했습니다: ${errText(err)}`);
  }
  if (browseAt.host !== host) browseAt = { host, path: null };
  const start = (document.getElementById('f-cwd')?.value || '').trim();
  const el = document.createElement('div');
  el.className = 'sheet-back';
  el.innerHTML = `<div class="sheet browser" role="dialog" aria-modal="true" aria-label="폴더 찾아보기">
      <div class="browser-head">
        <h2>폴더 찾아보기${multi() ? `<span class="sub">${esc(hostLabel(host))}</span>` : ''}</h2>
        <button type="button" class="icon-btn" data-close aria-label="닫기">${ICON.x}</button>
      </div>
      <div class="chips places">${(info.places || []).map((p) => `<button type="button" class="chip" data-go="${esc(p.path)}" title="${esc(p.path)}">${esc(p.name)}</button>`).join('')}</div>
      <nav class="crumbs" aria-label="현재 위치"></nav>
      <div class="dir-list" role="list"></div>
      <div class="browser-foot">
        <button type="button" class="btn secondary" data-mkdir>새 폴더</button>
        <button type="button" class="btn" data-pick>이 폴더 선택</button>
      </div>
    </div>`;
  const $ = (q) => el.querySelector(q);
  let cur = null; // the last listing shown
  let layer = null;
  const close = () => closeLayer(layer);
  el.onclick = (e) => {
    if (e.target === el) close();
  };
  $('[data-close]').onclick = close;

  async function open(p) {
    const list = $('.dir-list');
    list.setAttribute('aria-busy', 'true');
    let r;
    try {
      r = await api(hp(`/dirs${p == null ? '' : `?path=${encodeURIComponent(p)}`}`, host));
    } catch (err) {
      list.removeAttribute('aria-busy');
      // A remembered folder that has since gone away: start over at home.
      if (p != null && ['cwd_not_found', 'cwd_not_directory'].includes(err.code) && cur == null) return open(null);
      return toast(`열지 못했습니다: ${errText(err)}`);
    }
    if (!el.isConnected || layer.closed) return;
    cur = r;
    if (!r.drives) browseAt.path = r.path;
    const crumbs = r.drives ? [] : r.crumbs;
    $('.crumbs').innerHTML = [
      ...(info.platform === 'win32' ? [`<button type="button" class="crumb" data-go="::drives" ${r.drives ? 'aria-current="page"' : ''}>드라이브</button>`] : []),
      ...crumbs.map((c, i) => `<button type="button" class="crumb" data-go="${esc(c.path)}" ${i === crumbs.length - 1 ? 'aria-current="page"' : ''}>${esc(c.name)}</button>`),
    ].join('<span class="crumb-sep" aria-hidden="true">›</span>');
    const up = r.parent ? `<button type="button" class="dir-item up" data-go="${esc(r.parent)}" role="listitem"><span class="ico">↑</span><span class="nm">상위</span></button>` : '';
    const items = r.dirs
      .map((d) => {
        const full = r.drives ? d : joinPath(r.path, d, r.sep);
        return `<button type="button" class="dir-item" data-go="${esc(full)}" role="listitem"><span class="ico">${r.drives ? '◼' : '▸'}</span><span class="nm">${esc(r.drives ? d.replace(/\\$/, '') : d)}</span></button>`;
      })
      .join('');
    const note = r.denied ? '이 폴더를 읽을 권한이 없습니다.' : !r.dirs.length ? (r.drives ? '드라이브가 없습니다.' : '하위 폴더가 없습니다.') : r.truncated ? `처음 ${r.dirs.length}개만 보입니다.` : '';
    list.innerHTML = up + items + (note ? `<p class="dir-note">${esc(note)}</p>` : '');
    list.scrollTop = 0;
    list.removeAttribute('aria-busy');
    el.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => open(b.dataset.go)));
    const pickBtn = $('[data-pick]');
    pickBtn.disabled = Boolean(r.drives);
    $('[data-mkdir]').disabled = Boolean(r.drives) || Boolean(r.denied);
    pickBtn.innerHTML = r.drives ? '이 폴더 선택' : `이 폴더 선택<span class="sub">${esc(basename(r.path) || r.path)}</span>`;
  }

  $('[data-pick]').onclick = () => {
    if (!cur || cur.drives) return;
    pickCwd(cur.path);
    close();
  };
  $('[data-mkdir]').onclick = async () => {
    if (!cur || cur.drives) return;
    let name = '';
    let error = '';
    for (;;) {
      name = await sheet({ title: '새 폴더', text: `${cur.path} 안에 만들고 바로 선택합니다.`, error, input: { value: name, placeholder: '폴더 이름' }, ok: '만들기' });
      if (name == null) return;
      name = name.trim();
      try {
        const r = await api(hp('/dirs', host), { method: 'POST', body: JSON.stringify({ parent: cur.path, name }) });
        toast('폴더를 만들었습니다');
        pickCwd(r.path);
        browseAt.path = r.path;
        close();
        return;
      } catch (err) {
        error = errText(err);
      }
    }
  };

  layer = openLayer(el, { focus: '[data-close]' });
  open(browseAt.path || start || null);
}

const joinPath = (dir, name, sep) => (dir.endsWith(sep) ? dir + name : dir + sep + name);

// Allowed kinds and folder suggestions come from the chosen host.
async function fillForm(host) {
  view.formHost = host;
  const btn = document.getElementById('f-submit');
  btn.disabled = true;
  let info;
  try {
    info = await hostInfo(host);
  } catch (err) {
    return toast(`불러오지 못했습니다: ${errText(err)}`);
  }
  if (view.name !== 'form' || view.formHost !== host) return;
  const kind = document.getElementById('f-kind');
  const prev = kind.value;
  kind.innerHTML = info.kinds.map((k) => `<option value="${esc(k)}">${esc(k)}</option>`).join('');
  if (info.kinds.includes(prev)) kind.value = prev;
  const cwd = document.getElementById('f-cwd');
  if (cwd) {
    // Another host's folder means nothing here: a host change starts the choice over.
    if (cwd.dataset.host && cwd.dataset.host !== host) cwd.value = '';
    cwd.dataset.host = host;
    if (browseAt.host !== host) browseAt = { host, path: null };
    cwd.placeholder = info.platform === 'win32' ? 'C:\\Users\\…\\project' : `${info.home || '/home/…'}/project`;
    document.getElementById('f-cwds').innerHTML = info.recentCwds.map((c) => `<option value="${esc(c)}">`).join('');
    renderRecent(info.recentCwds);
  }
  btn.disabled = false;
}

async function submitForm(e) {
  e.preventDefault();
  const val = (id) => (document.getElementById(id)?.value || '').trim();
  const agent = { kind: val('f-kind'), args: val('f-args').split(/\s+/).filter(Boolean), name: val('f-name') };
  const host = view.formHost || curHost();
  const btn = document.getElementById('f-submit');
  if (agentNameHint(agent.name)) {
    document.getElementById('f-name').focus();
    return toastErr(agentNameHint(agent.name));
  }
  btn.disabled = true;
  let r = null;
  let started = true;
  if (view.mode === 'new') {
    if (!val('f-cwd')) {
      btn.disabled = false;
      return toast('폴더를 먼저 고르세요.');
    }
    const withAgent = document.getElementById('f-with').checked;
    r = await act(hp('/workspaces', host), { cwd: val('f-cwd'), label: val('f-label'), agent: withAgent ? agent : null });
    if (r) {
      if (r.agentError) toast(`워크스페이스는 만들었지만 에이전트를 시작하지 못했습니다: ${r.agentError}`);
      started = Boolean(r.agent);
      hostCache.delete(host); // recent folders changed
    }
  } else if (view.mode === 'ws') r = await act(hp(`/workspaces/${encodeURIComponent(view.target)}/agents`, host), agent);
  else r = await act(hp(`/panes/${encodeURIComponent(view.target)}/agent`, host), agent);
  btn.disabled = false;
  if (!r) return;
  const pane = encodeURIComponent(r.pane || view.target);
  location.hash = link(host, started ? `/agent/${pane}` : `/term/${pane}`);
}

// ------------------------------------------------------------ settings

let pushInfo = null; // /api/push/key; { disabled: true } on a peer that leaves notifications to its hub
// This device's push subscription: undefined until looked up, null when there is none (or the
// hub doesn't know it), else the PushSubscription.
let devSub;
async function lookupSub() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return (devSub = null);
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && (await reg.pushManager.getSubscription());
    if (!sub) return (devSub = null);
    const r = await api('/push/status', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) });
    devSub = r.subscribed ? sub : null;
  } catch {
    devSub = null;
  }
  return devSub;
}

const PERM_TEXT = {
  granted: ['허용됨', ''],
  denied: ['거부됨', 'iPhone 설정 → 알림 → Herdr Hub 에서 허용하세요.'],
  default: ['아직 묻지 않음', '알림 켜기를 누르면 묻습니다.'],
  unsupported: ['지원 안 됨', '이 브라우저는 알림을 받을 수 없습니다.'],
};

function renderSettings() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const off = pushInfo && pushInfo.disabled;
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !off;
  if (!pushInfo)
    api('/push/key')
      .then((r) => {
        pushInfo = r;
        if (settingsShown() && r.disabled) renderSettings();
      })
      .catch(() => {});
  if (devSub === undefined && supported)
    lookupSub().then(() => settingsShown() && renderSettings());
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const [permWord, permTodo] = PERM_TEXT[perm] || [perm, ''];
  const denied = perm === 'denied';
  const subscribed = Boolean(devSub);
  const devLine = !supported || denied ? '' : devSub === undefined ? '이 기기 알림을 확인하는 중…' : subscribed ? '이 기기는 알림을 받습니다.' : '이 기기는 알림이 꺼져 있습니다.';
  listRoot().innerHTML = `
    <header class="bar">
      <h1>설정</h1>
    </header>
    <main class="panel">
      <section>
        <h2>알림</h2>
        <p>에이전트가 답을 기다리거나 작업을 끝내면 알림을 받습니다.</p>
        ${!standalone ? '<p>iPhone에서는 먼저 Safari 공유 버튼 → <b>홈 화면에 추가</b>로 설치한 뒤, 설치된 앱에서 알림을 켜야 합니다.</p>' : ''}
        ${off ? '<p>이 호스트는 알림을 보내지 않습니다. 알림은 허브(desktop)에서 켜세요.</p>' : !supported ? '<p>이 브라우저는 웹 푸시를 지원하지 않습니다.</p>' : ''}
        <p class="perm ${denied ? 'bad' : ''}">권한: <b>${esc(permWord)}</b>${permTodo ? ` — ${esc(permTodo)}` : ''}</p>
        ${devLine ? `<p id="s-dev">${esc(devLine)}</p>` : ''}
        ${supported && !denied ? `<p class="muted">${actionsLine()}</p>` : ''}
        <div class="row">
          ${subscribed
            ? `<button type="button" class="btn" id="s-test">이 기기로 시험 알림</button>`
            : `<button type="button" class="btn" id="s-enable" ${supported && !denied ? '' : 'disabled'}>알림 켜기</button>`}
        </div>
      </section>
      <section>
        <h2>리턴 키</h2>
        <div class="seg" role="radiogroup" aria-label="리턴 키" id="s-enter">
          ${[['newline', '줄바꿈'], ['send', '보내기']]
            .map(([k, label]) => `<button type="button" class="toggle" role="radio" data-enter="${k}" aria-checked="${getEnter() === k}" aria-pressed="${getEnter() === k}">${label}</button>`)
            .join('')}
        </div>
        <p>${
          getEnter() === 'send'
            ? '리턴 키로 바로 보냅니다. 키보드가 있으면 Shift+리턴으로 줄을 바꿉니다. iPhone 화면 키보드에는 Shift+리턴이 없어 줄바꿈은 붙여넣기로만 넣을 수 있습니다.'
            : '리턴 키는 줄을 바꿉니다. 보내기는 ↑ 버튼이나 ⌘/Ctrl+리턴입니다.'
        } 에이전트 입력 칸에만 해당하고, 셸 명령 줄은 늘 리턴으로 실행합니다.</p>
      </section>
      <section>
        <h2>셸 입력</h2>
        <div class="seg" role="radiogroup" aria-label="셸 입력" id="s-shell">
          ${[['raw', '키 직접 입력'], ['line', '한 줄 입력']]
            .map(([k, label]) => `<button type="button" class="toggle" role="radio" data-shell="${k}" aria-checked="${getShellInput() === k}" aria-pressed="${getShellInput() === k}">${label}</button>`)
            .join('')}
        </div>
        <p>${
          getShellInput() === 'raw'
            ? '터미널 앱처럼 화면을 탭해 키보드를 올리고, 누르는 키가 바로 셸로 갑니다. 셸의 탭 완성·기록·자동 제안이 그대로 됩니다.'
            : '아래 입력 줄에 명령을 다 쓴 뒤 리턴으로 실행합니다. 한글이나 긴 명령을 쓰기 편합니다.'
        }</p>
      </section>
      <section>
        <h2>터미널 화면</h2>
        <label class="switch"><span>색상</span><input type="checkbox" id="s-color" role="switch" ${getColor() ? 'checked' : ''}></label>
        <label class="switch"><span>셸 줄바꿈</span><input type="checkbox" id="s-wrap-term" role="switch" ${getWrap('term') ? 'checked' : ''}></label>
        <label class="switch"><span>에이전트 화면 줄바꿈</span><input type="checkbox" id="s-wrap-agent" role="switch" ${getWrap('agent') ? 'checked' : ''}></label>
        <p>줄바꿈을 끄면 긴 줄이 한 줄로 남고 옆으로 밀어 봅니다. 표나 전체 화면 프로그램의 모양은 끈 쪽이 지켜집니다.</p>
      </section>
      <section>
        <h2>화면 모드</h2>
        <div class="seg" role="radiogroup" aria-label="화면 모드" id="s-theme">
          ${Object.entries(THEMES)
            .map(([k, label]) => `<button type="button" class="toggle" role="radio" data-theme="${k}" aria-checked="${getTheme() === k}" aria-pressed="${getTheme() === k}">${label}</button>`)
            .join('')}
        </div>
        <p>시스템은 기기의 밝게·어둡게 설정을 따릅니다. 이 기기에만 기억합니다.</p>
      </section>
      <section>
        <h2>진단</h2>
        <label class="switch"><span>화면 진단 보내기</span><input type="checkbox" id="s-diag" role="switch" ${diagOn() ? 'checked' : ''}></label>
        <p>키보드를 열고 닫거나 화면이 움직일 때 화면 크기·위치를 허브의 <code>data/viewport.log</code> 에 남깁니다(1초에 두 번까지, 바뀔 때만). 화면 문제를 살필 때만 켜세요.</p>
      </section>
      <section>
        <h2>호스트</h2>
        ${(hosts().length ? hosts() : [{ id: localId(), label: state.host, online: true, herdr: state.herdr, local: true }])
          .map((x) => {
            const n = state.agents.filter((a) => (a.host || localId()) === x.id).length;
            const status = !x.online ? `오프라인${x.since ? ` · ${esc(clock(x.since))}부터` : ''}` : `herdr ${x.herdr === 'up' ? '연결됨' : esc(x.herdr)} · 에이전트 ${n}개`;
            return `<p><b>${esc(x.label)}</b>${x.local && multi() ? ' (허브)' : ''} · ${status}</p>`;
          })
          .join('')}
      </section>
    </main>${tabBar('settings')}`;
  const radios = (id, attr, set) => {
    document.getElementById(id).onclick = (e) => {
      const b = e.target.closest(`[data-${attr}]`);
      if (!b) return;
      set(b.dataset[attr]);
      for (const x of document.querySelectorAll(`#${id} [data-${attr}]`)) {
        const on = String(x.dataset[attr] === b.dataset[attr]);
        x.setAttribute('aria-checked', on);
        x.setAttribute('aria-pressed', on);
      }
    };
  };
  radios('s-theme', 'theme', setTheme);
  radios('s-shell', 'shell', (v) => {
    setShellInput(v);
    renderSettings();
    document.querySelector(`#s-shell [data-shell="${v}"]`).focus();
  });
  radios('s-enter', 'enter', (v) => {
    setEnter(v);
    renderSettings();
    document.querySelector(`#s-enter [data-enter="${v}"]`).focus();
  });
  document.getElementById('s-color').onchange = (e) => saveColor(e.target.checked);
  document.getElementById('s-wrap-term').onchange = (e) => saveWrap('term', e.target.checked);
  document.getElementById('s-wrap-agent').onchange = (e) => saveWrap('agent', e.target.checked);
  document.getElementById('s-diag').onchange = (e) => {
    setDiag(e.target.checked);
    if (e.target.checked) {
      diagLast = '';
      viewportDiag('settings');
    }
    toast(e.target.checked ? '화면 진단을 보냅니다' : '화면 진단을 껐습니다');
  };
  const enable = document.getElementById('s-enable');
  if (enable) enable.onclick = enablePush;
  const test = document.getElementById('s-test');
  if (test) test.onclick = testPush;
}

// Notification buttons (답 필요 → Yes / No): what this browser says it can show. iOS Safari has
// no Notification.maxActions and shows no buttons; the notification still opens the agent.
function actionsLine() {
  const n = 'Notification' in window ? Number(Notification.maxActions) || 0 : 0;
  return n > 0
    ? '답 필요 알림에 빠른 답 버튼(예: Yes · No)이 붙습니다. 누르면 그 질문이 그대로일 때만 보냅니다.'
    : '이 기기의 알림에는 답 버튼이 없습니다(iPhone 은 지원하지 않음). 알림을 누르면 그 에이전트가 열립니다.';
}

// Only to this device: its own endpoint goes along and the hub sends to that one alone.
async function testPush() {
  const sub = await lookupSub();
  if (!sub) {
    if (settingsShown()) renderSettings();
    return toast('이 기기는 알림이 꺼져 있습니다', { action: { label: '알림 켜기', run: enablePush } });
  }
  try {
    await api('/push/test', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) });
    toast('이 기기로 시험 알림을 보냈습니다');
  } catch (err) {
    if (err.code === 'not_subscribed') {
      devSub = null;
      if (settingsShown()) renderSettings();
      return toast('이 기기는 알림이 꺼져 있습니다', { action: { label: '알림 켜기', run: enablePush } });
    }
    toastErr(`시험 알림을 보내지 못했습니다: ${errText(err)}`);
  }
}

function b64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function enablePush() {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      if (settingsShown()) renderSettings();
      return toastErr(perm === 'denied' ? '알림이 거부됐습니다. iPhone 설정 → 알림 → Herdr Hub 에서 허용하세요.' : '알림 권한을 받지 못했습니다.');
    }
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await api('/push/key');
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
    await api('/push/subscribe', { method: 'POST', body: JSON.stringify(sub.toJSON()) });
    devSub = sub;
    toast('이 기기 알림을 켰습니다.');
    if (settingsShown()) renderSettings();
  } catch (err) {
    toastErr(`알림을 켜지 못했습니다: ${errText(err)}`);
  }
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
