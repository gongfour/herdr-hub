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
// While the live stream is down the statuses on screen may be stale. Every header says so the
// same way: a small red chip with a word (not a bare dot, whose title a finger never sees), which a
// tap explains in a toast. Nothing shows while all is well. liveDot: the agent, shell and workspace
// headers (the stream only); liveChip: the list's header, which also tells a host's herdr being down.
const LIVE_WHY = {
  stream: T('실시간 연결이 끊겨 다시 붙는 중입니다. 그동안 보이는 상태는 늦을 수 있습니다.'),
  connecting: T('실시간 연결을 여는 중입니다.'),
  herdr: T('허브에는 닿지만 herdr 에 연결하지 못했습니다. 에이전트 상태가 늦을 수 있습니다.'),
};
const liveChipHtml = (word, why) => `<button type="button" class="live-chip" data-live-why="${why}" aria-label="${T('{word} — 설명 보기', { word })}"><span class="dot" aria-hidden="true"></span>${word}</button>`;
const liveDot = () => (live ? '' : liveChipHtml(T('끊김'), 'stream'));
function liveChip() {
  if (!live) return state.herdr === 'connecting' ? liveChipHtml(T('연결 중'), 'connecting') : liveChipHtml(T('연결 끊김'), 'stream');
  if (state.herdr === 'down') return liveChipHtml(T('herdr 연결 끊김'), 'herdr');
  return '';
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-live-why]');
  if (b) toast(LIVE_WHY[b.dataset.liveWhy] || LIVE_WHY.stream);
});
// The stream went down (or was found dead): every header that shows it says so now.
function showLiveLost() {
  if (listShown()) render();
  if (view.name === 'agent') renderDetailHeader();
  if (view.name === 'term') renderTerminalHeader();
  if (view.name === 'ws' && !backSwipeBusy()) renderWorkspace();
}

function connect() {
  clearTimeout(retryTimer);
  if (stream) stream.close();
  // The state whole first, then patches (statepatch.js): raw is the stream's state as the hub
  // made it, which the next patch is from; state is the page's copy (closes hidden, reorder.js
  // sets its hosts). A patch from another state (never seen: the stream is ordered) starts again.
  const es = (stream = new EventSource('/api/stream?delta=1'));
  let raw = null;
  let rev = null;
  lastHeard = Date.now();
  es.addEventListener('ping', () => (lastHeard = Date.now()));
  es.addEventListener('version', (e) => {
    try {
      checkVersion(JSON.parse(e.data));
    } catch {}
  });
  const take = (next, id) => {
    raw = next;
    rev = id;
    lastHeard = Date.now();
    retryDelay = 1000;
    live = true;
    state = hideClosing({ ...raw }); // actions.js: a close sent just now
    hubUp();

    resolveReady();
    onState();
  };
  es.addEventListener('state', (e) => take(JSON.parse(e.data), e.lastEventId));
  es.addEventListener('patch', (e) => {
    if (es !== stream) return;
    let next = null;
    try {
      const p = JSON.parse(e.data);
      if (raw && String(p.base) === rev) next = StatePatch.apply(raw, p);
    } catch {}
    if (next) take(next, e.lastEventId);
    else connect();
  });
  es.onerror = () => {
    state = { ...state, herdr: 'offline' };
    live = false;
    hubLost();
    showLiveLost();
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
  hubLost();
  showLiveLost();
  retryDelay = 1000;
  connect();
}

// ------------------------------------------------------------ hub down (conn.js)

// The hosts this device last saw, with their own addresses, kept for when this page's server
// can't be reached: the stream down for a while and /api/version failing too shows a calm notice
// with the likeliest cause and, for each remembered host that answers, a way to open it directly
// (another origin: its own app install and settings). offline.html says the same when even the
// page can't be loaded (sw.js).
let downSince = null;
let downTimer = null;
let downBar = null;
let downProbe = { at: 0, live: [], busy: false };
let downOpen = true; // the notice's 먼저 볼 것 is unfolded
let downFold = null;
function hubUp() {
  downSince = null;
  clearTimeout(downTimer);
  hideHubDown();
  try {
    Conn.write(localStorage, Conn.remember(Conn.read(localStorage), location.origin, state));
  } catch {}
}
function hubLost() {
  if (!downSince) downSince = Date.now();
  clearTimeout(downTimer);
  downTimer = setTimeout(checkHubDown, Math.max(500, downSince + Conn.DOWN_MS - Date.now()));
}
async function checkHubDown() {
  clearTimeout(downTimer);
  if (!downSince || live) return;
  if (Date.now() - downSince < Conn.DOWN_MS) return hubLost();
  let versionOk = false;
  try {
    const r = await fetch('/api/version', { cache: 'no-store', signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined });
    versionOk = r.ok && Conn.answers(r.status, await r.json().catch(() => null));
  } catch {}
  if (!downSince || live) return;
  if (Conn.hubDown({ downSince, now: Date.now(), versionOk })) {
    showHubDown();
    // The peers are asked again now and then while the notice stays.
    if (!downProbe.busy && Date.now() - downProbe.at > 30000) probeHosts();
  }
  downTimer = setTimeout(checkHubDown, 10000);
}
async function probeHosts() {
  const rec = Conn.read(localStorage);
  const cands = Conn.candidates(rec, location.origin);
  downProbe = { at: Date.now(), live: downProbe.live, busy: cands.length > 0 };
  showHubDown();
  if (!cands.length) return;
  const got = await Conn.probe(cands, fetch.bind(window));
  downProbe = { at: Date.now(), live: got, busy: false };
  if (downBar) showHubDown();
}
function showHubDown() {
  if (!downSince || live) return;
  if (!downBar) {
    hideUpdateBanner();
    downBar = document.createElement('div');
    downBar.className = 'hub-down';
    downBar.setAttribute('role', 'status');
    downBar.addEventListener('click', (e) => {
      if (e.target.closest('.hd-more > summary')) clearTimeout(downFold);
      if (!e.target.closest('[data-retry]')) return;
      downProbe.at = 0;
      revive('retry');
      checkHubDown();
    });
    // What to check shows when the notice first appears and folds after a while, leaving the
    // title and 다시 시도 (a phone's screen is short); 먼저 볼 것 opens it again, and stays as left.
    downOpen = true;
    // toggle doesn't bubble (and fires for a redraw too); a tap on 먼저 볼 것 is the person's choice.
    downBar.addEventListener('toggle', (e) => e.target.matches('.hd-more') && (downOpen = e.target.open), true);
    clearTimeout(downFold);
    downFold = setTimeout(() => {
      const d = downBar && downBar.querySelector('.hd-more');
      if (d && d.open && !d.contains(document.activeElement)) d.open = false; // the toggle event keeps downOpen
    }, 12000);
    document.body.appendChild(downBar);
    new ResizeObserver(() => downBar && document.documentElement.style.setProperty('--down-h', `${downBar.offsetHeight}px`)).observe(downBar);
    document.documentElement.classList.add('has-down');
  }
  const html = Conn.noticeHtml(Conn.notice(Conn.read(localStorage), { live: downProbe.live, probing: downProbe.busy }), { open: downOpen });
  if (downBar._html === html) return;
  // Redrawn in place: a focused button keeps the focus when it is still there.
  const focused = document.activeElement && downBar.contains(document.activeElement) ? document.activeElement.getAttribute('data-direct') || (document.activeElement.hasAttribute('data-retry') ? 'retry' : null) : null;
  downBar._html = html;
  downBar.innerHTML = html;
  if (focused) {
    const again = focused === 'retry' ? downBar.querySelector('[data-retry]') : downBar.querySelector(`[data-direct="${CSS.escape(focused)}"]`);
    if (again) again.focus({ preventScroll: true });
  }
}
function hideHubDown() {
  if (!downBar) return;
  downBar.remove();
  downBar = null;
  clearTimeout(downFold);
  downProbe = { at: 0, live: [], busy: false };
  document.documentElement.classList.remove('has-down');
  document.documentElement.style.removeProperty('--down-h');
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
// (Update.safeToReload): coming back to the app, or away from it (Update.away). Deploys come many
// times a day and the old page keeps working with its own files, so until then 설정 only gets a
// dot (rail, tab bar) and 설정 → 정보 says when. Only a server on another API version
// (Update.mustReload) doesn't wait for that: it reloads as soon as nothing would be lost, and
// meanwhile a bar at the top says the page needs it.
const myBuild = pageBuild(); // settings.js: the build this page was served with
let serverBuild = null;
let returnedAt = 0; // when the app last came back to the foreground
let touchedAt = Date.now(); // the last key, tap, click or wheel on this page
const RELOAD_KEY = 'herdr-hub.reloadedFor'; // { v: build id, t }: this tab's last try (sessionStorage)
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
for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) document.addEventListener(type, () => (touchedAt = Date.now()), { capture: true, passive: true });
const returning = () =>
  document.visibilityState === 'hidden' ||
  Date.now() - returnedAt < 5000 ||
  Update.away({ visible: document.visibilityState === 'visible', focused: document.hasFocus(), idleMs: Date.now() - touchedAt });
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
const mustReload = () => Update.mustReload(myBuild, serverBuild);
function checkVersion(b) {
  if (!b || !b.id) return;
  if (serverBuild && b.id === serverBuild.id) {
    if (hasNew()) offerUpdate();
    return;
  }
  serverBuild = b;
  if (!hasNew()) return markUpdate();
  offerUpdate();
}
// Reload when that is safe and this version wasn't just tried; else the dot (and, for another
// API, the bar).
function offerUpdate() {
  const s = reloadState();
  if (mustReload()) s.returning = true; // no waiting for the app to come back
  if (Update.safeToReload(s) && Update.mayTry(session.get(RELOAD_KEY), serverBuild.id, Date.now())) return void reloadToNew({ auto: true });
  markUpdate();
}
// A new build not taken yet: looked at again now and then, as being away is a time, not an event
// (and a send finishing or a sheet closing can make a reload safe).
setInterval(() => hasNew() && offerUpdate(), 30000);
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
    if (auto && !Update.differs(myBuild, got)) return markUpdate();
  } catch {
    if (auto) return markUpdate();
  }
  if (auto && !Update.safeToReload({ ...reloadState(), returning: true })) return markUpdate(); // changed meanwhile
  stashDraft();
  location.reload();
}
// What shows that a new build waits (updateReady, core.js): the dot on 설정 (list.js
// renderUpdateDot), 설정 → 정보, and the bar only when this page can't go on (mustReload).
function markUpdate() {
  const now = hasNew();
  if (now !== updateReady) {
    updateReady = now;
    renderUpdateDot();
  }
  if (view.name === 'settings') renderVersionInfo();
  if (now && mustReload()) showUpdateBanner();
  else hideUpdateBanner();
}
// The bar: what is wrong and the one way out, at the start of the line; no ✕, it can't be put off
// (and it goes by itself with the reload as soon as that is safe).
let updateBanner = null;
function showUpdateBanner() {
  if (!mustReload() || downBar) return;
  if (!updateBanner) {
    updateBanner = document.createElement('div');
    updateBanner.className = 'update-bar';
    updateBanner.setAttribute('role', 'status');
    updateBanner.innerHTML = `<span class="ub-t">${T('이 화면이 서버와 맞지 않습니다')}<span class="ub-more">${T('. 새로고침하면 고쳐집니다')}</span></span>
      <button type="button" class="ub-go">${T('새로고침')}</button>`;
    updateBanner.querySelector('.ub-go').onclick = () => reloadToNew();
    document.body.appendChild(updateBanner);
    new ResizeObserver(() => updateBanner && document.documentElement.style.setProperty('--update-h', `${updateBanner.offsetHeight}px`)).observe(updateBanner);
  }
  updateBanner.querySelector('.ub-t').title = T('새 버전 {build} · API {api} (이 화면은 {mine})', { build: Update.shortLabel(serverBuild), api: serverBuild.api, mine: myBuild.api });
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
  // A page under a sideways swipe, or finishing one, isn't redrawn: it catches up after.
  if (backSwipeBusy()) return void (backSwipe.pending = true);
  forgetGone(); // kept chats of agents that are gone (agent.js)
  if (switcherOpen()) renderSwitcher();
  if (split) {
    render();
    if (!isDetail()) return renderEmpty();
  } else if (view.name === 'list') return render();
  if (view.name === 'ws') return renderWorkspace();
  if (view.name === 'settings') return renderSettings();
  if (view.name === 'repos') return void (renderReposBody(), loadRepoLists()); // repo.js: a host that came (or the first state) is read
  if (view.name === 'repo') return drawAgents();
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
    // herdr's stateSeq, and the status the host shows: a slash command's menu or a dialog the
    // host reads off the screen (lib/askhold.js) turns idle into 답 필요 under the same
    // stateSeq, and is read at once, not on the next 3 s poll.
    const mark = a && `${a.stateSeq}|${a.status}|${a.menu ? 'menu' : ''}`;
    const changed = a && mark !== detail.lastSeq;
    // The screen read for the previous state must not label buttons for the next prompt.
    if (changed && detail.lastSeq !== -1) detail.blockedText = null;
    renderDetailHeader();
    markSeen(a);
    if (changed) {
      detail.lastSeq = mark;
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
  // A sideways gesture's pages go back as they were first (backswipe.js, tabswipe.js): the list
  // a back swipe showed behind its page is list.js's again, for the list drawn below.
  backSwipeRelease(relayout);
  tabSwipeRelease();
  if (!history.state || !('prev' in history.state)) history.replaceState({ ...(history.state || {}), prev: lastHash }, '');
  const from = lastHash ? Route.parse(lastHash.replace(/^#/, '') || '/') : null; // for fwdchip.js
  lastHash = location.hash || '#/';
  if (!relayout) noteVisit(lastHash);
  if (!relayout) stashDraft(); // relayout() kept it before the old composer went away
  const was = relayout ? { view, detail, sheet: Boolean(detail.sheet) } : null;
  clearInterval(pollTimer);
  clearInterval(tickTimer);
  tickTimer = null;
  liveStop(); // the shell's live channel (shell.js): a new view opens its own
  // relayout opens it again over the same entry (core.js: Back still closes it).
  hist.hold = relayout;
  closeScreenSheet();
  hist.hold = false;
  swipe.g = null;
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
  if (!split && !['list', 'settings', 'repos'].includes(r.name)) parkTab();
  // 빠른 이동 lists these first (switcher.js).
  if ((r.name === 'agent' || r.name === 'term') && (host || localId())) noteRecent(link(host || localId(), `/${r.name}/${encodeURIComponent(r.pane)}`));
  if (r.name === 'agent') {
    // An agent always shows its chat. …/screen (the old 화면 tab) opens the terminal sheet over it.
    const pane = r.pane;
    view = { name: 'agent', host };
    // Still this visit's host once the state is known (the same pane id on another host is not it).
    const sameHost = () => curHost() === (host || localId());
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
        const d = view.name === 'agent' && detail.pane === pane && sameHost() && drafts.get(rowKey(curHost(), pane));
        const input = document.getElementById('d-input');
        if (d && input && !input.value) {
          input.value = d.text;
          updateComposer();
        }
      });
    }
    loadDetail();
    closeNotes(curHost(), pane);
    ready.then(() => view.name === 'agent' && detail.pane === pane && sameHost() && markSeen(currentAgent()));
    pollTimer = setInterval(() => {
      const a = currentAgent();
      // Also retry a screen read that failed, whatever the status; the sheet keeps reading while open.
      if (a && (a.status === 'working' || a.status === 'blocked' || subsOf(a) || detail.sheet || (scr && scr.error))) loadDetail();
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
  } else if (r.name === 'repos') {
    view = { name: 'repos' };
    renderRepos({ focus: true }); // repo.js: the phone's 저장소 tab, split on the right
  } else if (r.name === 'repo') {
    // The same repository again (another commit, a file): its graph stays, only the rest is drawn.
    const same = view.name === 'repo' && (view.host || localId()) === (host || localId()) && view.id === r.id;
    view = { name: 'repo', host, id: r.id, c: r.c, w: r.w, f: r.f };
    renderRepo({ same });
    pollTimer = setInterval(repoPoll, RG_POLL_MS);
  } else if (r.name === 'settings') {
    view = { name: 'settings' };
    renderSettings({ focus: true }); // into the page (split: on the right, the list stays)
  } else if (r.name === 'keys') {
    view = { name: 'keys' };
    kp.rec = null;
    renderKeys({ focus: true, from }); // keyspage.js: split on the right, the phone a page of its own; on the tab of where it came from
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
  // What there is to go forward to, and the 「방금 본 대화」 chip (fwdchip.js).
  forwardRouted(from, r, relayout);
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
  $app.innerHTML = split
    ? `<nav class="rail" id="rail" aria-label="${T('탭')}"></nav><div class="col" id="list-pane"></div><div class="list-grip" role="separator" aria-orientation="vertical" aria-controls="list-pane" aria-label="${T('목록 칸 폭')}" tabindex="0" title="${T('끌어서 목록 칸 폭 바꾸기 · 두 번 누르면 자동')}"></div><div class="col" id="detail-pane"></div>`
    : '';
  syncGrip();
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
  const html = emptyDetailHtml();
  const cur = root.firstElementChild;
  if (cur && cur.classList.contains('empty-detail') && cur._html === html) return;
  root.innerHTML = html;
  root.firstElementChild._html = html;
}
// Also what a back swipe shows behind the page it closes (backswipe.js).
// An empty list says what to do instead: start a workspace, or why there is nothing (herdr down).
function emptyDetailHtml() {
  const off = sideOff();
  // The keys as this device has them (keymap.js), only those it has; each pair kept on one line.
  const k = (action, words) => {
    const h = Keymap.hint(action);
    return h ? `<span class="ed-k"><kbd>${esc(h)}</kbd> ${words}</span>` : '';
  };
  const keyLine = (keys) => (keys.filter(Boolean).length ? `<p class="ed-keys">${keys.filter(Boolean).join('<span class="ed-sep" aria-hidden="true"> · </span>')}</p>` : '');
  const icon = `<span class="ed-ic" aria-hidden="true">${ICON.panel}</span>`;
  const f = filter();
  if (live && !listModel().list.length) {
    const down = state.herdr !== 'up' && (f === localId() || (f === 'all' && !multi()));
    const peer = f !== 'all' && f !== localId() ? hostOf(f) : null;
    if (down || (peer && (!peer.online || peer.herdr !== 'up'))) {
      const where = peer ? peer.label : hostLabel(localId()) || state.host || T('이 호스트');
      return `<div class="empty-detail">
      ${icon}
      <h2>${T('{host} 의 에이전트를 볼 수 없습니다', { host: esc(where) })}</h2>
      ${peer && !peer.online ? `<p>${T('그 호스트가 잠들었거나 Herdr Hub 가 꺼져 있습니다.')}</p>` : peer ? `<p>${T('그 호스트에서 herdr 가 실행 중인지 확인하세요.')}</p>` : herdrHelp()}
      <div class="ed-acts">${connLink(T('연결 상태 보기'))}</div>
    </div>`;
    }
    const href = f === 'all' ? '#/new' : link(f, '/new');
    return `<div class="empty-detail">
      ${icon}
      <h2>${T('아직 워크스페이스가 없습니다')}</h2>
      <p>${T('폴더를 고르면 에이전트까지 바로 시작합니다.')}</p>
      <div class="ed-acts"><a class="btn" href="${href}"${keyAttrs('newWorkspace', T('새 워크스페이스'))}>${T('새 워크스페이스')}</a></div>
      ${keyLine([k('newWorkspace', T('새 워크스페이스')), k('switcher', T('찾아 열기'))])}
    </div>`;
  }
  // Two keys to get going, and the sheet with the rest: a wall of hints reads as noise.
  const keys = [k('switcher', T('찾아 열기')), k('nextRow', T('목록 옮겨 다니기')), k('help', T('모든 단축키'))];
  return `<div class="empty-detail">
      ${icon}
      <h2>${off ? T('목록을 열어 에이전트를 고르세요') : T('왼쪽에서 에이전트를 고르세요')}</h2>
      ${off ? `<button type="button" class="btn secondary ed-open" aria-controls="list-pane"${keyAttrs('toggleSide', T('작업공간 목록 열기'))}>${T('작업공간 목록 열기')}</button>` : ''}
      ${keyLine(keys)}
    </div>`;
}

// ---- the sidebar's width: its edge (.list-grip) dragged, or ←/→ with the focus on it (16px a
// press), double-click (or Enter) for 자동. Kept as 설정 → 목록 칸 폭 (prefs.js listW).
const LIST_W = { min: 240, max: 480, step: 16 };
const listPaneWidth = () => {
  const el = document.getElementById('list-pane');
  return el ? Math.round(el.getBoundingClientRect().width) : 0;
};
const clampListW = (px) => Math.round(Math.min(LIST_W.max, Math.max(LIST_W.min, px, 0)));
function syncGrip() {
  const g = $app.querySelector('.list-grip');
  if (!g) return;
  const w = listPaneWidth();
  g.setAttribute('aria-valuemin', LIST_W.min);
  g.setAttribute('aria-valuemax', LIST_W.max);
  if (w) {
    g.setAttribute('aria-valuenow', w);
    g.setAttribute('aria-valuetext', `${w}px${Prefs.get('listW') === 'auto' ? ` (${T('자동@@inline')})` : ''}`);
  }
}
function setListWidth(v) {
  setPref('listW', v); // core.js applyListWidth
  syncGrip();
  hostSegEdges();
}
$app.addEventListener('pointerdown', (e) => {
  const g = e.target.closest && e.target.closest('.list-grip');
  if (!g || e.button) return;
  e.preventDefault();
  g.setPointerCapture(e.pointerId);
  const left = document.getElementById('list-pane').getBoundingClientRect().left;
  let px = null;
  g.classList.add('dragging');
  document.documentElement.classList.add('list-dragging');
  const move = (ev) => {
    px = clampListW(ev.clientX - left);
    applyListWidth(px); // live; stored when the finger or button lets go
  };
  const end = () => {
    g.removeEventListener('pointermove', move);
    g.removeEventListener('pointerup', end);
    g.removeEventListener('pointercancel', end);
    g.classList.remove('dragging');
    document.documentElement.classList.remove('list-dragging');
    if (px != null) setListWidth(String(px));
  };
  g.addEventListener('pointermove', move);
  g.addEventListener('pointerup', end);
  g.addEventListener('pointercancel', end);
});
$app.addEventListener('dblclick', (e) => e.target.closest && e.target.closest('.list-grip') && setListWidth('auto'));
// The separator's own keys (as any splitter's), not shortcuts: listed in keymap.js LOCAL.
$app.addEventListener('keydown', (e) => {
  const g = e.target.closest && e.target.closest('.list-grip');
  if (!g || e.ctrlKey || e.altKey || e.metaKey) return;
  const w = listPaneWidth();
  const to = { ArrowLeft: w - LIST_W.step, ArrowRight: w + LIST_W.step, Home: LIST_W.min, End: LIST_W.max }[e.key];
  if (to != null) setListWidth(String(clampListW(to)));
  else if (e.key === 'Enter') setListWidth('auto');
  else return;
  e.preventDefault();
});
window.addEventListener('resize', () => split && syncGrip());

// F6 / Shift+F6 (keymap.js nextPane / prevPane): the focus to the next or previous column, as
// VS Code's: the rail, the list (its selected row), the right (its field, else its page).
function focusPane(dir) {
  if (!split) return false;
  const panes = ['rail', ...(sideOff() ? [] : ['list-pane']), 'detail-pane'].map((id) => document.getElementById(id)).filter(Boolean);
  const a = document.activeElement;
  const i = panes.findIndex((p) => p.contains(a));
  const next = panes[i < 0 ? (dir > 0 ? 0 : panes.length - 1) : (i + (dir > 0 ? 1 : panes.length - 1)) % panes.length];
  let to = null;
  if (next.id === 'rail') to = next.querySelector('.rail-btn[aria-pressed="true"]') || next.querySelector('.rail-btn');
  else if (next.id === 'list-pane') {
    const on = next.querySelector('main.home [aria-current]');
    to = (on && (on.matches('a') ? on : on.querySelector('a'))) || next.querySelector('main.home a.sw-front, main.home a.ws-main') || next.querySelector('.bar a, .bar button');
  } else {
    const field = document.getElementById('d-input') || document.getElementById('t-input');
    if (field && !field.disabled && field.offsetParent) return refocusInput(field), true;
    to = next.querySelector('main[tabindex], form.panel[tabindex]') || next.querySelector('.empty-detail a, .empty-detail button, main a[href], main button, form input, form select, form button, .bar a, .bar button');
  }
  if (!to) {
    next.tabIndex = -1;
    to = next;
  }
  to.focus({ preventScroll: true });
  if (to.scrollIntoView && next.id === 'list-pane') to.scrollIntoView({ block: 'nearest' });
  return true;
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
  // The cards' heads count where they stand: with a workspace open, the step starts at its card.
  const links = [...main.querySelectorAll('a.sw-front, .ws-head a.ws-main')].map((a) => a.getAttribute('href'));
  const heads = [...main.querySelectorAll('.ws-head a.ws-main')].map((a) => a.getAttribute('href'));
  const on = main.querySelector('[aria-current]');
  const cur = on && (on.matches('a') ? on : on.querySelector('a.ws-main'));
  const next = Split.stepRow(links, cur && cur.getAttribute('href'), dir, heads);
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
// Into or out of the shell view, the keys the buttons show change (core.js hintCtx).
window.addEventListener('hashchange', () => refreshKeyHints());
// Links marked data-back go back in history when that is where they lead (see goBack).
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[data-back]');
  if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
  e.preventDefault();
  goBack(a.getAttribute('href'));
});
function stepTermFont(dir) {
  const sizes = Object.keys(Prefs.row('termFont').options);
  const i = sizes.indexOf(Prefs.get('termFont')) + dir;
  if (i >= 0 && i < sizes.length) setPref('termFont', sizes[i]);
  const v = Prefs.get('termFont');
  const edge = i < 0 ? ` (${T('가장 작게')})` : i >= sizes.length ? ` (${T('가장 크게')})` : '';
  toast(`${T('셸 글자 크기: {size}', { size: Prefs.row('termFont').options[v] })}${edge}`, { id: 'termFont' });
  return true;
}
// Keyboard: every shortcut is a binding in keymap.js; these are what its actions do. A handler
// returns true when it acted (the key is then taken). In the shell view a key with the focus on
// the page goes to the shell first (termStrayKey).
const KEY_ACTIONS = {
  // Esc: the top sheet or menu, else a slash command's menu open in the agent (/model, /config:
  // Esc to Claude Code, as the box's 취소 — from the message box too, where the focus is after
  // sending the command), else out of a field, else back. Always taken:
  // Android turns an Escape the page leaves alone into Back, which closes the app when there is
  // nothing behind (a keyboard cover's Esc minimised the Hub).
  back(b, e) {
    const top = topLayer();
    const a = !top && view.name === 'agent' ? currentAgent() : null;
    if (top) closeLayer(top);
    else if (a && a.status === 'blocked' && a.menu && !a.stale) {
      if (!(e && e.repeat)) menuSend('esc'); // a held key cancels once (answer.js: in order with the arrows)
    } else if (editable(document.activeElement)) document.activeElement.blur();
    else if (reorder.on && listShown()) setReorder(false); // 순서 바꾸기 ends (reorder.js)
    else {
      const back = view.name !== 'list' && $app.querySelector('a[data-back]');
      if (back) goBack(back.getAttribute('href'));
    }
    return true;
  },
  // Ctrl+W / ⌘W in the installed app, as a window's tab: the top sheet, else out of what is open
  // (the agent keeps running), as ‹ does, from a field too. Nothing left to close: the key is
  // left to the browser, which closes the app window as ⌘W does anywhere. A held key closes one
  // thing only and never the window.
  leaveView(b, e) {
    if (e && e.repeat) return true;
    const top = topLayer();
    if (top) return closeLayer(top), true;
    if (view.name === 'settings') return toggleSettings(), true;
    if (view.name === 'repos') return toggleRepos(), true;
    const back = view.name !== 'list' && $app.querySelector('a[data-back]');
    if (!back) return false;
    goBack(back.getAttribute('href'));
    return true;
  },
  help: () => (toggleKeys(), true), // keyspage.js
  settings: () => (toggleSettings(), true),
  repos: () => (toggleRepos(), true), // repo.js
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
  // The screen box on show: the shell view's, or the agent's terminal screen (sheet or body).
  wrap() {
    if (!scr) return false;
    const key = scr.kind === 'term' ? 'wrap.term' : 'wrap.agent';
    setPref(key, !Prefs.get(key));
    toast(Prefs.get(key) ? T('줄바꿈을 켰습니다') : T('줄바꿈을 껐습니다'), { id: 'wrap' });
    return true;
  },
  // 셸 글자 크기 one step (설정 → 화면 has the same three).
  termFontUp: () => stepTermFont(1),
  termFontDown: () => stepTermFont(-1),
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
  commands: () => toggleSwitcher({ commands: true }),
  nextBlocked: () => stepBlocked(1), // list.js
  reorder: () => toggleReorder(), // reorder.js
  prevBlocked: () => stepBlocked(-1),
  terminal: () => toggleScreenSheet(), // agent.js
  usage: () => view.name === 'agent' && (openUsage(), true), // agent.js
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
  // The workspace of what is open (an agent, a shell, a workspace), or of the list row the focus
  // is on, after the same sheet as its menu's 워크스페이스 닫기; this key again confirms.
  closeWorkspace() {
    const w = workspaceHere();
    if (!w) return false;
    closeWorkspace(w, 'closeWorkspace'); // actions.js
    return true;
  },
  // In the message box only: elsewhere Shift+Tab moves the focus back, as always.
  mode() {
    if (view.name !== 'agent' || document.activeElement?.id !== 'd-input') return false;
    cycleMode(); // agent.js: Claude's own Shift+Tab, through herdr
    return true;
  },
  // The agent or shell open before this one (route keeps the two); from anywhere else (the list
  // it was just left for, 설정) the one last open, as the 「방금 본 대화」 chip opens it.
  lastView() {
    const to = view.name === 'agent' || view.name === 'term' ? visits.prev : visits.cur;
    if (!to) return false;
    stepFocus = true; // the caret into its field, as Alt+↑/↓
    location.hash = to;
    return true;
  },
  answer: (b) => answerKey(Number(b.key)), // answer.js
  menuKey: (b, e) => menuKey(b.key, e), // answer.js
  toggleSide: () => (setSideOff(!sideOff()), true), // as the rail's 작업공간
  nextPane: () => focusPane(1),
  prevPane: () => focusPane(-1),
  stop: () => stopKey(), // agent.js
  // A new agent at once in the workspace of what is open (a new tab there), as this device last
  // started one (quickStart); else a new workspace. The form is the new chat's 「종류·옵션 바꾸기」.
  newAgent(b, e) {
    const host = curHost();
    const of = (list, pane) => (list || []).find((x) => same(x, host, pane));
    const ws = view.name === 'ws' ? view.id : view.name === 'agent' ? (of(state.agents, detail.pane) || {}).workspace : view.name === 'term' ? (of(state.terminals, view.pane) || {}).workspace : null;
    if (!ws) return KEY_ACTIONS.newWorkspace();
    if (!(e && e.repeat)) quickStart(host, ws);
    return true;
  },
  // The ⋯ menu: of the row the focus is on (the list, the workspace page), else of what is open.
  // It opens beside its ⋯ (or the row) in the split layout (core.js menu).
  menu() {
    const a = document.activeElement;
    const row = a && a.closest && a.closest('[data-kind]');
    if (row && !topLayer()) {
      rowMenu(row); // rows.js
      return true;
    }
    const more = (id) => {
      const b = document.getElementById(id);
      return b && !b.hidden && b.offsetParent ? { el: b } : null;
    };
    if (view.name === 'agent' && currentAgent() && more('d-more')) return paneMenu('agent', currentAgent(), { anchor: more('d-more') }), true;
    if (view.name === 'term' && currentTerminal() && more('t-more')) return paneMenu('term', currentTerminal(), { anchor: more('t-more') }), true;
    if (view.name === 'ws') {
      const w = (state.workspaces || []).find((x) => same(x, curHost(), view.id, 'workspace_id'));
      const h1 = detailRoot().querySelector('.ws-bar h1');
      if (w) return wsMenu(w, { anchor: h1 ? { el: h1 } : null }), true;
    }
    return false;
  },
  // As the list's +: on the host the list is filtered to, if any.
  newWorkspace() {
    const f = filter();
    location.hash = f === 'all' ? '#/new' : link(f, '/new');
    return true;
  },
};
// The workspace a 워크스페이스 닫기 means here: the focused row's (the list, the workspace page),
// else that of the agent, shell or workspace open; null when there is none.
function workspaceHere() {
  const a = document.activeElement;
  const row = a && a.closest && !topLayer() && a.closest('[data-kind]');
  if (row) {
    const x = rowTarget(row); // rows.js
    if (x) return row.dataset.kind === 'ws' ? x : wsFor(x.host || localId(), x.workspace);
  }
  const host = curHost();
  if (view.name === 'ws') return (state.workspaces || []).find((x) => same(x, host, view.id, 'workspace_id')) || null;
  const x = view.name === 'agent' ? currentAgent() : view.name === 'term' ? currentTerminal() : null;
  return x ? wsFor(host, x.workspace) : null;
}
// Ctrl+N: an agent started right away in workspace ws, with this device's last kind and options
// (quick.js; Claude with none the first time) and the server's name, in the folder of what is
// open (startFolderFor; the toast says where), then its chat opened with
// the caret in the composer. One at a time: a held key or a second press while it starts does
// nothing more. The page moved on meanwhile: a toast to open it instead.
let quickBusy = false;
// Where Ctrl+N (and the start form, prefilled) opens the new tab on host, in workspace ws
// (quick.js startFolder): the open agent's or shell's folder, else the workspace's 기본 폴더, else
// that of the one in ws viewed last here, else '' (herdr's active tab there).
function startFolderFor(host, ws) {
  const open = view.name === 'agent' ? currentAgent() : view.name === 'term' ? currentTerminal() : null;
  const w = wsFor(host, ws);
  const href = (kind, x) => link(host, `/${kind}/${encodeURIComponent(x.pane)}`);
  const mine = (x) => (x.host || localId()) === host && x.workspace === ws;
  const panes = [
    ...(state.agents || []).filter(mine).map((a) => ({ href: href('agent', a), workspace: a.workspace, cwd: a.cwd })),
    ...(state.terminals || []).filter(mine).map((t) => ({ href: href('term', t), workspace: t.workspace, cwd: t.cwd })),
  ];
  return Quick.startFolder({ open: open && (open.host || localId()) === host ? open : null, ws, def: (w && w.defaultCwd) || '', panes, recent: recentList() });
}
async function quickStart(host, ws) {
  if (quickBusy) return toast(T('새 에이전트를 시작하는 중입니다'), { id: 'quick' });
  quickBusy = true;
  const from = location.hash;
  try {
    let info = null;
    try {
      info = await hostInfo(host);
    } catch {
      /* the server checks the kind anyway */
    }
    const kinds = info && info.kinds;
    const spec = Quick.specFor(Quick.last(), kinds);
    const cwd = startFolderFor(host, ws);
    const where = cwd ? ` · ${RowText.homePath(cwd, info && info.home)}` : '';
    toast(`${T('새 {kind} 에이전트를 시작하는 중…', { kind: kindLabel(spec.kind) })}${spec.args.length ? ` (${spec.args.join(' ')})` : ''}${where}`, { id: 'quick', ms: 60000 });
    const r = await act(hp(`/workspaces/${encodeURIComponent(ws)}/agents`, host), cwd ? { ...spec, cwd } : spec, null, T('에이전트를 시작하지 못했습니다'));
    for (const t of document.querySelectorAll('.toast[data-id="quick"]')) t.remove();
    if (!r || !r.pane) return;
    Quick.started(rowKey(host, r.pane));
    const to = link(host, `/agent/${encodeURIComponent(r.pane)}`);
    if (location.hash !== from) return toast(T('새 에이전트를 시작했습니다'), { action: { label: T('열기'), run: () => (location.hash = to) } });
    stepFocus = true; // the caret into its composer (route)
    location.hash = to;
  } finally {
    quickBusy = false;
  }
}
// Where a key is pressed, for Keymap.match. The shell's field in 키 직접 입력 is the shell, not a
// field one types into: there a binding with shell decides alone (shell.js asks the same).
function keyContext() {
  const a = document.activeElement;
  const rawShell = view.name === 'term' && detail.raw && a && a.id === 't-input';
  return { field: editable(a) && !rawShell, shell: view.name === 'term', layer: Boolean(topLayer()), split };
}
document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented) return;
  if (termStrayKey(e)) return e.preventDefault();
  const b = Keymap.match(e, keyContext());
  if (b && KEY_ACTIONS[b.action](b, e)) {
    e.preventDefault();
    // An IME or a dead key (Option+` on a Mac) may still type the chord's character into the field
    // the action left focused (Alt+` there typed a `): drop text that comes right after it.
    if (e.keyCode === 229 || e.isComposing || e.key === 'Dead') swallowTextUntil = Date.now() + 400;
    return;
  }
  if (e.isComposing) return;
  chatStrayKey(e);
});
let swallowTextUntil = 0;
document.addEventListener('beforeinput', (e) => {
  if (Date.now() > swallowTextUntil || !/^insert(Text|CompositionText)$/.test(e.inputType) || !e.data || e.data.length !== 1) return;
  if (e.cancelable) e.preventDefault();
  else { // a composition can't be cancelled: take the character out once it is in
    const t = e.target;
    t.addEventListener('input', () => {
      const v = t.value, at = t.selectionStart;
      if (typeof v === 'string' && at > 0 && v[at - 1] === e.data) { t.value = v.slice(0, at - 1) + v.slice(at); t.setSelectionRange(at - 1, at - 1); }
    }, { once: true });
  }
  swallowTextUntil = 0;
}, true);
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
  if (b.dataset.tab === 'repos') return toggleRepos(); // repo.js
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
applyListWidth();
connect();
hubLost(); // until the first state: a hub that never answers shows the notice too
if (splitMq.matches) relayout();
else route();
