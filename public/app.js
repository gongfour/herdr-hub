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
};

let state = { agents: [], herdr: 'connecting' };
let view = { name: 'list' };
let detail = { pane: null, tab: 'chat', transcript: null, screen: null, blockedText: null, lastSeq: -1 };
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
  const m = h.match(/^\/agent\/(.+)$/);
  if (m) {
    view = { name: 'agent' };
    detail = { pane: decodeURIComponent(m[1]), tab: detail.pane === decodeURIComponent(m[1]) ? detail.tab : 'chat', transcript: null, screen: null, blockedText: null, lastSeq: -1 };
    renderDetail();
    loadDetail();
    pollTimer = setInterval(() => {
      const a = currentAgent();
      if (a && (a.status === 'working' || a.status === 'blocked')) loadDetail();
    }, 3000);
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
  $app.innerHTML = `
    <header class="bar">
      <h1>Paddock<span class="sub">${esc(state.host || '')}</span></h1>
      <span class="conn ${down ? 'down' : ''}"><span class="dot"></span>${down ? (state.herdr === 'down' ? 'herdr 연결 끊김' : '연결 중') : '실시간'}</span>
      <a class="icon-btn" href="#/settings" aria-label="설정">${ICON.gear}</a>
    </header>
    <main class="list">
      ${groups.length ? groups.map(([title, list]) => `
        <section class="group">
          <h2>${esc(title)} · ${list.length}</h2>
          <div class="cards">${list.map(card).join('')}</div>
        </section>`).join('') : `<p class="empty">${down ? 'herdr 서버에 연결하지 못했습니다.' : '실행 중인 에이전트가 없습니다.'}</p>`}
    </main>`;
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
    if (!confirm('지금 작업을 중단할까요? (Esc 키를 보냅니다)')) return;
    sendKeys(['esc']);
  };
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
      body.innerHTML = `<p class="note">${currentAgent()?.agent === 'claude' ? '아직 대화 기록이 없습니다.' : '이 에이전트는 대화 기록을 지원하지 않습니다. 화면 탭을 보세요.'}</p>`;
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
