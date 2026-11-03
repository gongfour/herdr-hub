'use strict';
// The shell (terminal) view: 키 직접 입력 and 한 줄 입력, the key row, polling the screen.

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
