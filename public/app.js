'use strict';
// The app's spine, loaded last: the live state stream, routing, the split layout's glue, and boot.
// Load order (index.html): the pure helpers, core.js, the views, then this file. Top-level code in
// every file only registers listeners or defines things; anything that draws runs from here.

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
  if (st && st.prev != null && normHash(st.prev) === normHash(target)) history.go(-backSteps()); // over the shell's Esc guard too
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
      Object.assign(detail, { transcript: d.transcript, blockedText: d.blockedText, lastSeq: d.lastSeq, mode: d.mode, activity: d.activity, seen: d.seen, answerMode: d.answerMode, showScreen: d.showScreen, showKeys: d.showKeys, openTools: d.openTools, openShell: d.openShell, wantSheet: was.sheet });
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
// Keyboard: Escape closes the top sheet or menu, else leaves a field, else goes back. It is
// always taken: Android turns an Escape the page leaves alone into Back, which closes the app
// when there is nothing behind (a keyboard cover's Esc minimised the Hub).
// "/" puts the caret in the composer (or the shell's command line). In the shell view a key
// with the focus on the page goes to the shell instead (termStrayKey).
document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.isComposing) return;
  if (termStrayKey(e)) return e.preventDefault();
  if (e.key === 'Escape') {
    e.preventDefault();
    const top = topLayer();
    if (top) return closeLayer(top);
    if (swipe.open) return closeRow();
    if (editable(document.activeElement)) return document.activeElement.blur();
    const back = view.name !== 'list' && $app.querySelector('a[data-back]');
    if (back) goBack(back.getAttribute('href'));
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
  // says which keys count; in the shell view only Alt+↑/↓).
  if (split) {
    const a = document.activeElement;
    const dir = Split.listKey(e, { editable: editable(a), shell: view.name === 'term', layer: Boolean(topLayer()) });
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
