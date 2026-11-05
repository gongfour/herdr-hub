'use strict';
// The list: 작업공간 (workspace cards), the bottom tab bar, the unread mark of finishes not opened
// yet, and the times on the rows.

// ------------------------------------------------------------ list view

// The herdr hierarchy: host → workspace → pane, one card per workspace; cards with a blocked
// agent come first. State updates patch the list in place (one
// element per card, replaced only when its HTML changed), so the scroll position and an open
// row survive them; a card that does change closes the row open in it.

const rowKey = (host, id) => `${host || localId()}|${id}`;
// herdr pane ids count up in base 36 (p9, pA, … pZ, p10): shorter first, then by character.
const paneOrder = (x, y) => x.pane.length - y.pane.length || (x.pane < y.pane ? -1 : x.pane > y.pane ? 1 : 0);
const wsRank = (agents) => (agents.some((a) => a.status === 'blocked') ? 0 : agents.some((a) => a.status === 'working') ? 1 : 2);

// How long an agent has worked and when it finished: the hub keeps both (workingSince, doneAt;
// lib/times.js), so they show as soon as the app opens. Spans carry the time and tick() fills
// in the words, so a card's HTML stays the same from one second to the next.
function durKo(sec) {
  sec = Math.max(0, Math.floor(sec));
  if (sec < 60) return `${sec}초`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}분`;
  return `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}`;
}
function agoKo(t) {
  const sec = (Date.now() - t) / 1000;
  if (sec < 45) return '방금';
  if (sec < 3600) return `${Math.max(1, Math.round(sec / 60))}분 전`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`;
  return new Date(t).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' }); // 11월 4일, not 11. 4.
}
// "12분" (working) / "3분 전" (finished) at a row's right end; nothing when the hub doesn't know.
function timeTag(a) {
  if (a.status === 'working' && a.workingSince) return `<span class="el" data-since="${Number(a.workingSince)}"></span>`;
  if ((a.status === 'done' || a.status === 'idle') && a.doneAt) return `<span class="el ago" data-ago="${Number(a.doneAt)}" title="${esc(clock(a.doneAt))} 완료"></span>`;
  return '';
}
function fillTimes(root) {
  for (const el of root.querySelectorAll('.el[data-since]')) el.textContent = durKo((Date.now() - Number(el.dataset.since)) / 1000);
  for (const el of root.querySelectorAll('.el[data-ago]')) el.textContent = agoKo(Number(el.dataset.ago));
}

// A workspace by id; one herdr hasn't listed yet is made up from a pane that is in it.
function wsFor(host, id) {
  const w = (state.workspaces || []).find((x) => same(x, host, id, 'workspace_id'));
  if (w) return w;
  const p = [...state.agents, ...(state.terminals || [])].find((x) => same(x, host, id, 'workspace'));
  return p ? { workspace_id: id, label: p.workspaceLabel, host: p.host, hostLabel: p.hostLabel, pane_count: 0, tab_count: 0 } : null;
}

// ---- tabs: 작업공간 (the workspace cards) / 설정, as a bottom tab bar
// Where 뒤로 from an agent, shell or workspace leads: 작업공간 (split: the list is beside it, so
// it closes the detail).
const homeHash = () => '#/';

// 뒤로 in a detail header. Split, the list is already beside it: a detail that leads back to
// the list gets ✕ (닫기) at the end of the header instead, and closing it goes to the list route.
// close: ✕ for a page that leads back elsewhere too (에이전트 시작 goes back to what it was opened over).
function backLink(href, label = '작업공간', close = split && href === homeHash()) {
  if (close) return `<a class="icon-btn close-detail" href="${href}" data-back aria-label="닫기"${keyAttrs('back', '닫기')}>${ICON.x}</a>`;
  return `<a class="icon-btn" href="${href}" data-back aria-label="${label}"${keyAttrs('back', '뒤로')}>${ICON.back}</a>`;
}

// A new build waiting (app.js markUpdate): a dot on 설정, as VS Code's on its gear. No number (a
// count of deploys means nothing) and not the app icon's badge (that is for 답 필요).
const updateDot = () => (updateReady ? '<span class="rail-dot" role="img" aria-label="새 버전 있음"></span>' : '');
function renderUpdateDot() {
  if (split) return renderRail();
  const bar = listRoot().querySelector(':scope > .tabbar');
  if (bar) mountTabBar(bar.querySelector('.tab[aria-current="page"][href="#/settings"]') ? 'settings' : 'spaces');
}
function tabBar(active) {
  const n = state.agents.filter((a) => a.status === 'blocked' && shown(a)).length;
  const tab = (key, href, icon, label, extra = '') =>
    `<a class="tab" href="${href}"${active === key ? ' aria-current="page"' : ''}>${icon}<span>${label}</span>${extra}</a>`;
  return `<nav class="tabbar" aria-label="탭">
    ${tab('spaces', '#/', ICON.grid, '작업공간', n ? `<span class="tab-badge" aria-label="답 필요 ${n}">${n}</span>` : '')}
    ${tab('settings', '#/settings', ICON.gear, '설정', updateDot())}
  </nav>`;
}
// Each tab's page is kept once drawn: switching puts the other tab's tree back as it was (its
// scroll included) and its render patches only what changed. The page on screen sits in the
// list root; the other waits here, detached, and misses state updates until it is shown again.
const tabPages = { spaces: null, settings: null }; // [[element, scrollTop], …]
const tabOf = (root) => (root.querySelector(':scope > main.home') ? 'spaces' : root.querySelector(':scope > main.settings') ? 'settings' : null);
// Take the tab page shown in root out, to come back to later. Returns its tab, or null.
function parkTab(root = listRoot()) {
  const cur = root && tabOf(root);
  if (!cur) return null;
  tabPages[cur] = [...root.children].filter((el) => !el.classList.contains('tabbar')).map((el) => [el, el.scrollTop]);
  for (const [el] of tabPages[cur]) el.remove();
  return cur;
}
// Make tab t the page in the list root: its kept page, or nothing but the tab bar for the
// caller to fill. Whatever else was there (the phone's last detail view) goes.
function showTab(t) {
  const root = listRoot();
  if (tabOf(root) === t) return;
  if (!parkTab(root)) for (const el of [...root.children]) if (!el.classList.contains('tabbar')) el.remove();
  const kept = tabPages[t];
  tabPages[t] = null;
  if (!kept) return;
  const bar = root.querySelector(':scope > .tabbar');
  for (const [el] of kept) root.insertBefore(el, bar);
  for (const [el, top] of kept) if (top) el.scrollTop = top;
}
// The layout changed (relayout): kept pages were drawn for the other one.
const dropTabPages = () => (tabPages.spaces = tabPages.settings = null);

// Split, the tabs are the activity rail instead (renderRail); the list column has no tab bar.
function mountTabBar(active) {
  if (split) return renderRail();
  const root = listRoot();
  const html = tabBar(active);
  const old = root.querySelector(':scope > .tabbar');
  if (old && old._html === html) return;
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  const el = t.content.firstElementChild;
  el._html = html;
  if (old) old.replaceWith(el);
  else root.appendChild(el);
}

// ---- split: the activity rail at the far left (as in VS Code) and the sidebar it folds
// The rail has 작업공간 at the top and 설정 at the bottom. Pressing the tab the sidebar shows
// folds the sidebar away and the detail takes its width; pressing either opens it again on that
// tab. Folded is remembered on this device. The folded list column keeps its DOM (display: none),
// so it stays current and Alt+↑/↓ still steps through it.
const SIDE_KEY = 'herdr-hub.sideOff';
let memSide = null;
function sideOff() {
  if (memSide == null) {
    try {
      memSide = localStorage.getItem(SIDE_KEY) === '1';
    } catch {
      memSide = false;
    }
  }
  return memSide;
}
function setSideOff(off) {
  memSide = off;
  try {
    if (off) localStorage.setItem(SIDE_KEY, '1');
    else localStorage.removeItem(SIDE_KEY);
  } catch {
    /* this page only */
  }
  document.documentElement.classList.toggle('side-off', off);
  if (!split) return;
  renderRail();
  syncGrip(); // app.js: its width again, now that the list shows (or doesn't)
  if (!isDetail()) renderEmpty(); // its words say where the list is
}

function renderRail() {
  const rail = document.getElementById('rail');
  if (!rail) return;
  const n = state.agents.filter((a) => a.status === 'blocked' && shown(a)).length;
  const open = !sideOff();
  // Finishes not opened yet, on 작업공간 while its list is out of sight.
  const dot = !open && state.agents.some((a) => shown(a) && isUnread(a));
  const btn = (key, icon, label, extra = '') => {
    const on = key === 'spaces' ? open : view.name === 'settings';
    const what = key === 'spaces' ? `${label} 사이드바 ${open ? '접기' : '열기'}` : `${label} ${on ? '닫기' : '열기'}${updateReady ? ' — 새 버전 있음' : ''}`;
    return `<button type="button" class="rail-btn" data-tab="${key}" aria-controls="${key === 'spaces' ? 'list-pane' : 'detail-pane'}" aria-pressed="${on}"${on ? ' aria-current="page"' : ''} aria-label="${what}"${keyAttrs(key === 'spaces' ? 'toggleSide' : 'settings', key === 'settings' && updateReady ? `${label} — 새 버전 있음` : label)}>${icon}${extra}</button>`;
  };
  const html = `${btn('spaces', ICON.grid, '작업공간', n ? `<span class="tab-badge" aria-label="답 필요 ${n}">${n}</span>` : dot ? '<span class="rail-dot" role="img" aria-label="새 결과"></span>' : '')}
    <span class="rail-gap"></span>
    ${btn('settings', ICON.gear, '설정', updateDot())}`;
  if (rail._html === html) return;
  rail.innerHTML = rail._html = html;
}

// ---- unread: finishes this device has not opened yet (per device, in localStorage)
const SEEN_KEY = 'herdr-hub.seen';
const SEEN_DAYS = 7;
let memSeen = null;
function seenMap() {
  if (!memSeen) {
    try {
      memSeen = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') || {};
    } catch {
      memSeen = {};
    }
  }
  return memSeen;
}
const isSeen = (k) => Boolean(seenMap()[k]);
// An agent row gets the unread mark (a dot, a bolder name) while this is true.
const isUnread = (a) => Inbox.unread({ ...a, host: a.host || localId() }, { isSeen });
// Opening an agent that has finished marks that finish read (not one that is still running).
// Split, the list beside it drops the mark at once.
function markSeen(a) {
  if (!a || a.status === 'working' || a.status === 'blocked') return;
  const k = Inbox.seenKey({ ...a, host: a.host || localId() });
  const m = seenMap();
  if (m[k]) return;
  if (split) setTimeout(render, 0);
  const cut = Date.now() - SEEN_DAYS * 86400000;
  for (const [key, t] of Object.entries(m)) if (t < cut) delete m[key];
  m[k] = Date.now();
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(m));
  } catch {
    /* this page only */
  }
}

// This agent's notification (tag host|pane, lib/notify.js): gone once it is answered or opened.
async function closeNotes(host, pane) {
  try {
    if (!('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg || !reg.getNotifications) return;
    for (const n of await reg.getNotifications({ tag: `${host || localId()}|${pane}` })) n.close();
  } catch {
    /* nothing to close */
  }
}

// Workspaces with blocked agents first, then working ones, then the rest, each group in herdr's
// order; inside a card agents before shells, each in pane order.
function listModel() {
  const agents = state.agents.filter(shown);
  const spaces = new Map();
  for (const w of (state.workspaces || []).filter(shown)) spaces.set(rowKey(w.host, w.workspace_id), { w, agents: [], terms: [] });
  const into = (x) => {
    const k = rowKey(x.host, x.workspace);
    if (!spaces.has(k)) spaces.set(k, { w: wsFor(x.host, x.workspace), agents: [], terms: [] });
    return spaces.get(k);
  };
  for (const a of agents) into(a).agents.push(a);
  for (const t of (state.terminals || []).filter(shown)) into(t).terms.push(t);
  const list = [...spaces.values()].map((s, i) => ({ ...s, i, rank: wsRank(s.agents) }));
  list.sort((x, y) => x.rank - y.rank || x.i - y.i);
  for (const s of list) {
    s.agents.sort(paneOrder);
    s.terms.sort(paneOrder);
  }
  return { blocked: agents.filter((a) => a.status === 'blocked'), list };
}

let listScroll = 0; // the list's scroll position, kept while a detail view is open

// The words under 작업공간: the host's name when there is one host. With more, the host segment
// right under it says which, so the header doesn't say it twice.
const hostLine = () => (multi() ? '' : state.host || '');

// A host's dot, the same in the host picker and on 설정 → 연결 (rowtext.js hostState, style.css
// .hdot): online breathes slowly, herdr not answering is amber, offline a grey hollow ring, all
// still. A host that has just come online (seen not up before, up now) pops once: 'came' stays on
// its dot for the pop's length, so either screen drawn in that time shows it.
const hostSeen = new Map(); // host id → { st, cameAt }
const HOST_POP_MS = 1200;
function hostDot(x) {
  const st = RowText.hostState(x);
  const r = hostSeen.get(x.id);
  if (!r) hostSeen.set(x.id, { st, cameAt: 0 });
  else if (r.st !== st) {
    if (st === 'up') r.cameAt = Date.now();
    r.st = st;
  }
  const came = r && st === 'up' && Date.now() - r.cameAt < HOST_POP_MS;
  return `<span class="hdot ${st}${came ? ' came' : ''}" aria-hidden="true"></span>`;
}
// A hidden page keeps its dots still (no work for a screen nobody sees).
document.addEventListener('visibilitychange', () => document.documentElement.classList.toggle('page-hidden', document.hidden));

// The host segment: one button per host, scrolling sideways when they don't fit (style.css
// .seg.hosts). Offline is a hollow grey dot (hostDot), and said in words to a screen reader (rowtext.js).
function hostSeg(f) {
  if (!multi()) return '';
  const btn = (x) => {
    const warn = apiMismatch(x);
    return `<button data-host="${esc(x.id)}" aria-pressed="${f === x.id}" class="${x.online ? '' : 'off'}" aria-label="${esc(RowText.hostAria(x, warn))}"${warn ? ` title="${esc(warn)} — 배포가 필요합니다"` : ''}>${hostDot(x)}<span class="hl">${esc(x.label)}</span>${warn ? '<span class="api-warn" aria-hidden="true">!</span>' : ''}</button>`;
  };
  return `
    <nav class="seg hosts" role="group" aria-label="호스트"${keyAttrs('prevHost|nextHost', '호스트 바꾸기')}>
      <button data-host="all" aria-pressed="${f === 'all'}">전체</button>
      ${hosts().map(btn).join('')}
    </nav>`;
}
// The chosen host's button in view (after a tap, a swipe or Alt+←/→), the segment otherwise
// where it was left.
function showChosenHost(nav, left = 0) {
  if (!nav) return;
  nav.scrollLeft = left;
  const b = nav.querySelector('button[aria-pressed="true"]');
  const pad = 12;
  if (b && nav.scrollWidth > nav.clientWidth) {
    if (b.offsetLeft - pad < nav.scrollLeft) nav.scrollLeft = b.offsetLeft - pad;
    else if (b.offsetLeft + b.offsetWidth + pad > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = b.offsetLeft + b.offsetWidth + pad - nav.clientWidth;
  }
  hostSegEdges(nav);
}
// The segment says there is more past an edge by fading it (style.css .more-l / .more-r).
function hostSegEdges(nav = listRoot() && listRoot().querySelector(':scope > .seg.hosts')) {
  if (!nav) return;
  const max = nav.scrollWidth - nav.clientWidth;
  nav.classList.toggle('more-l', max > 1 && nav.scrollLeft > 1);
  nav.classList.toggle('more-r', max > 1 && nav.scrollLeft < max - 1);
}
document.addEventListener('scroll', (e) => e.target.matches && e.target.matches('.seg.hosts') && hostSegEdges(e.target), true);
// A mouse wheel has no sideways: over a segment that scrolls, it scrolls the segment.
document.addEventListener(
  'wheel',
  (e) => {
    const nav = e.target.closest && e.target.closest('.seg.hosts');
    if (!nav || e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY) || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollLeft += e.deltaY;
    e.preventDefault();
  },
  { passive: false },
);

function render() {
  if (tabSwipeBusy()) return void (tabSwipe.pending = true); // the pages under a host swipe
  if (swipe.g && Date.now() - swipe.g.t0 < 10000) return void (swipe.pending = true); // after the finger lifts
  showTab('spaces');
  const root = listRoot();
  const f = filter();
  const sub = esc(hostLine());
  const top = `
    <header class="bar">
      <h1>작업공간${sub ? `<span class="sub">${sub}</span>` : ''}</h1>
      ${liveChip()}
      <a class="icon-btn" href="${f === 'all' ? '#/new' : link(f, '/new')}" aria-label="새 워크스페이스"${keyAttrs('newWorkspace', '새 워크스페이스')}>${ICON.plus}</a>
    </header>${hostSeg(f)}`;
  const parts = homeParts(f);
  let main = root.querySelector(':scope > main.home');
  const fresh = !main;
  const segLeft = root.querySelector(':scope > .seg.hosts')?.scrollLeft || 0;
  if (fresh) {
    root.innerHTML = `${top}<main class="list home"></main>`;
    main = root.querySelector(':scope > main.home');
    main._top = top;
    bindList(main);
  } else if (main._top !== top) {
    root.querySelectorAll(':scope > header, :scope > nav:not(.tabbar)').forEach((el) => el.remove());
    main.insertAdjacentHTML('beforebegin', top);
  }
  main._top = top;
  showChosenHost(root.querySelector(':scope > .seg.hosts'), segLeft);
  patchList(main, parts);
  // The live stream down: what is listed may be old (style.css main.home.stale, tickList).
  main.classList.toggle('stale', !live && state.herdr !== 'connecting');
  // #/new open on the right: the + is marked as what is open.
  const plus = root.querySelector(':scope > .bar a[href$="/new"]');
  if (plus) plus.toggleAttribute('aria-current', split && view.name === 'form' && view.mode === 'new');
  if (plus && plus.hasAttribute('aria-current')) plus.setAttribute('aria-current', 'page');
  mountTabBar('spaces');
  // Back from an agent: where the list was left.
  if (fresh && listScroll) main.scrollTop = listScroll;
  root.querySelectorAll('.hosts button').forEach((b) => {
    b.onclick = () => {
      setFilter(b.dataset.host);
      render();
      if (split && !isDetail()) renderEmpty(); // its 답 필요 count follows the filter
    };
  });
  markSelected();
  tickList();
  syncChip(); // fwdchip.js: its name follows a rename; gone with the agent
}

// The list's keyed parts for host f: the hint and the offline notes, then the cards (also the
// neighbour host's list that a host swipe brings in beside it, tabswipe.js).
function homeParts(f = filter()) {
  const down = state.herdr !== 'up';
  const { list } = listModel();
  // Peers in view that are offline or whose herdr is down.
  const trouble = hosts().filter((h) => !h.local && (f === 'all' || f === h.id) && (!h.online || h.herdr !== 'up'));
  return [
    ...(swipeHintShown() && (list.length || state.agents.length) ? [['hint', `<p class="hint-row" role="note"><span>${RowText.hintText(multi())}</span><button type="button" class="icon-btn hint-x" aria-label="안내 닫기">${ICON.x}</button></p>`]] : []),
    ...trouble.map((x) => [`off|${x.id}`, `<div class="offline" role="status"><p><b>${esc(x.label)}</b> ${x.online ? 'herdr 연결 끊김 — 그 기기에서 herdr 가 실행 중인지 확인하세요' : `오프라인${x.since ? ` · ${esc(clock(x.since))}부터` : ''} — 잠들었거나 Herdr Hub 가 꺼져 있습니다${x.staleAt ? `. 아래 흐린 줄은 ${esc(RowText.asOf(x.staleAt))} 모습입니다` : ''}`}</p>${connLink('연결 상태 보기')}</div>`]),
    ...spacesParts(list, down, f),
  ];
}

// Alt+←/→ (split.js hostKey): the host segment one step along. Phone: on the list view only.
// Split: always, and the sidebar comes out to show it: unfolded, and on 작업공간 if it was on
// 설정. False when there is no segment to step.
function stepHostFilter(dir) {
  if (!multi() || (!split && view.name !== 'list')) return false;
  const next = Split.stepHost(['all', ...hosts().map((h) => h.id)], filter(), dir);
  if (!next) return false;
  setFilter(next);
  if (split) {
    if (sideOff()) setSideOff(false);
    renderRail();
  }
  render();
  if (split && !isDetail()) renderEmpty(); // its 답 필요 count follows the filter
  return true;
}

// Alt+Shift+↓/↑: the next (previous) agent waiting for an answer, in the list's order, round
// from either end; from anything else, the first (last). A toast when none is waiting.
function stepBlocked(dir) {
  const waiting = listModel().list.flatMap((s) => s.agents.filter((a) => a.status === 'blocked'));
  if (!waiting.length) {
    toast('답이 필요한 에이전트가 없습니다');
    return true;
  }
  const i = view.name === 'agent' ? waiting.findIndex((a) => same(a, curHost(), detail.pane)) : -1;
  const a = i < 0 ? waiting[dir > 0 ? 0 : waiting.length - 1] : waiting[(i + (dir > 0 ? 1 : waiting.length - 1)) % waiting.length];
  if (i >= 0 && waiting.length === 1) return toast('답이 필요한 에이전트는 이것 하나입니다'), true;
  stepFocus = true; // the caret into its composer, as Alt+↑/↓
  location.hash = link(a.host, `/agent/${encodeURIComponent(a.pane)}`);
  return true;
}

// 설정 → 연결: the hosts and their herdr, scrolled to (renderSettings takes settingsAt).
let settingsAt = null;
const connLink = (label) => `<a class="go-conn" href="#/settings" data-settings-at="g-conn">${esc(label)}<span aria-hidden="true"> ›</span></a>`;
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-settings-at]');
  if (a) settingsAt = a.dataset.settingsAt;
});

// No cards: what to do next. A peer that is offline or whose herdr is down has its note above
// (homeParts) and nothing more here.
function spacesParts(list, down, f) {
  if (list.length) return list.map((s) => [`ws|${rowKey(s.w.host, s.w.workspace_id)}`, wsSection(s)]);
  const peer = f !== 'all' && f !== localId() ? hostOf(f) : null;
  if (peer && (!peer.online || peer.herdr !== 'up')) return [];
  if (down && (f === localId() || (f === 'all' && !multi()))) {
    const where = hostLabel(localId()) || state.host || '이 기기';
    return [['empty', `<div class="empty" role="status"><p class="empty-t">${esc(where)} 의 herdr 에 연결하지 못했습니다</p><p>그 기기에서 herdr 가 실행 중인지 확인하세요.</p>${connLink('연결 상태 보기')}</div>`]];
  }
  // Split: the right column says it in full, with the button; here a short line.
  if (split) return [['empty', '<div class="empty"><p class="empty-t">워크스페이스가 없습니다</p><p>머리글의 + 로 새로 시작합니다.</p></div>']];
  const href = f === 'all' ? '#/new' : link(f, '/new');
  return [['empty', `<div class="empty"><p class="empty-t">워크스페이스가 없습니다</p><p>폴더를 고르면 에이전트까지 바로 시작합니다.</p><a class="btn" href="${href}"${keyAttrs('newWorkspace', '새 워크스페이스')}>새 워크스페이스</a></div>`]];
}

// Hint about the hidden row gestures: shown for the first few starts of the app (each for the
// rest of that page's life) until its ✕ is pressed (rowtext.js hintDue). The key holds the
// count, or 'x'; the old code's '1' counts as one.
const HINT_KEY = 'herdr-hub.hint.hostswipe';
let hintNow = null;
function swipeHintShown() {
  if (hintNow == null) {
    // Swipe and long press are touch gestures; a mouse has right-click and the ⋯ buttons.
    if (!matchMedia('(pointer: coarse)').matches) return (hintNow = false);
    try {
      const was = localStorage.getItem(HINT_KEY);
      hintNow = RowText.hintDue(was);
      if (hintNow) localStorage.setItem(HINT_KEY, RowText.hintNext(was));
    } catch {
      hintNow = false;
    }
  }
  return hintNow;
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.hint-x')) return;
  hintNow = false;
  try {
    localStorage.setItem(HINT_KEY, 'x');
  } catch {
    /* this page only */
  }
  if (listShown()) render();
});

// Reuse each keyed child whose HTML is unchanged, build the rest, and put them in order.
function patchList(box, parts) {
  const old = new Map([...box.children].map((el) => [el.dataset.key, el]));
  const next = parts.map(([key, html]) => {
    const el = old.get(key);
    if (el && el._html === html) {
      old.delete(key);
      return el;
    }
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    const fresh = t.content.firstElementChild;
    fresh.dataset.key = key;
    fresh._html = html;
    return fresh;
  });
  for (const el of old.values()) el.remove();
  next.forEach((el, i) => {
    if (box.children[i] !== el) box.insertBefore(el, box.children[i] || null);
  });
}

// Times on the list and the workspace page, filled in here so the cards' HTML stays the same.
let listTimer = null;
function tickList() {
  // The live stream down: the times stop where they were (the statuses they count are old).
  const box = live && (split || ['list', 'ws'].includes(view.name)) ? $app : null;
  const els = box ? box.querySelectorAll('.el[data-since], .el[data-ago]') : [];
  if (box) fillTimes(box);
  if (els.length && !listTimer) listTimer = setInterval(tickList, 1000);
  if (!els.length && listTimer) {
    clearInterval(listTimer);
    listTimer = null;
  }
}

const rowData = (kind, host, id) => `data-kind="${kind}" data-host="${esc(host || '')}" data-id="${esc(id)}"`;

// A card's head: its name, then the host (전체). No folder: a herdr workspace has none (each tab
// opens where it is told), so each row shows its own (paneDir).
// An offline peer's card (a ghost, lib/peers.js staleView) is drawn greyed with when it was so
// (「오후 10:47 기준」); its rows open read-only and its menus only look (actions.js).
function wsSection({ w, agents, terms }) {
  const rows = [...agents.map(agentRow), ...terms.map(termRow)].join('');
  const at = ghostAt(w, agents, terms);
  const asof = at ? `<span class="ws-asof">${esc(RowText.asOf(at))}</span>` : '';
  const chip = [filter() === 'all' ? hostChip(w) : '', asof].filter(Boolean).join('');
  return `<section class="ws${at ? ' ghost' : ''}">
    <div class="sw ws-head" ${rowData('ws', w.host, w.workspace_id)}>
      <div class="sw-front ws-front">
        <a class="ws-main" href="${link(w.host, `/ws/${encodeURIComponent(w.workspace_id)}`)}">
          <div class="ws-label">${esc(w.label)}</div>
          ${chip ? `<div class="ws-meta">${chip}</div>` : ''}
        </a>
        <button type="button" class="icon-btn ws-more" aria-haspopup="dialog" aria-label="${esc(w.label)} 워크스페이스 메뉴">${ICON.more}</button>
      </div>
    </div>
    <div class="ws-panes">${rows || '<p class="ws-empty">패널 없음</p>'}</div>
  </section>`;
}

// A row: the icon and the title (what the conversation is about, the row's width, up to two lines),
// and at the right, on the title's first line, when it finished or how long it has worked, small.
// The small line under the title says the status as a coloured dot and word, then the agent's
// name (not when the title begins with it) and the folder (rowtext.js). A blocked agent wants an
// answer now: a pill at the right says so in the time's place (it is answered by opening it, the
// chat's blocked box). A finish not opened yet: a dot before the icon and a bolder title, like an
// unread message.
function agentRow(a) {
  const ghost = Boolean(a.stale);
  const unread = !ghost && isUnread(a);
  const blocked = !ghost && a.status === 'blocked';
  const end = blocked ? `<span class="badge blocked">${esc(STATUS_LABEL.blocked)}</span>` : ghost ? '' : timeTag(a);
  const st = blocked ? '' : ghost ? `<span class="st stale"><i class="st-dot" aria-hidden="true"></i>${esc(RowText.lastStatus(a))}</span>` : `<span class="st ${esc(a.status)}"><i class="st-dot" aria-hidden="true"></i>${esc(STATUS_LABEL[a.status] || a.status)}</span>`;
  const name = RowText.metaName(a.name, a.title);
  const meta = [st, name ? `<span>${esc(name)}</span>` : '', paneDir(a, a.name)].filter(Boolean).join('<span class="sep"> · </span>');
  return `<div class="sw${ghost ? ' ghost' : ''}" ${rowData('agent', a.host, a.pane)}>
    <a class="sw-front pane-row agent${unread ? ' unread' : ''}" href="${link(a.host, `/agent/${encodeURIComponent(a.pane)}`)}">
      ${unread ? '<span class="unread-dot" role="img" aria-label="새 결과"></span>' : ''}<span class="pane-ic" aria-hidden="true">${agentIcon(a)}</span>
      <span class="pane-main"><span class="pane-title">${esc(a.title || a.name || a.agent || a.pane)}</span>${meta ? `<span class="pane-meta">${meta}</span>` : ''}</span>
      ${end ? `<span class="pane-end">${end}</span>` : ''}
    </a>
    ${rowMore(a.title || a.name || a.pane)}
  </div>`;
}

// When a card is a ghost's: its workspace's (or, one herdr hadn't listed, its rows').
const ghostAt = (w, agents = [], terms = []) => (w && w.stale) || [...agents, ...terms].reduce((t, x) => t || x.stale || 0, 0) || 0;

// A row's ⋯, shown while the pointer is over the row (style.css): the same menu as a right-click or
// a long press (rows.js). Out of the Tab order: Alt+M opens the focused row's menu.
const rowMore = (name) => `<button type="button" class="icon-btn row-more" tabindex="-1" aria-haspopup="dialog" aria-label="${esc(name)} 메뉴">${ICON.more}</button>`;

// A row's folder, where it is now: its last folder, none when the folder is named like the
// workspace or the row (rowtext.js rowDir); the whole path on hover.
function paneDir(x, name) {
  const d = RowText.rowDir(x.cwd, x.workspaceLabel, name);
  return d ? `<span class="pane-dir" title="${esc(x.cwd)}">${esc(d)}</span>` : '';
}

function termRow(t) {
  const dir = paneDir(t, termTitle(t));
  return `<div class="sw${t.stale ? ' ghost' : ''}" ${rowData('term', t.host, t.pane)}>
    <a class="sw-front pane-row term" href="${link(t.host, `/term/${encodeURIComponent(t.pane)}`)}">
      <span class="pane-ic" aria-hidden="true">${ICON.term}</span>
      <span class="pane-main"><span class="pane-title">${esc(termTitle(t))}</span>${dir ? `<span class="pane-meta">${dir}</span>` : ''}</span>
      <span class="pane-end"><span class="pane-kind">셸</span></span>
    </a>
    ${rowMore(termTitle(t))}
  </div>`;
}
