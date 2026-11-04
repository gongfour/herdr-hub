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
  es.addEventListener('version', (e) => {
    try {
      checkVersion(JSON.parse(e.data));
    } catch {}
  });
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

// ------------------------------------------------------------ new version

// An installed app is resumed from memory for days, so after a deploy it still runs the old
// code. The server says which build it serves (the first message of every stream, and
// /api/version when the app comes back to the foreground); when that is another build than the
// one this page came with, the page loads again by itself if that loses nothing
// (Update.safeToReload), else a banner offers 새로고침.
const myBuild = pageBuild(); // settings.js: the build this page was served with
let serverBuild = null;
let returnedAt = 0; // when the app last came back to the foreground
const RELOAD_KEY = 'herdr-hub.reloadedFor'; // { v: build id, t }: this tab's last try (sessionStorage)
const DISMISS_KEY = 'herdr-hub.updateDismissed'; // the build id whose banner was closed
const session = {
  get(k) {
    try {
      return JSON.parse(sessionStorage.getItem(k));
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      sessionStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};
const returning = () => document.visibilityState === 'hidden' || Date.now() - returnedAt < 5000;
function reloadState() {
  const input = document.getElementById('d-input');
  return {
    returning: returning(),
    layer: Boolean(topLayer()) || switcherOpen(),
    typing: editable(document.activeElement) && document.activeElement.id !== 'd-input',
    composer: Boolean((input && input.value.trim()) || (view.name === 'agent' && detail.files && detail.files.length)),
    sending: Boolean(detail.sending),
    answering: Boolean(detail.answerMode),
  };
}
const hasNew = () => Update.differs(myBuild, serverBuild);
function checkVersion(b) {
  if (!b || !b.id) return;
  if (serverBuild && b.id === serverBuild.id) {
    if (hasNew()) offerUpdate();
    return;
  }
  serverBuild = b;
  if (view.name === 'settings') renderVersionInfo();
  if (!hasNew()) return hideUpdateBanner();
  offerUpdate();
}
// Reload when that is safe and this version wasn't just tried; else the banner.
function offerUpdate() {
  if (Update.safeToReload(reloadState()) && Update.mayTry(session.get(RELOAD_KEY), serverBuild.id, Date.now())) return void reloadToNew({ auto: true });
  showUpdateBanner();
}
async function checkServerVersion() {
  try {
    const r = await fetch('/api/version', { cache: 'no-store' });
    if (r.ok) checkVersion(await r.json());
  } catch {}
}
// Load the new page, keeping the route (the hash) and the draft. index.html is no-cache with an
// ETag, so a reload asks the server again anyway; fetching it first with cache:'reload' also
// writes the new copy into the HTTP cache (in case a resumed page's reload would take the cached
// one), and tells whether the server really serves another build: when it doesn't, an automatic
// reload stays put (a reload into the same old page would go round).
async function reloadToNew({ auto = false } = {}) {
  session.set(RELOAD_KEY, { v: (serverBuild || myBuild || {}).id || '', t: Date.now() });
  try {
    const r = await fetch('/', { cache: 'reload', credentials: 'same-origin' });
    const got = Update.buildOf(await r.text());
    if (auto && !Update.differs(myBuild, got)) return showUpdateBanner();
  } catch {
    if (auto) return showUpdateBanner();
  }
  if (auto && !Update.safeToReload({ ...reloadState(), returning: true })) return showUpdateBanner(); // changed meanwhile
  stashDraft();
  location.reload();
}
let updateBanner = null;
function showUpdateBanner() {
  if (!hasNew() || session.get(DISMISS_KEY) === serverBuild.id) return;
  if (!updateBanner) {
    updateBanner = document.createElement('div');
    updateBanner.className = 'update-bar';
    updateBanner.setAttribute('role', 'status');
    updateBanner.innerHTML = `<span class="ub-t">새 버전이 있습니다</span>
      <button type="button" class="ub-go">새로고침</button>
      <button type="button" class="ub-x" aria-label="닫기" title="닫기">${ICON.x}</button>`;
    updateBanner.querySelector('.ub-go').onclick = () => reloadToNew();
    updateBanner.querySelector('.ub-x').onclick = () => {
      session.set(DISMISS_KEY, serverBuild.id);
      hideUpdateBanner();
    };
    document.body.appendChild(updateBanner);
    new ResizeObserver(() => updateBanner && document.documentElement.style.setProperty('--update-h', `${updateBanner.offsetHeight}px`)).observe(updateBanner);
  }
  updateBanner.querySelector('.ub-t').textContent = `새 버전이 있습니다 · ${Update.shortLabel(serverBuild)}`;
  document.documentElement.classList.add('has-update');
}
function hideUpdateBanner() {
  if (!updateBanner) return;
  updateBanner.remove();
  updateBanner = null;
  document.documentElement.classList.remove('has-update');
  document.documentElement.style.removeProperty('--update-h');
}
const backToFront = () => {
  returnedAt = Date.now();
  checkServerVersion();
};
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && backToFront());
window.addEventListener('pageshow', (e) => e.persisted && backToFront());

function onState() {
  forgetGone(); // kept chats of agents that are gone (agent.js)
  if (switcherOpen()) renderSwitcher();
  if (split) {
    render();
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

// The agent or shell open now and the one before it, for Alt+` (lastView): only those two kinds,
// so a trip through 설정 or a form in between doesn't count.
const visits = { cur: null, prev: null };
function noteVisit(hash) {
  const r = Route.parse(hash.replace(/^#/, '') || '/');
  if (r.name !== 'agent' && r.name !== 'term') return;
  const h = hash.replace(/\/(screen|chat)$/, '');
  if (visits.cur && normHash(visits.cur) !== normHash(h)) visits.prev = visits.cur;
  visits.cur = h;
}

// relayout: the same route drawn again for the other layout (the screen crossed the split
// width); an open agent keeps what it had loaded and its terminal sheet.
function route(e, { relayout = false } = {}) {
  if (!history.state || !('prev' in history.state)) history.replaceState({ ...(history.state || {}), prev: lastHash }, '');
  lastHash = location.hash || '#/';
  if (!relayout) noteVisit(lastHash);
  if (!relayout) stashDraft(); // relayout() kept it before the old composer went away
  const was = relayout ? { view, detail, sheet: Boolean(detail.sheet) } : null;
  clearInterval(pollTimer);
  clearInterval(tickTimer);
  tickTimer = null;
  // relayout opens it again over the same entry (core.js: Back still closes it).
  hist.hold = relayout;
  closeScreenSheet();
  hist.hold = false;
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
  // 빠른 이동 lists these first (switcher.js).
  if ((r.name === 'agent' || r.name === 'term') && (host || localId())) noteRecent(link(host || localId(), `/${r.name}/${encodeURIComponent(r.pane)}`));
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
    } else if (!curHost()) {
      // Opened before the first state (the app just started, or reloaded onto a new version):
      // the host isn't known yet, so neither is the draft's key. Put it back once it is.
      ready.then(() => {
        const d = view.name === 'agent' && detail.pane === pane && drafts.get(rowKey(curHost(), pane));
        const input = document.getElementById('d-input');
        if (d && input && !input.value) {
          input.value = d.text;
          updateComposer();
        }
      });
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
    renderSettings({ focus: true }); // into the page (split: on the right, the list stays)
  } else if (r.name === 'keys') {
    view = { name: 'keys' };
    kp.rec = null;
    renderKeys({ focus: true }); // keyspage.js: split on the right, the phone a page of its own
  } else {
    view = { name: 'list' };
    render();
  }
  if (split) {
    if (isDetail()) render();
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

// Nothing open on the right: a calm placeholder, with a way to what is waiting.
function renderEmpty() {
  const root = detailRoot();
  if (!root) return;
  const off = sideOff();
  // The keys as this device has them (keymap.js), only those it has.
  const k = (action, words) => {
    const h = Keymap.hint(action);
    return h ? `<kbd>${esc(h)}</kbd> ${words}` : '';
  };
  const keys = [k('switcher', '찾아 열기'), k('nextRow', '목록 옮겨 다니기'), k('nextBlocked', '다음 답 필요'), k('toggleSide', '사이드바 접기')].filter(Boolean);
  const html = `<div class="empty-detail">
      <span class="ed-ic" aria-hidden="true">${ICON.panel}</span>
      <h2>${off ? '목록을 열어 에이전트를 고르세요' : '왼쪽에서 에이전트를 고르세요'}</h2>
      ${off ? '<button type="button" class="btn secondary ed-open" aria-controls="list-pane">작업공간 목록 열기</button>' : ''}
      ${keys.length ? `<p class="ed-keys">${keys.join(' · ')}</p>` : ''}
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
  const main = listRoot() && listRoot().querySelector(':scope > main.home');
  if (!main) return false;
  const links = [...main.querySelectorAll('a.sw-front')].map((a) => a.getAttribute('href'));
  const cur = main.querySelector('a[aria-current]');
  const next = Split.stepRow(links, cur && cur.getAttribute('href'), dir);
  if (!next) return true;
  stepFocus = true;
  location.hash = next;
  const el = [...main.querySelectorAll('a.sw-front')].find((a) => a.getAttribute('href') === next);
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
  help: () => (toggleKeys(), true), // keyspage.js
  settings: () => (toggleSettings(), true),
  // The caret in the composer (or the shell's command line), at the end of what is there.
  focusInput() {
    const f = document.getElementById('d-input') || document.getElementById('t-input');
    if (!f || f.disabled) return false;
    f.focus();
    if (f.isContentEditable) caretToEnd(f);
    return true;
  },
  jumpEnd: () => jumpLatest(true),
  jumpTop: () => jumpTop(),
  prevMine: () => navStep(-1),
  nextMine: () => navStep(1),
  scrollUp: (b, e) => scrollStep(-1, e.repeat),
  scrollDown: (b, e) => scrollStep(1, e.repeat),
  prevHost: () => stepHostFilter(-1),
  nextHost: () => stepHostFilter(1),
  // Alt+↑/↓: the caret goes into the next one's field.
  prevRow: () => stepList(-1),
  nextRow: () => stepList(1),
  switcher: () => toggleSwitcher(), // switcher.js
  nextBlocked: () => stepBlocked(1), // list.js
  prevBlocked: () => stepBlocked(-1),
  terminal: () => toggleScreenSheet(), // agent.js
  // The agent, shell or workspace open, after the same 닫기 sheet as its menu (actions.js): Enter
  // closes, Esc keeps it. A close that can't be undone is never one key.
  closeView() {
    const host = curHost();
    if (view.name === 'agent') {
      const a = currentAgent();
      if (!a) return false;
      closePane(host, a.pane, a.name || a.title, true);
      return true;
    }
    if (view.name === 'term') {
      const t = (state.terminals || []).find((x) => same(x, host, view.pane));
      closePane(host, view.pane, t ? termTitle(t) : view.pane, false);
      return true;
    }
    if (view.name === 'ws') {
      const w = (state.workspaces || []).find((x) => same(x, host, view.id, 'workspace_id'));
      if (!w) return false;
      closeWorkspace(w);
      return true;
    }
    return false;
  },
  // In the message box only: elsewhere Shift+Tab moves the focus back, as always.
  mode() {
    if (view.name !== 'agent' || document.activeElement?.id !== 'd-input') return false;
    cycleMode(); // agent.js: Claude's own Shift+Tab, through herdr
    return true;
  },
  // The agent or shell open before this one (route keeps the two).
  lastView() {
    if (!visits.prev) return false;
    stepFocus = true; // the caret into its field, as Alt+↑/↓
    location.hash = visits.prev;
    return true;
  },
  answer: (b) => answerKey(Number(b.key)), // answer.js
  toggleSide: () => (setSideOff(!sideOff()), true), // as the rail's 작업공간
  stop: () => stopKey(), // agent.js
  // 에이전트 시작 in the workspace of what is open (a new tab there); else a new workspace.
  newAgent() {
    const host = curHost();
    const of = (list, pane) => (list || []).find((x) => same(x, host, pane));
    const ws = view.name === 'ws' ? view.id : view.name === 'agent' ? (of(state.agents, detail.pane) || {}).workspace : view.name === 'term' ? (of(state.terminals, view.pane) || {}).workspace : null;
    if (!ws) return KEY_ACTIONS.newWorkspace();
    location.hash = link(host, `/start/ws/${encodeURIComponent(ws)}`);
    return true;
  },
  // As the list's +: on the host the list is filtered to, if any.
  newWorkspace() {
    const f = filter();
    location.hash = f === 'all' ? '#/new' : link(f, '/new');
    return true;
  },
};
// Ctrl or Alt held alone for a moment: each button with a shortcut shows its keys (data-keyhint,
// style.css), as iPadOS does for ⌘. Any other key, letting go, or leaving the page hides them.
let hintTimer = 0;
function hideKeyHints() {
  clearTimeout(hintTimer);
  hintTimer = 0;
  document.documentElement.classList.remove('show-keys');
}
document.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Control' || e.key === 'Alt') {
      // Held, a modifier comes again and again, on some keyboards (a Galaxy Tab cover) with
      // e.repeat false: a timer already running (or the badges up) is left as it is.
      if (!hintTimer && !document.documentElement.classList.contains('show-keys')) hintTimer = setTimeout(() => document.documentElement.classList.add('show-keys'), 500);
    } else if (e.key !== 'Shift') hideKeyHints();
  },
  true,
);
document.addEventListener('keyup', (e) => (e.key === 'Control' || e.key === 'Alt') && hideKeyHints(), true);
window.addEventListener('blur', hideKeyHints);

// Where a key is pressed, for Keymap.match. The shell's field in 키 직접 입력 is the shell, not a
// field one types into: there a binding with shell decides alone (shell.js asks the same).
function keyContext() {
  const a = document.activeElement;
  const rawShell = view.name === 'term' && detail.raw && a && a.id === 't-input';
  return { field: editable(a) && !rawShell, shell: view.name === 'term', layer: Boolean(topLayer()), split };
}
document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.isComposing) return;
  if (termStrayKey(e)) return e.preventDefault();
  const b = Keymap.match(e, keyContext());
  if (b && KEY_ACTIONS[b.action](b, e)) return e.preventDefault();
  chatStrayKey(e);
});
// The agent view, a character typed with the focus on the page (not a shortcut: the keymap had
// its turn): the caret goes to the composer and the character lands there, as in the shell view.
// The key is left alone, so the browser (and an IME) puts it into the field that now has the
// focus. Space keeps scrolling; the header and a link or button keep their keys.
function chatStrayKey(e) {
  if (view.name !== 'agent' || topLayer() || e.ctrlKey || e.metaKey || e.altKey) return;
  if (!(e.key.length === 1 && e.key !== ' ') && e.keyCode !== 229) return;
  const input = document.getElementById('d-input');
  const a = document.activeElement;
  if (!input || a === input || editable(a) || (a && a.closest && a.closest('.bar'))) return;
  input.focus({ preventScroll: true });
  caretToEnd(input);
}
// The rail, as VS Code's activity bar: 작업공간 folds and unfolds the sidebar; ⚙ opens 설정 on
// the right (as VS Code opens its settings in the editor), and closes it when it is open.
document.addEventListener('click', (e) => {
  if (!split || !e.target.closest) return;
  if (e.target.closest('.ed-open')) return setSideOff(false);
  const b = e.target.closest('#rail .rail-btn');
  if (!b) return;
  if (b.dataset.tab === 'spaces') return setSideOff(!sideOff());
  toggleSettings();
});
// 설정 open or closed (the rail's ⚙, Ctrl+,): closing goes back to what was open before it
// (split: on the right; phone: the 작업공간 tab).
function toggleSettings() {
  if (view.name === 'settings') return goBack(split ? settingsBack() : '#/');
  history.pushState(null, '', '#/settings');
  route();
}
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
