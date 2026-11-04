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
  forgetGone(); // kept chats of agents that are gone (agent.js)
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
    // Opened before the first state (the app just started): its kept chat, now that the
    // agent's conversation is known.
    if (adoptKept()) {
      renderDetailBody(true);
      renderSync();
    }
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

// Unsent text and photos per agent (host|pane). The text is also kept on the device for a week,
// for a closed tab or an app iOS dropped in the background; photos only while the page lives.
const DRAFTS_KEY = 'herdr-hub.drafts';
const DRAFT_MS = 7 * 864e5;
const drafts = (() => {
  const live = new Map();
  const read = () => {
    try {
      const all = JSON.parse(localStorage.getItem(DRAFTS_KEY)) || {};
      for (const [k, d] of Object.entries(all)) if (!d || typeof d.text !== 'string' || !(d.at > Date.now() - DRAFT_MS)) delete all[k];
      return all;
    } catch {
      return {};
    }
  };
  // Read again before each write: another tab may have saved its own.
  const write = (k, text) => {
    const all = read();
    if (text) all[k] = { text, at: Date.now() };
    else if (!(k in all)) return;
    else delete all[k];
    try {
      localStorage.setItem(DRAFTS_KEY, JSON.stringify(all));
    } catch {}
  };
  return {
    get(k) {
      if (live.has(k)) return live.get(k);
      const d = read()[k];
      return d && { text: d.text, files: [] };
    },
    set(k, d) {
      live.set(k, d);
      write(k, d.text.trim() ? d.text : null);
    },
    delete(k) {
      live.delete(k);
      write(k, null);
    },
  };
})();
// Kept as it is typed (a moment after the last key), and when the page goes to the background.
let draftTimer = null;
function keepDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(stashDraft, 500);
}
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
  // An old 작업공간 link (#/spaces, #/h/<id>/spaces) becomes the list's own address, so 뒤로 finds it.
  if (/^(\/h\/[^/]+)?\/spaces$/.test(h)) {
    h = h.replace(/\/spaces$/, '') || '/';
    lastHash = `#${h}`;
    history.replaceState(history.state, '', lastHash);
  }
  // The route as data (route.js); the views below keep the shapes they always had.
  const r = Route.parse(h);
  const host = r.host;
  // The phone shows a detail in place of the tab: keep the tab's page for 뒤로.
  if (!split && !['list', 'settings'].includes(r.name)) parkTab();
  if (r.name === 'agent') {
    // An agent always shows its chat. …/screen (the old 화면 tab) opens the terminal sheet over it.
    const pane = r.pane;
    view = { name: 'agent', host };
    const draft = drafts.get(rowKey(curHost(), pane));
    detail = { host, pane, transcript: null, screen: null, blockedText: null, lastSeq: -1, files: draft ? draft.files : [], sheet: null, wantSheet: r.sub === 'screen', activity: null };
    if (was && was.view.name === 'agent' && was.detail.pane === pane && (was.view.host || localId()) === curHost()) {
      const d = was.detail;
      Object.assign(detail, { transcript: d.transcript, stale: d.stale, blockedText: d.blockedText, lastSeq: d.lastSeq, mode: d.mode, activity: d.activity, seen: d.seen, answerMode: d.answerMode, showScreen: d.showScreen, showKeys: d.showKeys, openTools: d.openTools, openShell: d.openShell, wantSheet: was.sheet });
    }
    // Its chat kept from an earlier visit (agent.js): drawn now, refreshed by loadDetail below.
    adoptKept();
    if (r.sub) history.replaceState(history.state, '', location.hash.replace(/\/(?:screen|chat)$/, ''));
    renderDetail();
    renderSync();
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
    if (split && sideOff()) setSideOff(false); // 설정 lives in the sidebar
    renderSettings();
  } else {
    view = { name: 'list' };
    if (split) colTab = 'spaces';
    render();
  }
  if (split) {
    if (isDetail()) renderCol();
    else renderEmpty();
  }
  if (stepFocus) {
    stepFocus = false;
    refocusInput(document.getElementById('d-input') || document.getElementById('t-input'));
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
  dropTabPages();
  colTab = split ? (view.name === 'settings' ? 'settings' : 'spaces') : null;
  document.documentElement.classList.toggle('split', split);
  $app.innerHTML = split ? '<nav class="rail" id="rail" aria-label="탭"></nav><div class="col" id="list-pane"></div><div class="col" id="detail-pane"></div>' : '';
  route(null, { relayout: true });
  refocusInput(refocus && document.getElementById(refocus));
}

// The caret into a composer or the shell's input, at the end of what is there.
function refocusInput(el) {
  if (!el) return;
  el.focus({ preventScroll: true });
  if (el.isContentEditable) caretToEnd(el);
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
  const off = sideOff();
  const html = `<div class="empty-detail">
      <span class="ed-ic" aria-hidden="true">${ICON.panel}</span>
      <h2>${off ? '목록을 열어 에이전트를 고르세요' : '왼쪽에서 에이전트를 고르세요'}</h2>
      ${off ? '<button type="button" class="btn secondary ed-open" aria-controls="list-pane">작업공간 목록 열기</button>' : ''}
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

// Alt+↑/↓: the previous or next agent or shell in the list column, opened on the right, with
// the caret in its composer or shell input (only a real keyboard has the keys; route takes it).
let stepFocus = false;
function stepList(dir) {
  // The folded sidebar on 설정: step through 작업공간 all the same (it opens there when unfolded).
  if (sideOff() && colTab === 'settings') {
    colTab = 'spaces';
    renderCol();
  }
  const main = listRoot() && listRoot().querySelector(':scope > main.home');
  if (!main) return false;
  const links = [...main.querySelectorAll('a.attn-row, a.sw-front')].map((a) => a.getAttribute('href'));
  const cur = main.querySelector('a[aria-current]');
  const next = Split.stepRow(links, cur && cur.getAttribute('href'), dir);
  if (!next) return true;
  stepFocus = true;
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
// Keyboard: every shortcut is a binding in keymap.js; these are what its actions do. A handler
// returns true when it acted (the key is then taken). In the shell view a key with the focus on
// the page goes to the shell first (termStrayKey).
const KEY_ACTIONS = {
  // Esc: the top sheet or menu, else an open row, else out of a field, else back. Always taken:
  // Android turns an Escape the page leaves alone into Back, which closes the app when there is
  // nothing behind (a keyboard cover's Esc minimised the Hub).
  back() {
    const top = topLayer();
    if (top) closeLayer(top);
    else if (swipe.open) closeRow();
    else if (editable(document.activeElement)) document.activeElement.blur();
    else {
      const back = view.name !== 'list' && $app.querySelector('a[data-back]');
      if (back) goBack(back.getAttribute('href'));
    }
    return true;
  },
  help: () => (openKeySheet(), true),
  // The caret in the composer (or the shell's command line), at the end of what is there.
  focusInput() {
    const f = document.getElementById('d-input') || document.getElementById('t-input');
    if (!f || f.disabled) return false;
    f.focus();
    if (f.isContentEditable) caretToEnd(f);
    return true;
  },
  jumpEnd: () => jumpLatest(true),
  prevMine: () => navStep(-1),
  nextMine: () => navStep(1),
  prevHost: () => stepHostFilter(-1),
  nextHost: () => stepHostFilter(1),
  // Alt+↑/↓: the caret goes into the next one's field.
  prevRow: () => stepList(-1),
  nextRow: () => stepList(1),
};
document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.isComposing) return;
  if (termStrayKey(e)) return e.preventDefault();
  const b = Keymap.match(e, { field: editable(document.activeElement), shell: view.name === 'term', layer: Boolean(topLayer()), split });
  if (b && KEY_ACTIONS[b.action](b)) e.preventDefault();
});
// Split: the list column shows tab t. With a detail open only the column changes and the
// detail stays; with nothing open it is that tab's route (as the phone's tab bar link).
function showCol(t) {
  if (!isDetail()) {
    const h = t === 'settings' ? '#/settings' : '#/';
    if (location.hash !== h) {
      history.pushState(null, '', h);
      route();
    }
    return;
  }
  colTab = t;
  renderCol();
  // ✕ in the detail header leads to where the list column now is.
  const close = detailRoot().querySelector('a.close-detail');
  if (close) close.setAttribute('href', homeHash());
}
// The rail, as VS Code's activity bar: the tab the open sidebar shows folds it; any tab
// while folded unfolds it on that tab; the other tab switches the sidebar to it.
document.addEventListener('click', (e) => {
  if (!split || !e.target.closest) return;
  if (e.target.closest('.ed-open')) return setSideOff(false);
  const b = e.target.closest('#rail .rail-btn');
  if (!b) return;
  const t = b.dataset.tab;
  if (!sideOff() && colTab === t) return setSideOff(true);
  if (sideOff()) setSideOff(false);
  if (colTab !== t) showCol(t);
  renderRail();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') stashDraft();
  else if (view.name === 'agent') loadDetail();
});
window.addEventListener('pagehide', stashDraft);
splitMq.addEventListener('change', relayout);
document.documentElement.classList.toggle('side-off', sideOff());
connect();
if (splitMq.matches) relayout();
else route();
