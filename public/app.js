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
};
const errText = (err) => ERROR_TEXT[err.code] || err.message;

let state = { agents: [], herdr: 'connecting' };
let view = { name: 'list' };
let detail = { pane: null, tab: 'chat', transcript: null, screen: null, blockedText: null, lastSeq: -1 };
let host = null; // { kinds, recentCwds } from /api/host, loaded when a form opens
let pollTimer = null;

// ------------------------------------------------------------ utilities

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const basename = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || p || '';

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
function sheet({ title, text = '', input = null, ok = '확인', danger = false }) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'sheet-back';
    el.innerHTML = `<form class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <h2>${esc(title)}</h2>
        ${text ? `<p>${esc(text)}</p>` : ''}
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
function md(src) {
  const parts = String(src).split(/```[^\n]*\n?([\s\S]*?)```/g);
  return parts
    .map((chunk, i) => {
      if (i % 2) return `<pre><code>${esc(chunk.replace(/\n$/, ''))}</code></pre>`;
      return chunk
        .split(/\n{2,}/)
        .filter((p) => p.trim())
        .map((p) => {
          const heading = p.trim().match(/^(#{1,4})\s+(.+)$/);
          if (heading && !p.trim().includes('\n')) return `<p><strong>${esc(heading[2])}</strong></p>`;
          let h = esc(p.trim());
          h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>');
          h = h.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
          h = h.replace(/(https?:\/\/[^\s<)]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
          return `<p>${h.replace(/\n/g, '<br>')}</p>`;
        })
        .join('');
    })
    .join('');
}

// ------------------------------------------------------------ live state

function connect() {
  const es = new EventSource('/api/stream');
  es.addEventListener('state', (e) => {
    state = JSON.parse(e.data);
    onState();
  });
  es.onerror = () => {
    state = { ...state, herdr: 'offline' };
    if (view.name === 'list') render();
  };
}

function onState() {
  if (view.name === 'list') return render();
  if (view.name === 'ws') return renderWorkspace();
  if (view.name === 'term') {
    renderTerminalHeader();
    if (!detail.screen) loadTerminal(); // a pane opened just now appears with this state
  }
  if (view.name === 'agent') {
    const a = currentAgent();
    renderDetailHeader();
    if (a && a.stateSeq !== detail.lastSeq) {
      detail.lastSeq = a.stateSeq;
      loadDetail();
    }
  }
}

const currentAgent = () => state.agents.find((a) => a.pane === detail.pane);

// ------------------------------------------------------------ routing

function route() {
  clearInterval(pollTimer);
  const h = location.hash.replace(/^#/, '') || '/';
  let m = h.match(/^\/agent\/(.+)$/);
  if (m) {
    view = { name: 'agent' };
    detail = { pane: decodeURIComponent(m[1]), tab: detail.pane === decodeURIComponent(m[1]) && detail.tab ? detail.tab : 'chat', transcript: null, screen: null, blockedText: null, lastSeq: -1 };
    renderDetail();
    loadDetail();
    pollTimer = setInterval(() => {
      const a = currentAgent();
      if (a && (a.status === 'working' || a.status === 'blocked')) loadDetail();
    }, 3000);
  } else if ((m = h.match(/^\/term\/(.+)$/))) {
    view = { name: 'term', pane: decodeURIComponent(m[1]) };
    detail = { pane: view.pane, screen: null };
    renderTerminal();
    loadTerminal();
    pollTimer = setInterval(loadTerminal, 2500);
  } else if ((m = h.match(/^\/ws\/(.+)$/))) {
    view = { name: 'ws', id: decodeURIComponent(m[1]) };
    renderWorkspace();
  } else if (h === '/new' || (m = h.match(/^\/start\/(ws|pane)\/(.+)$/))) {
    view = h === '/new' ? { name: 'form', mode: 'new' } : { name: 'form', mode: m[1], target: decodeURIComponent(m[2]) };
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
  const groups = GROUPS.map(([status, title]) => [title, state.agents.filter((a) => a.status === status)]).filter(([, list]) => list.length);
  const terms = state.terminals || [];
  const spaces = state.workspaces || [];
  $app.innerHTML = `
    <header class="bar">
      <h1>Paddock<span class="sub">${esc(state.host || '')}</span></h1>
      <span class="conn ${down ? 'down' : ''}"><span class="dot"></span>${down ? (state.herdr === 'down' ? 'herdr 연결 끊김' : '연결 중') : '실시간'}</span>
      <a class="icon-btn" href="#/new" aria-label="새 워크스페이스">${ICON.plus}</a>
      <a class="icon-btn" href="#/settings" aria-label="설정">${ICON.gear}</a>
    </header>
    <main class="list">
      ${groups.length ? groups.map(([title, list]) => `
        <section class="group">
          <h2>${esc(title)} · ${list.length}</h2>
          <div class="cards">${list.map(card).join('')}</div>
        </section>`).join('') : `<p class="empty">${down ? 'herdr 서버에 연결하지 못했습니다.' : '실행 중인 에이전트가 없습니다.'}</p>`}
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
}

function termCard(t) {
  return `<a class="card" href="#/term/${encodeURIComponent(t.pane)}">
    <div class="main">
      <div class="title">${esc(termTitle(t))}</div>
      <div class="meta">셸 · ${esc(t.workspaceLabel)} · ${esc(basename(t.cwd))}</div>
    </div>
    <span class="badge idle">터미널</span>
  </a>`;
}

function wsCard(w) {
  const agents = state.agents.filter((a) => a.workspace === w.workspace_id).length;
  return `<a class="card" href="#/ws/${encodeURIComponent(w.workspace_id)}">
    <div class="main">
      <div class="title">${esc(w.label)}</div>
      <div class="meta">탭 ${w.tab_count} · 패널 ${w.pane_count} · 에이전트 ${agents}</div>
    </div>
  </a>`;
}

function card(a) {
  return `<a class="card" href="#/agent/${encodeURIComponent(a.pane)}">
    <div class="main">
      <div class="title">${esc(a.name ? `${a.name} · ${a.title}` : a.title)}</div>
      <div class="meta">${esc(a.agent)} · ${esc(a.workspaceLabel)} · ${esc(basename(a.cwd))}</div>
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
      <div class="seg" role="group" aria-label="보기">
        <button data-tab="chat">대화</button>
        <button data-tab="screen">화면</button>
      </div>
      <div id="d-blocked"></div>
      <div class="scroll" id="d-body"></div>
      <form class="composer" id="d-form">
        <textarea id="d-input" rows="1" placeholder="에이전트에게 보내기" enterkeyhint="send"></textarea>
        <button type="button" class="stop" id="d-stop" aria-label="중단" hidden>${ICON.stop}</button>
        <button type="submit" class="send" id="d-send" aria-label="보내기" disabled>${ICON.send}</button>
      </form>
    </div>`;
  $app.querySelectorAll('.seg button').forEach((b) => {
    b.onclick = () => {
      detail.tab = b.dataset.tab;
      renderDetailBody(true);
      loadDetail();
    };
  });
  const input = document.getElementById('d-input');
  input.oninput = () => {
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
    updateComposer();
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) document.getElementById('d-form').requestSubmit();
  };
  document.getElementById('d-form').onsubmit = async (e) => {
    e.preventDefault();
    const text = input.value;
    if (!text.trim()) return;
    const sendBtn = document.getElementById('d-send');
    sendBtn.disabled = true;
    try {
      await api(`/agents/${encodeURIComponent(detail.pane)}/prompt`, { method: 'POST', body: JSON.stringify({ text }) });
      input.value = '';
      input.style.height = 'auto';
      setTimeout(loadDetail, 600);
    } catch (err) {
      toast(err.code === 'agent_blocked' ? '에이전트가 응답을 기다리는 중입니다. 위 버튼으로 먼저 답해 주세요.' : `보내지 못했습니다: ${err.message}`);
    } finally {
      updateComposer();
    }
  };
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
  send.disabled = !a || !input.value.trim() || a.status === 'blocked';
}

function renderDetailHeader() {
  const a = currentAgent();
  const title = document.getElementById('d-title');
  if (!title) return;
  // The agent exited and left its shell behind: show that pane as a terminal. Only once the
  // agent has been seen here; just after a start the state may still list the pane as a shell.
  if (a) detail.seen = true;
  else if (detail.seen && (state.terminals || []).some((t) => t.pane === detail.pane)) return (location.hash = `#/term/${encodeURIComponent(detail.pane)}`);
  if (!a) {
    title.innerHTML = `에이전트 없음<span class="sub">이 패널의 에이전트가 끝났거나 닫혔습니다</span>`;
    document.getElementById('d-badge').innerHTML = '';
    updateComposer();
    return;
  }
  title.innerHTML = `${esc(a.name || a.title)}<span class="sub">${esc(a.agent)} · ${esc(a.workspaceLabel)} · ${esc(basename(a.cwd))}</span>`;
  document.getElementById('d-badge').innerHTML = `<span class="badge ${esc(a.status)}">${esc(STATUS_LABEL[a.status] || a.status)}</span>`;
  $app.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === detail.tab)));
  renderBlocked();
  updateComposer();
}

function renderBlocked() {
  const box = document.getElementById('d-blocked');
  const a = currentAgent();
  if (!box) return;
  if (!a || a.status !== 'blocked') {
    box.innerHTML = '';
    return;
  }
  const keys = [['1', '1'], ['2', '2'], ['3', '3'], ['enter', 'Enter'], ['esc', 'Esc'], ['up', '↑'], ['down', '↓']];
  box.innerHTML = `<div class="blocked-box">
      <strong>응답을 기다리고 있습니다</strong>
      ${detail.blockedText ? `<pre>${esc(detail.blockedText)}</pre>` : ''}
      <div class="keys">${keys.map(([k, label]) => `<button class="key" data-key="${k}">${esc(label)}</button>`).join('')}</div>
    </div>`;
  box.querySelectorAll('.key').forEach((b) => (b.onclick = () => sendKeys([b.dataset.key])));
  // The choices sit at the bottom of the prompt; show them, not the preamble.
  const pre = box.querySelector('pre');
  if (pre) pre.scrollTop = pre.scrollHeight;
}

async function sendKeys(keys) {
  try {
    await api(`/agents/${encodeURIComponent(detail.pane)}/keys`, { method: 'POST', body: JSON.stringify({ keys }) });
    setTimeout(loadDetail, 500);
  } catch (err) {
    toast(`키를 보내지 못했습니다: ${err.message}`);
  }
}

let loading = false;
async function loadDetail() {
  const a = currentAgent();
  if (!a || loading) return;
  loading = true;
  const pane = encodeURIComponent(a.pane);
  try {
    if (a.status === 'blocked') {
      const v = await api(`/agents/${pane}/screen?source=visible&lines=30`);
      detail.blockedText = v.text.replace(/\s+$/, '').split('\n').slice(-18).join('\n');
      renderBlocked();
    } else detail.blockedText = null;
    if (detail.tab === 'chat') detail.transcript = await api(`/agents/${pane}/transcript?limit=150`);
    else detail.screen = await api(`/agents/${pane}/screen?lines=200`);
    renderDetailBody(false);
  } catch (err) {
    if (err.code !== 'agent_not_found') toast(`불러오지 못했습니다: ${err.message}`);
  } finally {
    loading = false;
  }
}

function renderDetailBody(reset) {
  const body = document.getElementById('d-body');
  if (!body) return;
  const nearBottom = reset || body.scrollHeight - body.scrollTop - body.clientHeight < 80;
  $app.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === detail.tab)));
  if (detail.tab === 'chat') {
    const t = detail.transcript;
    if (!t) body.innerHTML = '<p class="note">불러오는 중…</p>';
    else if (!t.supported)
      body.innerHTML = `<p class="note">${!currentAgent()?.agent ? '에이전트를 시작하는 중…' : currentAgent().agent === 'claude' ? '아직 대화 기록이 없습니다.' : '이 에이전트는 대화 기록을 지원하지 않습니다. 화면 탭을 보세요.'}</p>`;
    else if (!t.found) body.innerHTML = '<p class="note">아직 대화 기록이 없습니다.</p>';
    else
      body.innerHTML = `${t.truncated ? '<p class="note">최근 대화만 표시합니다</p>' : ''}<div class="msgs">${t.messages.map(message).join('')}</div>`;
  } else {
    const s = detail.screen;
    body.innerHTML = s ? `<pre class="screen">${esc(s.text.replace(/\s+$/, ''))}</pre>` : '<p class="note">불러오는 중…</p>';
  }
  if (nearBottom) body.scrollTop = body.scrollHeight;
}

function message(m) {
  if (m.role === 'note') return `<p class="note">${esc(m.text)}</p>`;
  if (m.role === 'user') return `<div class="msg user">${esc(m.text)}</div>`;
  const tools = m.tools && m.tools.length
    ? `<div class="tools">${m.tools.map((t) => `<div class="tool"><b>${esc(t.name)}</b> ${esc(t.summary)}</div>`).join('')}</div>`
    : '';
  return `<div class="msg assistant">${m.text ? md(m.text) : ''}${tools}</div>`;
}

async function agentMenu() {
  const a = currentAgent();
  if (!a) return;
  const k = await menu(a.name || a.title, [['rename', '이름 바꾸기'], ['ws', '워크스페이스 보기'], ['close', '패널 닫기(에이전트 종료)', true]]);
  if (k === 'ws') location.hash = `#/ws/${encodeURIComponent(a.workspace)}`;
  if (k === 'rename') {
    const name = await sheet({ title: '에이전트 이름', text: '영문 소문자·숫자·-·_ 만 됩니다. 비우면 이름을 지웁니다.', input: { value: a.name || '', placeholder: 'reviewer' }, ok: '바꾸기' });
    if (name != null) act(`/agents/${encodeURIComponent(a.pane)}/rename`, { name: name.trim() }, '이름을 바꿨습니다');
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
  if (ok && (await act(`/panes/${encodeURIComponent(pane)}/close`, {}, '패널을 닫았습니다'))) location.hash = '#/';
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
const currentTerminal = () => (state.terminals || []).find((t) => t.pane === detail.pane);

function renderTerminal() {
  $app.innerHTML = `
    <div class="detail">
      <header class="bar">
        <a class="icon-btn" href="#/" aria-label="목록">${ICON.back}</a>
        <h1 id="t-title"></h1>
        <button class="icon-btn" id="t-more" aria-label="더 보기">${ICON.more}</button>
      </header>
      <div class="scroll" id="t-body"><p class="note">불러오는 중…</p></div>
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
      if (await act(`/panes/${encodeURIComponent(detail.pane)}/keys`, { keys: [b.dataset.key], text: input.value })) {
        input.value = '';
        setTimeout(loadTerminal, 300);
      }
    };
  });
  document.getElementById('t-form').onsubmit = async (e) => {
    e.preventDefault();
    if (await act(`/panes/${encodeURIComponent(detail.pane)}/input`, { text: input.value })) {
      input.value = '';
      setTimeout(loadTerminal, 400);
    }
  };
  document.getElementById('t-more').onclick = terminalMenu;
  renderTerminalHeader();
}

function renderTerminalHeader() {
  const title = document.getElementById('t-title');
  if (!title) return;
  const t = currentTerminal();
  // The pane may have turned into an agent (started from here); follow it.
  if (!t && state.agents.some((a) => a.pane === detail.pane)) return (location.hash = `#/agent/${encodeURIComponent(detail.pane)}`);
  title.innerHTML = t
    ? `${esc(termTitle(t))}<span class="sub">셸 · ${esc(t.workspaceLabel)} · ${esc(t.cwd)}</span>`
    : '터미널 없음<span class="sub">이 패널이 닫혔습니다</span>';
}

async function loadTerminal() {
  if (!currentTerminal() || document.visibilityState !== 'visible') return;
  try {
    detail.screen = await api(`/panes/${encodeURIComponent(detail.pane)}/screen?lines=200`);
  } catch (err) {
    if (err.code !== 'pane_not_found') toast(`불러오지 못했습니다: ${err.message}`);
    return;
  }
  const body = document.getElementById('t-body');
  if (!body) return;
  const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
  body.innerHTML = `<pre class="screen">${esc(detail.screen.text.replace(/\s+$/, ''))}</pre>`;
  if (nearBottom || !body.dataset.loaded) body.scrollTop = body.scrollHeight;
  body.dataset.loaded = '1';
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
  if (k === 'agent') location.hash = `#/start/pane/${encodeURIComponent(t.pane)}`;
  if (k === 'ws') location.hash = `#/ws/${encodeURIComponent(t.workspace)}`;
  if (k === 'down' || k === 'right') {
    const r = await act(`/panes/${encodeURIComponent(t.pane)}/split`, { direction: k }, '패널을 나눴습니다');
    if (r && r.pane) location.hash = `#/term/${encodeURIComponent(r.pane)}`;
  }
  if (k === 'rename') {
    const label = await sheet({ title: '패널 이름', text: '비우면 이름을 지웁니다.', input: { value: t.label || '', placeholder: '빌드' }, ok: '바꾸기' });
    if (label != null) act(`/panes/${encodeURIComponent(t.pane)}/rename`, { label: label.trim() }, '이름을 바꿨습니다');
  }
  if (k === 'close') closePane(t.pane, termTitle(t), false);
}

// ------------------------------------------------------------ workspace view

function renderWorkspace() {
  const w = (state.workspaces || []).find((x) => x.workspace_id === view.id);
  const agents = state.agents.filter((a) => a.workspace === view.id);
  const terms = (state.terminals || []).filter((t) => t.workspace === view.id);
  const id = encodeURIComponent(view.id);
  $app.innerHTML = `
    <header class="bar">
      <a class="icon-btn" href="#/" aria-label="목록">${ICON.back}</a>
      <h1>${w ? esc(w.label) : '워크스페이스 없음'}<span class="sub">${w ? `${esc(w.workspace_id)} · 탭 ${w.tab_count} · 패널 ${w.pane_count}` : '닫혔거나 찾을 수 없습니다'}</span></h1>
    </header>
    <main class="list">
      ${w ? `
      <div class="row">
        <a class="btn" href="#/start/ws/${id}">에이전트 시작</a>
        <button class="btn secondary" id="w-tab">새 탭</button>
        <button class="btn secondary" id="w-rename">이름 바꾸기</button>
        <button class="btn secondary danger-text" id="w-close">닫기</button>
      </div>
      ${agents.length ? `<section class="group"><h2>에이전트 · ${agents.length}</h2><div class="cards">${agents.map(card).join('')}</div></section>` : ''}
      ${terms.length ? `<section class="group"><h2>터미널 · ${terms.length}</h2><div class="cards">${terms.map(termCard).join('')}</div></section>` : ''}` : ''}
    </main>`;
  if (!w) return;
  document.getElementById('w-tab').onclick = async () => {
    const r = await act(`/workspaces/${id}/tabs`, {}, '새 탭을 열었습니다');
    if (r && r.pane) location.hash = `#/term/${encodeURIComponent(r.pane)}`;
  };
  document.getElementById('w-rename').onclick = async () => {
    const label = await sheet({ title: '워크스페이스 이름', input: { value: w.label }, ok: '바꾸기' });
    if (label != null) act(`/workspaces/${id}/rename`, { label }, '이름을 바꿨습니다');
  };
  document.getElementById('w-close').onclick = async () => {
    const ok = await sheet({
      title: '워크스페이스 닫기',
      text: `${w.label} 을(를) 닫을까요? 안의 패널 ${w.pane_count}개${agents.length ? `와 에이전트 ${agents.length}개` : ''}가 모두 끝납니다. 되돌릴 수 없습니다.`,
      ok: '닫기',
      danger: true,
    });
    if (ok && (await act(`/workspaces/${id}/close`, {}, '워크스페이스를 닫았습니다'))) location.hash = '#/';
  };
}

// ------------------------------------------------------------ new workspace / start agent

async function renderForm() {
  const isNew = view.mode === 'new';
  const ws = view.mode === 'ws' ? (state.workspaces || []).find((x) => x.workspace_id === view.target) : null;
  const term = view.mode === 'pane' ? (state.terminals || []).find((t) => t.pane === view.target) : null;
  const where = isNew ? '' : ws ? `${ws.label} 워크스페이스의 새 탭` : term ? `${termTitle(term)} 패널 (${term.workspaceLabel})` : '찾을 수 없음';
  $app.innerHTML = `
    <header class="bar">
      <a class="icon-btn" href="${isNew ? '#/' : ws ? `#/ws/${encodeURIComponent(ws.workspace_id)}` : term ? `#/term/${encodeURIComponent(term.pane)}` : '#/'}" aria-label="뒤로">${ICON.back}</a>
      <h1>${isNew ? '새 워크스페이스' : '에이전트 시작'}${where ? `<span class="sub">${esc(where)}</span>` : ''}</h1>
    </header>
    <form class="panel" id="f-form">
      ${isNew ? `
      <section>
        <h2>폴더</h2>
        <input class="field" id="f-cwd" list="f-cwds" placeholder="C:\\Users\\…\\project" autocomplete="off" autocapitalize="off" spellcheck="false" required>
        <datalist id="f-cwds"></datalist>
        <div class="chips" id="f-recent"></div>
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
      <div class="row end"><button type="submit" class="btn" id="f-submit" ${!isNew && !ws && !term ? 'disabled' : ''}>${isNew ? '만들기' : '시작'}</button></div>
    </form>`;
  const form = document.getElementById('f-form');
  const withAgent = document.getElementById('f-with');
  if (withAgent) withAgent.onchange = () => (document.getElementById('f-agent').hidden = !withAgent.checked);
  form.onsubmit = submitForm;
  try {
    host = host || (await api('/host'));
  } catch (err) {
    return toast(`불러오지 못했습니다: ${err.message}`);
  }
  if (view.name !== 'form') return;
  document.getElementById('f-kind').innerHTML = host.kinds.map((k) => `<option value="${esc(k)}">${esc(k)}</option>`).join('');
  if (isNew) {
    document.getElementById('f-cwds').innerHTML = host.recentCwds.map((c) => `<option value="${esc(c)}">`).join('');
    const chips = document.getElementById('f-recent');
    chips.innerHTML = host.recentCwds.map((c) => `<button type="button" class="chip" title="${esc(c)}" data-cwd="${esc(c)}">${esc(basename(c))}</button>`).join('');
    chips.querySelectorAll('.chip').forEach((b) => (b.onclick = () => (document.getElementById('f-cwd').value = b.dataset.cwd)));
  }
}

async function submitForm(e) {
  e.preventDefault();
  const val = (id) => (document.getElementById(id)?.value || '').trim();
  const agent = { kind: val('f-kind'), args: val('f-args').split(/\s+/).filter(Boolean), name: val('f-name') };
  const btn = document.getElementById('f-submit');
  btn.disabled = true;
  let r = null;
  let started = true;
  if (view.mode === 'new') {
    const withAgent = document.getElementById('f-with').checked;
    r = await act('/workspaces', { cwd: val('f-cwd'), label: val('f-label'), agent: withAgent ? agent : null });
    if (r) {
      if (r.agentError) toast(`워크스페이스는 만들었지만 에이전트를 시작하지 못했습니다: ${r.agentError}`);
      started = Boolean(r.agent);
      host = null; // recent folders changed
    }
  } else if (view.mode === 'ws') r = await act(`/workspaces/${encodeURIComponent(view.target)}/agents`, agent);
  else r = await act(`/panes/${encodeURIComponent(view.target)}/agent`, agent);
  btn.disabled = false;
  if (!r) return;
  const pane = encodeURIComponent(r.pane || view.target);
  location.hash = started ? `#/agent/${pane}` : `#/term/${pane}`;
}

// ------------------------------------------------------------ settings

function renderSettings() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
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
        ${!supported ? '<p>이 브라우저는 웹 푸시를 지원하지 않습니다.</p>' : ''}
        <p>현재 권한: <b>${esc(perm)}</b></p>
        <div class="row">
          <button class="btn" id="s-enable" ${supported ? '' : 'disabled'}>알림 켜기</button>
          <button class="btn secondary" id="s-test" ${supported ? '' : 'disabled'}>시험 알림</button>
        </div>
      </section>
      <section>
        <h2>호스트</h2>
        <p>${esc(state.host || '')} · herdr ${esc(state.herdr)} · 에이전트 ${state.agents.length}개</p>
      </section>
    </main>`;
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
