'use strict';

const $app = document.getElementById('app');
const STATUS_LABEL = { blocked: '응답 필요', done: '완료', working: '작업 중', idle: '대기', unknown: '알 수 없음' };
const GROUPS = [
  ['blocked', '응답이 필요한 에이전트'],
  ['done', '방금 끝난 에이전트'],
  ['working', '작업 중'],
  ['idle', '대기 중'],
  ['unknown', '상태를 알 수 없음'],
];
const ICON = {
  back: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  photo: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 15.5l-4.6-4.6a1.2 1.2 0 0 0-1.7 0L6 19.2"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.6l1.3-1.8a1.5 1.5 0 0 1 1.2-.7h2.8a1.5 1.5 0 0 1 1.2.7L15.9 6h1.6A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.5" r="3.3"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></svg>',
};
const TERM_KEYS = [['ctrl+c', 'Ctrl+C'], ['enter', 'Enter'], ['up', '↑'], ['down', '↓'], ['tab', 'Tab'], ['esc', 'Esc']];
const ERROR_TEXT = {
  cwd_not_absolute: '절대 경로를 적어 주세요.',
  cwd_not_found: '그 폴더가 호스트에 없습니다.',
  cwd_not_directory: '폴더가 아니라 파일입니다.',
  bad_cwd: '폴더 경로가 올바르지 않습니다.',
  bad_kind: '지원하지 않는 에이전트 종류입니다.',
  bad_args: '인자에 쓸 수 없는 문자가 있습니다.',
  bad_agent_name: '이름은 영문 소문자로 시작하고 소문자·숫자·-·_ 만 쓸 수 있습니다(32자까지).',
  bad_label: '이름이 너무 길거나 쓸 수 없는 문자가 있습니다.',
  empty_label: '이름을 적어 주세요.',
  agent_name_taken: '같은 이름의 에이전트가 이미 있습니다.',
  peer_offline: '그 호스트가 오프라인입니다.',
  peer_unreachable: '그 호스트에 닿지 못했습니다.',
  peer_timeout: '그 호스트가 제때 답하지 않았습니다.',
  unknown_host: '모르는 호스트입니다.',
  bad_dir_name: '폴더 이름이 올바르지 않습니다. / \\ : * ? " < > | 와 . 이나 .. 은 쓸 수 없고 100자까지입니다.',
  dir_exists: '같은 이름의 폴더가 이미 있습니다.',
  dir_forbidden: '그 위치에 폴더를 만들 권한이 없습니다.',
  image_too_large: '사진이 너무 큽니다(10MB까지).',
  body_too_large: '사진이 너무 큽니다(10MB까지).',
  bad_image_type: 'JPEG·PNG·WebP 사진만 보낼 수 있습니다.',
};
const errText = (err) => ERROR_TEXT[err.code] || err.message;

let state = { agents: [], terminals: [], workspaces: [], hosts: [], herdr: 'connecting' };
let view = { name: 'list' };
let detail = { host: null, pane: null, transcript: null, screen: null, blockedText: null, lastSeq: -1, files: [], sheet: null, activity: null, workingSince: null };
const hostCache = new Map(); // host id -> { kinds, recentCwds, platform, home } from that host's /api/host
let pollTimer = null;
let tickTimer = null; // the activity line's clock, once a second while working
let resolveReady;
const ready = new Promise((r) => (resolveReady = r)); // the first state has arrived

// ------------------------------------------------------------ utilities

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const basename = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || p || '';

// ------------------------------------------------------------ hosts

// The host a view is about: from the route (#/h/<id>/…), else this Paddock's own host.
const localId = () => state.hostId || null;
const curHost = () => view.host || localId();
const hosts = () => state.hosts || [];
const multi = () => hosts().length > 1;
const hostOf = (id) => hosts().find((h) => h.id === id);
const hostLabel = (id) => (hostOf(id) || {}).label || id || '';
const online = (id) => !hostOf(id) || hostOf(id).online;
// API path for a host: the local host directly, a peer through the hub.
const hp = (path, host = curHost()) => (host && host !== localId() ? `/peers/${encodeURIComponent(host)}${path}` : path);
// Every route carries its host; #/agent/… without one still means the local host.
const link = (host, path) => `#/h/${encodeURIComponent(host || localId() || '')}${path}`;
const same = (x, host, id, key = 'pane') => x[key] === id && (x.host || localId()) === host;
const hostChip = (x) => (multi() ? `<span class="host-chip">${esc(x.hostLabel || hostLabel(x.host))}</span>` : '');

const FILTER_KEY = 'paddock.host';
function getFilter() {
  try {
    return localStorage.getItem(FILTER_KEY) || 'all';
  } catch {
    return 'all';
  }
}
function setFilter(v) {
  try {
    localStorage.setItem(FILTER_KEY, v);
  } catch {
    /* private mode: the choice lasts until reload */
  }
  memFilter = v;
}
let memFilter = getFilter();
// A remembered host that no longer exists falls back to everything.
const filter = () => (memFilter !== 'all' && multi() && hostOf(memFilter) ? memFilter : 'all');
const shown = (x) => filter() === 'all' || (x.host || localId()) === filter();

const clock = (t) => (t ? new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '');

async function hostInfo(id) {
  if (!hostCache.has(id)) hostCache.set(id, await api(hp('/host', id)));
  return hostCache.get(id);
}

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'X-Paddock': '1', ...(opts.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.message || body.error || res.statusText), { code: body.error });
  return body;
}

// In-page sheet instead of confirm()/prompt(): those block the page (and automated tests).
// Resolves with the input's value (or true) on OK, null on cancel.
function sheet({ title, text = '', error = '', input = null, ok = '확인', danger = false }) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'sheet-back';
    el.innerHTML = `<form class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <h2>${esc(title)}</h2>
        ${text ? `<p>${esc(text)}</p>` : ''}
        ${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
        ${input ? `<input class="field" name="v" value="${esc(input.value || '')}" placeholder="${esc(input.placeholder || '')}" autocomplete="off" autocapitalize="off" spellcheck="false">` : ''}
        <div class="row end">
          <button type="button" class="btn secondary" data-cancel>취소</button>
          <button type="submit" class="btn ${danger ? 'danger' : ''}">${esc(ok)}</button>
        </div>
      </form>`;
    const done = (v) => {
      el.remove();
      resolve(v);
    };
    // A block body: an onclick that returns false would cancel the submit button's click.
    el.onclick = (e) => {
      if (e.target === el) done(null);
    };
    el.querySelector('[data-cancel]').onclick = () => done(null);
    el.querySelector('form').onsubmit = (e) => {
      e.preventDefault();
      done(input ? el.querySelector('input').value : true);
    };
    document.body.appendChild(el);
    (el.querySelector('input') || el.querySelector('[type=submit]')).focus();
  });
}

// A list of actions in a sheet. Resolves with the chosen key or null.
function menu(title, items) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'sheet-back';
    el.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <h2>${esc(title)}</h2>
        <div class="actions">${items.map(([key, label, danger]) => `<button class="action ${danger ? 'danger' : ''}" data-k="${esc(key)}">${esc(label)}</button>`).join('')}</div>
        <button class="btn secondary wide" data-k="">취소</button>
      </div>`;
    const done = (v) => {
      el.remove();
      resolve(v || null);
    };
    // A block body: an onclick that returns false would cancel the submit button's click.
    el.onclick = (e) => {
      if (e.target === el) done(null);
    };
    el.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => done(b.dataset.k)));
    document.body.appendChild(el);
  });
}

function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// Minimal markdown: fenced code, inline code, bold, links, paragraphs. Input is escaped first.
function inline(text) {
  let h = esc(text);
  h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  h = h.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/(https?:\/\/[^\s<)]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  return h;
}

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEP = /^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*(:?-{2,}:?\s*)?\|?\s*$/;
const LIST_ITEM = /^\s*(?:[-*•]|\d+[.)])\s+/;

function cells(line) {
  // An escaped pipe (\|) is part of the cell text, not a column break.
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').replace(/\\\|/g, '\u0000').split('|').map((c) => c.replace(/\u0000/g, '|').trim());
}

function table(lines) {
  const align = cells(lines[1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : ''));
  const row = (line, tag) =>
    `<tr>${cells(line).map((c, i) => `<${tag}${align[i] ? ` style="text-align:${align[i]}"` : ''}>${inline(c)}</${tag}>`).join('')}</tr>`;
  return `<div class="table-wrap"><table><thead>${row(lines[0], 'th')}</thead><tbody>${lines.slice(2).map((l) => row(l, 'td')).join('')}</tbody></table></div>`;
}

// One blank-line-separated block: tables and lists become real elements, other lines stay a paragraph.
function block(p) {
  const lines = p.replace(/\s+$/, '').split('\n');
  let out = '';
  let text = [];
  const flush = () => {
    if (text.length) out += `<p>${text.map(inline).join('<br>')}</p>`;
    text = [];
  };
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    const heading = line.trim().match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flush();
      out += `<p><strong>${inline(heading[2])}</strong></p>`;
      i++;
    } else if (TABLE_ROW.test(line) && TABLE_SEP.test(lines[i + 1] || '')) {
      flush();
      let j = i + 2;
      while (j < lines.length && TABLE_ROW.test(lines[j])) j++;
      out += table(lines.slice(i, j));
      i = j;
    } else if (LIST_ITEM.test(line)) {
      flush();
      const ordered = /^\s*\d/.test(line);
      const items = [];
      const same = (l) => LIST_ITEM.test(l) && /^\s*\d/.test(l) === ordered;
      while (i < lines.length && (same(lines[i]) || (items.length && !LIST_ITEM.test(lines[i]) && /^\s{2,}\S/.test(lines[i])))) {
        if (same(lines[i])) items.push(lines[i].replace(LIST_ITEM, ''));
        else items[items.length - 1] += '\n' + lines[i].trim();
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      out += `<${tag}>${items.map((t) => `<li>${t.split('\n').map(inline).join('<br>')}</li>`).join('')}</${tag}>`;
    } else {
      text.push(line);
      i++;
    }
  }
  flush();
  return out;
}

function md(src) {
  const parts = String(src).split(/```[^\n]*\n?([\s\S]*?)```/g);
  return parts
    .map((chunk, i) => {
      if (i % 2) return `<pre><code>${esc(chunk.replace(/\n$/, ''))}</code></pre>`;
      return chunk
        .split(/\n{2,}/)
        .filter((p) => p.trim())
        .map(block)
        .join('');
    })
    .join('');
}

// ------------------------------------------------------------ live state

// EventSource retries a dropped connection by itself, but gives up for good on a non-200
// answer such as the 502 tailscale serve returns while Paddock restarts. Reopen it then,
// and whenever the app comes back to the foreground (iOS suspends home-screen apps).
let stream = null;
let retryTimer = null;
let retryDelay = 1000;

function connect() {
  clearTimeout(retryTimer);
  if (stream) stream.close();
  const es = (stream = new EventSource('/api/stream'));
  es.addEventListener('state', (e) => {
    retryDelay = 1000;
    state = JSON.parse(e.data);
    resolveReady();
    onState();
  });
  es.onerror = () => {
    state = { ...state, herdr: 'offline' };
    if (view.name === 'list') render();
    if (es.readyState === EventSource.CLOSED && es === stream) {
      retryTimer = setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 15000);
    }
  };
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && (!stream || stream.readyState !== EventSource.OPEN)) connect();
});

function onState() {
  if (view.name === 'list') return render();
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
    if (changed) {
      detail.lastSeq = a.stateSeq;
      loadDetail();
    }
  }
}

const currentAgent = () => state.agents.find((a) => same(a, curHost(), detail.pane));

// ------------------------------------------------------------ routing

function route() {
  clearInterval(pollTimer);
  clearInterval(tickTimer);
  tickTimer = null;
  closeScreenSheet();
  setTimeout(() => fit({ type: 'route' }), 0);
  scr = null;
  let h = location.hash.replace(/^#/, '') || '/';
  let host = null;
  let m = h.match(/^\/h\/([^/]+)(\/.*)?$/);
  if (m) {
    host = decodeURIComponent(m[1]);
    h = m[2] || '/';
  }
  if ((m = h.match(/^\/agent\/([^/]+)(?:\/(screen|chat))?$/))) {
    // An agent always shows its chat. …/screen (the old 화면 tab) opens the terminal sheet over it.
    const pane = decodeURIComponent(m[1]);
    dropFiles();
    view = { name: 'agent', host };
    detail = { host, pane, transcript: null, screen: null, blockedText: null, lastSeq: -1, files: [], sheet: null, wantSheet: m[2] === 'screen', activity: null, workingSince: null };
    if (m[2]) history.replaceState(null, '', location.hash.replace(/\/(?:screen|chat)$/, ''));
    renderDetail();
    loadDetail();
    pollTimer = setInterval(() => {
      const a = currentAgent();
      // Also retry a screen read that failed, whatever the status; the sheet keeps reading while open.
      if (a && (a.status === 'working' || a.status === 'blocked' || detail.sheet || (scr && scr.error))) loadDetail();
    }, 3000);
  } else if ((m = h.match(/^\/term\/(.+)$/))) {
    view = { name: 'term', host, pane: decodeURIComponent(m[1]) };
    detail = { host, pane: view.pane, screen: null };
    renderTerminal();
    loadTerminal();
    pollTimer = setInterval(loadTerminal, 2500);
  } else if ((m = h.match(/^\/ws\/(.+)$/))) {
    view = { name: 'ws', host, id: decodeURIComponent(m[1]) };
    renderWorkspace();
  } else if (h === '/new' || (m = h.match(/^\/start\/(ws|pane)\/(.+)$/))) {
    view = h === '/new' ? { name: 'form', mode: 'new', host } : { name: 'form', mode: m[1], host, target: decodeURIComponent(m[2]) };
    renderForm();
  } else if (h === '/settings') {
    view = { name: 'settings' };
    renderSettings();
  } else {
    view = { name: 'list' };
    render();
  }
}

// ------------------------------------------------------------ list view

function render() {
  const down = state.herdr !== 'up';
  const f = filter();
  const agents = state.agents.filter(shown);
  const groups = GROUPS.map(([status, title]) => [title, agents.filter((a) => a.status === status)]).filter(([, list]) => list.length);
  const terms = (state.terminals || []).filter(shown);
  const spaces = (state.workspaces || []).filter(shown);
  // Peers in view that are offline or whose herdr is down.
  const trouble = hosts().filter((h) => !h.local && (f === 'all' || f === h.id) && (!h.online || h.herdr !== 'up'));
  const empty = f !== 'all' && !online(f) ? '' : down && f !== 'all' && f === localId() ? 'herdr 서버에 연결하지 못했습니다.' : '실행 중인 에이전트가 없습니다.';
  $app.innerHTML = `
    <header class="bar">
      <h1>Paddock<span class="sub">${esc(f === 'all' ? (multi() ? hosts().map((x) => x.label).join(' · ') : state.host || '') : hostLabel(f))}</span></h1>
      <span class="conn ${down ? 'down' : ''}"><span class="dot"></span>${down ? (state.herdr === 'down' ? 'herdr 연결 끊김' : state.herdr === 'offline' ? '연결 끊김' : '연결 중') : '실시간'}</span>
      <a class="icon-btn" href="${f === 'all' ? '#/new' : link(f, '/new')}" aria-label="새 워크스페이스">${ICON.plus}</a>
      <a class="icon-btn" href="#/settings" aria-label="설정">${ICON.gear}</a>
    </header>
    ${multi() ? `
    <nav class="seg hosts" role="group" aria-label="호스트">
      <button data-host="all" aria-pressed="${f === 'all'}">전체</button>
      ${hosts().map((x) => `<button data-host="${esc(x.id)}" aria-pressed="${f === x.id}" class="${x.online ? '' : 'off'}"><span class="hdot"></span>${esc(x.label)}</button>`).join('')}
    </nav>` : ''}
    <main class="list">
      ${trouble.map((x) => `<p class="offline" role="status"><b>${esc(x.label)}</b> ${x.online ? 'herdr 연결 끊김' : `오프라인${x.since ? ` · ${esc(clock(x.since))}부터` : ''} — 잠들었거나 Paddock 이 꺼져 있습니다`}</p>`).join('')}
      ${groups.length ? groups.map(([title, list]) => `
        <section class="group">
          <h2>${esc(title)} · ${list.length}</h2>
          <div class="cards">${list.map(card).join('')}</div>
        </section>`).join('') : empty ? `<p class="empty">${empty}</p>` : ''}
      ${terms.length ? `
        <section class="group">
          <h2>터미널 · ${terms.length}</h2>
          <div class="cards">${terms.map(termCard).join('')}</div>
        </section>` : ''}
      ${spaces.length ? `
        <section class="group">
          <h2>워크스페이스 · ${spaces.length}</h2>
          <div class="cards">${spaces.map(wsCard).join('')}</div>
        </section>` : ''}
    </main>`;
  $app.querySelectorAll('.hosts button').forEach((b) => {
    b.onclick = () => {
      setFilter(b.dataset.host);
      render();
    };
  });
}

function termCard(t) {
  return `<a class="card" href="${link(t.host, `/term/${encodeURIComponent(t.pane)}`)}">
    <div class="main">
      <div class="title">${esc(termTitle(t))}</div>
      <div class="meta">${hostChip(t)}셸 · ${esc(t.workspaceLabel)} · ${esc(basename(t.cwd))}</div>
    </div>
    <span class="badge idle">터미널</span>
  </a>`;
}

function wsCard(w) {
  const agents = state.agents.filter((a) => same(a, w.host, w.workspace_id, 'workspace')).length;
  return `<a class="card" href="${link(w.host, `/ws/${encodeURIComponent(w.workspace_id)}`)}">
    <div class="main">
      <div class="title">${esc(w.label)}</div>
      <div class="meta">${hostChip(w)}탭 ${w.tab_count} · 패널 ${w.pane_count} · 에이전트 ${agents}</div>
    </div>
  </a>`;
}

function card(a) {
  return `<a class="card" href="${link(a.host, `/agent/${encodeURIComponent(a.pane)}`)}">
    <div class="main">
      <div class="title">${esc(a.name ? `${a.name} · ${a.title}` : a.title)}</div>
      <div class="meta">${hostChip(a)}${esc(a.agent)} · ${esc(a.workspaceLabel)} · ${esc(basename(a.cwd))}</div>
    </div>
    <span class="badge ${esc(a.status)}">${esc(STATUS_LABEL[a.status] || a.status)}</span>
  </a>`;
}

// ------------------------------------------------------------ detail view

function renderDetail() {
  $app.innerHTML = `
    <div class="detail">
      <header class="bar">
        <a class="icon-btn" href="#/" aria-label="목록">${ICON.back}</a>
        <h1 id="d-title"></h1>
        <span id="d-badge"></span>
        <button class="icon-btn" id="d-more" aria-label="더 보기">${ICON.more}</button>
      </header>
      <button type="button" class="activity" id="d-activity" aria-label="터미널 화면 보기" hidden></button>
      <div id="d-blocked"></div>
      <div class="screen-tools" id="s-tools" hidden></div>
      <div class="scroll" id="d-body"></div>
      <div class="attach-tray" id="d-tray" hidden></div>
      <input type="file" id="d-file" accept="image/*" multiple hidden>
      <input type="file" id="d-cam" accept="image/*" capture="environment" hidden>
      <div class="composer" id="d-form">
        <button type="button" class="attach" id="d-attach" aria-label="사진 첨부">${ICON.photo}</button>
        <button type="button" class="attach" id="d-camera" aria-label="카메라로 찍기">${ICON.camera}</button>
        <div id="d-input" class="input" contenteditable="plaintext-only" role="textbox" aria-multiline="true" aria-label="메시지" data-placeholder="메시지 보내기" enterkeyhint="send" autocapitalize="sentences"></div>
        <button type="button" class="stop" id="d-stop" aria-label="중단" hidden>${ICON.stop}</button>
        <button type="button" class="send" id="d-send" aria-label="보내기" disabled>${ICON.send}</button>
      </div>
    </div>`;
  document.getElementById('d-activity').onclick = openScreenSheet;
  // An editable div, not a <textarea>: iOS puts its ⌃ ⌄ / contact AutoFill bar over the keyboard
  // for text fields, but not for contenteditable. `value` keeps the textarea-style API below.
  const input = document.getElementById('d-input');
  Object.defineProperty(input, 'value', {
    get: () => input.innerText.replace(/\n$/, ''),
    set: (v) => (input.textContent = v),
  });
  input.oninput = () => {
    if (!input.innerText.trim()) input.textContent = ''; // a leftover <br> would hide the placeholder
    updateComposer();
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendNow();
  };
  // Pasted images (iOS: screenshot → Copy → long-press here → Paste) join the attachments;
  // text pastes as usual.
  input.addEventListener('paste', (e) => {
    pasteDiag(e);
    const images = pastedImages(e.clipboardData);
    if (!images.length) return;
    // Keep any text that came along; with images only there is nothing to insert.
    if (!e.clipboardData.types.includes('text/plain')) e.preventDefault();
    addFiles(images);
  });
  for (const [btn, id] of [['d-attach', 'd-file'], ['d-camera', 'd-cam']]) {
    const picker = document.getElementById(id);
    document.getElementById(btn).onclick = () => picker.click();
    picker.onchange = () => {
      addFiles([...picker.files]);
      picker.value = ''; // the same photo can be picked again
    };
  }
  document.getElementById('d-tray').onclick = (e) => {
    const x = e.target.closest('[data-drop]');
    if (x) removeFile(Number(x.dataset.drop));
  };
  document.getElementById('d-body').addEventListener('click', (e) => {
    const pic = e.target.closest('.pic');
    if (pic) openViewer(pic.dataset.src);
  });
  // Not a <form>: iOS would add its ⌃ ⌄ / contact AutoFill bar above the keyboard.
  const sendNow = async () => {
    const text = input.value;
    const files = detail.files;
    if (detail.sending || (!text.trim() && !files.length)) return;
    if (files.some((f) => !f.blob)) return toast('사진을 준비하는 중입니다. 잠시 뒤에 보내 주세요.');
    const host = curHost();
    const pane = detail.pane;
    detail.sending = true;
    updateComposer();
    try {
      // Photos go to the agent's own host first; the prompt then names each file on its own line.
      for (const f of files) {
        if (f.path) continue; // uploaded on an earlier try
        try {
          f.path = (await api(hp('/uploads', host), { method: 'POST', body: f.blob, headers: { 'Content-Type': f.blob.type } })).path;
        } catch (err) {
          throw Object.assign(err, { upload: true });
        }
      }
      await api(hp(`/agents/${encodeURIComponent(pane)}/prompt`, host), { method: 'POST', body: JSON.stringify({ text: promptText(text, files.map((f) => f.path)) }) });
      if (detail.pane === pane) {
        input.value = '';
        dropFiles();
        renderTray();
      }
      setTimeout(loadDetail, 600);
    } catch (err) {
      toast(
        err.upload
          ? `사진을 올리지 못했습니다: ${errText(err)}`
          : err.code === 'agent_blocked'
            ? '에이전트가 응답을 기다리는 중입니다. 위 버튼으로 먼저 답해 주세요.'
            : `보내지 못했습니다: ${err.message}`
      );
    } finally {
      detail.sending = false;
      updateComposer();
    }
  };
  document.getElementById('d-send').onclick = sendNow;
  document.getElementById('d-stop').onclick = async () => {
    if (!(await sheet({ title: '작업 중단', text: '지금 작업을 중단할까요? (Esc 키를 보냅니다)', ok: '중단', danger: true }))) return;
    sendKeys(['esc']);
  };
  document.getElementById('d-more').onclick = agentMenu;
  renderDetailHeader();
  renderDetailBody(true);
}

function updateComposer() {
  const a = currentAgent();
  const input = document.getElementById('d-input');
  const send = document.getElementById('d-send');
  const stop = document.getElementById('d-stop');
  if (!input) return;
  const working = a && a.status === 'working';
  stop.hidden = !working;
  const files = detail.files || [];
  send.disabled = !a || (!input.value.trim() && !files.length) || a.status === 'blocked' || Boolean(detail.sending);
  for (const id of ['d-attach', 'd-camera']) {
    const b = document.getElementById(id);
    if (b) b.disabled = Boolean(detail.sending) || files.length >= MAX_FILES;
  }
}

// ------------------------------------------------------------ photo attach

const MAX_FILES = 6;
const MAX_SIDE = 2000; // px, long side
const KEEP_BYTES = 8 * 1024 * 1024; // a PNG/WebP this small and within MAX_SIDE is sent as it is
// An upload path on a line of its own, as promptText writes it (either host's separators).
const UPLOAD_LINE = /^(?:.*[\\/])?paddock-uploads[\\/](\d{8}-\d{6}-[0-9a-f]{8}\.(?:jpg|png|webp))$/;
// Claude Code (2.1.317) takes an image path in a prompt by itself: it attaches the file and
// shows "[Image #N]" in its place. So the prompt is the text, then one path per line.
function promptText(text, paths) {
  if (!paths.length) return text;
  return [text.replace(/\s+$/, ''), ...paths].filter(Boolean).join('\n');
}

// Split a sent prompt into what was typed and the attached upload names: from the transcript's
// image sources, or from path lines Claude Code left as text.
function userParts(m) {
  const pics = [...(m.uploads || [])];
  let text = String(m.text || '')
    .split('\n')
    .filter((line) => {
      const x = UPLOAD_LINE.exec(line.trim());
      if (x && !pics.includes(x[1])) pics.push(x[1]);
      return !x;
    })
    .join('\n');
  if (pics.length || m.images) text = text.replace(/\[Image #\d+\]\s?/g, '');
  return { text: text.trim(), pics };
}

// Image files on a paste: clipboardData.files, else file items (browsers differ).
function pastedImages(dt) {
  if (!dt) return [];
  const isImage = (f) => f && /^image\//.test(f.type);
  const files = [...(dt.files || [])].filter(isImage);
  if (files.length) return files;
  return [...(dt.items || [])]
    .filter((it) => it.kind === 'file' && /^image\//.test(it.type))
    .map((it) => it.getAsFile())
    .filter(isImage);
}

let fileSeq = 0;
function addFiles(list) {
  const room = MAX_FILES - detail.files.length;
  if (list.length > room) toast(`사진은 한 번에 ${MAX_FILES}장까지 보낼 수 있습니다.`);
  for (const file of list.slice(0, Math.max(0, room))) {
    const f = { id: ++fileSeq, name: file.name, url: URL.createObjectURL(file), blob: null, path: null };
    const files = detail.files;
    files.push(f);
    shrinkImage(file)
      .then((blob) => {
        f.blob = blob;
        if (blob !== file) {
          URL.revokeObjectURL(f.url);
          f.url = URL.createObjectURL(blob);
        }
      })
      .catch(() => {
        const i = files.indexOf(f);
        if (i >= 0) files.splice(i, 1);
        URL.revokeObjectURL(f.url);
        toast(`사진을 읽지 못했습니다${file.name ? `: ${file.name}` : ''}. 다른 형식(JPEG·PNG)으로 골라 주세요.`);
      })
      .finally(() => files === detail.files && renderTray());
  }
  renderTray();
}

function removeFile(id) {
  const i = detail.files.findIndex((f) => f.id === id);
  if (i < 0 || detail.sending) return;
  URL.revokeObjectURL(detail.files[i].url);
  detail.files.splice(i, 1);
  renderTray();
}

function dropFiles() {
  for (const f of detail.files || []) URL.revokeObjectURL(f.url);
  detail.files = [];
}

function renderTray() {
  const tray = document.getElementById('d-tray');
  if (!tray) return;
  tray.hidden = !detail.files.length;
  tray.innerHTML = detail.files
    .map((f) => `<div class="thumb${f.blob ? '' : ' busy'}"><img src="${esc(f.url)}" alt="${esc(f.name || '사진')}"><button type="button" class="x" data-drop="${f.id}" aria-label="사진 빼기">✕</button></div>`)
    .join('');
  updateComposer();
}

// Downscale to MAX_SIDE, JPEG 0.85, upright (EXIF orientation applied). The iOS picker
// normally hands over a JPEG even for HEIC photos; anything that won't decode is refused.
async function shrinkImage(file) {
  let src;
  let w;
  let h;
  let done = () => {};
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' });
    w = src.width;
    h = src.height;
    done = () => src.close();
  } catch {
    // Older Safari: an <img> decodes more formats and applies EXIF orientation itself.
    src = await new Promise((resolve, reject) => {
      const img = new Image();
      const u = URL.createObjectURL(file);
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('decode'));
      img.src = u;
      done = () => URL.revokeObjectURL(u);
    });
    w = src.naturalWidth;
    h = src.naturalHeight;
  }
  try {
    if (!w || !h) throw new Error('decode');
    if (['image/png', 'image/webp'].includes(file.type) && Math.max(w, h) <= MAX_SIDE && file.size <= KEEP_BYTES) return file;
    const k = Math.min(1, MAX_SIDE / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * k));
    canvas.height = Math.max(1, Math.round(h * k));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // JPEG has no transparency
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) throw new Error('encode');
    return blob;
  } finally {
    done();
  }
}

function openViewer(src) {
  const el = document.createElement('div');
  el.className = 'viewer';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', '사진');
  el.innerHTML = `<img src="${esc(src)}" alt="첨부 사진"><button type="button" class="icon-btn x" aria-label="닫기"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
  const close = () => {
    el.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => e.key === 'Escape' && close();
  el.onclick = close;
  document.addEventListener('keydown', onKey);
  document.body.appendChild(el);
}

function renderDetailHeader() {
  const a = currentAgent();
  const title = document.getElementById('d-title');
  if (!title) return;
  // The agent exited and left its shell behind: show that pane as a terminal. Only once the
  // agent has been seen here; just after a start the state may still list the pane as a shell.
  if (a) detail.seen = true;
  else if (detail.seen && (state.terminals || []).some((t) => same(t, curHost(), detail.pane))) return (location.hash = link(curHost(), `/term/${encodeURIComponent(detail.pane)}`));
  if (!a) {
    // Before the first state arrives (or before a peer's first report) nothing is known yet.
    const known = state.herdr !== 'connecting' && (state.hosts || []).some((h) => h.id === curHost());
    title.innerHTML = !known
      ? '불러오는 중…'
      : !online(curHost())
      ? `${esc(hostLabel(curHost()))} 오프라인<span class="sub">호스트가 돌아오면 다시 보입니다</span>`
      : `에이전트 없음<span class="sub">이 패널의 에이전트가 끝났거나 닫혔습니다</span>`;
    document.getElementById('d-badge').innerHTML = '';
    renderActivity();
    updateComposer();
    return;
  }
  title.innerHTML = `${esc(a.name || a.title)}<span class="sub">${multi() ? `${esc(hostLabel(a.host))} · ` : ''}${esc(a.agent)} · ${esc(a.workspaceLabel)} · ${esc(basename(a.cwd))}</span>`;
  document.getElementById('d-badge').innerHTML = `<span class="badge ${esc(a.status)}">${esc(STATUS_LABEL[a.status] || a.status)}</span>`;
  if (a.status !== 'working') detail.workingSince = detail.activity = null;
  else if (!detail.workingSince) detail.workingSince = Date.now();
  if (detail.wantSheet) {
    detail.wantSheet = false;
    openScreenSheet();
  }
  renderBlocked();
  renderActivity();
  updateComposer();
}

const RAW_KEYS = [['1', '1'], ['2', '2'], ['3', '3'], ['enter', 'Enter'], ['esc', 'Esc'], ['up', '↑'], ['down', '↓']];
// After a choice is sent, the buttons wait this long (or for the next status) so a double tap
// can't answer the prompt that comes next.
const CHOICE_LOCK_MS = 4000;
const choiceLocked = (a) => detail.lock && Date.now() < detail.lock.until && a && a.stateSeq === detail.lock.seq;

function renderBlocked() {
  const box = document.getElementById('d-blocked');
  const a = currentAgent();
  if (!box) return;
  if (!a || a.status !== 'blocked') {
    box.innerHTML = '';
    return;
  }
  const text = detail.blockedText;
  const choices = text ? parseChoices(text) : null;
  const screen = text ? `<pre>${esc(text)}</pre>` : '';
  const keys = `<div class="keys">${RAW_KEYS.map(([k, label]) => `<button class="key" data-key="${k}">${esc(label)}</button>`).join('')}</div>`;
  if (!choices) {
    box.innerHTML = `<div class="blocked-box">
        <strong>응답을 기다리고 있습니다</strong>
        ${text == null ? '<p class="question muted">화면을 불러오는 중…</p>' : screen}
        ${keys}
      </div>`;
  } else {
    const locked = choiceLocked(a);
    const firstYes = choices.items.find((x) => !x.negative);
    box.innerHTML = `<div class="blocked-box">
        <strong>응답을 기다리고 있습니다</strong>
        ${choices.context.length ? `<pre class="context">${esc(choices.context.join('\n'))}</pre>` : ''}
        ${choices.question ? `<p class="question">${esc(choices.question)}</p>` : ''}
        <div class="choices">${choices.items
          .map((x) => {
            const ok = choiceKeys(choices, x.n);
            const sent = locked && detail.lock.n === x.n;
            const kind = x.negative ? ' negative' : x !== firstYes ? ' alt' : '';
            return `<button class="choice${kind}${sent ? ' sent' : ''}" data-n="${x.n}"${locked || !ok ? ' disabled' : ''}>
              ${choices.numbered ? `<span class="num">${x.n}</span>` : ''}<span class="label">${esc(x.label)}</span>${sent ? '<span class="state">보냄</span>' : ''}</button>`;
          })
          .join('')}</div>
        <div class="toggles">
          <button class="toggle" data-toggle="showScreen" aria-expanded="${Boolean(detail.showScreen)}">화면 보기</button>
          <button class="toggle" data-toggle="showKeys" aria-expanded="${Boolean(detail.showKeys)}">직접 입력</button>
        </div>
        ${detail.showScreen ? screen : ''}
        ${detail.showKeys ? keys : ''}
      </div>`;
    box.querySelectorAll('.choice').forEach((b) => {
      b.onclick = () => {
        const cur = currentAgent();
        const k = choiceKeys(choices, Number(b.dataset.n));
        if (!k || choiceLocked(cur)) return;
        detail.lock = { until: Date.now() + CHOICE_LOCK_MS, seq: cur && cur.stateSeq, n: Number(b.dataset.n) };
        setTimeout(renderBlocked, CHOICE_LOCK_MS + 50);
        renderBlocked();
        sendKeys(k);
      };
    });
    box.querySelectorAll('.toggle').forEach((b) => {
      b.onclick = () => {
        detail[b.dataset.toggle] = !detail[b.dataset.toggle];
        renderBlocked();
      };
    });
  }
  box.querySelectorAll('.key').forEach((b) => (b.onclick = () => sendKeys([b.dataset.key])));
  // The choices sit at the bottom of the prompt; show them, not the preamble.
  const pre = box.querySelector('pre:not(.context)');
  if (pre) pre.scrollTop = pre.scrollHeight;
}

async function sendKeys(keys) {
  try {
    await api(hp(`/agents/${encodeURIComponent(detail.pane)}/keys`), { method: 'POST', body: JSON.stringify({ keys }) });
    setTimeout(loadDetail, 500);
  } catch (err) {
    toast(`키를 보내지 못했습니다: ${err.message}`);
  }
}

let loading = false;
let reloadAfter = false; // a load was asked for while one was running
async function loadDetail() {
  const a = currentAgent();
  if (!a) return;
  if (loading) return void (reloadAfter = true);
  loading = true;
  const pane = encodeURIComponent(a.pane);
  const host = curHost();
  try {
    if (a.status === 'blocked') {
      const seq = a.stateSeq;
      const v = await api(hp(`/agents/${pane}/screen?source=visible&lines=30`, host));
      // Read before a state change: that screen belongs to the previous prompt.
      if ((currentAgent() || {}).stateSeq === seq) detail.blockedText = v.text.replace(/\s+$/, '');
      else reloadAfter = true;
      renderBlocked();
    } else detail.blockedText = null;
    const working = a.status === 'working';
    let activityText = null;
    if (!screenBody(a)) detail.transcript = await api(hp(`/agents/${pane}/transcript?limit=150`, host));
    if (screenBody(a) || detail.sheet) {
      // A working agent can't give its scrollback; Claude draws on the alternate screen anyway,
      // so what is visible is the whole picture. The server falls back to it too.
      const source = working || a.status === 'blocked' ? 'visible' : 'recent';
      const s = (detail.screen = await api(hp(`/agents/${pane}/screen?source=${source}&lines=200${colorQuery()}`, host)));
      if (working && s.source === 'visible') activityText = s.format === 'ansi' && window.Ansi ? window.Ansi.strip(s.text) : s.text;
    }
    // The activity line: what the visible screen says the agent is doing, only while working.
    if (working && activityText == null) activityText = (await api(hp(`/agents/${pane}/screen?source=visible&lines=60`, host))).text;
    if (working && (currentAgent() || {}).status === 'working') setActivity(activityText);
    detail.lastErr = null;
    renderDetailBody(false);
    renderScreen();
    renderActivity();
  } catch (err) {
    if (['agent_not_found', 'peer_offline'].includes(err.code)) return;
    const msg = `불러오지 못했습니다: ${errText(err)}`;
    // Polls repeat the same failure every few seconds: say it once, inline on the screen.
    if (scr) screenError(msg);
    else if (msg !== detail.lastErr) toast(msg);
    detail.lastErr = msg;
  } finally {
    loading = false;
    if (reloadAfter) {
      reloadAfter = false;
      loadDetail();
    }
  }
}

// Only Claude has a transcript; any other agent kind shows its terminal screen in the body.
const screenBody = (a = currentAgent()) => Boolean(a && a.agent && a.agent !== 'claude');

function renderDetailBody(reset) {
  const body = document.getElementById('d-body');
  if (!body) return;
  if (screenBody()) {
    closeScreenSheet();
    if (!scr || scr.body !== body)
      mountScreen(body, 'agent', document.getElementById('s-tools'), '이 에이전트는 대화 기록이 없어 터미널 화면을 보여 줍니다. 지금 보이는 화면만 있습니다.');
    renderScreen();
    return;
  }
  if (scr && scr.body === body) {
    unmountScreen();
    reset = true;
  }
  const nearBottom = reset || body.scrollHeight - body.scrollTop - body.clientHeight < 80;
  const t = detail.transcript;
  if (!t) body.innerHTML = '<p class="note">불러오는 중…</p>';
  else if (!t.supported) body.innerHTML = `<p class="note">${currentAgent()?.agent ? '아직 대화 기록이 없습니다.' : '에이전트를 시작하는 중…'}</p>`;
  else if (!t.found) body.innerHTML = '<p class="note">아직 대화 기록이 없습니다.</p>';
  else
    body.innerHTML = `${t.truncated ? '<p class="note">최근 대화만 표시합니다</p>' : ''}<div class="msgs">${t.messages.map(message).join('')}</div>`;
  if (nearBottom) body.scrollTop = body.scrollHeight;
}

// The latest screen read, into whichever screen box is mounted (the body or the sheet).
function renderScreen() {
  const s = detail.screen;
  if (!scr || scr.kind !== 'agent' || !s) return;
  scr.note = s.source === 'visible' ? '보이는 화면' : '';
  setScreenText(s.text, s.format);
}

// ---- live activity line: under the header while the agent works; a tap opens the screen

function setActivity(text) {
  const p = text != null && window.Activity ? window.Activity.parseActivity(text) : null;
  detail.activity = p ? { ...p, at: Date.now() } : null;
}

function renderActivity() {
  const box = document.getElementById('d-activity');
  if (!box) return;
  const a = currentAgent();
  if (!a || a.status !== 'working') {
    box.hidden = true;
    clearInterval(tickTimer);
    tickTimer = null;
    return;
  }
  const act = detail.activity;
  const tail = (act && act.tool) || transcriptTool() || (act && (act.detail || act.tokens));
  box.disabled = screenBody(a); // the screen is already the body
  box.innerHTML = `<span class="spin" aria-hidden="true"></span><b>${esc(act ? act.word : '작업 중…')}</b><span class="el"></span>${
    tail ? `<span class="tail">${esc(tail)}</span>` : ''
  }${box.disabled ? '' : '<span class="go" aria-hidden="true">화면 ›</span>'}`;
  box.hidden = false;
  tickActivity();
  if (!tickTimer) tickTimer = setInterval(tickActivity, 1000);
}

// The last tool of this turn from the transcript, for screens that don't show the tool block
// (Claude on Windows often has only the spinner in view): the tools of the replies after the
// last prompt.
function transcriptTool() {
  const msgs = (detail.transcript && detail.transcript.messages) || [];
  for (let i = msgs.length - 1; i >= 0 && !['user', 'note'].includes(msgs[i].role); i--) {
    const t = msgs[i].tools && msgs[i].tools[msgs[i].tools.length - 1];
    if (t) return `${t.name}: ${t.summary}`;
  }
  return null;
}

// Elapsed time runs on between reads: from the spinner's own count, else since the status
// turned to working (as seen here).
function tickActivity() {
  const el = document.querySelector('#d-activity .el');
  if (!el) return;
  const act = detail.activity;
  const since = act && act.seconds != null ? act.at - act.seconds * 1000 : detail.workingSince;
  el.textContent = since && window.Activity ? window.Activity.formatElapsed((Date.now() - since) / 1000) : '';
}

// ---- the terminal screen as a tall sheet over the chat

function openScreenSheet() {
  const a = currentAgent();
  if (!a || screenBody(a) || detail.sheet || !document.getElementById('d-body')) return;
  const el = document.createElement('div');
  el.className = 'sheet-back';
  el.innerHTML = `<div class="sheet term-sheet" role="dialog" aria-modal="true" aria-label="터미널 화면">
      <div class="term-sheet-head">
        <h2>터미널 화면<span class="sub">${esc(a.name || a.title)}</span></h2>
        <button type="button" class="icon-btn" data-close aria-label="닫기"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </div>
      <div class="screen-tools"></div>
      <div class="scroll" id="ss-body"></div>
    </div>`;
  el.onclick = (e) => {
    if (e.target === el) closeScreenSheet();
  };
  el.querySelector('[data-close]').onclick = closeScreenSheet;
  detail.sheet = el;
  document.body.appendChild(el);
  document.addEventListener('keydown', sheetKey);
  mountScreen(el.querySelector('#ss-body'), 'agent', el.querySelector('.screen-tools'), '터미널에 지금 보이는 화면의 맨 위입니다. 이전 내용은 <button type="button" class="linkish">대화</button>에서 볼 수 있습니다.');
  el.querySelector('.screen-top .linkish').onclick = closeScreenSheet;
  el.querySelector('[data-close]').focus();
  loadDetail();
}

function closeScreenSheet() {
  const el = detail.sheet;
  if (!el) return;
  if (scr && el.contains(scr.body)) unmountScreen();
  detail.sheet = null;
  el.remove();
  document.removeEventListener('keydown', sheetKey);
}

function sheetKey(e) {
  // Another sheet on top (a menu) takes Escape first.
  if (e.key === 'Escape' && detail.sheet && document.querySelectorAll('.sheet-back').length === 1) closeScreenSheet();
}

function message(m) {
  if (m.role === 'note') return `<p class="note">${esc(m.text)}</p>`;
  if (m.role === 'user') {
    const { text, pics } = userParts(m);
    const imgs = pics.map((n) => {
      const src = `/api${hp(`/uploads/${n}`)}`;
      return `<button type="button" class="pic" data-src="${esc(src)}" aria-label="사진 크게 보기"><img src="${esc(src)}" alt="첨부 사진" loading="lazy"></button>`;
    });
    // Inline images with no upload behind them (pasted on the host): a chip each, never the bytes.
    const chips = Array.from({ length: Math.max(0, (m.images || 0) - pics.length) }, () => '<span class="img-chip">이미지</span>');
    const media = imgs.length || chips.length ? `<div class="pics">${imgs.join('')}${chips.join('')}</div>` : '';
    // No whitespace between tags: the bubble keeps line breaks (pre-wrap).
    return `<div class="msg user">${media}${text ? `<span>${esc(text)}</span>` : ''}</div>`;
  }
  const tools = m.tools && m.tools.length
    ? `<div class="tools">${m.tools.map((t) => `<div class="tool"><b>${esc(t.name)}</b> ${esc(t.summary)}</div>`).join('')}</div>`
    : '';
  return `<div class="msg assistant">${m.text ? md(m.text) : ''}${tools}</div>`;
}

async function agentMenu() {
  const a = currentAgent();
  if (!a) return;
  const k = await menu(a.name || a.title, [
    ...(screenBody(a) ? [] : [['screen', '터미널 화면 보기']]),
    ['rename', '이름 바꾸기'],
    ['ws', '워크스페이스 보기'],
    ['close', '패널 닫기(에이전트 종료)', true],
  ]);
  if (k === 'screen') openScreenSheet();
  if (k === 'ws') location.hash = link(a.host, `/ws/${encodeURIComponent(a.workspace)}`);
  if (k === 'rename') {
    const name = await sheet({ title: '에이전트 이름', text: '영문 소문자·숫자·-·_ 만 됩니다. 비우면 이름을 지웁니다.', input: { value: a.name || '', placeholder: 'reviewer' }, ok: '바꾸기' });
    if (name != null) act(hp(`/agents/${encodeURIComponent(a.pane)}/rename`), { name: name.trim() }, '이름을 바꿨습니다');
  }
  if (k === 'close') closePane(a.pane, a.name || a.title, true);
}

async function closePane(pane, label, isAgent) {
  const ok = await sheet({
    title: '패널 닫기',
    text: `${label} 패널을 닫을까요?${isAgent ? ' 에이전트도 함께 끝납니다.' : ''} 되돌릴 수 없습니다.`,
    ok: '닫기',
    danger: true,
  });
  if (ok && (await act(hp(`/panes/${encodeURIComponent(pane)}/close`), {}, '패널을 닫았습니다'))) location.hash = '#/';
}

// POST a mutation; toasts on failure. Returns the response body or null.
async function act(path, body, okText) {
  try {
    const r = await api(path, { method: 'POST', body: JSON.stringify(body) });
    if (okText) toast(okText);
    return r;
  } catch (err) {
    toast(`실패: ${errText(err)}`);
    return null;
  }
}

// ------------------------------------------------------------ terminal view

// Shell titles are often the executable's full path; the program name says enough.
const termTitle = (t) => t.label || (/[\\/]/.test(t.title) ? basename(t.title) : t.title);
const currentTerminal = () => (state.terminals || []).find((t) => same(t, curHost(), detail.pane));

function renderTerminal() {
  $app.innerHTML = `
    <div class="detail">
      <header class="bar">
        <a class="icon-btn" href="#/" aria-label="목록">${ICON.back}</a>
        <h1 id="t-title"></h1>
        <button class="icon-btn" id="t-more" aria-label="더 보기">${ICON.more}</button>
      </header>
      <div class="screen-tools" id="s-tools" hidden></div>
      <div class="scroll" id="t-body"></div>
      <div class="keys term-keys">${TERM_KEYS.map(([k, label]) => `<button class="key" data-key="${k}">${esc(label)}</button>`).join('')}</div>
      <form class="composer" id="t-form">
        <input class="cmd" id="t-input" placeholder="명령 (Enter 로 실행)" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send">
        <button type="submit" class="send" aria-label="실행">${ICON.send}</button>
      </form>
    </div>`;
  const input = document.getElementById('t-input');
  // A key goes after whatever is in the input line, typed without Enter (Tab completes it).
  $app.querySelectorAll('.term-keys .key').forEach((b) => {
    b.onclick = async () => {
      if (await act(hp(`/panes/${encodeURIComponent(detail.pane)}/keys`), { keys: [b.dataset.key], text: input.value })) {
        input.value = '';
        setTimeout(loadTerminal, 300);
      }
    };
  });
  document.getElementById('t-form').onsubmit = async (e) => {
    e.preventDefault();
    if (await act(hp(`/panes/${encodeURIComponent(detail.pane)}/input`), { text: input.value })) {
      input.value = '';
      setTimeout(loadTerminal, 400);
    }
  };
  document.getElementById('t-more').onclick = terminalMenu;
  mountScreen(document.getElementById('t-body'), 'term', document.getElementById('s-tools'));
  renderTerminalHeader();
}

function renderTerminalHeader() {
  const title = document.getElementById('t-title');
  if (!title) return;
  const t = currentTerminal();
  // The pane may have turned into an agent (started from here); follow it.
  if (!t && state.agents.some((a) => same(a, curHost(), detail.pane))) return (location.hash = link(curHost(), `/agent/${encodeURIComponent(detail.pane)}`));
  title.innerHTML = t
    ? `${esc(termTitle(t))}<span class="sub">${multi() ? `${esc(hostLabel(t.host))} · ` : ''}셸 · ${esc(t.workspaceLabel)} · ${esc(t.cwd)}</span>`
    : !online(curHost())
      ? `${esc(hostLabel(curHost()))} 오프라인<span class="sub">호스트가 돌아오면 다시 보입니다</span>`
      : '터미널 없음<span class="sub">이 패널이 닫혔습니다</span>';
}

// Unwrapped lines, so the phone wraps each real line once instead of re-wrapping lines already
// cut at the pane's width. (The server falls back to recent on a herdr without it.)
async function loadTerminal() {
  if (!currentTerminal() || document.visibilityState !== 'visible') return;
  const pane = detail.pane;
  try {
    detail.screen = await api(hp(`/panes/${encodeURIComponent(pane)}/screen?source=recent_unwrapped&lines=200${colorQuery()}`));
  } catch (err) {
    if (scr && scr.kind === 'term' && !['pane_not_found', 'peer_offline'].includes(err.code)) screenError(`불러오지 못했습니다: ${errText(err)}`);
    return;
  }
  if (!scr || scr.kind !== 'term' || detail.pane !== pane) return;
  setScreenText(detail.screen.text, detail.screen.format);
}

async function terminalMenu() {
  const t = currentTerminal();
  if (!t) return;
  const k = await menu(termTitle(t), [
    ['agent', '여기서 에이전트 시작'],
    ['down', '아래로 나누기'],
    ['right', '오른쪽으로 나누기'],
    ['rename', '이름 바꾸기'],
    ['ws', '워크스페이스 보기'],
    ['close', '패널 닫기', true],
  ]);
  if (k === 'agent') location.hash = link(t.host, `/start/pane/${encodeURIComponent(t.pane)}`);
  if (k === 'ws') location.hash = link(t.host, `/ws/${encodeURIComponent(t.workspace)}`);
  if (k === 'down' || k === 'right') {
    const r = await act(hp(`/panes/${encodeURIComponent(t.pane)}/split`), { direction: k }, '패널을 나눴습니다');
    if (r && r.pane) location.hash = link(t.host, `/term/${encodeURIComponent(r.pane)}`);
  }
  if (k === 'rename') {
    const label = await sheet({ title: '패널 이름', text: '비우면 이름을 지웁니다.', input: { value: t.label || '', placeholder: '빌드' }, ok: '바꾸기' });
    if (label != null) act(hp(`/panes/${encodeURIComponent(t.pane)}/rename`), { label: label.trim() }, '이름을 바꿨습니다');
  }
  if (k === 'close') closePane(t.pane, termTitle(t), false);
}

// ------------------------------------------------------------ screen box

// The pane text in the agent screen sheet (or body) and the terminal view. Polls arrive every few seconds;
// the box changes only when the text did, follows new output while you're at the bottom, and
// holds still while you've scrolled up to read, selected text, or have a finger on it.
// Wrapping is a per-view choice: off for agents (TUI layouts keep their shape and scroll
// sideways inside the box), on for terminals.
const WRAP_KEY = { agent: 'paddock.wrap.agent', term: 'paddock.wrap.term' };
function getWrap(kind) {
  try {
    const v = localStorage.getItem(WRAP_KEY[kind]);
    if (v === '1' || v === '0') return v === '1';
  } catch {
    /* private mode: default */
  }
  return kind === 'term';
}
function saveWrap(kind, on) {
  try {
    localStorage.setItem(WRAP_KEY[kind], on ? '1' : '0');
  } catch {
    /* private mode: the choice lasts until reload */
  }
}

// Colours (herdr's ansi read) are one choice for both views, on unless switched off.
const COLOR_KEY = 'paddock.color';
function getColor() {
  try {
    return localStorage.getItem(COLOR_KEY) !== '0';
  } catch {
    return true;
  }
}
function saveColor(on) {
  try {
    localStorage.setItem(COLOR_KEY, on ? '1' : '0');
  } catch {
    /* private mode: the choice lasts until reload */
  }
}
const colorQuery = () => (getColor() ? '&format=ansi' : '');

const FOLLOW_SLACK = 40; // px from the bottom that still counts as "at the bottom"
let scr = null; // { kind, body, pre, pill, tools, wrap, color, raw, shown, pending, follow, touching, error, note }
const atBottom = (el) => el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_SLACK;
const selecting = () => {
  const s = window.getSelection();
  return Boolean(scr && s && !s.isCollapsed && s.rangeCount && scr.pre.contains(s.getRangeAt(0).commonAncestorContainer));
};

// tools: the bar for the status and the colour/wrap toggles. topHtml: a note above the text
// (agent TUIs draw on the alternate screen, so herdr has nothing above what is on screen now).
function mountScreen(body, kind, tools, topHtml = '') {
  body.classList.add('screen-mode');
  const top = topHtml ? `<div class="screen-top">${topHtml}</div>` : '';
  body.innerHTML = `<p class="note">불러오는 중…</p>${top}<pre class="screen" hidden></pre>
    <div class="pill-dock"><button type="button" class="new-out" hidden>↓ 새 출력</button></div>`;
  const s = (scr = {
    kind, body, tools, wrap: getWrap(kind), color: getColor(), raw: null, shown: null, pending: null, follow: true, touching: false, error: null, note: '',
    pre: body.querySelector('.screen'), pill: body.querySelector('.new-out'), loading: body.querySelector('.note'),
  });
  s.pre.classList.toggle('wrap', s.wrap);
  body.onscroll = () => {
    if (scr !== s) return;
    s.follow = atBottom(body);
    flushScreen();
  };
  body.ontouchstart = () => scr === s && (s.touching = true);
  body.ontouchend = body.ontouchcancel = () => {
    if (scr !== s) return;
    s.touching = false;
    setTimeout(flushScreen, 60);
  };
  s.pill.onclick = () => {
    s.follow = true;
    flushScreen(true);
  };
  if (tools) {
    tools.hidden = false;
    tools.innerHTML = `<span class="s-status"></span>
      <button type="button" class="toggle" data-s="color" aria-pressed="${s.color}">색상</button>
      <button type="button" class="toggle" data-s="wrap" aria-pressed="${s.wrap}">줄바꿈</button>`;
    tools.querySelector('[data-s="color"]').onclick = (e) => {
      s.color = !s.color;
      saveColor(s.color);
      e.currentTarget.setAttribute('aria-pressed', String(s.color));
      // Redraw what's there at once (an ansi read strips to plain), then read again in the new format.
      if (s.raw) setScreenText(s.raw.text, s.raw.format, true);
      if (kind === 'agent') loadDetail();
      else loadTerminal();
    };
    tools.querySelector('[data-s="wrap"]').onclick = (e) => {
      s.wrap = !s.wrap;
      saveWrap(kind, s.wrap);
      e.currentTarget.setAttribute('aria-pressed', String(s.wrap));
      s.pre.classList.toggle('wrap', s.wrap);
      if (s.follow) body.scrollTop = body.scrollHeight;
    };
  }
  screenStatus();
}

function unmountScreen() {
  if (!scr) return;
  const { body, tools } = scr;
  body.classList.remove('screen-mode');
  body.onscroll = body.ontouchstart = body.ontouchend = body.ontouchcancel = null;
  if (tools && tools.id === 's-tools') {
    tools.hidden = true;
    tools.innerHTML = '';
  }
  scr = null;
}

function screenStatus() {
  const el = scr && scr.tools && scr.tools.querySelector('.s-status');
  if (!el) return;
  el.textContent = scr.error || scr.note || '';
  el.classList.toggle('err', Boolean(scr.error));
  if (scr.shown == null) scr.loading.textContent = scr.error ? '화면을 읽지 못했습니다' : '불러오는 중…';
}

function screenError(msg) {
  if (!scr || scr.error === msg) return;
  scr.error = msg;
  screenStatus();
}

// format "ansi": herdr's coloured read, drawn as spans (ansi.js); "text" or missing: plain.
// Change detection compares the raw string, colour codes and all.
function setScreenText(raw, format, force) {
  if (!scr) return;
  const ansi = format === 'ansi' && Boolean(window.Ansi);
  scr.raw = { text: raw, format };
  // Trailing blanks only widen the sideways scroll (ansi.js trims the ansi read the same way).
  const text = ansi ? String(raw).replace(/\r/g, '') : String(raw).replace(/[ \t]+$/gm, '').replace(/\s+$/, '');
  const view = ansi ? (scr.color ? 'ansi' : 'strip') : 'text';
  const key = `${view}\u0000${text}`;
  scr.error = null;
  screenStatus();
  scr.pending = key === scr.shown && !force ? null : { key, view, text };
  flushScreen(force);
}

function screenColors(pre) {
  const cs = getComputedStyle(pre);
  const rgb = (v) => (v.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
  const bg = rgb(cs.backgroundColor);
  const fg = rgb(cs.color);
  const palette = Array.from({ length: 16 }, (_, i) => {
    const h = cs.getPropertyValue(`--ansi-${i}`).trim();
    return /^#[0-9a-f]{6}$/i.test(h) ? [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16)) : null;
  });
  return { fg: fg.length === 3 ? fg : undefined, bg: bg.length === 3 ? bg : undefined, palette, dark: bg.length === 3 ? 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2] < 128 : matchMedia('(prefers-color-scheme: dark)').matches };
}

function drawScreen(s, p) {
  if (p.view === 'ansi') s.pre.innerHTML = window.Ansi.toHtml(p.text, screenColors(s.pre));
  else s.pre.textContent = p.view === 'strip' ? window.Ansi.strip(p.text) : p.text;
}

// Put the waiting text on screen unless the reader is busy with what's there.
function flushScreen(force) {
  const s = scr;
  if (!s) return;
  if (s.pending != null && (force || (s.follow && !s.touching && !selecting()))) {
    drawScreen(s, s.pending);
    s.shown = s.pending.key;
    s.pending = null;
    s.pre.hidden = false;
    s.loading.hidden = true;
    if (s.follow) s.body.scrollTop = s.body.scrollHeight;
  }
  s.pill.hidden = s.pending == null || s.follow;
}

// The guarded colours depend on the theme: redraw when it flips.
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (scr && scr.raw && scr.pending == null) setScreenText(scr.raw.text, scr.raw.format, true);
});

document.addEventListener('selectionchange', () => {
  if (scr && scr.pending != null && !selecting()) flushScreen();
});

// ------------------------------------------------------------ app shell and keyboard

// The page never scrolls: #app is a fixed shell and only the regions inside it scroll.
// iOS keeps the layout viewport when the keyboard opens, shrinks the visual one and scrolls
// the page to show the field, which pushed the header off the top. So the shell follows the
// visual viewport (--app-top/--app-h), any page scroll is undone, and a chat or screen that
// was following the bottom stays there. Pinch-zoomed, the layout is left alone.
const vv = window.visualViewport || null;
const mainScroller = () => document.getElementById('ss-body') || document.querySelector('#d-body, #t-body, #app > main, #app > form.panel');
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
  if (window.scrollY || de.scrollTop || document.body.scrollTop) window.scrollTo(0, 0);
  const sc = mainScroller();
  // Measured before the shell changes size.
  const pinned = Boolean(sc) && (scr && scr.body === sc ? scr.follow : atBottom(sc));
  const zoomed = !vv || vv.scale > 1.01;
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
        touch.allow = canScroll(touch.target, axis);
      }
      if (!touch.allow && e.cancelable) e.preventDefault();
    },
    { passive: false }
  );
}

// ---- viewport diagnostics: snapshots to the hub's data/viewport.log (settings switch)

const DIAG_KEY = 'paddock.vpdiag';
let memDiag = true;
function diagOn() {
  try {
    return localStorage.getItem(DIAG_KEY) !== '0'; // on unless switched off
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
  fetch('/api/debug/viewport', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Paddock': '1' }, body: JSON.stringify(snap), keepalive: true }).catch(() => {});
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
    fetch('/api/debug/viewport', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Paddock': '1' }, body: JSON.stringify(snap), keepalive: true }).catch(() => {});
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
  $app.innerHTML = `
    <header class="bar">
      <a class="icon-btn" href="#/" aria-label="목록">${ICON.back}</a>
      <h1>${w ? esc(w.label) : '워크스페이스 없음'}<span class="sub">${w ? `${multi() ? `${esc(hostLabel(host))} · ` : ''}${esc(w.workspace_id)} · 탭 ${w.tab_count} · 패널 ${w.pane_count}` : missing}</span></h1>
    </header>
    <main class="list">
      ${w ? `
      <div class="row">
        <a class="btn" href="${link(host, `/start/ws/${id}`)}">에이전트 시작</a>
        <button class="btn secondary" id="w-tab">새 탭</button>
        <button class="btn secondary" id="w-rename">이름 바꾸기</button>
        <button class="btn secondary danger-text" id="w-close">닫기</button>
      </div>
      ${agents.length ? `<section class="group"><h2>에이전트 · ${agents.length}</h2><div class="cards">${agents.map(card).join('')}</div></section>` : ''}
      ${terms.length ? `<section class="group"><h2>터미널 · ${terms.length}</h2><div class="cards">${terms.map(termCard).join('')}</div></section>` : ''}` : ''}
    </main>`;
  if (!w) return;
  document.getElementById('w-tab').onclick = async () => {
    const r = await act(hp(`/workspaces/${id}/tabs`, host), {}, '새 탭을 열었습니다');
    if (r && r.pane) location.hash = link(host, `/term/${encodeURIComponent(r.pane)}`);
  };
  document.getElementById('w-rename').onclick = async () => {
    const label = await sheet({ title: '워크스페이스 이름', input: { value: w.label }, ok: '바꾸기' });
    if (label != null) act(hp(`/workspaces/${id}/rename`, host), { label }, '이름을 바꿨습니다');
  };
  document.getElementById('w-close').onclick = async () => {
    const ok = await sheet({
      title: '워크스페이스 닫기',
      text: `${w.label} 을(를) 닫을까요? 안의 패널 ${w.pane_count}개${agents.length ? `와 에이전트 ${agents.length}개` : ''}가 모두 끝납니다. 되돌릴 수 없습니다.`,
      ok: '닫기',
      danger: true,
    });
    if (ok && (await act(hp(`/workspaces/${id}/close`, host), {}, '워크스페이스를 닫았습니다'))) location.hash = '#/';
  };
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
  const where = isNew ? '' : ws ? `${ws.label} 워크스페이스의 새 탭${on}` : term ? `${termTitle(term)} 패널 (${term.workspaceLabel})${on}` : '찾을 수 없음';
  const back = isNew ? '#/' : ws ? link(host, `/ws/${encodeURIComponent(ws.workspace_id)}`) : term ? link(host, `/term/${encodeURIComponent(term.pane)}`) : '#/';
  $app.innerHTML = `
    <header class="bar">
      <a class="icon-btn" href="${back}" aria-label="뒤로">${ICON.back}</a>
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
        <input class="field" id="f-name" placeholder="자동 (영문 소문자)" autocomplete="off" autocapitalize="off" spellcheck="false">
        ${isNew ? '<p>새 폴더에서 Claude 를 처음 띄우면 폴더 신뢰 질문이 나옵니다. 에이전트 화면의 응답 키로 답하세요.</p>' : ''}
      </section>
      <div class="row end"><button type="submit" class="btn" id="f-submit" disabled>${isNew ? '만들기' : '시작'}</button></div>
    </form>`;
  const withAgent = document.getElementById('f-with');
  if (withAgent) withAgent.onchange = () => (document.getElementById('f-agent').hidden = !withAgent.checked);
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
        <button type="button" class="icon-btn" data-close aria-label="닫기"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
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
  const close = () => {
    el.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && el.isConnected && document.querySelectorAll('.sheet-back').length === 1) close();
  };
  document.addEventListener('keydown', onKey);
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
    if (!el.isConnected) return;
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

  document.body.appendChild(el);
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

function renderSettings() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const off = pushInfo && pushInfo.disabled;
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !off;
  if (!pushInfo)
    api('/push/key')
      .then((r) => {
        pushInfo = r;
        if (view.name === 'settings' && r.disabled) renderSettings();
      })
      .catch(() => {});
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  $app.innerHTML = `
    <header class="bar">
      <a class="icon-btn" href="#/" aria-label="목록">${ICON.back}</a>
      <h1>설정</h1>
    </header>
    <main class="panel">
      <section>
        <h2>알림</h2>
        <p>에이전트가 응답을 기다리거나 작업을 끝내면 알림을 받습니다.</p>
        ${!standalone ? '<p>iPhone에서는 먼저 Safari 공유 버튼 → <b>홈 화면에 추가</b>로 설치한 뒤, 설치된 앱에서 알림을 켜야 합니다.</p>' : ''}
        ${off ? '<p>이 호스트는 알림을 보내지 않습니다. 알림은 허브(desktop) Paddock 에서 켜세요.</p>' : !supported ? '<p>이 브라우저는 웹 푸시를 지원하지 않습니다.</p>' : ''}
        <p>현재 권한: <b>${esc(perm)}</b></p>
        <div class="row">
          <button class="btn" id="s-enable" ${supported ? '' : 'disabled'}>알림 켜기</button>
          <button class="btn secondary" id="s-test" ${supported ? '' : 'disabled'}>시험 알림</button>
        </div>
      </section>
      <section>
        <h2>진단</h2>
        <label class="switch"><span>화면 진단 보내기</span><input type="checkbox" id="s-diag" role="switch" ${diagOn() ? 'checked' : ''}></label>
        <p>키보드를 열고 닫거나 화면이 움직일 때 화면 크기·위치를 허브의 <code>data/viewport.log</code> 에 남깁니다(1초에 두 번까지, 바뀔 때만). 확인이 끝나면 끄세요.</p>
      </section>
      <section>
        <h2>호스트</h2>
        ${(hosts().length ? hosts() : [{ id: localId(), label: state.host, online: true, herdr: state.herdr, local: true }])
          .map((x) => {
            const n = state.agents.filter((a) => (a.host || localId()) === x.id).length;
            const status = !x.online ? `오프라인${x.since ? ` · ${esc(clock(x.since))}부터` : ''}` : `herdr ${esc(x.herdr)} · 에이전트 ${n}개`;
            return `<p><b>${esc(x.label)}</b>${x.local && multi() ? ' (허브)' : ''} · ${status}</p>`;
          })
          .join('')}
      </section>
    </main>`;
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
  if (test)
    test.onclick = async () => {
      try {
        const r = await api('/push/test', { method: 'POST' });
        toast(r.sent ? `알림을 ${r.sent}개 기기로 보냈습니다` : '등록된 기기가 없습니다. 먼저 알림을 켜 주세요.');
      } catch (err) {
        toast(`실패: ${err.message}`);
      }
    };
}

function b64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function enablePush() {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return toast('알림 권한이 허용되지 않았습니다.');
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await api('/push/key');
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
    await api('/push/subscribe', { method: 'POST', body: JSON.stringify(sub.toJSON()) });
    toast('알림을 켰습니다.');
    renderSettings();
  } catch (err) {
    toast(`알림을 켜지 못했습니다: ${err.message}`);
  }
}

// ------------------------------------------------------------ boot

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
window.addEventListener('hashchange', route);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && view.name === 'agent') loadDetail();
});
connect();
route();
