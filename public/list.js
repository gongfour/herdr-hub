'use strict';
// The lists: 홈 (inbox) and 작업공간 (workspace cards), the bottom tab bar, the 답 필요 strip with
// its quick answers, 방금 끝남 bookkeeping, and the times on the rows.

// ------------------------------------------------------------ list view

// The herdr hierarchy: host → workspace → pane, one card per workspace, with blocked agents
// from every workspace also in a strip on top. State updates patch the list in place (one
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
  return new Date(t).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
}
// "작업 중 · 12분" / "완료 · 3분 전" next to the badge; nothing when the hub doesn't know.
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

// ---- tabs: 홈 (inbox) / 작업공간 (the workspace cards) / 설정, as a bottom tab bar
const TAB_KEY = 'herdr-hub.tab';
let memTab = null;
let routed = false; // the first route may restore the last tab
function getTab() {
  if (memTab == null) {
    try {
      memTab = localStorage.getItem(TAB_KEY) === 'spaces' ? 'spaces' : 'home';
    } catch {
      memTab = 'home';
    }
  }
  return memTab;
}
function setTab(t) {
  memTab = t;
  try {
    localStorage.setItem(TAB_KEY, t);
  } catch {
    /* remembered for this page only */
  }
}
// Where 뒤로 from an agent, shell or workspace leads: the list tab it was opened from (split:
// whatever the list column shows, 설정 included).
const homeHash = () => (split && colTab === 'settings' ? '#/settings' : getTab() === 'spaces' ? '#/spaces' : '#/');
// The list tab render() draws: the view's own on the phone, the list column's when split.
const listTab = () => (split ? (colTab === 'spaces' ? 'spaces' : 'home') : view.tab || 'home');

// 뒤로 in a detail header. Split, the list is already beside it: a detail that leads back to
// the list gets ✕ (닫기) at the end of the header instead, and closing it goes to the list route.
function backLink(href, label = '목록') {
  if (split && href === homeHash()) return `<a class="icon-btn close-detail" href="${href}" data-back aria-label="닫기" title="닫기 (Esc)">${ICON.x}</a>`;
  return `<a class="icon-btn" href="${href}" data-back aria-label="${label}">${ICON.back}</a>`;
}

function tabBar(active) {
  const n = state.agents.filter((a) => a.status === 'blocked' && shown(a)).length;
  const tab = (key, href, icon, label, extra = '') =>
    `<a class="tab" href="${href}"${active === key ? ' aria-current="page"' : ''}>${icon}<span>${label}</span>${extra}</a>`;
  return `<nav class="tabbar" aria-label="탭">
    ${tab('home', '#/', ICON.inbox, '홈', n ? `<span class="tab-badge" aria-label="답 필요 ${n}">${n}</span>` : '')}
    ${tab('spaces', '#/spaces', ICON.grid, '작업공간')}
    ${tab('settings', '#/settings', ICON.gear, '설정')}
  </nav>`;
}
function mountTabBar(active) {
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

// ---- 방금 끝남: finishes this device has not opened yet (per device, in localStorage)
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
// Opening an agent that has finished marks that finish read (not one that is still running).
function markSeen(a) {
  if (!a || a.status === 'working' || a.status === 'blocked') return;
  const k = Inbox.seenKey({ ...a, host: a.host || localId() });
  const m = seenMap();
  if (m[k]) return;
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

const listScroll = { home: 0, spaces: 0 }; // each tab's scroll position, kept while a detail view is open
let quietOpen = false; // 조용함 expanded (this page's life)

function render() {
  if (swipe.g && Date.now() - swipe.g.t0 < 10000) return void (swipe.pending = true); // after the finger lifts
  if (split && colTab === 'settings') return; // the list column shows 설정
  const root = listRoot();
  const tab = listTab();
  const down = state.herdr !== 'up';
  const f = filter();
  const { blocked, list } = listModel();
  for (const a of blocked) ensureQuestion(a);
  // Peers in view that are offline or whose herdr is down.
  const trouble = hosts().filter((h) => !h.local && (f === 'all' || f === h.id) && (!h.online || h.herdr !== 'up'));
  const hostLine = esc(f === 'all' ? (multi() ? hosts().map((x) => x.label).join(' · ') : state.host || '') : hostLabel(f));
  const top = `
    <header class="bar">
      <h1>${tab === 'home' ? '홈' : '작업공간'}<span class="sub">${hostLine}</span></h1>
      <span class="conn ${down ? 'down' : ''}"><span class="dot"></span>${down ? (state.herdr === 'down' ? 'herdr 연결 끊김' : state.herdr === 'offline' ? '연결 끊김' : '연결 중') : '실시간'}</span>
      <a class="icon-btn" href="${f === 'all' ? '#/new' : link(f, '/new')}" aria-label="새 워크스페이스">${ICON.plus}</a>
    </header>
    ${multi() ? `
    <nav class="seg hosts" role="group" aria-label="호스트">
      <button data-host="all" aria-pressed="${f === 'all'}">전체</button>
      ${hosts().map((x) => `<button data-host="${esc(x.id)}" aria-pressed="${f === x.id}" class="${x.online ? '' : 'off'}"><span class="hdot"></span>${esc(x.label)}</button>`).join('')}
    </nav>` : ''}`;
  const head = [
    ...(swipeHintShown() && (list.length || state.agents.length) ? [['hint', `<p class="hint-row" role="note"><span>줄을 왼쪽으로 밀면 이름·닫기, 길게 누르면 메뉴가 나옵니다.</span><button type="button" class="icon-btn hint-x" aria-label="안내 닫기">${ICON.x}</button></p>`]] : []),
    ...trouble.map((x) => [`off|${x.id}`, `<p class="offline" role="status"><b>${esc(x.label)}</b> ${x.online ? 'herdr 연결 끊김' : `오프라인${x.since ? ` · ${esc(clock(x.since))}부터` : ''} — 잠들었거나 Herdr Hub 가 꺼져 있습니다`}</p>`]),
    ...(blocked.length ? [['attn', attnStrip(blocked)]] : []),
  ];
  const parts = tab === 'home' ? [...head, ...inboxParts(down, f)] : [...head, ...spacesParts(list, down, f)];
  let main = root.querySelector(':scope > main.home');
  const fresh = !main || main.dataset.tab !== tab;
  if (fresh) {
    root.innerHTML = `${top}<main class="list home" data-tab="${tab}"></main>`;
    main = root.querySelector(':scope > main.home');
    main._top = top;
    bindList(main);
  } else if (main._top !== top) {
    root.querySelectorAll(':scope > header, :scope > nav:not(.tabbar)').forEach((el) => el.remove());
    main.insertAdjacentHTML('beforebegin', top);
  }
  main._top = top;
  patchList(main, parts);
  mountTabBar(tab);
  // Back from an agent: where this tab was left.
  if (fresh && listScroll[tab]) main.scrollTop = listScroll[tab];
  root.querySelectorAll('.hosts button').forEach((b) => {
    b.onclick = () => {
      setFilter(b.dataset.host);
      render();
      if (split && !isDetail()) renderEmpty(); // its 답 필요 count follows the filter
    };
  });
  markSelected();
  tickList();
}

function spacesParts(list, down, f) {
  const empty = f !== 'all' && !online(f) ? '' : down && f !== 'all' && f === localId() ? 'herdr 서버에 연결하지 못했습니다.' : '열린 워크스페이스가 없습니다.';
  return [...list.map((s) => [`ws|${rowKey(s.w.host, s.w.workspace_id)}`, wsSection(s)]), ...(!list.length && empty ? [['empty', `<p class="empty">${empty}</p>`]] : [])];
}

// 홈: 답 필요 (the strip, above), 방금 끝남, 작업 중, and 조용함 folded into one line.
function inboxParts(down, f) {
  const b = Inbox.bucket(state.agents.filter(shown), { isSeen });
  const out = [];
  if (b.done.length) out.push(['done', inboxSection('방금 끝남', b.done, 'done')]);
  if (b.working.length) out.push(['working', inboxSection('작업 중', b.working, 'working')]);
  if (b.idle.length)
    out.push([
      'quiet',
      `<section class="ib-sec quiet">
        <button type="button" class="quiet-toggle" aria-expanded="${quietOpen}"><span>조용함</span><span class="quiet-n">대기 ${b.idle.length}</span><span class="chev${quietOpen ? ' open' : ''}" aria-hidden="true">${ICON.chevron}</span></button>
        ${quietOpen ? `<div class="ib-card">${b.idle.map((a) => inboxRow(a, 'idle')).join('')}</div>` : ''}
      </section>`,
    ]);
  if (!b.blocked.length && !b.done.length && !b.working.length) {
    const none = !state.agents.filter(shown).length;
    const msg = f !== 'all' && !online(f) ? '' : down && !state.agents.length ? 'herdr 서버에 연결하지 못했습니다.' : none ? '에이전트가 없습니다. + 로 워크스페이스를 만들거나 작업공간 탭에서 시작하세요.' : '답할 것도, 작업 중인 것도 없습니다.';
    if (msg) out.unshift(['calm', `<p class="empty calm">${msg}</p>`]);
  }
  return out;
}

function inboxSection(title, agents, kind) {
  return `<section class="ib-sec ${kind}" aria-label="${title}">
    <h2>${title}<span class="ib-count">${agents.length}</span></h2>
    <div class="ib-card">${agents.map((a) => inboxRow(a, kind)).join('')}</div>
  </section>`;
}

// One compact agent row (56–64px): name · workspace · host and the time on the first line,
// what it said or is doing on the second. Swipe and long press work as in the workspace cards.
function inboxRow(a, kind) {
  const host = multi() && filter() === 'all' ? ` · ${esc(a.hostLabel || hostLabel(a.host))}` : '';
  const where = `${esc(a.workspaceLabel)}${host}`;
  const name = a.name || a.title;
  let sub = '';
  let time = '';
  if (kind === 'done') {
    sub = a.lastReply || '';
    time = a.doneAt ? `<span class="el ago" data-ago="${Number(a.doneAt)}" title="${esc(clock(a.doneAt))} 완료"></span>` : `<span class="el ago">완료</span>`;
  } else if (kind === 'working') {
    sub = a.lastTool || '작업 중…';
    time = a.workingSince ? `<span class="el" data-since="${Number(a.workingSince)}"></span>` : '';
  }
  return `<div class="sw" ${rowData('agent', a.host, a.pane)}>${SWIPE_ACTS}
    <a class="sw-front ib-row ${kind}${sub ? '' : ' one'}" href="${link(a.host, `/agent/${encodeURIComponent(a.pane)}`)}">
      <span class="pane-ic" aria-hidden="true">${agentIcon(a)}</span>
      <span class="ib-main">
        <span class="ib-top"><span class="ib-name">${esc(name)}</span><span class="ib-where"> · ${where}</span></span>
        ${sub ? `<span class="ib-sub${kind === "working" ? " ib-tool" : ""}">${esc(sub)}</span>` : ''}
      </span>
      ${time}
    </a>
  </div>`;
}

// One-time hint about the hidden row gestures: shown on the first visit to the list (and for
// the rest of that page's life) until its ✕ is pressed.
const HINT_KEY = 'herdr-hub.hint.swipe';
let hintNow = null;
function swipeHintShown() {
  if (hintNow == null) {
    // Swipe and long press are touch gestures; a mouse has right-click and the ⋯ buttons.
    if (!matchMedia('(pointer: coarse)').matches) return (hintNow = false);
    try {
      hintNow = !localStorage.getItem(HINT_KEY);
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      hintNow = false;
    }
  }
  return hintNow;
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.hint-x')) return;
  hintNow = false;
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
  if (swipe.open && !swipe.open.isConnected) swipe.open = null;
}

// Times on the list and the workspace page, filled in here so the cards' HTML stays the same.
let listTimer = null;
function tickList() {
  const box = split || ['list', 'ws'].includes(view.name) ? $app : null;
  const els = box ? box.querySelectorAll('.el[data-since], .el[data-ago]') : [];
  if (box) fillTimes(box);
  if (els.length && !listTimer) listTimer = setInterval(tickList, 1000);
  if (!els.length && listTimer) {
    clearInterval(listTimer);
    listTimer = null;
  }
}

const rowData = (kind, host, id) => `data-kind="${kind}" data-host="${esc(host || '')}" data-id="${esc(id)}"`;
const SWIPE_ACTS = `<div class="sw-acts" aria-hidden="true"><button type="button" class="sw-act" data-act="rename" tabindex="-1">이름</button><button type="button" class="sw-act danger" data-act="close" tabindex="-1">닫기</button></div>`;
const agentTitle = (a) => (a.name ? `${a.name} · ${a.title}` : a.title);

// ---- 답 필요 strip: each blocked agent with its question and quick answers
// The question is read off the agent's visible screen once per prompt (stateSeq) and parsed
// like the detail view does. One tap answers, with the same lock as there.
const questions = new Map(); // host|pane -> { seq, choices, loading, at }
const quickLocks = new Map(); // host|pane -> { until, seq, n }
const quickLocked = (k, a) => {
  const l = quickLocks.get(k);
  return Boolean(l && Date.now() < l.until && a && a.stateSeq === l.seq);
};
// A read that caught the prompt half drawn (choicesSettled) is repeated a few times.
const QUESTION_RETRY_MS = 1200;
const QUESTION_TRIES = 4;
function ensureQuestion(a) {
  const k = rowKey(a.host, a.pane);
  const q = questions.get(k);
  if (q && q.seq === a.stateSeq) {
    if (q.loading) return;
    if (q.failed ? Date.now() - q.at <= 10000 : q.choices !== undefined && (choicesSettled(q.choices) || q.tries >= QUESTION_TRIES)) return;
    if (!q.failed && Date.now() - q.at < QUESTION_RETRY_MS) return;
  }
  const seq = a.stateSeq;
  const tries = (q && q.seq === seq && !q.failed ? q.tries || 0 : 0) + 1;
  // Keep showing the earlier read while the next one is on its way.
  questions.set(k, { ...(q && q.seq === seq ? q : {}), seq, loading: true });
  api(hp(`/agents/${encodeURIComponent(a.pane)}/screen?source=visible&lines=30`, a.host || localId()))
    .then((r) => {
      const cur = state.agents.find((x) => same(x, a.host || localId(), a.pane));
      // Read after the prompt changed: that screen is not this question's.
      if (!cur || cur.stateSeq !== seq) return questions.delete(k);
      const choices = window.parseChoices ? parseChoices(String(r.text || '').replace(/\s+$/, '')) : null;
      questions.set(k, { seq, choices, tries, at: Date.now() });
      if (!choicesSettled(choices) && tries < QUESTION_TRIES) setTimeout(() => listShown() && render(), QUESTION_RETRY_MS + 50);
    })
    .catch(() => questions.set(k, { seq, choices: null, failed: true, at: Date.now() }))
    .finally(() => listShown() && render());
}

function attnStrip(list) {
  return `<section class="attn" aria-label="답 필요">
    <h2>답 필요 (${list.length})</h2>
    ${list.map(attnRow).join('')}
  </section>`;
}

function attnRow(a) {
  const k = rowKey(a.host, a.pane);
  const q = questions.get(k);
  const ch = q && q.seq === a.stateSeq ? q.choices : null;
  const quick = quickChoices(ch); // choices.js
  const locked = quickLocked(k, a);
  const primary = ch ? primaryChoice(ch.items) : null;
  const where = `${esc(a.workspaceLabel)}${multi() && filter() === 'all' ? ` · ${esc(a.hostLabel || hostLabel(a.host))}` : ''}`;
  return `<div class="attn-item" ${rowData('agent', a.host, a.pane)}>
    <a class="attn-row" href="${link(a.host, `/agent/${encodeURIComponent(a.pane)}`)}">
      <span class="pane-ic" aria-hidden="true">${agentIcon(a)}</span>
      <span class="pane-main"><span class="pane-title">${esc(a.name || a.title)}<span class="pane-meta-inline"> · ${where}</span></span>${
        ch && ch.question ? `<span class="attn-q">${esc(ch.question)}</span>` : `<span class="pane-meta">${q && q.loading ? '질문을 읽는 중…' : '열어서 답하세요'}</span>`
      }</span>
      <span class="go" aria-hidden="true">›</span>
    </a>
    ${quick.length ? `<div class="quick" role="group" aria-label="빠른 답">${quick.map((x) => choiceButton(ch, x, { locked, sentN: locked && quickLocks.get(k).n, primary, compact: true }).replace('<button ', '<button data-quick ')).join('')}</div>` : ''}
  </div>`;
}

async function quickAnswer(btn) {
  const row = btn.closest('[data-kind]');
  const host = row.dataset.host || localId();
  const pane = row.dataset.id;
  const a = state.agents.find((x) => same(x, host, pane));
  const k = rowKey(host, pane);
  const q = questions.get(k);
  if (!a || a.status !== 'blocked' || !q || q.seq !== a.stateSeq || !q.choices || quickLocked(k, a)) return;
  const n = Number(btn.dataset.n);
  const keys = choiceKeys(q.choices, n);
  if (!keys) return;
  const lock = { until: Date.now() + CHOICE_LOCK_MS, seq: a.stateSeq, n };
  quickLocks.set(k, lock);
  setTimeout(() => listShown() && render(), CHOICE_LOCK_MS + 50);
  render();
  if (!(await sendKeys(keys, host, pane))) {
    // Not sent: the buttons come back at once.
    if (quickLocks.get(k) === lock) quickLocks.delete(k);
    if (listShown()) render();
  } else closeNotes(host, pane);
}

function wsSection({ w, agents, terms }) {
  const first = [...agents, ...terms].sort(paneOrder)[0];
  const rows = [...agents.map(agentRow), ...terms.map(termRow)].join('');
  return `<section class="ws">
    <div class="sw ws-head" ${rowData('ws', w.host, w.workspace_id)}>${SWIPE_ACTS}
      <div class="sw-front ws-front">
        <div class="ws-main">
          <div class="ws-label">${filter() === 'all' ? hostChip(w) : ''}${esc(w.label)}</div>
          ${first && first.cwd ? `<div class="ws-cwd">${esc(first.cwd)}</div>` : ''}
        </div>
        <button type="button" class="icon-btn ws-more" aria-haspopup="dialog" aria-label="${esc(w.label)} 워크스페이스 메뉴">${ICON.more}</button>
      </div>
    </div>
    <div class="ws-panes">${rows || '<p class="ws-empty">패널 없음</p>'}</div>
  </section>`;
}

// A blocked agent is answered from the strip on top; here it only says so (no second full row).
function agentRow(a) {
  const badge =
    a.status === 'blocked'
      ? `<span class="badge blocked up" aria-label="답 필요 — 위 목록에서 답하세요">↑ 답 필요</span>`
      : `<span class="badge ${esc(a.status)}">${esc(STATUS_LABEL[a.status] || a.status)}</span>`;
  return `<div class="sw" ${rowData('agent', a.host, a.pane)}>${SWIPE_ACTS}
    <a class="sw-front pane-row agent" href="${link(a.host, `/agent/${encodeURIComponent(a.pane)}`)}">
      <span class="pane-ic" aria-hidden="true">${agentIcon(a)}</span>
      <span class="pane-main"><span class="pane-title">${esc(agentTitle(a))}</span></span>
      ${timeTag(a)}
      ${badge}
    </a>
  </div>`;
}

function termRow(t) {
  return `<div class="sw" ${rowData('term', t.host, t.pane)}>${SWIPE_ACTS}
    <a class="sw-front pane-row term" href="${link(t.host, `/term/${encodeURIComponent(t.pane)}`)}">
      <span class="pane-ic" aria-hidden="true">${ICON.term}</span>
      <span class="pane-main"><span class="pane-title">${esc(termTitle(t))}</span></span>
      <span class="pane-kind">셸</span>
    </a>
  </div>`;
}
