'use strict';
// The shell (terminal) view: 키 직접 입력 and 한 줄 입력, the key row, polling the screen.

// ------------------------------------------------------------ terminal view

// The key row: 한 줄 입력's keys, and 키 직접 입력's.
const TERM_KEYS = [['ctrl+c', 'Ctrl+C'], ['enter', 'Enter'], ['up', '↑'], ['down', '↓'], ['tab', 'Tab'], ['esc', 'Esc']];
// 키 직접 입력 (raw), the shell view's default: every key goes to the pane as it is pressed,
// so the shell's own completion, history and suggestions work, as do full-screen programs
// (helix, vim, less). What the phone's keyboard lacks comes first, so a 390px row shows it
// without scrolling: Esc, the sticky Ctrl and Alt, Tab and the arrows. A ":text" entry types
// that text, "mod:" ones are the sticky modifiers; the rest are herdr key names.
const RAW_TERM_KEYS = [
  ['esc', 'Esc'], ['mod:ctrl', 'Ctrl'], ['mod:alt', 'Alt'], ['tab', 'Tab'], ['up', '↑'], ['down', '↓'], ['left', '←'], ['right', '→'],
  ['enter', 'Enter'], ['ctrl+c', 'Ctrl+C'], ['ctrl+r', 'Ctrl+R'], ['pageup', 'PgUp'], ['pagedown', 'PgDn'], [':text', ':'], ['/text', '/'], ['ctrl+x', 'Ctrl+X'],
];
const MOD_LABEL = { ctrl: 'Ctrl', alt: 'Alt' };

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
    keysBox.innerHTML = list
      .map(([k, label]) =>
        k.startsWith('mod:')
          ? `<button type="button" class="key mod" data-key="${esc(k)}" aria-pressed="false">${esc(label)}</button>`
          : `<button type="button" class="key" data-key="${esc(k)}" aria-label="${esc(label)} 키 보내기">${esc(label)}</button>`,
      )
      .join('');
    keysBox.scrollLeft = 0;
    drawMods();
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
    if (k.startsWith('mod:')) return tapMod(k.slice(4));
    if (detail.raw) return rawPress(k.endsWith('text') ? { text: k.slice(0, -4) } : { key: k });
    followTerm();
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
    detail.mods = {};
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
    followTerm();
    if (await act(hp(`/panes/${encodeURIComponent(detail.pane)}/input`), { text: input.value })) {
      input.value = '';
      setTimeout(loadTerminal, 400);
    }
  };
  // Raw mode: typed characters go as text, editing keys as keys; the field stays empty.
  // A Korean (IME) syllable goes once it is composed. Everything passes the sticky Ctrl/Alt
  // (rawPress). A word deleted at once (Alt+Backspace, the keyboard's word delete) is Ctrl+W.
  input.addEventListener('beforeinput', (e) => {
    if (!detail.raw || e.isComposing || e.inputType === 'insertCompositionText') return;
    e.preventDefault();
    const t = e.inputType;
    if (t === 'insertText' || t === 'insertReplacementText' || t === 'insertFromPaste') {
      const text = (e.data != null ? e.data : e.dataTransfer ? e.dataTransfer.getData('text/plain') : '') || '';
      if (composedEcho(text)) return;
      const clean = text.replace(/[\x00-\x1f\x7f]+/g, ' ');
      if (clean) rawPress({ text: clean });
    } else if (t === 'insertLineBreak' || t === 'insertParagraph') rawPress({ key: 'enter' });
    else if (t === 'deleteWordBackward') rawPress({ key: 'ctrl+w' });
    else if (t.startsWith('deleteContentBackward')) rawPress({ key: 'backspace' });
    else if (t === 'deleteContentForward') rawPress({ key: 'delete' });
  });
  // A keyboard that composes Latin letters too (Gboard holds a word until space) would keep
  // Ctrl + d back until the word ends: with Ctrl or Alt on, the first composed letter goes at
  // once as the chord and the field is emptied. The keyboard then commits that letter (as the
  // composition's end, or as typed text): that echo is dropped.
  let composedChord = null; // { text, at }
  const composedEcho = (text) => {
    const c = composedChord;
    composedChord = null;
    return Boolean(c && c.text === text && Date.now() - c.at < 1500);
  };
  input.addEventListener('input', (e) => {
    if (!detail.raw || !e.isComposing || !modsOn()) return;
    const v = input.value;
    if (Keys.withMods({ text: v }, modsHeld()).key) {
      input.value = '';
      rawPress({ text: v });
      composedChord = { text: v, at: Date.now() };
    }
  });
  input.addEventListener('compositionend', (e) => {
    if (!detail.raw) return;
    if (e.data && !composedEcho(e.data)) rawPress({ text: e.data });
    setTimeout(() => (input.value = ''), 0);
  });
  // A key the keymap gives the Hub here (a binding with shell, keymap.js) is left to app.js;
  // 뒤로's keys are the shell's Esc; every other key goes to the shell as rawKeyName names it.
  input.addEventListener('keydown', (e) => {
    if (!detail.raw || e.isComposing || e.keyCode === 229) return;
    const k = shellKeyName(e);
    if (!k) return;
    e.preventDefault();
    rawPress({ key: k });
  });
  document.getElementById('t-more').onclick = () => paneMenu('term', currentTerminal()); // actions.js
  mountScreen(document.getElementById('t-body'), 'term', document.getElementById('s-tools'));
  document.getElementById('t-body').addEventListener('scroll', termScrolled);
  renderTerminalHeader();
  // With a hardware keyboard (a tablet's cover, a laptop) typing goes to the shell at once,
  // here and after Alt+↑/↓; a phone's keyboard stays down until the screen is tapped.
  if (keyboardLikely()) input.focus({ preventScroll: true });
}

// ---- hardware keyboard

// A key pressed with nothing to type into, or a chord or Esc, came from a real keyboard (a
// soft keyboard only types into a field and has none of these).
let hardKeys = false;
// Chrome on a big tablet asks for desktop sites by default and then says "Linux", not Android:
// Linux with a touch screen is taken for Android too.
const ANDROID = /Android/i.test(navigator.userAgent) || (/Linux/i.test(navigator.userAgent) && navigator.maxTouchPoints > 0);
const keyboardLikely = () => hardKeys || matchMedia('(pointer: fine)').matches;
document.addEventListener(
  'keydown',
  (e) => {
    if (hardKeys || e.keyCode === 229 || e.key === 'Unidentified' || e.isComposing) return;
    // On Android a soft keyboard's letters come as keyCode 229 (skipped above); a cover's don't.
    if (!editable(e.target) || e.ctrlKey || e.metaKey || e.altKey || e.key === 'Escape' || /^F\d/.test(e.key) || (ANDROID && e.key.length === 1)) hardKeys = true;
  },
  true,
);

// What a key pressed in the shell view's 키 직접 입력 sends to the shell: nothing when the keymap
// gives it to the Hub, Esc for 뒤로's keys (the shell's Esc), else its rawKeyName (null: typed
// text, which beforeinput sends, or a key the shell never gets).
const shellKeyName = (e) => Keymap.shellKey(e, keyContext()); // app.js

// The shell view, a key pressed while the focus is on the page (before the screen was tapped,
// or after ⌨ put the keyboard away): it goes to the shell, and its field takes the focus for
// the next ones. Esc, [ ] and / here are the shell's, never 뒤로 or the list; the way out is
// ‹ (✕), or a key the keymap gives the Hub in the shell view (Alt+↑/↓ in the split layout),
// which is left to app.js. The header's own controls keep their keys.
// Returns true when the key was taken.
function termStrayKey(e) {
  if (view.name !== 'term' || e.isComposing || e.keyCode === 229 || topLayer()) return false;
  const input = document.getElementById('t-input');
  const a = document.activeElement;
  if (!input || a === input) return false;
  // The page: nothing, the screen, the key row, or (split) a row of the list that was tapped to
  // open this shell. A link or button keeps Enter, Space and Tab; the header keeps every key.
  const control = a && a.closest && a.closest('a, button');
  const onPage = !a || a === document.body || a === document.documentElement || (!editable(a) && !a.closest('.bar') && (detailRoot().contains(a) || (split && listRoot().contains(a))));
  if (!onPage || (control && ['Enter', ' ', 'Tab'].includes(e.key))) return false;
  if (detail.raw) {
    const b = Keymap.match(e, keyContext()); // app.js
    if (b && !Keymap.ACTIONS[b.action].shellEsc) return false; // the Hub's
    const k = shellKeyName(e);
    const text = !b && !k && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1 ? e.key : null;
    if (!k && text == null) return false;
    input.focus({ preventScroll: true });
    rawPress(k ? { key: k } : { text });
    return true;
  }
  // 한 줄 입력: a typed character starts the line; Esc only puts the caret there.
  if (e.ctrlKey || e.metaKey || e.altKey || (e.key !== 'Escape' && e.key.length !== 1)) return false;
  input.focus({ preventScroll: true });
  if (e.key.length === 1) input.value += e.key;
  return true;
}

// ---- sticky Ctrl and Alt (the key row)

// detail.mods: { ctrl, alt }, each { state: 'off' | 'once' | 'lock', at } (keys.js tapMod). A
// tap holds the modifier for the next key, a double tap until it is tapped again.
const modOn = (m) => Boolean(m && m.state !== 'off');
const modsHeld = () => ({ ctrl: modOn((detail.mods || {}).ctrl), alt: modOn((detail.mods || {}).alt) });
const modsOn = () => detail.raw && (modsHeld().ctrl || modsHeld().alt);
function tapMod(name) {
  detail.mods = { ...(detail.mods || {}), [name]: Keys.tapMod((detail.mods || {})[name], Date.now()) };
  drawMods();
}
function drawMods() {
  for (const b of document.querySelectorAll('#t-keys .key.mod')) {
    const name = b.dataset.key.slice(4);
    const m = (detail.mods || {})[name];
    const lock = Boolean(m && m.state === 'lock');
    b.setAttribute('aria-pressed', String(modOn(m)));
    b.classList.toggle('lock', lock);
    b.setAttribute('aria-label', `${MOD_LABEL[name]} ${lock ? '고정됨 (누르면 풀림)' : modOn(m) ? '켜짐: 다음 키와 함께' : '(한 번 누르면 다음 키, 두 번이면 고정)'}`);
  }
}
// A raw-mode press with the sticky modifiers applied; a one-shot modifier is used up by it.
function rawPress(press) {
  const out = Keys.withMods(press, modsHeld());
  const m = detail.mods || {};
  let used = false;
  for (const name of ['ctrl', 'alt'])
    if (m[name] && m[name].state === 'once') {
      m[name] = { state: 'off', at: 0 };
      used = true;
    }
  if (used) drawMods();
  rawSend(out);
}

// Typing brings the prompt back: a key or a command while scrolled up to read earlier output
// follows the end of the screen again.
function followTerm() {
  if (!scr || scr.kind !== 'term' || scr.follow) return;
  scr.follow = true;
  flushScreen(true);
  scr.body.scrollTop = scr.body.scrollHeight;
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
// Each queued item carries the pane it was typed for (keys.js queueRaw): keys still waiting when
// the view moves to another shell go to the one they were typed in, never to the new one.
const rawQ = [];
let rawBusy = false;
let rawLoadTimer = null;
const termHere = (host, pane) => view.name === 'term' && detail.pane === pane && curHost() === host;
function rawSend(press) {
  followTerm();
  Keys.queueRaw(rawQ, { host: curHost(), pane: detail.pane }, press);
  pumpRaw();
}
async function pumpRaw() {
  if (rawBusy) return;
  rawBusy = true;
  try {
    while (rawQ.length) {
      const it = rawQ.shift();
      const { host, pane } = it;
      // The reply carries the screen (the echo) when this is the last item for the pane on
      // screen; a read follows a moment later for slower output.
      const echo = termHere(host, pane) && !rawQ.some((x) => x.host === host && x.pane === pane);
      const n = ++termReads;
      try {
        const r = await api(hp(`/panes/${encodeURIComponent(pane)}/keys`, host), { method: 'POST', body: JSON.stringify({ text: it.text, keys: it.keys, ...(echo ? { echo: { format: getColor() ? 'ansi' : 'text', lines: termLines() } } : {}) }) });
        if (!termHere(host, pane)) continue;
        detail.keyAt = Date.now();
        if (r && r.screen) drawTerminal(r.screen, n);
        clearTimeout(rawLoadTimer);
        rawLoadTimer = setTimeout(loadTerminal, RAW_FOLLOW_MS);
      } catch (err) {
        // What was typed after a failed key would land out of order: drop the rest for that pane.
        for (let i = rawQ.length - 1; i >= 0; i--) if (rawQ[i].host === host && rawQ[i].pane === pane) rawQ.splice(i, 1);
        toastErr(`키를 보내지 못했습니다: ${errText(err)}`);
      }
    }
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
// Scrollback: 200 lines while the box follows the prompt (a read every 300 ms while typing
// stays small: a colourful 200 is about 60 KB), the server's most (400) once the box is
// scrolled near its top; back to 200 when it follows again.
const TERM_LINES = 200;
const TERM_LINES_DEEP = 400;
const DEEP_PX = 600; // this near the top asks for the longer scrollback
const termLines = () => (detail.deep ? TERM_LINES_DEEP : TERM_LINES);
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
  const deep = Boolean(detail.deep);
  const n = ++termReads;
  detail.loadAt = Date.now();
  let screen;
  try {
    screen = await api(hp(`/panes/${encodeURIComponent(pane)}/screen?source=recent_unwrapped&lines=${deep ? TERM_LINES_DEEP : TERM_LINES}${colorQuery()}`));
  } catch (err) {
    if (n === termReads && scr && scr.kind === 'term' && !['pane_not_found', 'peer_offline'].includes(err.code)) screenError(`불러오지 못했습니다: ${errText(err)}`);
    return;
  }
  if (detail.pane === pane) drawTerminal(screen, n, deep);
}
function drawTerminal(screen, n, deep) {
  if (n < (detail.drawn || 0)) return; // an older read finished after a newer one
  detail.drawn = n;
  detail.screen = screen;
  if (!scr || scr.kind !== 'term') return;
  // The first longer read while scrolled up: its earlier lines go on above what is being read.
  if (deep && detail.deep && !detail.deepShown && !scr.follow) {
    detail.deepShown = true;
    return prependScreenText(screen.text, screen.format);
  }
  setScreenText(screen.text, screen.format);
}
// Scrolled near the top of a full box: read the longer scrollback; following again: the short one.
function termScrolled() {
  if (!scr || scr.kind !== 'term') return;
  if (scr.follow) detail.deep = detail.deepShown = false;
  else if (!detail.deep && scr.body.scrollTop < DEEP_PX && detail.screen && detail.screen.text.split('\n').length >= TERM_LINES - 1) {
    detail.deep = true;
    loadTerminal();
  }
}

