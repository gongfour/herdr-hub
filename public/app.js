'use strict';

const $app = document.getElementById('app');
const STATUS_LABEL = { blocked: '답 필요', done: '완료', working: '작업 중', idle: '대기', unknown: '알 수 없음' };
const ICON = {
  // Lucide (ISC, lucide.dev) throughout, so stroke, corners and proportions match.
  back: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></svg>', // chevron-left
  gear: '<svg viewBox="0 0 24 24"><path d="M10 5H3" /><path d="M12 19H3" /><path d="M14 3v4" /><path d="M16 17v4" /><path d="M21 12h-9" /><path d="M21 19h-5" /><path d="M21 5h-7" /><path d="M8 10v4" /><path d="M8 12H3" /></svg>', // sliders-horizontal
  send: '<svg viewBox="0 0 24 24"><path d="m5 12 7-7 7 7" /><path d="M12 19V5" /></svg>', // arrow-up
  stop: '<svg viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="3" rx="2" /></svg>', // square
  plus: '<svg viewBox="0 0 24 24"><path d="M5 12h14" /><path d="M12 5v14" /></svg>', // plus
  photo: '<svg viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /></svg>', // image
  camera: '<svg viewBox="0 0 24 24"><path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z" /><circle cx="12" cy="13" r="3" /></svg>', // camera
  agent: '<svg viewBox="0 0 24 24"><path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" /></svg>', // bot
  more: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" /></svg>', // ellipsis
  term: '<svg viewBox="0 0 24 24"><path d="M12 19h8" /><path d="m4 17 6-6-6-6" /></svg>', // terminal
  x: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>', // x
  folder: '<svg viewBox="0 0 24 24"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></svg>', // folder
  file: '<svg viewBox="0 0 24 24"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /><path d="M14 2v5a1 1 0 0 0 1 1h5" /></svg>', // file
};
const TERM_KEYS = [['ctrl+c', 'Ctrl+C'], ['enter', 'Enter'], ['up', '↑'], ['down', '↓'], ['tab', 'Tab'], ['esc', 'Esc']];
// 키 직접 입력 (raw) in the shell view: for full-screen programs (helix, vim, less). A ":text"
// entry types that text; the rest are herdr key names.
const RAW_TERM_KEYS = [
  ['esc', 'Esc'], [':text', ':'], ['/text', '/'], ['ctrl+x', 'Ctrl+X'], ['pageup', 'PgUp'], ['pagedown', 'PgDn'],
  ['up', '↑'], ['down', '↓'], ['left', '←'], ['right', '→'], ['tab', 'Tab'], ['enter', 'Enter'], ['ctrl+c', 'Ctrl+C'],
];
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
  network: '연결이 끊겼습니다. 다시 시도해 주세요.',
  timeout: '응답이 늦어 기다리기를 멈췄습니다. 다시 시도해 주세요.',
  agent_not_found: '에이전트가 끝났거나 닫혔습니다.',
  pane_not_found: '셸이 닫혔습니다.',
  workspace_not_found: '워크스페이스가 닫혔습니다.',
  agent_blocked: '에이전트가 답을 기다리는 중입니다. 위 버튼으로 먼저 답해 주세요.',
  not_subscribed: '이 기기는 알림이 꺼져 있습니다.',
  forbidden: '이 기기는 허용되지 않았습니다.',
};
// Korean for every failure: the server's code, else a plain 'try again' (never "Load failed").
const errText = (err) => ERROR_TEXT[err.code] || (err.status >= 500 ? `호스트 오류(${err.status})입니다. 잠시 뒤에 다시 시도해 주세요.` : err.message && /[가-힣]/.test(err.message) ? err.message : `요청이 실패했습니다${err.code ? ` (${err.code})` : ''}. 다시 시도해 주세요.`);

let state = { agents: [], terminals: [], workspaces: [], hosts: [], herdr: 'connecting' };
let view = { name: 'list' };
let detail = { host: null, pane: null, transcript: null, screen: null, blockedText: null, lastSeq: -1, files: [], sheet: null, activity: null };
const hostCache = new Map(); // host id -> { kinds, recentCwds, platform, home } from that host's /api/host
let pollTimer = null;
let tickTimer = null; // the activity line's clock, once a second while working
let resolveReady;
const ready = new Promise((r) => (resolveReady = r)); // the first state has arrived

// ------------------------------------------------------------ utilities

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const basename = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || p || '';

// ------------------------------------------------------------ hosts

// The host a view is about: from the route (#/h/<id>/…), else this Herdr Hub's own host.
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
// "hub-pol-d1 · hub-pol-d1" says the same thing twice: one when the folder is named like the workspace.
const wsAndDir = (label, cwd) => {
  const dir = basename(cwd);
  return !dir || dir === label ? label || dir : `${label} · ${dir}`;
};

// Settings saved before the rename lived under paddock.*; move them across once.
try {
  for (const k of Object.keys(localStorage))
    if (k.startsWith('paddock.')) {
      const nk = 'herdr-hub.' + k.slice(8);
      if (localStorage.getItem(nk) == null) localStorage.setItem(nk, localStorage.getItem(k));
      localStorage.removeItem(k);
    }
} catch {}

const FILTER_KEY = 'herdr-hub.host';
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

// 화면 모드: system (no data-theme), light or dark on <html>. index.html applies the saved one
// before first paint; this keeps it, the status bar colour and color-scheme in step.
const THEME_KEY = 'herdr-hub.theme';
const THEMES = { system: '시스템', light: '밝게', dark: '어둡게' };
const THEME_BAR = { light: '#f6f5f1', dark: '#161614' };
let memTheme = null;
function getTheme() {
  if (memTheme) return memTheme;
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}
const darkNow = () => {
  const t = getTheme();
  return t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
};
function applyTheme(t) {
  const root = document.documentElement;
  if (t === 'light' || t === 'dark') root.dataset.theme = t;
  else delete root.dataset.theme;
  // Two metas, one per scheme; a forced mode gives both the same colour.
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
    const scheme = /dark/.test(m.media) ? 'dark' : 'light';
    m.content = THEME_BAR[t === 'system' ? scheme : t];
  }
}
function setTheme(t) {
  memTheme = t;
  try {
    if (t === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, t);
  } catch {
    /* private mode: the choice lasts until reload */
  }
  applyTheme(t);
  redrawScreen();
}
applyTheme(getTheme());

// 리턴 키 for the agent composer: newline (default; send with the ↑ button or ⌘/Ctrl+Enter) or
// send (Shift+Enter for a newline on a hardware keyboard). The shell line always runs on Enter.
const ENTER_KEY = 'herdr-hub.enter';
let memEnter = null;
function getEnter() {
  if (memEnter) return memEnter;
  try {
    return localStorage.getItem(ENTER_KEY) === 'send' ? 'send' : 'newline';
  } catch {
    return 'newline';
  }
}
function setEnter(v) {
  memEnter = v;
  try {
    localStorage.setItem(ENTER_KEY, v);
  } catch {
    /* private mode: the choice lasts until reload */
  }
}
// What Enter does in the composer: 'send', 'newline' or null (leave it to the IME).
// Korean (and other) IMEs send Enter while a syllable is still being composed: never act then.
function enterAction(e, mode) {
  if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return null;
  if (e.metaKey || e.ctrlKey) return 'send';
  if (mode === 'send' && !e.shiftKey && !e.altKey) return 'send';
  return 'newline';
}

const clock = (t) => (t ? new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '');

async function hostInfo(id) {
  if (!hostCache.has(id)) hostCache.set(id, await api(hp('/host', id)));
  return hostCache.get(id);
}

// Reads give up after 15 s, writes after 60 s: a dead connection after iOS wakes the app must
// not hold up the next poll. Failures carry a code: the server's, else network / timeout.
async function api(path, opts = {}) {
  const write = opts.method && opts.method !== 'GET';
  const signal = opts.signal || (window.AbortSignal && AbortSignal.timeout ? AbortSignal.timeout(write ? 60000 : 15000) : undefined);
  let res;
  try {
    res = await fetch(`/api${path}`, {
      ...opts,
      signal,
      headers: { 'Content-Type': 'application/json', 'X-Herdr-Hub': '1', ...(opts.headers || {}) },
    });
  } catch (err) {
    const timeout = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw Object.assign(new Error(timeout ? 'timeout' : 'network'), { code: timeout ? 'timeout' : 'network', network: true });
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.message || body.error || res.statusText), { code: body.error, status: res.status });
  return body;
}

// ---- layers: sheets, menus, the terminal sheet, the photo viewer
// One stack: Escape closes the top one, focus moves into it and comes back afterwards, and
// everything underneath is inert. Sheets slide up, the backdrop fades (not with reduced motion).
const layers = [];
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function syncInert() {
  $app.inert = layers.length > 0;
  layers.forEach((l, i) => (l.el.inert = i < layers.length - 1));
}
function openLayer(el, { onClose, focus, animate = true } = {}) {
  const layer = { el, onClose, back: document.activeElement, closed: false };
  layers.push(layer);
  if (!animate) el.classList.add('no-anim');
  document.body.appendChild(el);
  syncInert();
  const target = typeof focus === 'string' ? el.querySelector(focus) : focus || el.querySelector('[autofocus], input, [data-k], button');
  if (target) target.focus({ preventScroll: true });
  layer.close = (v) => closeLayer(layer, v);
  return layer;
}
function closeLayer(layer, value) {
  if (!layer || layer.closed) return;
  layer.closed = true;
  const i = layers.indexOf(layer);
  if (i >= 0) layers.splice(i, 1);
  syncInert();
  const { el } = layer;
  if (reduced() || el.classList.contains('no-anim')) el.remove();
  else {
    el.classList.add('closing');
    el.inert = true;
    setTimeout(() => el.remove(), 160);
  }
  // Back to where focus was, if that is still on the page and not under another layer.
  const back = layer.back;
  if (back && back.isConnected && !back.closest('[inert]') && typeof back.focus === 'function') back.focus({ preventScroll: true });
  if (layer.onClose) layer.onClose(value);
}
const topLayer = () => layers[layers.length - 1] || null;

// In-page sheet instead of confirm()/prompt(): those block the page (and automated tests).
// Resolves with the input's value (or true) on OK, null on cancel.
// validate(value) -> a hint while the typed value can't be used ('' when it can): shown under
// the field as you type, and OK waits for a usable value.
function sheet({ title, text = '', error = '', input = null, ok = '확인', danger = false, validate = null, again = false }) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'sheet-back';
    el.innerHTML = `<form class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <h2>${esc(title)}</h2>
        ${text ? `<p>${esc(text)}</p>` : ''}
        ${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
        ${input ? `<input class="field" name="v" value="${esc(input.value || '')}" placeholder="${esc(input.placeholder || '')}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="sheet-hint">
        <p class="hint" id="sheet-hint" aria-live="polite"></p>` : ''}
        <div class="row end">
          <button type="button" class="btn secondary" data-cancel>취소</button>
          <button type="submit" class="btn ${danger ? 'danger' : ''}">${esc(ok)}</button>
        </div>
      </form>`;
    const field = el.querySelector('input');
    const submit = el.querySelector('[type=submit]');
    const check = () => {
      if (!validate || !field) return true;
      const hint = validate(field.value);
      el.querySelector('.hint').textContent = hint || '';
      field.setAttribute('aria-invalid', String(Boolean(hint)));
      submit.disabled = Boolean(hint);
      return !hint;
    };
    let layer = null;
    const done = (v) => closeLayer(layer, v);
    // A block body: an onclick that returns false would cancel the submit button's click.
    el.onclick = (e) => {
      if (e.target === el) done(null);
    };
    el.querySelector('[data-cancel]').onclick = () => done(null);
    if (field) field.oninput = check;
    el.querySelector('form').onsubmit = (e) => {
      e.preventDefault();
      if (!check()) return;
      done(input ? field.value : true);
    };
    check();
    // Shown again after an error: no slide, so it reads as the same sheet.
    layer = openLayer(el, { onClose: (v) => resolve(v === undefined ? null : v), focus: field || submit, animate: !again });
  });
}

// Ask, post, and on failure ask again with the error and the typed text kept (the 새 폴더 way).
async function askLoop(opts, post) {
  let value = opts.input ? opts.input.value || '' : '';
  let error = '';
  for (let n = 0; ; n++) {
    const v = await sheet({ ...opts, error, again: n > 0, input: opts.input ? { ...opts.input, value } : null });
    if (v == null) return null;
    value = v;
    try {
      return (await post(v.trim())) || true;
    } catch (err) {
      error = errText(err);
    }
  }
}

// A list of actions in a sheet. Resolves with the chosen key or null.
// items: [key, label, danger?, sub?]; a null item is skipped. Danger items go last, under a gap.
function menu(title, items, { sub = '' } = {}) {
  return new Promise((resolve) => {
    const list = items.filter(Boolean);
    const row = ([key, label, danger, note]) =>
      `<button class="action ${danger ? 'danger' : ''}" data-k="${esc(key)}">${esc(label)}${note ? `<span class="sub">${esc(note)}</span>` : ''}</button>`;
    const plain = list.filter((x) => !x[2]);
    const risky = list.filter((x) => x[2]);
    const el = document.createElement('div');
    el.className = 'sheet-back';
    el.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <h2>${esc(title)}${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</h2>
        ${plain.length ? `<div class="actions">${plain.map(row).join('')}</div>` : ''}
        ${risky.length ? `<div class="actions">${risky.map(row).join('')}</div>` : ''}
        <button class="btn secondary wide" data-k="">취소</button>
      </div>`;
    let layer = null;
    const done = (v) => closeLayer(layer, v);
    // A block body: an onclick that returns false would cancel the submit button's click.
    el.onclick = (e) => {
      if (e.target === el) done(null);
    };
    el.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => done(b.dataset.k)));
    layer = openLayer(el, { onClose: (v) => resolve(v || null), focus: '.action' });
  });
}

// Toasts stack above the composer (newest at the bottom, three at most); the same text again
// replaces the old one. Errors are announced at once (role=alert), the rest politely.
// action: { label, run } adds a button (다시 보내기).
let toastBox = null;
function toast(text, { error = false, action = null, ms } = {}) {
  if (!toastBox || !toastBox.isConnected) {
    toastBox = document.createElement('div');
    toastBox.className = 'toasts';
    document.body.appendChild(toastBox);
  }
  for (const old of toastBox.querySelectorAll('.toast')) if (old.dataset.text === text) old.remove();
  const el = document.createElement('div');
  el.className = `toast${error ? ' err' : ''}`;
  el.setAttribute('role', error ? 'alert' : 'status');
  el.dataset.text = text;
  el.innerHTML = `<span class="t">${esc(text)}</span>${action ? `<button type="button" class="t-act">${esc(action.label)}</button>` : ''}`;
  const remove = () => {
    if (!el.isConnected) return;
    if (reduced()) return el.remove();
    el.classList.add('closing');
    setTimeout(() => el.remove(), 160);
  };
  if (action)
    el.querySelector('.t-act').onclick = () => {
      remove();
      action.run();
    };
  toastBox.appendChild(el);
  const all = toastBox.querySelectorAll('.toast:not(.closing)');
  for (let i = 0; i < all.length - 3; i++) all[i].remove();
  setTimeout(remove, ms || (action ? 6000 : error ? 4500 : 3200));
}
const toastErr = (text, action) => toast(text, { error: true, action });

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
  es.addEventListener('state', (e) => {
    retryDelay = 1000;
    live = true;
    state = JSON.parse(e.data);

    resolveReady();
    onState();
  });
  es.onerror = () => {
    state = { ...state, herdr: 'offline' };
    live = false;
    if (view.name === 'list') render();
    if (view.name === 'agent') renderDetailHeader();
    if (view.name === 'term') renderTerminalHeader();
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

function route() {
  if (!history.state || !('prev' in history.state)) history.replaceState({ ...(history.state || {}), prev: lastHash }, '');
  lastHash = location.hash || '#/';
  stashDraft();
  clearInterval(pollTimer);
  clearInterval(tickTimer);
  tickTimer = null;
  closeScreenSheet();
  swipe.open = swipe.g = null;
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
    view = { name: 'agent', host };
    const draft = drafts.get(rowKey(curHost(), pane));
    detail = { host, pane, transcript: null, screen: null, blockedText: null, lastSeq: -1, files: draft ? draft.files : [], sheet: null, wantSheet: m[2] === 'screen', activity: null };
    if (m[2]) history.replaceState(history.state, '', location.hash.replace(/\/(?:screen|chat)$/, ''));
    renderDetail();
    if (draft) {
      document.getElementById('d-input').value = draft.text;
      renderTray();
    }
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

// The herdr hierarchy: host → workspace → pane, one card per workspace, with blocked agents
// from every workspace also in a strip on top. State updates patch the list in place (one
// element per card, replaced only when its HTML changed), so the scroll position and an open
// row survive them; a card that does change closes the row open in it.

const rowKey = (host, id) => `${host || localId()}|${id}`;
let listScroll = 0; // the list's scroll position, kept while a detail view is open
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

function render() {
  if (swipe.g && Date.now() - swipe.g.t0 < 10000) return void (swipe.pending = true); // after the finger lifts
  const down = state.herdr !== 'up';
  const f = filter();
  const { blocked, list } = listModel();
  for (const a of blocked) ensureQuestion(a);
  // Peers in view that are offline or whose herdr is down.
  const trouble = hosts().filter((h) => !h.local && (f === 'all' || f === h.id) && (!h.online || h.herdr !== 'up'));
  const empty = f !== 'all' && !online(f) ? '' : down && f !== 'all' && f === localId() ? 'herdr 서버에 연결하지 못했습니다.' : '열린 워크스페이스가 없습니다.';
  const top = `
    <header class="bar">
      <h1>Herdr Hub<span class="sub">${esc(f === 'all' ? (multi() ? hosts().map((x) => x.label).join(' · ') : state.host || '') : hostLabel(f))}</span></h1>
      <span class="conn ${down ? 'down' : ''}"><span class="dot"></span>${down ? (state.herdr === 'down' ? 'herdr 연결 끊김' : state.herdr === 'offline' ? '연결 끊김' : '연결 중') : '실시간'}</span>
      <a class="icon-btn" href="${f === 'all' ? '#/new' : link(f, '/new')}" aria-label="새 워크스페이스">${ICON.plus}</a>
      <a class="icon-btn" href="#/settings" aria-label="설정">${ICON.gear}</a>
    </header>
    ${multi() ? `
    <nav class="seg hosts" role="group" aria-label="호스트">
      <button data-host="all" aria-pressed="${f === 'all'}">전체</button>
      ${hosts().map((x) => `<button data-host="${esc(x.id)}" aria-pressed="${f === x.id}" class="${x.online ? '' : 'off'}"><span class="hdot"></span>${esc(x.label)}</button>`).join('')}
    </nav>` : ''}`;
  const parts = [
    ...(swipeHintShown() && list.length ? [['hint', `<p class="hint-row" role="note"><span>줄을 왼쪽으로 밀면 이름·닫기, 길게 누르면 메뉴가 나옵니다.</span><button type="button" class="icon-btn hint-x" aria-label="안내 닫기">${ICON.x}</button></p>`]] : []),
    ...trouble.map((x) => [`off|${x.id}`, `<p class="offline" role="status"><b>${esc(x.label)}</b> ${x.online ? 'herdr 연결 끊김' : `오프라인${x.since ? ` · ${esc(clock(x.since))}부터` : ''} — 잠들었거나 Herdr Hub 가 꺼져 있습니다`}</p>`]),
    ...(blocked.length ? [['attn', attnStrip(blocked)]] : []),
    ...list.map((s) => [`ws|${rowKey(s.w.host, s.w.workspace_id)}`, wsSection(s)]),
    ...(!list.length && empty ? [['empty', `<p class="empty">${empty}</p>`]] : []),
  ];
  let main = $app.querySelector(':scope > main.home');
  const fresh = !main;
  if (!main) {
    $app.innerHTML = `${top}<main class="list home"></main>`;
    main = $app.querySelector(':scope > main.home');
    bindList(main);
  } else if (main._top !== top) {
    $app.querySelectorAll(':scope > header, :scope > nav').forEach((el) => el.remove());
    main.insertAdjacentHTML('beforebegin', top);
  }
  main._top = top;
  patchList(main, parts);
  // Back from an agent: where the list was left.
  if (fresh && listScroll) main.scrollTop = listScroll;
  $app.querySelectorAll('.hosts button').forEach((b) => {
    b.onclick = () => {
      setFilter(b.dataset.host);
      render();
    };
  });
  tickList();
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
  if (view.name === 'list') render();
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
  const box = ['list', 'ws'].includes(view.name) ? $app : null;
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
function ensureQuestion(a) {
  const k = rowKey(a.host, a.pane);
  const q = questions.get(k);
  if (q && q.seq === a.stateSeq && (q.loading || q.choices !== undefined) && !(q.failed && Date.now() - q.at > 10000)) return;
  const seq = a.stateSeq;
  questions.set(k, { seq, loading: true });
  api(hp(`/agents/${encodeURIComponent(a.pane)}/screen?source=visible&lines=30`, a.host || localId()))
    .then((r) => {
      const cur = state.agents.find((x) => same(x, a.host || localId(), a.pane));
      // Read after the prompt changed: that screen is not this question's.
      if (!cur || cur.stateSeq !== seq) return questions.delete(k);
      questions.set(k, { seq, choices: window.parseChoices ? parseChoices(String(r.text || '').replace(/\s+$/, '')) : null, at: Date.now() });
    })
    .catch(() => questions.set(k, { seq, choices: null, failed: true, at: Date.now() }))
    .finally(() => view.name === 'list' && render());
}
// Up to three buttons: a numbered menu's first options, or a Yes/No menu; never "Type something".
function quickItems(ch) {
  if (!ch) return [];
  const items = ch.items.filter((x) => !TYPE_OWN.test(x.label) && choiceKeys(ch, x.n));
  // A permission prompt's refusal comes last (1 Yes, 2-3 Yes and …, 4 No): keep it in reach.
  const neg = items.find((x) => x.negative);
  if (ch.numbered) return neg && items.indexOf(neg) >= 3 ? [...items.slice(0, 2), neg] : items.slice(0, 3);
  return items.length <= 3 && items.every((x) => /^(yes|no)\b/i.test(x.label)) ? items : [];
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
  const quick = quickItems(ch);
  const locked = quickLocked(k, a);
  const primary = ch ? primaryChoice(ch.items) : null;
  const where = `${esc(a.workspaceLabel)}${multi() && filter() === 'all' ? ` · ${esc(a.hostLabel || hostLabel(a.host))}` : ''}`;
  return `<div class="attn-item" ${rowData('agent', a.host, a.pane)}>
    <a class="attn-row" href="${link(a.host, `/agent/${encodeURIComponent(a.pane)}`)}">
      <span class="pane-ic" aria-hidden="true">${ICON.agent}</span>
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
  setTimeout(() => view.name === 'list' && render(), CHOICE_LOCK_MS + 50);
  render();
  if (!(await sendKeys(keys, host, pane))) {
    // Not sent: the buttons come back at once.
    if (quickLocks.get(k) === lock) quickLocks.delete(k);
    if (view.name === 'list') render();
  }
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
      <span class="pane-ic" aria-hidden="true">${ICON.agent}</span>
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

// ---- row actions: swipe a row left for 이름 / 닫기, or long-press it for a menu

// iOS style: a swipe only reveals the buttons (a full swipe never runs one), one row is open
// at a time, and a tap elsewhere or a scroll closes it. The first move decides the axis:
// vertical scrolls the list, horizontal slides the row. A touch that starts at the left edge
// is left to iOS (back). The document-level touch guard lets sideways drags on .sw through.
const SWIPE_EDGE = 20; // px from the left screen edge
const SWIPE_SLOP = 8; // px before the axis is decided
const LONG_MS = 500;
const swipe = { open: null, g: null, mute: 0, pending: false };

function slideTo(el, x, animate) {
  const front = el.querySelector(':scope > .sw-front');
  el.classList.toggle('drag', !animate);
  el.classList.add('live');
  front.style.transform = x ? `translateX(${x}px)` : '';
  if (x || !animate) return;
  // Hide the buttons once the row has slid shut (at once without a transition).
  const hide = () => el !== swipe.open && !front.style.transform && el.classList.remove('live');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return hide();
  front.addEventListener('transitionend', hide, { once: true });
  setTimeout(hide, 400);
}
const actsWidth = (el) => el.querySelector(':scope > .sw-acts').offsetWidth;
function openRow(el) {
  if (swipe.open && swipe.open !== el) closeRow();
  swipe.open = el;
  slideTo(el, -actsWidth(el), true);
}
function closeRow() {
  const el = swipe.open;
  swipe.open = null;
  if (el) slideTo(el, 0, true);
}

function bindList(main) {
  main.addEventListener('touchstart', rowTouchStart, { passive: true });
  main.addEventListener('touchmove', rowTouchMove, { passive: false });
  main.addEventListener('touchend', rowTouchEnd);
  main.addEventListener('touchcancel', rowTouchEnd);
  main.addEventListener(
    'scroll',
    () => {
      listScroll = main.scrollTop;
      if (!(swipe.g && swipe.g.axis === 'x')) closeRow();
    },
    { passive: true }
  );
  main.addEventListener('click', rowClick, true);
  // Right-click (and a long press where the browser makes one of it) opens the same menu.
  main.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('[data-kind]');
    if (!row) return;
    e.preventDefault();
    if ((swipe.g && swipe.g.long) || Date.now() < swipe.mute) return;
    closeRow();
    rowMenu(row);
  });
}

// A press outside the list (header, host filter) closes an open row too.
document.addEventListener('pointerdown', (e) => {
  if (swipe.open && !e.target.closest('main.home')) closeRow();
});

function rowTouchStart(e) {
  clearTimeout(swipe.g && swipe.g.timer);
  if (e.touches.length !== 1) return void (swipe.g = null);
  const t = e.touches[0];
  const onActs = e.target.closest('.sw-acts');
  const sw = onActs ? null : e.target.closest('.sw');
  const row = onActs ? null : e.target.closest('[data-kind]');
  const g = { x: t.clientX, y: t.clientY, t0: Date.now(), sw, row, axis: null, base: 0, dx: 0, eat: false, long: false, timer: null, lastX: t.clientX, lastT: Date.now(), v: 0 };
  if (swipe.open && !(onActs && swipe.open.contains(onActs))) {
    // While a row is open, a tap only closes it; dragging the open row itself moves it.
    g.eat = true;
    if (sw === swipe.open) g.base = -actsWidth(sw);
    else closeRow();
  }
  g.edge = t.clientX < SWIPE_EDGE;
  if (row) g.timer = setTimeout(() => {
    g.long = true;
    closeRow();
    rowMenu(row);
  }, LONG_MS);
  swipe.g = g;
}

function rowTouchMove(e) {
  const g = swipe.g;
  if (!g || e.touches.length !== 1) return;
  const t = e.touches[0];
  const dx = t.clientX - g.x;
  const dy = t.clientY - g.y;
  if (!g.axis) {
    if (Math.hypot(dx, dy) < SWIPE_SLOP) return;
    clearTimeout(g.timer);
    g.axis = Math.abs(dx) > Math.abs(dy) ? (g.sw && !g.edge && !g.long ? 'x' : 'none') : 'y';
    if (g.axis === 'x' && swipe.open && swipe.open !== g.sw) closeRow();
    if (g.axis === 'y' && swipe.open) closeRow();
  }
  if (g.axis === 'y') return;
  if (e.cancelable) e.preventDefault(); // sideways: never the page
  if (g.axis !== 'x') return;
  const w = actsWidth(g.sw);
  let x = Math.min(0, g.base + dx);
  if (x < -w) x = -w + (x + w) / 3; // past the buttons: resist, and never run one
  g.dx = x;
  const now = Date.now();
  if (now > g.lastT) g.v = (t.clientX - g.lastX) / (now - g.lastT);
  g.lastX = t.clientX;
  g.lastT = now;
  slideTo(g.sw, x, false);
}

function rowTouchEnd(e) {
  const g = swipe.g;
  swipe.g = null;
  if (!g) return;
  clearTimeout(g.timer);
  const eatClick = () => {
    swipe.mute = Date.now() + 450;
    if (e.cancelable) e.preventDefault();
  };
  if (g.axis === 'x') {
    const w = actsWidth(g.sw);
    const open = g.v < -0.3 ? true : g.v > 0.3 ? false : g.dx < -w / 2;
    if (open) openRow(g.sw);
    else {
      if (swipe.open === g.sw) swipe.open = null;
      slideTo(g.sw, 0, true);
    }
    eatClick();
  } else if (g.long || g.axis === 'none') eatClick();
  else if (g.eat && !g.axis) {
    closeRow();
    eatClick();
  }
  if (swipe.pending) {
    swipe.pending = false;
    if (view.name === 'list') render();
  }
}

function rowClick(e) {
  if (Date.now() < swipe.mute) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const quick = e.target.closest('[data-quick]');
  if (quick) {
    e.preventDefault();
    if (!quick.disabled) quickAnswer(quick);
    return;
  }
  const more = e.target.closest('.ws-more');
  if (more) {
    // The card's ⋯ opens the same menu as a long press, not another page.
    e.preventDefault();
    closeRow();
    rowMenu(more.closest('[data-kind]'));
    return;
  }
  const act = e.target.closest('.sw-act');
  if (act) {
    e.preventDefault();
    const row = act.closest('.sw');
    closeRow();
    rowAction(row, act.dataset.act);
  } else if (swipe.open) {
    // A mouse click elsewhere: close only.
    e.preventDefault();
    e.stopPropagation();
    closeRow();
  }
}

function rowTarget(el) {
  const { kind, id } = el.dataset;
  const host = el.dataset.host || localId();
  if (kind === 'ws') return wsFor(host, id);
  return (kind === 'agent' ? state.agents : state.terminals || []).find((x) => same(x, host, id));
}
const rowLabel = (kind, x) => (kind === 'ws' ? x.label : kind === 'agent' ? x.name || x.title : termTitle(x));

async function rowMenu(el) {
  const kind = el.dataset.kind;
  const x = rowTarget(el);
  if (!x) return;
  const items =
    kind === 'ws'
      ? [['open', '워크스페이스 보기'], ['agent', '에이전트 시작'], ['tab', '새 탭'], ['rename', '이름 바꾸기'], ['close', '워크스페이스 닫기', true]]
      : [
          ['open', kind === 'agent' ? '대화 열기' : '셸 열기'],
          kind === 'agent' && x.status === 'working' ? ['stop', '멈추기'] : null,
          ['rename', '이름 바꾸기'],
          ['ws', '워크스페이스 보기'],
          ['close', kind === 'agent' ? '패널 닫기(에이전트 종료)' : '패널 닫기', true],
        ];
  const k = await menu(rowLabel(kind, x), items, { sub: kind === 'ws' ? '워크스페이스' : kind === 'agent' ? '에이전트' : '셸' });
  if (k) rowAction(el, k);
}

// The same calls the agent, shell and workspace menus make.
async function rowAction(el, k) {
  const kind = el.dataset.kind;
  const x = rowTarget(el);
  if (!x) return toast('이미 닫혔습니다');
  if (kind === 'ws') {
    if (k === 'open') location.hash = link(x.host, `/ws/${encodeURIComponent(x.workspace_id)}`);
    if (k === 'agent') location.hash = link(x.host, `/start/ws/${encodeURIComponent(x.workspace_id)}`);
    if (k === 'tab') newTab(x);
    if (k === 'rename') renameWorkspace(x);
    if (k === 'close') closeWorkspace(x);
    return;
  }
  if (k === 'open') location.hash = link(x.host, `/${kind === 'agent' ? 'agent' : 'term'}/${encodeURIComponent(x.pane)}`);
  if (k === 'ws') location.hash = link(x.host, `/ws/${encodeURIComponent(x.workspace)}`);
  if (k === 'stop' && (await sheet({ title: '작업 멈추기', text: `‘${rowLabel(kind, x)}’ 의 작업을 멈출까요? 대화는 남습니다.`, ok: '멈추기', danger: true }))) {
    if (await sendKeys(['esc'], x.host || localId(), x.pane)) toast('멈추라고 보냈습니다');
  }
  if (k === 'rename') renamePane(x, kind === 'agent');
  if (k === 'close') closePane(x.host, x.pane, rowLabel(kind, x), kind === 'agent');
}

// ------------------------------------------------------------ detail view

function renderDetail() {
  $app.innerHTML = `
    <div class="detail">
      <header class="bar">
        <a class="icon-btn" href="#/" data-back aria-label="목록">${ICON.back}</a>
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
    if (enterAction(e, getEnter()) === 'send') {
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
  const tools = m.tools && m.tools.length ? `<div class="tools">${m.tools.map((t, i) => toolLine(t, `${m.id}:${i}`)).join('')}</div>` : '';
  return `<div class="msg assistant">${m.text ? md(m.text) : ''}${tools}</div>`;
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
  if (ok && (await act(hp(`/panes/${encodeURIComponent(pane)}/close`, host), {}, '패널을 닫았습니다')) && view.name !== 'list') goBack('#/');
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
  if (ok && (await act(hp(`/workspaces/${encodeURIComponent(w.workspace_id)}/close`, w.host), {}, '워크스페이스를 닫았습니다')) && view.name !== 'list') goBack('#/');
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
  $app.innerHTML = `
    <div class="detail">
      <header class="bar">
        <a class="icon-btn" href="#/" data-back aria-label="목록">${ICON.back}</a>
        <h1 id="t-title"></h1>
        <span id="t-live"></span>
        <button class="icon-btn" id="t-more" aria-label="더 보기">${ICON.more}</button>
      </header>
      <div class="screen-tools" id="s-tools" hidden></div>
      <div class="scroll" id="t-body"></div>
      <div class="keys term-keys" id="t-keys"></div>
      <form class="composer" id="t-form">
        <button type="button" class="mode" id="t-raw" aria-pressed="false" aria-label="키 직접 입력">키 직접<br>입력</button>
        <input class="cmd" id="t-input" placeholder="명령 (Enter 로 실행)" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send">
        <button type="submit" class="send" id="t-send" aria-label="실행">${ICON.send}</button>
      </form>
    </div>`;
  const input = document.getElementById('t-input');
  detail.raw = false; // command mode first, every time
  const keysBox = document.getElementById('t-keys');
  const drawKeys = () => {
    const list = detail.raw ? RAW_TERM_KEYS : TERM_KEYS;
    keysBox.innerHTML = list.map(([k, label]) => `<button type="button" class="key" data-key="${esc(k)}" aria-label="${esc(label)} 키 보내기">${esc(label)}</button>`).join('');
    keysBox.scrollLeft = 0;
  };
  drawKeys();
  // Raw mode: pressing a key button leaves the caret (and the iPhone keyboard) in the field,
  // so the next typed key still goes to the program, not to the button.
  keysBox.addEventListener('mousedown', (e) => detail.raw && e.preventDefault());
  // Command mode: a key goes after whatever is in the input line, typed without Enter (Tab
  // completes it). Raw mode: the key alone, at once.
  keysBox.onclick = async (e) => {
    const b = e.target.closest('.key');
    if (!b) return;
    const k = b.dataset.key;
    if (detail.raw) return rawSend(k.endsWith('text') ? { text: k.slice(0, -4) } : { key: k });
    if (await act(hp(`/panes/${encodeURIComponent(detail.pane)}/keys`), { keys: [k], text: input.value })) {
      input.value = '';
      setTimeout(loadTerminal, 300);
    }
  };
  const rawBtn = document.getElementById('t-raw');
  rawBtn.onclick = () => {
    detail.raw = !detail.raw;
    rawBtn.setAttribute('aria-pressed', String(detail.raw));
    input.value = '';
    input.placeholder = detail.raw ? '누르는 키가 바로 갑니다' : '명령 (Enter 로 실행)';
    input.setAttribute('enterkeyhint', detail.raw ? 'enter' : 'send');
    document.getElementById('t-send').hidden = detail.raw;
    $app.querySelector('.detail').classList.toggle('raw', detail.raw);
    drawKeys();
    input.focus();
    clearInterval(pollTimer);
    pollTimer = setInterval(loadTerminal, detail.raw ? 1000 : 2500);
  };
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
    const k = rawKeyName(e);
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
const RAW_NAMES = { Enter: 'enter', Escape: 'esc', Tab: 'tab', Backspace: 'backspace', Delete: 'delete', ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', PageUp: 'pageup', PageDown: 'pagedown', Home: 'home', End: 'end' };
function rawKeyName(e) {
  if (e.metaKey) return null;
  if (e.key === 'Tab' && e.shiftKey) return 'shift+tab';
  if (RAW_NAMES[e.key] && !e.ctrlKey && !e.altKey) return RAW_NAMES[e.key];
  if (e.ctrlKey && /^[a-z]$/i.test(e.key)) return `ctrl+${e.key.toLowerCase()}`;
  if (e.altKey && /^[a-z]$/i.test(e.key)) return `alt+${e.key.toLowerCase()}`;
  return null;
}
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
      await api(hp(`/panes/${encodeURIComponent(pane)}/keys`, host), { method: 'POST', body: JSON.stringify(it) });
      clearTimeout(rawLoadTimer);
      rawLoadTimer = setTimeout(loadTerminal, 150);
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
  $app.innerHTML = `
    <header class="bar">
      <a class="icon-btn" href="#/" data-back aria-label="목록">${ICON.back}</a>
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
  const back = isNew ? '#/' : ws ? link(host, `/ws/${encodeURIComponent(ws.workspace_id)}`) : term ? link(host, `/term/${encodeURIComponent(term.pane)}`) : '#/';
  $app.innerHTML = `
    <header class="bar">
      <a class="icon-btn" href="${back}" data-back aria-label="뒤로">${ICON.back}</a>
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
        if (view.name === 'settings' && r.disabled) renderSettings();
      })
      .catch(() => {});
  if (devSub === undefined && supported)
    lookupSub().then(() => view.name === 'settings' && renderSettings());
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const [permWord, permTodo] = PERM_TEXT[perm] || [perm, ''];
  const denied = perm === 'denied';
  const subscribed = Boolean(devSub);
  const devLine = !supported || denied ? '' : devSub === undefined ? '이 기기 알림을 확인하는 중…' : subscribed ? '이 기기는 알림을 받습니다.' : '이 기기는 알림이 꺼져 있습니다.';
  $app.innerHTML = `
    <header class="bar">
      <a class="icon-btn" href="#/" data-back aria-label="목록">${ICON.back}</a>
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
    </main>`;
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
  radios('s-enter', 'enter', (v) => {
    setEnter(v);
    renderSettings();
    document.querySelector(`#s-enter [data-enter="${v}"]`).focus();
  });
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

// Only to this device: its own endpoint goes along and the hub sends to that one alone.
async function testPush() {
  const sub = await lookupSub();
  if (!sub) {
    if (view.name === 'settings') renderSettings();
    return toast('이 기기는 알림이 꺼져 있습니다', { action: { label: '알림 켜기', run: enablePush } });
  }
  try {
    await api('/push/test', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) });
    toast('이 기기로 시험 알림을 보냈습니다');
  } catch (err) {
    if (err.code === 'not_subscribed') {
      devSub = null;
      if (view.name === 'settings') renderSettings();
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
      if (view.name === 'settings') renderSettings();
      return toastErr(perm === 'denied' ? '알림이 거부됐습니다. iPhone 설정 → 알림 → Herdr Hub 에서 허용하세요.' : '알림 권한을 받지 못했습니다.');
    }
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await api('/push/key');
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
    await api('/push/subscribe', { method: 'POST', body: JSON.stringify(sub.toJSON()) });
    devSub = sub;
    toast('이 기기 알림을 켰습니다.');
    if (view.name === 'settings') renderSettings();
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
    if (f.isContentEditable) {
      const r = document.createRange();
      r.selectNodeContents(f);
      r.collapse(false);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && view.name === 'agent') loadDetail();
});
connect();
route();
