'use strict';
// The agent composer's helpers: the /, @ and ! palette, and photo attachments (picking, pasting,
// shrinking, the tray).

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
// Claude Code (2.1.317) takes an image path in a prompt by itself: it attaches the file and
// shows "[Image #N]" in its place. So the prompt is the text, then one path per line.
function promptText(text, paths) {
  if (!paths.length) return text;
  return [text.replace(/\s+$/, ''), ...paths].filter(Boolean).join('\n');
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
