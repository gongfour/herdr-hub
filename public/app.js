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

// ------------------------------------------------------------ detail view

function renderDetail() {
  detailRoot().innerHTML = `
    <div class="detail">
      <header class="bar">
        ${backLink(homeHash())}
        <h1 id="d-title"></h1>
        <button type="button" class="mode-chip" id="d-mode" hidden></button>
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
      <div class="palette" id="d-pal" role="listbox" aria-label="명령 제안" hidden></div>
      <div class="composer" id="d-form">
        <button type="button" class="attach" id="d-attach" aria-label="사진 첨부">${ICON.photo}</button>
        <button type="button" class="attach" id="d-camera" aria-label="카메라로 찍기">${ICON.camera}</button>
        <div id="d-input" class="input" contenteditable="plaintext-only" role="textbox" aria-multiline="true" aria-label="메시지" data-placeholder="메시지 보내기" enterkeyhint="${getEnter() === 'send' ? 'send' : 'enter'}" autocapitalize="sentences"></div>
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
    updatePalette();
  };
  input.onkeydown = (e) => {
    if (paletteKey(e)) return;
    if (Keys.enterAction(e, getEnter()) === 'send') {
      e.preventDefault();
      sendNow();
    }
  };
  input.addEventListener('click', updatePalette);
  input.addEventListener('focus', updatePalette);
  // A tap on a suggestion must not count as leaving the field.
  input.addEventListener('blur', () => setTimeout(() => document.activeElement !== input && !(pal && pal.pressing) && hidePalette(), 0));
  bindPalette(input);
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
    const more = e.target.closest('[data-shell]');
    if (more) {
      const set = (detail.openShell ||= new Set());
      const k = more.dataset.shell;
      if (set.has(k)) set.delete(k);
      else set.add(k);
      return renderDetailBody(false);
    }
    const tool = e.target.closest('[data-tool]');
    if (tool) {
      const set = (detail.openTools ||= new Set());
      const k = tool.dataset.tool;
      if (set.has(k)) set.delete(k);
      else set.add(k);
      renderDetailBody(false);
    }
  });
  // Not a <form>: iOS would add its ⌃ ⌄ / contact AutoFill bar above the keyboard.
  const sendNow = async () => {
    const text = input.value.replace(/\s+$/, '');
    const files = detail.files;
    if (detail.sending || (!text.trim() && !files.length)) return;
    if (files.some((f) => !f.blob)) return toast('사진을 준비하는 중입니다. 잠시 뒤에 보내 주세요.');
    const host = curHost();
    const pane = detail.pane;
    const key = rowKey(host, pane);
    const here = () => view.name === 'agent' && detail.pane === pane && curHost() === host;
    detail.sending = true;
    updateComposer();
    // The answer typed after a "Type something" choice: into the open question, then Enter.
    if (detail.answerMode && !files.length) {
      try {
        await api(hp(`/agents/${encodeURIComponent(pane)}/keys`, host), { method: 'POST', body: JSON.stringify({ text: text.replace(/\s+/g, ' ').trim(), keys: ['enter'] }) });
        if (here()) {
          input.value = '';
          detail.answerMode = false;
          setPlaceholder();
        }
        drafts.delete(key);
        setTimeout(loadDetail, 500);
      } catch (err) {
        toastErr(`답을 보내지 못했습니다: ${errText(err)} 글은 그대로 있습니다.`, { label: '다시 보내기', run: () => here() && sendNow() });
      } finally {
        detail.sending = false;
        updateComposer();
      }
      return;
    }
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
      if (here() && detail.files === files) {
        input.value = '';
        hidePalette();
        dropFiles();
        renderTray();
      } else for (const f of files) URL.revokeObjectURL(f.url);
      if ((drafts.get(key) || {}).files === files) drafts.delete(key);
      setTimeout(loadDetail, 600);
    } catch (err) {
      const retry = { label: '다시 보내기', run: () => here() && sendNow() };
      if (err.code === 'agent_blocked') toastErr(errText(err));
      else if (err.network) toastErr(`연결이 끊겨 ${err.upload ? '사진을 올리지' : '보내지'} 못했습니다. 글은 그대로 있습니다.`, retry);
      else toastErr(`${err.upload ? '사진을 올리지' : '보내지'} 못했습니다: ${errText(err)} 글은 그대로 있습니다.`, retry);
    } finally {
      detail.sending = false;
      updateComposer();
    }
  };
  document.getElementById('d-send').onclick = sendNow;
  keepFocusTap(document.getElementById('d-send'), sendNow);
  document.getElementById('d-stop').onclick = confirmStop;
  document.getElementById('d-more').onclick = agentMenu;
  document.getElementById('d-mode').onclick = cycleMode;
  renderDetailHeader();
  renderDetailBody(true);
}

async function confirmStop() {
  if (!(await sheet({ title: '작업 멈추기', text: '작업을 멈출까요? 대화는 남습니다.', ok: '멈추기', danger: true }))) return;
  sendKeys(['esc']);
}

function setPlaceholder() {
  const input = document.getElementById('d-input');
  if (input) input.dataset.placeholder = detail.answerMode ? '답을 적어 보내세요' : '메시지 보내기';
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
  // Blocked: only the answer to a "Type something" choice goes from here.
  const blockedNow = a && a.status === 'blocked' && !detail.answerMode;
  send.disabled = !a || (!input.value.trim() && !files.length) || blockedNow || Boolean(detail.sending);
  for (const id of ['d-attach', 'd-camera']) {
    const b = document.getElementById(id);
    if (b) b.disabled = Boolean(detail.sending) || files.length >= MAX_FILES;
  }
}

// ------------------------------------------------------------ composer palette

// Typing "/" at the start lists what this Claude agent's Claude Code accepts as a command
// (built-in, project, user, skills, plugins: read on the agent's host); "@" completes paths
// under its folder; "!" says the line runs in its shell. Tap or ↑↓ + Enter/Tab inserts.
const SOURCE_LABEL = { builtin: '기본', project: '프로젝트', user: '사용자', skill: '스킬', plugin: '플러그인' };
const PAL_MAX = 80; // rows drawn; the filter narrows long lists
const cmdCache = new Map(); // host|pane -> { at, list } for 60 s, like the host's own cache
const fileCache = new Map(); // host|pane|q -> { at, list }
let pal = null; // { kind: cmd|file|bang, items, sel, q, start, end, pressing, dismissed }

const palAgent = () => {
  const a = currentAgent();
  return a && a.agent === 'claude' ? a : null;
};

// The text from the start of the field to the caret.
function beforeCaret(input) {
  const sel = getSelection();
  if (!sel || !sel.rangeCount || !input.contains(sel.anchorNode)) return input.value;
  const r = document.createRange();
  r.selectNodeContents(input);
  try {
    r.setEnd(sel.anchorNode, sel.anchorOffset);
  } catch {
    return input.value;
  }
  return r.toString();
}

function caretToEnd(el) {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

function placeCaret(input, offset) {
  const node = input.firstChild;
  if (!node) return;
  const r = document.createRange();
  r.setStart(node, Math.min(offset, node.textContent.length));
  r.collapse(true);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

// Prefix matches first (of the whole name or of a part after ":"), then substring ones;
// each keeps the host's order (source group, then name).
function filterCommands(list, q) {
  const ql = q.toLowerCase();
  if (!ql) return list;
  const pre = (c) => c.name.toLowerCase().split(':').some((part, i, all) => all.slice(i).join(':').startsWith(ql));
  const a = list.filter(pre);
  const b = list.filter((c) => !pre(c) && c.name.toLowerCase().includes(ql));
  return [...a, ...b];
}

async function loadCommands(host, pane) {
  const key = `${host}|${pane}`;
  const hit = cmdCache.get(key);
  if (hit && Date.now() - hit.at < 60000) return hit.list;
  const r = await api(hp(`/agents/${encodeURIComponent(pane)}/commands`, host));
  const list = r.supported ? r.commands : [];
  cmdCache.set(key, { at: Date.now(), list });
  return list;
}

async function loadFiles(host, pane, q) {
  const key = `${host}|${pane}|${q}`;
  const hit = fileCache.get(key);
  if (hit && Date.now() - hit.at < 30000) return hit.list;
  const r = await api(hp(`/agents/${encodeURIComponent(pane)}/files?q=${encodeURIComponent(q)}`, host));
  const list = r.supported ? r.files : [];
  fileCache.set(key, { at: Date.now(), list });
  if (fileCache.size > 60) fileCache.delete(fileCache.keys().next().value);
  return list;
}

// What the text before the caret asks for, or null.
function paletteWant(input) {
  const value = input.value;
  const before = beforeCaret(input);
  let m;
  if ((m = /^\/(\S*)$/.exec(before)))
    return { kind: 'cmd', q: m[1], start: 0, end: before.length + (value.slice(before.length).match(/^\S*/) || [''])[0].length };
  if (/^!/.test(value)) return { kind: 'bang' };
  if ((m = /(^|\s)@(\S*)$/.exec(before))) return { kind: 'file', q: m[2], start: before.length - m[2].length - 1, end: before.length };
  return null;
}

let palSeq = 0;
async function updatePalette() {
  const input = document.getElementById('d-input');
  const box = document.getElementById('d-pal');
  if (!input || !box) return;
  const a = palAgent();
  const want = a && document.activeElement === input ? paletteWant(input) : null;
  if (!want || (pal && pal.dismissed === input.value)) return hidePalette(pal && pal.dismissed === input.value ? pal.dismissed : null);
  const seq = ++palSeq;
  const host = curHost();
  const pane = detail.pane;
  let items = [];
  if (want.kind === 'cmd') {
    try {
      items = filterCommands(await loadCommands(host, pane), want.q);
    } catch (err) {
      items = [];
      want.error = `명령 목록을 읽지 못했습니다: ${errText(err)}`;
    }
  } else if (want.kind === 'file') {
    // Typing fast asks once the letters settle.
    if (!fileCache.has(`${host}|${pane}|${want.q}`)) await new Promise((r) => setTimeout(r, 120));
    if (seq !== palSeq) return;
    try {
      items = await loadFiles(host, pane, want.q);
    } catch (err) {
      want.error = `파일 목록을 읽지 못했습니다: ${errText(err)}`;
    }
  }
  if (seq !== palSeq || document.getElementById('d-pal') !== box) return;
  const keepSel = pal && pal.kind === want.kind && pal.q === want.q ? pal.sel : 0;
  pal = { ...want, items: items.slice(0, PAL_MAX), total: items.length, sel: Math.min(keepSel, Math.max(0, items.length - 1)), pressing: false };
  renderPalette();
}

function hidePalette(dismissed = null) {
  const box = document.getElementById('d-pal');
  if (box) {
    box.hidden = true;
    box.innerHTML = '';
  }
  pal = dismissed ? { dismissed } : null;
}

function renderPalette() {
  const box = document.getElementById('d-pal');
  if (!box || !pal) return;
  let html = '';
  if (pal.kind === 'bang') html = `<div class="pal-note"><b>!</b> 셸 모드: 이 줄은 에이전트의 세션에서 셸 명령으로 실행되고, 그 출력이 대화에 들어갑니다.</div>`;
  else if (pal.error) html = `<div class="pal-note err">${esc(pal.error)}</div>`;
  else if (!pal.items.length) html = `<div class="pal-note">${pal.kind === 'cmd' ? '맞는 명령이 없습니다' : '맞는 파일이 없습니다'}</div>`;
  else
    html = pal.items
      .map((c, i) =>
        pal.kind === 'cmd'
          ? `<div class="pal-row" role="option" id="pal-${i}" data-i="${i}" aria-selected="${i === pal.sel}">
              <div class="pal-top"><b class="pal-name">/${esc(c.name)}</b>${c.hint ? `<span class="pal-hint">${esc(c.hint)}</span>` : ''}${
                c.menu ? '<span class="pal-chip menu">메뉴</span>' : ''
              }<span class="pal-chip ${esc(c.source)}">${esc(c.scope === 'project' ? '프로젝트 스킬' : SOURCE_LABEL[c.source] || c.source)}</span></div>
              ${c.desc ? `<div class="pal-desc">${esc(c.desc)}</div>` : ''}
            </div>`
          : `<div class="pal-row file" role="option" id="pal-${i}" data-i="${i}" aria-selected="${i === pal.sel}">
              <div class="pal-top"><span class="pal-ic" aria-hidden="true">${c.dir ? ICON.folder : ICON.file}</span><b class="pal-name">${esc(c.path)}</b></div>
            </div>`
      )
      .join('') + (pal.total > pal.items.length ? `<div class="pal-note">${pal.total - pal.items.length}개 더 — 더 적어서 좁히세요</div>` : '');
  box.innerHTML = html;
  box.hidden = false;
  box.dataset.kind = pal.kind;
  const sel = document.getElementById(`pal-${pal.sel}`);
  document.getElementById('d-input').setAttribute('aria-activedescendant', sel ? sel.id : '');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

function choosePalette(i) {
  const input = document.getElementById('d-input');
  if (!pal || !input || !pal.items[i]) return;
  const c = pal.items[i];
  const value = input.value;
  let text;
  let caret;
  if (pal.kind === 'cmd') {
    text = `/${c.name} ${value.slice(pal.end).replace(/^\s+/, '')}`;
    caret = c.name.length + 2;
    if (c.menu) toast(`/${c.name} 은 터미널에서 메뉴를 엽니다. 보낸 뒤 「터미널 화면 보기」나 선택 버튼으로 고르세요.`);
  } else {
    const ins = `@${c.path}${c.dir ? '' : ' '}`;
    text = value.slice(0, pal.start) + ins + value.slice(pal.end);
    caret = pal.start + ins.length;
  }
  input.value = text;
  input.focus();
  placeCaret(input, caret);
  updateComposer();
  pal = null;
  // A folder keeps listing what is inside it.
  updatePalette();
}

// ↑↓ move, Enter/Tab insert, Esc closes until the text changes. True when the key was used.
function paletteKey(e) {
  if (!pal || !pal.kind || e.isComposing || e.keyCode === 229) return false;
  if (e.key === 'Escape') {
    e.preventDefault();
    hidePalette(document.getElementById('d-input').value);
    return true;
  }
  if (!pal.items || !pal.items.length) return false;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = pal.items.length;
    pal.sel = (pal.sel + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
    renderPalette();
    return true;
  }
  if ((e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) || (e.key === 'Tab' && !e.shiftKey)) {
    e.preventDefault();
    choosePalette(pal.sel);
    return true;
  }
  return false;
}

function bindPalette(input) {
  const box = document.getElementById('d-pal');
  // Keep the caret in the field: a mouse press on a row would otherwise blur it.
  box.addEventListener('mousedown', (e) => e.preventDefault());
  box.addEventListener('pointerdown', () => pal && (pal.pressing = true));
  const release = () => setTimeout(() => pal && (pal.pressing = false), 400);
  box.addEventListener('pointerup', release);
  box.addEventListener('pointercancel', release);
  box.addEventListener('click', (e) => {
    const row = e.target.closest('.pal-row');
    if (row) choosePalette(Number(row.dataset.i));
    else input.focus();
  });
}

// ------------------------------------------------------------ photo attach

const MAX_FILES = 6;
const MAX_SIDE = 2000; // px, long side
const KEEP_BYTES = 8 * 1024 * 1024; // a PNG/WebP this small and within MAX_SIDE is sent as it is
// An upload path on a line of its own, as promptText writes it (either host's separators).
const UPLOAD_LINE = /^(?:.*[\\/])?(?:herdr-hub|paddock)-uploads[\\/](\d{8}-\d{6}-[0-9a-f]{8}\.(?:jpg|png|webp))$/;
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
  el.innerHTML = `<img src="${esc(src)}" alt="첨부 사진"><button type="button" class="icon-btn x" aria-label="닫기">${ICON.x}</button>`;
  const layer = openLayer(el, { focus: '.x' });
  el.onclick = () => closeLayer(layer);
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
  title.innerHTML = `${esc(a.name || a.title)}<span class="sub">${multi() ? `${esc(hostLabel(a.host))} · ` : ''}${esc(a.agent)} · ${esc(wsAndDir(a.workspaceLabel, a.cwd))}</span>`;
  const badge = document.getElementById('d-badge');
  const bh = `${liveDot()}${a.status === 'working' ? '' : timeTag(a)}<span class="badge ${esc(a.status)}">${esc(STATUS_LABEL[a.status] || a.status)}</span>`;
  if (badge._html !== bh) {
    badge._html = bh;
    badge.innerHTML = bh;
    fillTimes(badge);
  }
  if (a.status !== 'working') detail.activity = null;
  renderMode();
  if (detail.answerMode && a.status !== 'blocked') {
    detail.answerMode = false;
    setPlaceholder();
  }
  if (detail.wantSheet) {
    detail.wantSheet = false;
    openScreenSheet();
  }
  renderBlocked();
  renderActivity();
  updateComposer();
}

// Keys an agent takes from here: the blocked box's 직접 입력, the ⋯ 키 보내기 menu and the
// terminal sheet's key row (which adds Ctrl+C).
const AGENT_KEYS = [['esc', 'Esc'], ['shift+tab', '⇧Tab'], ['enter', 'Enter'], ['up', '↑'], ['down', '↓'], ['1', '1'], ['2', '2'], ['3', '3']];
const SHEET_KEYS = [...AGENT_KEYS, ['ctrl+c', 'Ctrl+C']];
// An option that asks for your own words (AskUserQuestion's "Type something.").
const TYPE_OWN = /^(type something|type your own|other\b|something else|직접 입력|기타)/i;
const keyRow = (keys, cls = '') => `<div class="keys ${cls}">${keys.map(([k, label]) => `<button type="button" class="key" data-key="${k}" aria-label="${esc(label)} 키 보내기">${esc(label)}</button>`).join('')}</div>`;
function bindKeyRow(row) {
  if (row) row.querySelectorAll('.key').forEach((b) => (b.onclick = () => sendKeys([b.dataset.key])));
}
// After a choice is sent, the buttons wait this long (or for the next status) so a double tap
// can't answer the prompt that comes next.
const CHOICE_LOCK_MS = 4000;
const choiceLocked = (a) => detail.lock && Date.now() < detail.lock.until && a && a.stateSeq === detail.lock.seq;

// The emphasised answer: the first plain "Yes" only. Everything else has the same weight;
// refusals are tinted as a warning.
const primaryChoice = (items) => items.find((x) => !x.negative && /^yes\b/i.test(x.label)) || null;

// One choice button: name (bold) over its description (muted), when the menu has one.
function choiceButton(choices, x, { locked, sentN, primary, compact = false }) {
  const ok = choiceKeys(choices, x.n);
  const sent = locked && sentN === x.n;
  const kind = x.negative ? ' negative' : x === primary ? ' primary' : '';
  return `<button type="button" class="choice${kind}${sent ? ' sent' : ''}${compact ? ' compact' : ''}" data-n="${x.n}"${locked || !ok ? ' disabled' : ''}>
    ${choices.numbered ? `<span class="num">${x.n}</span>` : ''}<span class="label"><span class="name">${esc(x.label)}</span>${x.desc && !compact ? `<span class="desc">${esc(x.desc)}</span>` : ''}</span>${sent ? '<span class="state">보냄</span>' : ''}</button>`;
}

// Re-drawn only when what it shows changed: a poll must not swallow a tap or a selection.
function renderBlocked() {
  const box = document.getElementById('d-blocked');
  const a = currentAgent();
  if (!box) return;
  if (!a || a.status !== 'blocked') {
    if (box._html !== '') box.innerHTML = box._html = '';
    return;
  }
  const text = detail.blockedText;
  const choices = text ? parseChoices(text) : null;
  const screen = text ? `<pre>${esc(text)}</pre>` : '';
  const keys = keyRow(AGENT_KEYS);
  let html;
  if (!choices) {
    html = `<div class="blocked-box">
        <strong class="b-title">답 필요</strong>
        ${text == null ? '<p class="question muted">화면을 불러오는 중…</p>' : screen}
        ${keys}
      </div>`;
  } else {
    const locked = choiceLocked(a);
    const primary = primaryChoice(choices.items);
    html = `<div class="blocked-box">
        <strong class="b-title">${esc(choices.question || '답 필요')}</strong>
        ${choices.context.length ? `<pre class="context">${esc(choices.context.join('\n'))}</pre>` : ''}
        <div class="choices">${choices.items.map((x) => choiceButton(choices, x, { locked, sentN: locked && detail.lock.n, primary })).join('')}</div>
        <div class="toggles">
          <button type="button" class="toggle" data-toggle="showScreen" aria-expanded="${Boolean(detail.showScreen)}">화면 보기</button>
          <button type="button" class="toggle" data-toggle="showKeys" aria-expanded="${Boolean(detail.showKeys)}">직접 입력</button>
        </div>
        ${detail.showScreen ? screen : ''}
        ${detail.showKeys ? keys : ''}
      </div>`;
  }
  if (box._html === html) return;
  box._html = html;
  box.innerHTML = html;
  if (choices) {
    box.querySelectorAll('.choice').forEach((b) => {
      b.onclick = async () => {
        const cur = currentAgent();
        const n = Number(b.dataset.n);
        const k = choiceKeys(choices, n);
        if (!k || choiceLocked(cur)) return;
        const lock = (detail.lock = { until: Date.now() + CHOICE_LOCK_MS, seq: cur && cur.stateSeq, n });
        setTimeout(renderBlocked, CHOICE_LOCK_MS + 50);
        renderBlocked();
        const item = choices.items.find((x) => x.n === n);
        if (!(await sendKeys(k))) {
          // Not sent: the buttons come back at once.
          if (detail.lock === lock) detail.lock = null;
          return renderBlocked();
        }
        closeNotes(curHost(), detail.pane);
        if (item && TYPE_OWN.test(item.label)) startAnswer();
      };
    });
    box.querySelectorAll('.toggle').forEach((b) => {
      b.onclick = () => {
        detail[b.dataset.toggle] = !detail[b.dataset.toggle];
        renderBlocked();
      };
    });
  }
  bindKeyRow(box.querySelector('.keys'));
  // The choices sit at the bottom of the prompt; show them, not the preamble.
  const pre = box.querySelector('pre:not(.context)');
  if (pre) pre.scrollTop = pre.scrollHeight;
}

// After a "Type something" choice the question waits for words: the composer sends them there.
function startAnswer() {
  detail.answerMode = true;
  detail.answerSeq = (currentAgent() || {}).stateSeq;
  setPlaceholder();
  updateComposer();
  const input = document.getElementById('d-input');
  if (input) input.focus();
  toast('답을 아래 입력 칸에 적어 보내세요');
}

// True when the keys went through. A failure says so in Korean and changes nothing else.
async function sendKeys(keys, host = curHost(), pane = detail.pane) {
  try {
    await api(hp(`/agents/${encodeURIComponent(pane)}/keys`, host), { method: 'POST', body: JSON.stringify({ keys }) });
    if (view.name === 'agent' && detail.pane === pane) setTimeout(loadDetail, 500);
    return true;
  } catch (err) {
    toastErr(`키를 보내지 못했습니다: ${errText(err)}`);
    return false;
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
    const d = detail;
    let activityText = null;
    let footer = false; // the visible screen was read this round (for the mode chip)
    if (!screenBody(a)) {
      // Only what changed since the copy here (?rev, ?since): an unchanged chat costs nothing.
      const t = d.transcript;
      const last = t && t.messages && t.messages[t.messages.length - 1];
      const q = `${t && t.rev ? `&rev=${encodeURIComponent(t.rev)}` : ''}${last && last.id ? `&since=${encodeURIComponent(last.id)}` : ''}`;
      const r = await api(hp(`/agents/${pane}/transcript?limit=150${q}`, host));
      if (d === detail) d.transcript = mergeTranscript(d.transcript, r);
    }
    if (screenBody(a) || detail.sheet) {
      // A working agent can't give its scrollback; Claude draws on the alternate screen anyway,
      // so what is visible is the whole picture. The server falls back to it too.
      const source = working || a.status === 'blocked' ? 'visible' : 'recent';
      const s = (detail.screen = await api(hp(`/agents/${pane}/screen?source=${source}&lines=200${colorQuery()}`, host)));
      if (working && s.source === 'visible') activityText = s.format === 'ansi' && window.Ansi ? window.Ansi.strip(s.text) : s.text;
      if (s.source === 'visible' && a.status !== 'blocked') {
        noteMode(s.text);
        footer = true;
      }
    }
    // The activity line: what the visible screen says the agent is doing, only while working.
    if (working && activityText == null) activityText = (await api(hp(`/agents/${pane}/screen?source=visible&lines=60`, host))).text;
    if (working && (currentAgent() || {}).status === 'working') setActivity(activityText);
    if (activityText != null) {
      noteMode(activityText);
      footer = true;
    }
    // Idle Claude: a short read of the bottom lines for the mode chip.
    if (!footer && !working && a.status !== 'blocked' && a.agent === 'claude' && d === detail) noteMode((await api(hp(`/agents/${pane}/screen?source=visible&lines=8`, host))).text);
    renderMode();
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
    body._html = null;
    closeScreenSheet();
    if (!scr || scr.body !== body)
      mountScreen(body, 'agent', document.getElementById('s-tools'), '이 에이전트는 대화 기록이 없어 터미널 화면을 보여 줍니다. 지금 보이는 화면만 있습니다.');
    renderScreen();
    return;
  }
  if (scr && scr.body === body) {
    unmountScreen();
    body._html = null;
    reset = true;
  }
  const nearBottom = reset || body.scrollHeight - body.scrollTop - body.clientHeight < 80;
  const t = detail.transcript;
  const note = !t ? '불러오는 중…' : !t.supported ? (currentAgent()?.agent ? '아직 대화 기록이 없습니다.' : '에이전트를 시작하는 중…') : !t.found ? '아직 대화 기록이 없습니다.' : '';
  if (note) {
    const html = `<p class="note">${note}</p>`;
    if (body._html !== html) body.innerHTML = body._html = html;
  } else {
    if (body._html !== 'chat' || !body.querySelector('.msgs')) {
      body.innerHTML = '<p class="note trunc" hidden>최근 대화만 표시합니다</p><div class="msgs"></div>';
      body._html = 'chat';
    }
    body.querySelector('.trunc').hidden = !t.truncated;
    // One element per message, replaced only when its HTML changed: a poll that brings
    // nothing new touches nothing, so a text selection or a press survives it.
    patchList(body.querySelector('.msgs'), t.messages.map((m, i) => [m.id || `i${i}`, message(m)]));
  }
  if (nearBottom) body.scrollTop = body.scrollHeight;
}

// The server's answer onto the copy here: unchanged, the tail from `since` on, or all of it.
function mergeTranscript(old, r) {
  if (!r || !r.supported || !r.found || !old || !old.messages || r.reset || (!r.unchanged && !r.since)) return r;
  if (r.unchanged) return old;
  const i = old.messages.findIndex((m) => m.id === r.since);
  if (i < 0) return r;
  return { ...r, truncated: old.truncated || r.truncated, messages: old.messages.slice(0, i).concat(r.messages).slice(-300) };
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
  }${box.disabled ? '' : '<span class="go" aria-hidden="true">터미널 ›</span>'}`;
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

// Elapsed time runs on between reads: since the hub saw the status turn to working, else from
// the spinner's own count. The header's "완료 · 3분 전" ticks here too.
function tickActivity() {
  const badge = document.getElementById('d-badge');
  if (badge) fillTimes(badge);
  const el = document.querySelector('#d-activity .el');
  if (!el) return;
  const act = detail.activity;
  const a = currentAgent();
  const since = a && a.workingSince ? a.workingSince : act && act.seconds != null ? act.at - act.seconds * 1000 : null;
  el.textContent = since ? durKo((Date.now() - since) / 1000) : '';
}

// ---- permission mode chip (Claude): read off the footer; a tap sends ⇧Tab, the next mode
const MODE_LABEL = { auto: '자동', manual: '수동 승인', accept: '편집 허용', plan: '계획', bypass: '권한 우회' };
function noteMode(text) {
  if (text == null || !window.parseMode) return;
  const m = parseMode(window.Ansi ? window.Ansi.strip(String(text)) : String(text));
  if (m) detail.mode = m;
}
function renderMode() {
  const chip = document.getElementById('d-mode');
  const a = currentAgent();
  if (!chip) return;
  const m = a && a.agent === 'claude' ? detail.mode : null;
  chip.hidden = !m;
  if (!m) return;
  chip.textContent = MODE_LABEL[m] || m;
  chip.dataset.mode = m;
  // ⇧Tab in the middle of a question would act on the question.
  chip.disabled = a.status === 'blocked' || Boolean(detail.modeBusy);
  chip.setAttribute('aria-label', `권한 모드: ${MODE_LABEL[m] || m}. 누르면 다음 모드로 바꿉니다(⇧Tab)`);
}
async function cycleMode() {
  const a = currentAgent();
  if (!a || a.status === 'blocked' || detail.modeBusy) return;
  const pane = a.pane;
  const host = curHost();
  detail.modeBusy = true;
  renderMode();
  const ok = await sendKeys(['shift+tab'], host, pane);
  // Read the footer again once Claude has redrawn it.
  if (ok)
    await new Promise((r) => setTimeout(r, 450)).then(() =>
      api(hp(`/agents/${encodeURIComponent(pane)}/screen?source=visible&lines=8`, host))
        .then((s) => detail.pane === pane && noteMode(s.text))
        .catch(() => {})
    );
  detail.modeBusy = false;
  renderMode();
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
        <button type="button" class="icon-btn" data-close aria-label="닫기">${ICON.x}</button>
      </div>
      <div class="screen-tools"></div>
      <div class="scroll" id="ss-body"></div>
      ${keyRow(SHEET_KEYS, 'sheet-keys')}
    </div>`;
  el.onclick = (e) => {
    if (e.target === el) closeScreenSheet();
  };
  el.querySelector('[data-close]').onclick = closeScreenSheet;
  detail.sheet = el;
  // Closed by Escape or the backdrop too: whichever way, the screen box goes with it.
  detail.sheetLayer = openLayer(el, { focus: '[data-close]', onClose: () => closeScreenSheet() });
  mountScreen(el.querySelector('#ss-body'), 'agent', el.querySelector('.screen-tools'), '터미널에 지금 보이는 화면의 맨 위입니다. 이전 내용은 <button type="button" class="linkish">대화</button>에서 볼 수 있습니다.');
  el.querySelector('.screen-top .linkish').onclick = closeScreenSheet;
  bindKeyRow(el.querySelector('.sheet-keys'));
  loadDetail();
}

function closeScreenSheet() {
  const el = detail.sheet;
  if (!el) return;
  if (scr && el.contains(scr.body)) unmountScreen();
  detail.sheet = null;
  const layer = detail.sheetLayer;
  detail.sheetLayer = null;
  if (layer) closeLayer(layer);
  else el.remove();
}

// Output of a "!" command (bash mode), under its line: monospace, folded after SHELL_FOLD lines.
const SHELL_FOLD = 12;
function shellOut(m) {
  // A failed command's output is all recorded as stderr: tinted only next to real stdout.
  const tint = Boolean(m.text);
  const lines = [...(m.text ? m.text.split('\n') : []), ...(m.err ? m.err.split('\n').map((l) => (tint ? { err: l } : l)) : [])];
  if (!lines.length) return `<div class="msg shell-out empty"><span class="muted">(출력 없음)</span></div>`;
  const open = Boolean(detail.openShell && detail.openShell.has(m.id));
  const shown = open || lines.length <= SHELL_FOLD + 2 ? lines : lines.slice(0, SHELL_FOLD);
  const body = shown.map((l) => (typeof l === 'string' ? esc(l) : `<span class="err">${esc(l.err)}</span>`)).join('\n');
  const fold = lines.length > SHELL_FOLD + 2
    ? `<button type="button" class="shell-more" data-shell="${esc(m.id)}" aria-expanded="${open}">${open ? '접기' : `${lines.length - SHELL_FOLD}줄 더 보기`}</button>`
    : '';
  return `<div class="msg shell-out"><pre>${body}</pre>${fold}</div>`;
}

function message(m) {
  if (m.role === 'note') return `<p class="note">${esc(m.text)}</p>`;
  if (m.role === 'shell') return shellOut(m);
  if (m.role === 'user' && m.bash) return `<div class="msg user bash"><span>${esc(m.text)}</span></div>`;
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
  const tools = m.tools && m.tools.length ? `<div class="tools">${m.tools.map((t, i) => toolLine(t, `${m.id}:${i}`)).join('')}</div>` : '';
  return `<div class="msg assistant">${m.text ? Markdown.md(m.text) : ''}${tools}</div>`;
}

// A tool line; AskUserQuestion shows what was chosen ("Pick a color? → Red"). One with a
// result in the transcript opens to show it (cut at 2000 characters by the server).
function toolLine(t, key) {
  const asked = t.answers && t.answers.length ? t.answers.map((x) => `${esc(x.q)} → <span class="ans">${esc(x.a)}</span>`).join(' · ') : '';
  const head = `<b>${esc(t.name)}</b> ${asked || esc(t.summary)}`;
  const cls = `tool${asked ? ' asked' : ''}${t.error ? ' failed' : ''}`;
  if (!t.result) return `<div class="${cls}">${head}</div>`;
  const open = Boolean(detail.openTools && detail.openTools.has(key));
  return `<div class="tool-wrap"><button type="button" class="${cls}" data-tool="${esc(key)}" aria-expanded="${open}"><span class="tool-head">${head}</span><span class="chev" aria-hidden="true">${open ? '▾' : '▸'}</span></button>${
    open ? `<pre class="tool-out">${esc(t.result)}${t.cut ? '\n… (뒤는 잘림)' : ''}</pre>` : ''
  }</div>`;
}

async function agentMenu() {
  const a = currentAgent();
  if (!a) return;
  const last = lastReply();
  const k = await menu(a.name || a.title, [
    a.status === 'working' ? ['stop', '멈추기'] : null,
    screenBody(a) ? null : ['screen', '터미널 화면 보기'],
    ['keys', '키 보내기', false, 'Esc · ⇧Tab · Enter · ↑ ↓ · 1–3'],
    last ? ['copy', '마지막 답 복사'] : null,
    ['rename', '이름 바꾸기'],
    ['ws', '워크스페이스 보기'],
    ['close', '패널 닫기(에이전트 종료)', true],
  ]);
  if (k === 'stop') confirmStop();
  if (k === 'screen') openScreenSheet();
  if (k === 'keys') {
    const key = await menu('키 보내기', AGENT_KEYS.map(([key, label]) => [key, label]), { sub: a.name || a.title });
    if (key) {
      const host = a.host;
      const pane = a.pane;
      if (await sendKeys([key], host, pane)) toast(`${AGENT_KEYS.find((x) => x[0] === key)[1]} 키를 보냈습니다`);
    }
  }
  if (k === 'copy') copyText(lastReply(), '마지막 답을 복사했습니다');
  if (k === 'ws') location.hash = link(a.host, `/ws/${encodeURIComponent(a.workspace)}`);
  if (k === 'rename') renamePane(a, true);
  if (k === 'close') closePane(a.host, a.pane, a.name || a.title, true);
}

// The agent's last reply in the transcript, as it wrote it (markdown).
function lastReply() {
  const msgs = (detail.transcript && detail.transcript.messages) || [];
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'assistant' && msgs[i].text) return msgs[i].text;
  return '';
}

async function copyText(text, okText) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Older Safari, or no permission: a hidden field and the copy command.
    const t = document.createElement('textarea');
    t.value = text;
    t.setAttribute('readonly', '');
    t.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand && document.execCommand('copy');
    t.remove();
    if (!ok) return toastErr('복사하지 못했습니다');
  }
  toast(okText);
}

// Rename and close, shared by the agent, shell and workspace menus and the list's row actions.
// Each takes the host explicitly: from the list it is the row's, not the route's.
// herdr's rule for agent names, checked while typing (the server checks again).
const AGENT_NAME = /^[a-z][a-z0-9_-]{0,31}$/;
const agentNameHint = (v) => {
  const t = v.trim();
  if (!t || AGENT_NAME.test(t)) return '';
  if (/[A-Z]/.test(t)) return '대문자는 쓸 수 없습니다. 소문자로 적어 주세요.';
  if (!/^[a-z]/.test(t)) return '영문 소문자로 시작해야 합니다.';
  if (t.length > 32) return `32자까지입니다(지금 ${t.length}자).`;
  return '영문 소문자·숫자·-·_ 만 쓸 수 있습니다.';
};
const labelHint = (v) => (v.trim().length > 60 ? `60자까지입니다(지금 ${v.trim().length}자).` : '');

// A mistake keeps the sheet (and what was typed) with the error in it, like 새 폴더.
async function renamePane(x, isAgent) {
  const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
  const r = isAgent
    ? await askLoop(
        { title: '에이전트 이름', text: '영문 소문자로 시작하고 소문자·숫자·-·_ 만, 32자까지. 비우면 이름을 지웁니다.', input: { value: x.name || '', placeholder: 'reviewer' }, ok: '바꾸기', validate: agentNameHint },
        (name) => post(hp(`/agents/${encodeURIComponent(x.pane)}/rename`, x.host), { name })
      )
    : await askLoop({ title: '셸 이름', text: '비우면 이름을 지웁니다.', input: { value: x.label || '', placeholder: '빌드' }, ok: '바꾸기', validate: labelHint }, (label) =>
        post(hp(`/panes/${encodeURIComponent(x.pane)}/rename`, x.host), { label })
      );
  if (r) toast('이름을 바꿨습니다');
}

async function closePane(host, pane, label, isAgent) {
  const ok = await sheet({
    title: isAgent ? '에이전트 닫기' : '셸 닫기',
    text: `‘${label}’ 패널을 닫을까요?${isAgent ? ' 에이전트도 함께 끝납니다.' : ''} 되돌릴 수 없습니다.`,
    ok: '닫기',
    danger: true,
  });
  if (ok && (await act(hp(`/panes/${encodeURIComponent(pane)}/close`, host), {}, '패널을 닫았습니다')) && leaveFor(host, pane)) goBack(homeHash());
}

// After closing a pane or workspace: back to the list when that was open. On the phone the list
// is the only other place a close comes from; split, the list's rows can close something else.
function leaveFor(host, pane, wsId) {
  if (!split) return view.name !== 'list';
  if (!isDetail() || curHost() !== (host || localId())) return false;
  if (wsId == null) return ['agent', 'term'].includes(view.name) && detail.pane === pane;
  if (view.name === 'ws') return view.id === wsId;
  const open = [...state.agents, ...(state.terminals || [])].find((x) => same(x, curHost(), detail.pane));
  return Boolean(open && open.workspace === wsId);
}

async function renameWorkspace(w) {
  const r = await askLoop({ title: '워크스페이스 이름', input: { value: w.label }, ok: '바꾸기', validate: (v) => (!v.trim() ? '이름을 적어 주세요.' : labelHint(v)) }, (label) =>
    api(hp(`/workspaces/${encodeURIComponent(w.workspace_id)}/rename`, w.host), { method: 'POST', body: JSON.stringify({ label }) })
  );
  if (r) toast('이름을 바꿨습니다');
}

async function closeWorkspace(w) {
  const host = w.host || localId();
  const agents = state.agents.filter((a) => same(a, host, w.workspace_id, 'workspace')).length;
  const panes = w.pane_count || agents + (state.terminals || []).filter((t) => same(t, host, w.workspace_id, 'workspace')).length;
  const ok = await sheet({
    title: '워크스페이스 닫기',
    text: `‘${w.label}’ 워크스페이스를 닫을까요? 안의 패널 ${panes}개${agents ? `와 에이전트 ${agents}개` : ''}가 모두 끝납니다. 되돌릴 수 없습니다.`,
    ok: '닫기',
    danger: true,
  });
  if (ok && (await act(hp(`/workspaces/${encodeURIComponent(w.workspace_id)}/close`, w.host), {}, '워크스페이스를 닫았습니다')) && leaveFor(host, null, w.workspace_id)) goBack(homeHash());
}

async function newTab(w) {
  const host = w.host || localId();
  const r = await act(hp(`/workspaces/${encodeURIComponent(w.workspace_id)}/tabs`, host), {}, '새 탭을 열었습니다');
  if (r && r.pane) location.hash = link(host, `/term/${encodeURIComponent(r.pane)}`);
}

// POST a mutation; toasts on failure. Returns the response body or null.
async function act(path, body, okText) {
  try {
    const r = await api(path, { method: 'POST', body: JSON.stringify(body) });
    if (okText) toast(okText);
    return r;
  } catch (err) {
    toastErr(`하지 못했습니다: ${errText(err)}`);
    return null;
  }
}

// ------------------------------------------------------------ terminal view

// Shell titles are often the executable's full path; the program name says enough.
const termTitle = (t) => t.label || (/[\\/]/.test(t.title) ? basename(t.title) : t.title);
const currentTerminal = () => (state.terminals || []).find((t) => same(t, curHost(), detail.pane));

function renderTerminal() {
  detailRoot().innerHTML = `
    <div class="detail">
      <header class="bar">
        ${backLink(homeHash())}
        <h1 id="t-title"></h1>
        <span id="t-live"></span>
        <button class="icon-btn" id="t-more" aria-label="더 보기">${ICON.more}</button>
      </header>
      <div class="screen-tools" id="s-tools" hidden></div>
      <div class="scroll" id="t-body"></div>
      <div class="term-bar">
        <div class="keys term-keys" id="t-keys"></div>
        <div class="term-side">
          <button type="button" class="key" id="t-kbd" aria-pressed="false" aria-label="키보드 올리기">${ICON.keyboard}</button>
        </div>
      </div>
      <form class="composer" id="t-form">
        <input class="cmd" id="t-input" placeholder="명령 (Enter 로 실행)" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send">
        <button type="submit" class="send" id="t-send" aria-label="실행">${ICON.send}</button>
      </form>
    </div>`;
  const input = document.getElementById('t-input');
  const keysBox = document.getElementById('t-keys');
  const drawKeys = () => {
    const list = detail.raw ? RAW_TERM_KEYS : TERM_KEYS;
    keysBox.innerHTML = list.map(([k, label]) => `<button type="button" class="key" data-key="${esc(k)}" aria-label="${esc(label)} 키 보내기">${esc(label)}</button>`).join('');
    keysBox.scrollLeft = 0;
  };
  drawKeys();
  // Raw mode: pressing a key button leaves the caret (and the iPhone keyboard) in the field,
  // so the next typed key still goes to the program, not to the button. On a touch screen
  // that means acting on touchend (as keepFocusTap does); a swipe along the row only scrolls it.
  keysBox.addEventListener('mousedown', (e) => detail.raw && e.preventDefault());
  let keyTouch = null;
  keysBox.addEventListener('touchstart', (e) => (keyTouch = e.touches.length === 1 ? e.touches[0] : null), { passive: true });
  keysBox.addEventListener('touchend', (e) => {
    const from = keyTouch;
    keyTouch = null;
    const t = e.changedTouches[0];
    const b = e.target.closest('.key');
    if (!detail.raw || !b || !from || !t || Math.hypot(t.clientX - from.clientX, t.clientY - from.clientY) > 12) return;
    e.preventDefault();
    pressKey(b);
  });
  // Command mode: a key goes after whatever is in the input line, typed without Enter (Tab
  // completes it). Raw mode: the key alone, at once.
  keysBox.onclick = (e) => {
    const b = e.target.closest('.key');
    if (b) pressKey(b);
  };
  const pressKey = async (b) => {
    const k = b.dataset.key;
    if (detail.raw) return rawSend(k.endsWith('text') ? { text: k.slice(0, -4) } : { key: k });
    if (await act(hp(`/panes/${encodeURIComponent(detail.pane)}/keys`), { keys: [k], text: input.value })) {
      input.value = '';
      setTimeout(loadTerminal, 300);
    }
  };
  // 설정 → 셸 입력 picks the mode. 키 직접 입력 has no visible command line, like a terminal
  // app: a tap on the screen (or ⌨) brings up the keyboard and the hidden field passes each key
  // on. 한 줄 입력 shows the line, run with Enter.
  const setRaw = (on) => {
    detail.raw = on;
    input.value = '';
    input.placeholder = on ? '누르는 키가 바로 갑니다' : '명령 (Enter 로 실행)';
    input.setAttribute('enterkeyhint', on ? 'enter' : 'send');
    document.getElementById('t-send').hidden = on;
    detailRoot().querySelector('.detail').classList.toggle('raw', on);
    drawKeys();
  };
  setRaw(getShellInput() === 'raw');
  const kbd = document.getElementById('t-kbd');
  const toggleKbd = () => (document.activeElement === input ? input.blur() : input.focus());
  keepFocusTap(kbd, toggleKbd);
  kbd.onclick = toggleKbd;
  const showKbd = () => {
    const up = document.activeElement === input;
    kbd.innerHTML = up ? ICON.keyboardOff : ICON.keyboard;
    kbd.setAttribute('aria-pressed', String(up));
    kbd.setAttribute('aria-label', up ? '키보드 내리기' : '키보드 올리기');
  };
  input.addEventListener('focus', showKbd);
  input.addEventListener('blur', showKbd);
  // A tap on the screen brings up the keyboard. A long press (selecting text) or a scroll is no
  // click, and a click that ends a selection or lands on a button is left alone.
  document.getElementById('t-body').addEventListener('click', (e) => {
    if (!detail.raw || e.target.closest('button, a')) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    input.focus();
  });
  keepFocusTap(document.getElementById('t-send'), () => document.getElementById('t-form').requestSubmit());
  document.getElementById('t-form').onsubmit = async (e) => {
    e.preventDefault();
    if (detail.raw) return;
    if (await act(hp(`/panes/${encodeURIComponent(detail.pane)}/input`), { text: input.value })) {
      input.value = '';
      setTimeout(loadTerminal, 400);
    }
  };
  // Raw mode: typed characters go as text, editing keys as keys; the field stays empty.
  // A Korean (IME) syllable goes once it is composed.
  input.addEventListener('beforeinput', (e) => {
    if (!detail.raw || e.isComposing || e.inputType === 'insertCompositionText') return;
    e.preventDefault();
    const t = e.inputType;
    if (t === 'insertText' || t === 'insertReplacementText' || t === 'insertFromPaste') {
      const text = (e.data != null ? e.data : e.dataTransfer ? e.dataTransfer.getData('text/plain') : '') || '';
      const clean = text.replace(/[\x00-\x1f\x7f]+/g, ' ');
      if (clean) rawSend({ text: clean });
    } else if (t === 'insertLineBreak' || t === 'insertParagraph') rawSend({ key: 'enter' });
    else if (t.startsWith('deleteContentBackward') || t === 'deleteWordBackward') rawSend({ key: 'backspace' });
    else if (t === 'deleteContentForward') rawSend({ key: 'delete' });
  });
  input.addEventListener('compositionend', (e) => {
    if (!detail.raw) return;
    if (e.data) rawSend({ text: e.data });
    setTimeout(() => (input.value = ''), 0);
  });
  input.addEventListener('keydown', (e) => {
    if (!detail.raw || e.isComposing || e.keyCode === 229) return;
    const k = Keys.rawKeyName(e);
    if (!k) return;
    e.preventDefault();
    rawSend({ key: k });
  });
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
      : '셸 없음<span class="sub">이 셸이 닫혔습니다</span>';
  const dot = document.getElementById('t-live');
  if (dot) dot.innerHTML = liveDot();
}

// Raw-mode keys in order: text runs merge, one request at a time, the screen read soon after.
const rawQ = [];
let rawBusy = false;
let rawLoadTimer = null;
function rawSend(item) {
  const last = rawQ[rawQ.length - 1];
  if (item.text != null && last && last.text != null && !last.keys.length && last.text.length < 2000) last.text += item.text;
  else if (item.key && last && !last.text && last.keys.length < 8) last.keys.push(item.key);
  else rawQ.push({ text: item.text || '', keys: item.key ? [item.key] : [] });
  pumpRaw();
}
async function pumpRaw() {
  if (rawBusy) return;
  rawBusy = true;
  const host = curHost();
  const pane = detail.pane;
  try {
    while (rawQ.length) {
      const it = rawQ.shift();
      // The reply carries the screen (the echo); a read follows a moment later for slower output.
      const n = ++termReads;
      const last = !rawQ.length;
      const r = await api(hp(`/panes/${encodeURIComponent(pane)}/keys`, host), { method: 'POST', body: JSON.stringify(last ? { ...it, echo: { format: getColor() ? 'ansi' : 'text' } } : it) });
      detail.keyAt = Date.now();
      if (r && r.screen && detail.pane === pane) drawTerminal(r.screen, n);
      clearTimeout(rawLoadTimer);
      rawLoadTimer = setTimeout(loadTerminal, RAW_FOLLOW_MS);
    }
  } catch (err) {
    rawQ.length = 0;
    toastErr(`키를 보내지 못했습니다: ${errText(err)}`);
  } finally {
    rawBusy = false;
  }
}

// Unwrapped lines, so the phone wraps each real line once instead of re-wrapping lines already
// cut at the pane's width. (The server falls back to recent on a herdr without it.)
// How soon the screen is read again: a little after a key's echo came back (output that takes
// longer), every 300 ms while keys are being typed, then every second in 키 직접 입력 and every
// 2.5 s in 한 줄 입력.
const RAW_FOLLOW_MS = 250;
const TERM_TICK_MS = 300;
const TYPING_MS = 3000;
function pollTerminal() {
  const since = Date.now() - (detail.loadAt || 0);
  const typing = detail.raw && Date.now() - (detail.keyAt || 0) < TYPING_MS;
  if (typing || since >= (detail.raw ? 1000 : 2500)) loadTerminal();
}

let termReads = 0; // reads overlap when keys come fast; only the newest may draw
async function loadTerminal() {
  if (!currentTerminal() || document.visibilityState !== 'visible') return;
  const pane = detail.pane;
  const n = ++termReads;
  detail.loadAt = Date.now();
  let screen;
  try {
    screen = await api(hp(`/panes/${encodeURIComponent(pane)}/screen?source=recent_unwrapped&lines=200${colorQuery()}`));
  } catch (err) {
    if (n === termReads && scr && scr.kind === 'term' && !['pane_not_found', 'peer_offline'].includes(err.code)) screenError(`불러오지 못했습니다: ${errText(err)}`);
    return;
  }
  if (detail.pane === pane) drawTerminal(screen, n);
}
function drawTerminal(screen, n) {
  if (n < (detail.drawn || 0)) return; // an older read finished after a newer one
  detail.drawn = n;
  detail.screen = screen;
  if (!scr || scr.kind !== 'term') return;
  setScreenText(screen.text, screen.format);
}

async function terminalMenu() {
  const t = currentTerminal();
  if (!t) return;
  const k = await menu(termTitle(t), [
    ['agent', '여기서 에이전트 시작'],
    ['down', '아래로 나누기'],
    ['right', '오른쪽으로 나누기'],
    ['tab', '새 탭'],
    ['rename', '이름 바꾸기'],
    ['ws', '워크스페이스 보기'],
    ['close', '패널 닫기', true],
  ]);
  if (k === 'agent') location.hash = link(t.host, `/start/pane/${encodeURIComponent(t.pane)}`);
  if (k === 'ws') location.hash = link(t.host, `/ws/${encodeURIComponent(t.workspace)}`);
  if (k === 'down' || k === 'right') {
    const r = await act(hp(`/panes/${encodeURIComponent(t.pane)}/split`), { direction: k }, '새 셸을 열었습니다');
    if (r && r.pane) location.hash = link(t.host, `/term/${encodeURIComponent(r.pane)}`);
  }
  if (k === 'tab') {
    const w = wsFor(t.host || localId(), t.workspace);
    if (w) newTab(w);
  }
  if (k === 'rename') renamePane(t, false);
  if (k === 'close') closePane(t.host, t.pane, termTitle(t), false);
}

// ------------------------------------------------------------ screen box

// The pane text in the agent screen sheet (or body) and the terminal view. Polls arrive every few seconds;
// the box changes only when the text did, follows new output while you're at the bottom, and
// holds still while you've scrolled up to read, selected text, or have a finger on it.
// Wrapping is a per-view choice: off for agents (TUI layouts keep their shape and scroll
// sideways inside the box), on for terminals.
const WRAP_KEY = { agent: 'herdr-hub.wrap.agent', term: 'herdr-hub.wrap.term' };
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
const COLOR_KEY = 'herdr-hub.color';
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
  // 색상 and 줄바꿈 live in 설정; the tools row only says what went wrong, when something did.
  if (tools) tools.innerHTML = '<span class="s-status"></span>';
  screenStatus();
}

function unmountScreen() {
  if (!scr) return;
  const { body, tools } = scr;
  body.classList.remove('screen-mode');
  body.style.removeProperty('--term-bg');
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
  scr.tools.hidden = !scr.error; // a note alone is not worth a row
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
  return { fg: fg.length === 3 ? fg : undefined, bg: bg.length === 3 ? bg : undefined, palette, dark: bg.length === 3 ? 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2] < 128 : darkNow() };
}

function drawScreen(s, p) {
  if (p.view === 'ansi') s.pre.innerHTML = window.Ansi.toHtml(p.text, screenColors(s.pre));
  else s.pre.textContent = p.view === 'strip' ? window.Ansi.strip(p.text) : p.text;
  paneBackground(s, p.view === 'ansi');
}

// A full-screen program (helix, vim) paints its own background on most cells. That colour then
// fills the whole box, padding included, so no dark gutter or gaps show around its rows.
function paneBackground(s, ansi) {
  let best = '';
  if (ansi) {
    const counts = new Map();
    let most = 0;
    for (const sp of s.pre.querySelectorAll('span')) {
      const bg = sp.style.backgroundColor || (/(^|\s)a[bB]\d/.test(sp.className) ? getComputedStyle(sp).backgroundColor : '');
      if (!bg) continue;
      const n = (counts.get(bg) || 0) + sp.textContent.length;
      counts.set(bg, n);
      if (n > most) (most = n), (best = bg);
    }
    const cells = s.pre.textContent.replace(/\n/g, '').length;
    if (!cells || most / cells < 0.4) best = '';
  }
  if (best) s.body.style.setProperty('--term-bg', best);
  else s.body.style.removeProperty('--term-bg');
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
function redrawScreen() {
  if (scr && scr.raw && scr.pending == null) setScreenText(scr.raw.text, scr.raw.format, true);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  applyTheme(getTheme());
  redrawScreen();
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
