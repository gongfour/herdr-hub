'use strict';
// The shell (terminal) view: 키 직접 입력 and 한 줄 입력, the key row, polling the screen.

// ------------------------------------------------------------ terminal view

// The key row: 한 줄 입력's keys, and 키 직접 입력's. [key, label, spoken name] (the name a screen
// reader says: VoiceOver skips some signs or reads them its own way).
// 한 줄 입력 keeps Esc, Tab and ↑ where 키 직접 입력 has them; Ctrl+C, which stops the running
// program without asking, goes last, away from the thumb's first key.
const TERM_KEYS = [['esc', 'Esc'], ['tab', 'Tab'], ['up', '↑', '위 화살표'], ['down', '↓', '아래 화살표'], ['enter', 'Enter'], ['ctrl+c', 'Ctrl+C']];
// 키 직접 입력 (raw), the shell view's default: every key goes to the pane as it is pressed,
// so the shell's own completion, history and suggestions work, as do full-screen programs
// (helix, vim, less). What the phone's keyboard lacks comes first, so a 390px row shows it
// without scrolling: Esc, the sticky Ctrl and Alt, Tab and the arrows. A ":text" entry types
// that text, "mod:" ones are the sticky modifiers; the rest are herdr key names.
const RAW_TERM_KEYS = [
  ['esc', 'Esc'], ['mod:ctrl', 'Ctrl'], ['mod:alt', 'Alt'], ['tab', 'Tab'], ['up', '↑', '위 화살표'], ['down', '↓', '아래 화살표'], ['left', '←', '왼쪽 화살표'], ['right', '→', '오른쪽 화살표'],
  ['enter', 'Enter'], ['ctrl+c', 'Ctrl+C'], ['ctrl+r', 'Ctrl+R'], ['pageup', 'PgUp', 'Page Up'], ['pagedown', 'PgDn', 'Page Down'], [':text', ':', '쌍점'], ['/text', '/', '빗금'], ['ctrl+x', 'Ctrl+X'],
];
const MOD_LABEL = { ctrl: 'Ctrl', alt: 'Alt' };
const LOCK_ICON = '<svg class="lk" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

// Shell titles are often the executable's full path; the program name says enough. Never empty
// (rowtext.js: the folder, then the pane id).
const termTitle = (t) => RowText.termName(t);
const currentTerminal = () => (state.terminals || []).find((t) => same(t, curHost(), detail.pane));

function renderTerminal() {
  detailRoot().innerHTML = `
    <div class="detail">
      <header class="bar">
        ${backLink(homeHash())}
        <h1 id="t-title"></h1>
        <span id="t-live"></span>
        <button class="icon-btn" id="t-more" aria-label="더 보기" aria-haspopup="dialog"${keyAttrs('menu', '더 보기')}>${ICON.more}</button>
      </header>
      <div class="screen-tools" id="s-tools" hidden></div>
      <div class="term-gone" id="t-gone" hidden></div>
      <div class="scroll" id="t-body" role="region" aria-label="셸 화면"></div>
      <div class="term-bar">
        <div class="raw-chip" id="t-sending" hidden></div>
        <p class="term-state" id="t-state"></p>
        <div class="keys term-keys" id="t-keys"></div>
        <div class="term-side">
          <button type="button" class="key fold" id="t-fold" aria-expanded="true" aria-controls="t-keys" hidden>키 줄</button>
          <button type="button" class="key" id="t-kbd" aria-pressed="false" aria-label="키보드 올리기" title="키보드 올리기">${ICON.keyboard}</button>
        </div>
      </div>
      <form class="composer" id="t-form">
        <input class="cmd" id="t-input" aria-label="셸 명령" placeholder="명령 (Enter 로 실행)" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send">
        <button type="submit" class="send" id="t-send" aria-label="실행">${ICON.send}</button>
      </form>
    </div>`;
  const input = document.getElementById('t-input');
  const keysBox = document.getElementById('t-keys');
  const drawKeys = () => {
    const list = detail.raw ? RAW_TERM_KEYS : TERM_KEYS;
    keysBox.innerHTML = list
      .map(([k, label, spoken]) =>
        k.startsWith('mod:')
          ? `<button type="button" class="key mod" data-key="${esc(k)}" aria-pressed="false">${esc(label)}</button>`
          : `<button type="button" class="key" data-key="${esc(k)}" aria-label="${esc(spoken || label)} 키 보내기">${esc(label)}</button>`,
      )
      .join('');
    keysBox.scrollLeft = 0;
    drawMods();
    keysFade();
  };
  // The row fades at its right edge only while more keys wait past it.
  const keysFade = () => keysBox.classList.toggle('more', keysBox.scrollWidth - keysBox.scrollLeft - keysBox.clientWidth > 2);
  keysBox.addEventListener('scroll', keysFade, { passive: true });
  if (window.ResizeObserver) new ResizeObserver(keysFade).observe(keysBox);
  // A mouse wheel turns the row sideways (it has no other way to reach the keys past its edge).
  keysBox.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY) || keysBox.scrollWidth <= keysBox.clientWidth) return;
      e.preventDefault();
      keysBox.scrollLeft += e.deltaY;
    },
    { passive: false },
  );
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
    if (!currentTerminal()) return;
    if (detail.raw) return rawPress(k.endsWith('text') ? { text: k.slice(0, -4) } : { key: k });
    followTerm();
    if (await act(hp(`/panes/${encodeURIComponent(detail.pane)}/keys`), { keys: [k], text: input.value }, null, '키를 보내지 못했습니다')) {
      input.value = '';
      setTimeout(loadTerminal, 300);
    }
  };
  // 설정 → 셸 입력 picks the mode. 키 직접 입력 has no visible command line, like a terminal
  // app: a tap on the screen (or ⌨) brings up the keyboard and the hidden field passes each key
  // on. 한 줄 입력 shows the line, run with Enter.
  const setRaw = (on) => {
    predEnd();
    detail.raw = on;
    detail.mods = {};
    input.value = '';
    input.placeholder = on ? '누르는 키가 바로 갑니다' : '명령 (리턴으로 실행 · Tab 은 셸의 완성)';
    input.setAttribute('aria-label', on ? '셸에 키 입력' : '셸 명령');
    input.setAttribute('enterkeyhint', on ? 'enter' : 'send');
    document.getElementById('t-send').hidden = on;
    detailRoot().querySelector('.detail').classList.toggle('raw', on);
    drawKeys();
    drawKeyRow();
  };
  setRaw(getShellInput() === 'raw');
  detail.setRaw = (on) => {
    if (on === detail.raw) return;
    const typing = document.activeElement === input;
    setRaw(on);
    drawSending();
    if (typing) input.focus({ preventScroll: true });
  };
  const kbd = document.getElementById('t-kbd');
  const toggleKbd = () => (document.activeElement === input ? input.blur() : input.focus());
  keepFocusTap(kbd, toggleKbd);
  kbd.onclick = toggleKbd;
  const showKbd = () => {
    const up = document.activeElement === input;
    kbd.innerHTML = up ? ICON.keyboardOff : ICON.keyboard;
    kbd.setAttribute('aria-pressed', String(up));
    kbd.setAttribute('aria-label', up ? '키보드 내리기' : '키보드 올리기');
    kbd.title = up ? '키보드 내리기' : '키보드 올리기';
  };
  // 키 줄 접기·펴기 (two columns or a mouse): the choice lasts while the app is open.
  document.getElementById('t-fold').onclick = () => {
    keyRowPick = keyRowFolded() ? 'open' : 'folded';
    drawKeyRow();
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
    if (detail.raw || !currentTerminal()) return;
    followTerm();
    if (await act(hp(`/panes/${encodeURIComponent(detail.pane)}/input`), { text: input.value }, null, '셸에 보내지 못했습니다')) {
      input.value = '';
      setTimeout(loadTerminal, 400);
    }
  };
  // 한 줄 입력: Tab in the line hands what is typed to the shell with its Tab (the key row's Tab
  // does the same), so the shell completes it; Shift+Tab still moves the focus back.
  input.addEventListener('keydown', (e) => {
    if (detail.raw || e.isComposing || e.keyCode === 229 || e.key !== 'Tab' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    const tab = keysBox.querySelector('[data-key="tab"]');
    if (!tab || !currentTerminal()) return;
    e.preventDefault();
    pressKey(tab);
  });
  // 한 줄 입력: Ctrl+W deletes the word before the caret, as the shell's own does; in the
  // installed app the key would otherwise close the window (a tab's browser keeps it anyway).
  // A key the keymap gives the Hub here stays the Hub's.
  input.addEventListener('keydown', (e) => {
    if (detail.raw || e.isComposing || e.keyCode === 229 || !Keymap.matches(e, 'Ctrl+w') || Keymap.match(e, keyContext())) return;
    e.preventDefault();
    const at = input.selectionStart;
    const end = input.selectionEnd;
    const from = at !== end ? at : input.value.slice(0, at).replace(/\S*\s*$/, '').length;
    input.setRangeText('', from, end, 'end');
  });
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
    if (!k) {
      // A Mac keyboard: a letter goes from its keydown, not beforeinput. Held down in a text
      // field, macOS opens its accent picker (ð ď) instead of repeating; a keydown the page takes
      // never reaches the text system, so the key repeats as in a terminal. Not a touch device
      // (its keyboard composes), not with ⌥ (it types ∫ and its dead keys as text) or a dead key.
      if (HOLD_REPEATS && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        rawPress({ text: e.key });
      }
      return;
    }
    e.preventDefault();
    rawPress({ key: k });
  });
  // After ⋯ (a tap or a click), the keys typed next go to the shell again, not to ⋯.
  document.getElementById('t-more').onclick = async () => {
    await paneMenu('term', currentTerminal()); // actions.js
    if (view.name !== 'term' || topLayer() || !detail.raw || !document.getElementById('t-input')) return;
    const a = document.activeElement;
    if (!a || a === document.body || a.id === 't-more') typeHere();
  };
  mountScreen(document.getElementById('t-body'), 'term', document.getElementById('s-tools'));
  scr.overlay = { clear: predClear, draw: predDraw };
  document.getElementById('t-body').addEventListener('scroll', termScrolled);
  document.getElementById('t-sending').onclick = () => {
    rawFailed = null;
    drawSending();
  };
  renderTerminalHeader();
  drawSending();
  drawKeyRow();
  // With a hardware keyboard (a tablet's cover, a laptop) typing goes to the shell at once,
  // here and after Alt+↑/↓; a phone's keyboard stays down until the screen is tapped.
  if (keyboardLikely()) input.focus({ preventScroll: true });
  drawTyping();
}

// The caret into the shell's field (keys go to the shell from there).
function typeHere() {
  const input = document.getElementById('t-input');
  if (input && !input.disabled) input.focus({ preventScroll: true });
}

// ---- the key row folded (two columns with a keyboard)

// A laptop or a tablet's cover types every key the row has, so in the two-column layout the row
// starts folded to one line saying where typed keys go; 키 줄 opens it. A finger on the screen
// (the tablet without its cover) opens it again, unless 키 줄 was used. The fold button shows in
// two columns and wherever there is a mouse.
let keyRowPick = null; // 'open' | 'folded': 키 줄 was pressed
let touchSeen = false;
const keyRowFolded = () => Boolean(detail.raw && split && (keyRowPick ? keyRowPick === 'folded' : keyboardLikely() && !touchSeen));
function drawKeyRow() {
  const d = detailRoot().querySelector('.detail');
  const fold = document.getElementById('t-fold');
  if (!d || !fold) return;
  const folded = keyRowFolded();
  d.classList.toggle('keys-folded', folded);
  fold.hidden = !detail.raw || !(split || matchMedia('(hover: hover) and (pointer: fine)').matches);
  fold.setAttribute('aria-expanded', String(!folded));
  fold.textContent = folded ? '키 줄 ▴' : '키 줄 ▾';
  fold.title = folded ? '키 줄 펴기 (Esc·Ctrl·Tab·화살표…)' : '키 줄 접기';
  fold.setAttribute('aria-label', folded ? '키 줄 펴기' : '키 줄 접기');
}
addEventListener(
  'pointerdown',
  (e) => {
    if (e.pointerType !== 'touch' || touchSeen) return;
    touchSeen = true;
    if (view.name === 'term') drawKeyRow();
  },
  true,
);

// Where typed keys go now, said on the folded row (and as .typing for the screen's edge): to the
// shell while the focus is in its field or on the page (termStrayKey), else nowhere until the
// screen is clicked.
function keysReachShell() {
  const input = document.getElementById('t-input');
  if (!input || input.disabled || topLayer()) return false;
  const a = document.activeElement;
  return a === input || termPageFocus(a);
}
function drawTyping() {
  const d = detailRoot().querySelector('.detail');
  const st = document.getElementById('t-state');
  if (view.name !== 'term' || !d || !st) return;
  const on = Boolean(detail.raw && keysReachShell());
  d.classList.toggle('typing', on);
  st.classList.toggle('on', on);
  st.textContent = on ? '치는 키가 셸로 갑니다' : '셸 화면을 누르면 키가 셸로 갑니다';
}
for (const ev of ['focusin', 'focusout']) addEventListener(ev, () => view.name === 'term' && setTimeout(drawTyping, 0));

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
    if (!editable(e.target) || e.ctrlKey || e.metaKey || e.altKey || e.key === 'Escape' || /^F\d/.test(e.key) || (ANDROID && e.key.length === 1)) {
      hardKeys = true;
      if (view.name === 'term') drawKeyRow();
    }
  },
  true,
);

// What a key pressed in the shell view's 키 직접 입력 sends to the shell: nothing when the keymap
// gives it to the Hub, Esc for 뒤로's keys (the shell's Esc), else its rawKeyName (null: typed
// text, which beforeinput sends, or a key the shell never gets).
const shellKeyName = (e) => Keymap.shellKey(e, keyContext()); // app.js
// A Mac with a keyboard and no touch screen, where holding a letter would open the accent picker.
const HOLD_REPEATS = KEY_MAC && !navigator.maxTouchPoints; // core.js

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
  const control = a && a.closest && a.closest('a, button');
  if (!termPageFocus(a) || (control && ['Enter', ' ', 'Tab'].includes(e.key))) return false;
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
  // 한 줄 입력: a typed character starts the line. Esc (and Ctrl+[) are 뒤로 as anywhere: once
  // out of the line, twice back, as in the chat.
  if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return false;
  input.focus({ preventScroll: true });
  input.value += e.key;
  return true;
}
// Whether the focus is on the shell view's page, where a key pressed goes to the shell: nothing,
// the screen, the key row, the header's buttons (they keep Enter, Space and Tab), or (split) a
// row of the list that was tapped to open this shell.
function termPageFocus(a) {
  if (!a || a === document.body || a === document.documentElement) return true;
  return !editable(a) && (detailRoot().contains(a) || (split && listRoot().contains(a)));
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
    // Locked shows a padlock, so it reads apart from 한 번 (filled only) at a phone's distance.
    b.innerHTML = `${esc(MOD_LABEL[name])}${lock ? LOCK_ICON : ''}`;
    b.setAttribute('aria-label', lock ? `${MOD_LABEL[name]} 고정됨, 누르면 풀림` : modOn(m) ? `${MOD_LABEL[name]} 켜짐, 다음 키에 붙음` : `${MOD_LABEL[name]}, 한 번 누르면 다음 키에만, 두 번 누르면 고정`);
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
  if (!scr || scr.kind !== 'term') return;
  if (scr.pre.scrollLeft) scr.pre.scrollLeft = 0; // unwrapped and pushed sideways: back to the prompt
  if (scr.follow) return;
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
  const offline = !t && !online(curHost());
  // Opened before the first state (the app just started): not known yet, so not 「닫힘」 either.
  if (t) detail.lastTerm = t;
  const more = document.getElementById('t-more');
  if (more) more.hidden = !t; // nothing to do with a shell that is gone
  if (!t && !stateIn) {
    title.innerHTML = '<span class="t">셸</span><span class="sub">불러오는 중…</span>';
    return;
  }
  title.innerHTML = t
    ? `<span class="t">${esc(termTitle(t))}</span><span class="sub"${t.cwd ? ` title="${esc(t.cwd)}"` : ''}>${multi() ? `${esc(hostLabel(t.host))} · ` : ''}셸 · ${esc(wsAndDir(t.workspaceLabel, t.cwd))}</span>`
    : offline
      ? `<span class="t">${esc(hostLabel(curHost()))} 오프라인</span><span class="sub">호스트가 돌아오면 다시 보입니다</span>`
      : detail.lastTerm
        ? `<span class="t">${esc(termTitle(detail.lastTerm))}</span><span class="sub">닫힘 · ${esc(wsAndDir(detail.lastTerm.workspaceLabel, detail.lastTerm.cwd))}</span>`
        : '<span class="t">셸 없음</span><span class="sub">닫혔거나 없는 셸입니다</span>';
  const dot = document.getElementById('t-live');
  if (dot) dot.innerHTML = liveDot();
  termGone(t ? null : offline ? 'offline' : 'closed');
}

let stateIn = false;
ready.then(() => {
  stateIn = true;
  renderTerminalHeader();
});

// A shell that closed (or whose host went away): nothing to type into. The key row and the
// command line go, and the body says so with the way out; a screen already read stays under a
// band saying the same. It comes back by itself when the shell (its host) does.
function termGone(kind) {
  const d = detailRoot().querySelector('.detail');
  const box = document.getElementById('t-gone');
  if (!d || !box) return;
  const was = d.dataset.gone || '';
  if (was === (kind || '')) return;
  d.dataset.gone = kind || '';
  d.classList.toggle('closed', Boolean(kind));
  d.classList.toggle('kept', Boolean(kind) && Boolean(scr && scr.shown != null));
  for (const el of d.querySelectorAll('.term-bar button, #t-form input, #t-form button')) el.disabled = Boolean(kind);
  drawTyping();
  if (!kind) {
    box.hidden = true;
    box.innerHTML = '';
    if (was) loadTerminal();
    return;
  }
  const input = document.getElementById('t-input');
  if (input && document.activeElement === input) input.blur();
  box.hidden = false;
  box.innerHTML =
    kind === 'offline'
      ? `<p class="g-main">${esc(hostLabel(curHost()))}에 닿지 않습니다</p><p class="g-sub">호스트가 돌아오면 이 셸이 다시 보입니다</p>`
      : `<div class="g-text"><p class="g-main">이 셸은 닫혔습니다</p>${d.classList.contains('kept') ? '<p class="g-sub">아래는 닫히기 전의 마지막 화면입니다</p>' : ''}</div>${
          // Two columns: the list is beside it and ✕ closes this side.
          split ? '' : `<a class="btn secondary" href="${esc(homeHash())}">작업공간으로</a>`
        }`;
}

// Raw-mode keys in order: text runs merge, one request at a time, the screen read soon after.
// Each queued item carries the pane it was typed for (keys.js queueRaw): keys still waiting when
// the view moves to another shell go to the one they were typed in, never to the new one.
const rawQ = [];
let rawBusy = false;
let rawLoadTimer = null;
const termHere = (host, pane) => view.name === 'term' && detail.pane === pane && curHost() === host;
function rawSend(press) {
  if (!currentTerminal()) return;
  rawFailed = null;
  followTerm();
  const host = curHost();
  const pane = detail.pane;
  // Keys held from a channel that dropped wait for the next one to resume them: these go after.
  if (liveHeldFor(host, pane)) {
    predEnd();
    liveHeld.later.push({ text: press.text || '', keys: press.key ? [press.key] : [] });
    drawSending();
    return;
  }
  // Over the live channel when it is open and nothing for this shell is still on the HTTP way
  // (which would be overtaken).
  if (liveFeeds(host, pane) && ![rawInFlight, ...rawQ].some((x) => x && x.host === host && x.pane === pane)) {
    const s = liveKey(press);
    liveCh.pred.typed(press, s, performance.now());
    predRender();
    drawSending();
    return;
  }
  predEnd();
  Keys.queueRaw(rawQ, { host, pane }, press);
  drawSending();
  pumpRaw();
}

// 「보내는 중」: herdr gives no cursor position, and a typed key shows only once its echo is
// back. So the keys still on their way to the shell on screen sit in a chip above the key row
// (after SENDING_MS, so a quick echo never flickers it), gone once they have arrived; past
// 350 ms its dots move. Keys that failed stay in it, in the warning colour, until the next key
// or a tap on it.
const SENDING_MS = 150;
let rawInFlight = null; // the item being sent
let rawFailed = null; // { host, pane, text }: what did not get there
let sendingTimer = null;
function drawSending() {
  const chip = document.getElementById('t-sending');
  if (!chip) return;
  const here = (x) => x && termHere(x.host, x.pane);
  if (here(rawFailed)) {
    clearTimeout(sendingTimer);
    sendingTimer = null;
    chip.className = 'raw-chip err';
    chip.setAttribute('role', 'alert');
    chip.innerHTML = `보내지 못한 키: <b>${esc(rawFailed.text)}</b> · ${esc(rawFailed.why)}`;
    chip.hidden = false;
    return;
  }
  const items = [rawInFlight, ...rawQ, ...liveSent(), ...liveHeldItems()].filter(here);
  if (!detail.raw || !items.length) {
    clearTimeout(sendingTimer);
    sendingTimer = null;
    chip.hidden = true;
    return;
  }
  chip.className = 'raw-chip';
  chip.removeAttribute('role');
  chip.innerHTML = `보내는 중: <b>${esc(Keys.describeRaw(items))}</b><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>`;
  if (chip.hidden && !sendingTimer)
    sendingTimer = setTimeout(() => {
      sendingTimer = null;
      const c = document.getElementById('t-sending');
      if (c && [rawInFlight, ...rawQ, ...liveSent(), ...liveHeldItems()].some(here)) c.hidden = false;
    }, SENDING_MS);
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
      rawInFlight = it;
      try {
        const r = await api(hp(`/panes/${encodeURIComponent(pane)}/keys`, host), { method: 'POST', body: JSON.stringify({ text: it.text, keys: it.keys, ...(echo ? { echo: { format: getColor() ? 'ansi' : 'text', lines: termLines() } } : {}) }) });
        if (!termHere(host, pane)) continue;
        detail.keyAt = Date.now();
        if (r && r.screen) drawTerminal(r.screen, n);
        clearTimeout(rawLoadTimer);
        rawLoadTimer = setTimeout(loadTerminal, RAW_FOLLOW_MS);
      } catch (err) {
        // What was typed after a failed key would land out of order: drop the rest for that pane.
        const lost = [it];
        for (let i = rawQ.length - 1; i >= 0; i--) if (rawQ[i].host === host && rawQ[i].pane === pane) lost.splice(1, 0, ...rawQ.splice(i, 1));
        // On this shell's screen the chip says what was lost; elsewhere only the notice can.
        if (termHere(host, pane)) {
          rawFailed = { host, pane, text: Keys.describeRaw(lost), why: errReason(err) };
        } else lostElsewhere(host, pane, errText(err));
      } finally {
        rawInFlight = null;
        drawSending();
      }
    }
  } finally {
    rawBusy = false;
  }
}

// Unwrapped lines, so the phone wraps each real line once instead of re-wrapping lines already
// cut at the pane's width. (The server falls back to recent on a herdr without it.)
// How soon the screen is read again: a little after a key's echo came back (output that takes
// longer), every 300 ms while keys are being typed or the output is still moving (keys.js
// termReadDue), else every second in 키 직접 입력 and every 2.5 s in 한 줄 입력; at once when
// the app comes back to the front.
const RAW_FOLLOW_MS = 250;
// Scrollback: 200 lines while the box follows the prompt (a read every 300 ms while typing
// stays small: a colourful 200 is about 60 KB), the server's most (400) once the box is
// scrolled near its top; back to 200 when it follows again.
const TERM_LINES = 200;
const TERM_LINES_DEEP = 400;
const DEEP_PX = 600; // this near the top asks for the longer scrollback
const termLines = () => (detail.deep ? TERM_LINES_DEEP : TERM_LINES);
const TERM_TICK_MS = 300;
function pollTerminal() {
  if (liveFeeds()) return liveSyncShape();
  if (Keys.termReadDue({ now: Date.now(), raw: detail.raw, keyAt: detail.keyAt, changeAt: detail.changeAt, loadAt: detail.loadAt })) loadTerminal();
}
// A page in the background closes its channel (the host stops reading for it) and opens it
// again when it comes back.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') liveStop();
  else if (view.name === 'term') loadTerminal();
});

let termReads = 0; // reads overlap when keys come fast; only the newest may draw
async function loadTerminal() {
  if (!currentTerminal() || document.visibilityState !== 'visible') return;
  // The channel brings the screen by itself: at most the shape it reads changes.
  if (liveFeeds()) return liveSyncShape();
  liveEnsure();
  const pane = detail.pane;
  const host = curHost();
  const deep = Boolean(detail.deep);
  const n = ++termReads;
  detail.loadAt = Date.now();
  let screen;
  try {
    screen = await api(hp(`/panes/${encodeURIComponent(pane)}/screen?source=recent_unwrapped&lines=${deep ? TERM_LINES_DEEP : TERM_LINES}${colorQuery()}`));
  } catch (err) {
    if (n === termReads && scr && scr.kind === 'term' && !['pane_not_found', 'peer_offline'].includes(err.code)) screenError(errReason(err));
    return;
  }
  // Not onto another host's shell with the same id (herdr's ids repeat across hosts: w1:p1).
  if (termHere(host, pane)) drawTerminal(screen, n, deep);
}
function drawTerminal(screen, n, deep) {
  if (n < (detail.drawn || 0)) return; // an older read finished after a newer one
  detail.drawn = n;
  // Output still moving keeps the reads coming every tick (pollTerminal).
  if (detail.screen && detail.screen.text !== screen.text) detail.changeAt = Date.now();
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


// ------------------------------------------------------------ the live channel
// One WebSocket per open shell view (server.js, lib/live.js; the rules in live.js): typed keys go
// up as they are pressed, each with a sequence number the host applies in order, and the host
// pushes the screen whenever it changed (a line change after the first whole one). The HTTP way
// (POST /keys, GET /screen every 300 ms) stays for hosts without it (API before 2), while the
// channel opens or is down, and for a while after it failed to open or kept dropping.
let liveCh = null; // { ws, host, pane, open, resume, cur, sent, heardAt, shape, gone }
const liveLog = {}; // host → { fails, drops } (live.js ended)
const liveOff = {}; // host → until when it reads over HTTP
let liveRetry = null;
let liveWatch = null;
const liveFeeds = (host = curHost(), pane = detail.pane) => Boolean(liveCh && liveCh.open && liveCh.host === host && liveCh.pane === pane);
const liveShapeNow = () => ({ lines: termLines(), format: getColor() ? 'ansi' : 'text' });
// The keys sent on the channel and not yet with the shell, as the 「보내는 중」 chip lists them.
const liveSent = () => (liveCh ? liveCh.sent.map((x) => ({ host: liveCh.host, pane: liveCh.pane, text: x.text, keys: x.keys })) : []);

// Keys left unacknowledged when a channel dropped or the page hid: the next channel to the shell
// asks the host what got there (resume: this page's id and the last number it sent there) and
// sends again only the rest, in order; keys typed meanwhile wait behind them. Key numbers go on
// rising per shell across channels, so the host can tell them apart. A host that does not
// resume, or no answer within Live.RESUME_WAIT_MS: they show as not sent, as before.
const liveCid = String((self.crypto && crypto.randomUUID && crypto.randomUUID()) || `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
const liveSeqs = new Map(); // host + pane → the last key number sent there
const liveSeqKey = (host, pane) => `${host}\u0000${pane}`;
const liveNextSeq = (host, pane) => {
  const s = (liveSeqs.get(liveSeqKey(host, pane)) || 0) + 1;
  liveSeqs.set(liveSeqKey(host, pane), s);
  return s;
};
let liveHeld = null; // { host, pane, keys: [{ s, text, keys }], later: [{ text, keys }], timer }
const liveHeldFor = (host, pane) => Boolean(liveHeld && liveHeld.host === host && liveHeld.pane === pane);
const liveHeldItems = () => (liveHeld ? [...liveHeld.keys, ...liveHeld.later].map((x) => ({ host: liveHeld.host, pane: liveHeld.pane, text: x.text, keys: x.keys })) : []);
function liveHold(ch) {
  if (!ch.resume || !ch.sent.length) return false;
  if (liveHeld && !liveHeldFor(ch.host, ch.pane)) liveGiveUp('연결이 끊겼습니다');
  if (!liveHeld) liveHeld = { host: ch.host, pane: ch.pane, keys: [], later: [], timer: setTimeout(() => liveGiveUp('연결이 끊겼습니다'), Live.RESUME_WAIT_MS) };
  liveHeld.keys.push(...ch.sent);
  ch.sent = [];
  return true;
}
// No channel to resume them: the held keys may or may not have arrived (the chip says so); the
// ones typed after them never went, so they go the HTTP way now.
function liveGiveUp(why) {
  const h = liveHeld;
  if (!h) return;
  liveHeld = null;
  clearTimeout(h.timer);
  liveLost({ host: h.host, pane: h.pane }, h.keys, why);
  for (const x of h.later) Keys.queueRaw(rawQ, { host: h.host, pane: h.pane }, x.keys.length ? { key: x.keys[0] } : { text: x.text });
  drawSending();
  pumpRaw();
}
// The host said what it applied: the rest again, in order, then what was typed meanwhile.
function liveResumed(ch, applied) {
  const h = liveHeld;
  if (!liveHeldFor(ch.host, ch.pane)) return;
  liveHeld = null;
  clearTimeout(h.timer);
  const r = Live.resumeSplit(h.keys, applied);
  liveLost(ch, r.lost, '연결이 끊겼습니다');
  for (const it of r.resend) liveSendKey(ch, it);
  for (const x of h.later) liveKey(x.keys.length ? { key: x.keys[0] } : { text: x.text });
  drawSending();
}

function liveEnsure() {
  if (view.name !== 'term' || document.visibilityState !== 'visible' || !currentTerminal()) return;
  const host = curHost();
  const pane = detail.pane;
  if (liveCh && liveCh.host === host && liveCh.pane === pane) return; // open, or opening
  if (liveRetry) return;
  if (!Live.usable(hostOf(host), { off: liveOff, now: Date.now(), hasSocket: typeof WebSocket === 'function' })) return;
  liveStop();
  const shape = liveShapeNow();
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api${hp(`/panes/${encodeURIComponent(pane)}/live`, host)}?lines=${shape.lines}&format=${shape.format}`;
  let sock;
  try {
    sock = new WebSocket(url);
  } catch {
    return;
  }
  const ch = { ws: sock, host, pane, open: false, resume: false, cur: null, sent: [], heardAt: Date.now(), shape, gone: false, pred: predictorFor(host, pane) };
  ch.pred.end();
  liveCh = ch;
  sock.onmessage = (e) => liveMessage(ch, e.data);
  sock.onclose = () => liveClosed(ch);
  // A link that died without a close (a phone that slept): the host's heartbeat stops coming.
  clearInterval(liveWatch);
  liveWatch = setInterval(() => {
    if (liveCh !== ch || Date.now() - ch.heardAt < Live.SILENT_MS) return;
    try {
      ch.ws.close();
    } catch {}
    liveClosed(ch);
  }, 5000);
}

function liveStop() {
  clearTimeout(liveRetry);
  liveRetry = null;
  clearInterval(liveWatch);
  const ch = liveCh;
  liveCh = null;
  if (ch) {
    liveHold(ch); // hidden with keys unacknowledged: they resume when it is back
    try {
      ch.ws.close(1000);
    } catch {}
  }
}

function liveSyncShape() {
  const ch = liveCh;
  const want = liveShapeNow();
  if (!ch || (ch.shape.lines === want.lines && ch.shape.format === want.format)) return;
  ch.shape = want;
  ch.ws.send(JSON.stringify({ t: 'shape', ...want }));
}

// A debug aid, off unless set from the console or a test (window.liveTrace = []): each key is
// traced by the host (lib/live tr), and the page notes when it sent, heard and drew.
const liveTracing = () => Array.isArray(window.liveTrace) && window.liveTrace.length < 5000;
function liveKey(press) {
  const ch = liveCh;
  const s = liveNextSeq(ch.host, ch.pane);
  liveSendKey(ch, { s, text: press.text || '', keys: press.key ? [press.key] : [] });
  return s;
}
function liveSendKey(ch, it) {
  ch.sent.push(it);
  const tr = liveTracing();
  if (tr) window.liveTrace.push({ e: 'k', s: it.s, t: performance.now(), x: it.text });
  ch.ws.send(JSON.stringify({ t: 'k', s: it.s, x: it.text, y: it.keys, ...(tr ? { tr: 1 } : {}) }));
}

// Keys that did not reach the shell (a failure, or the channel dropped before they were
// acknowledged: they may or may not have arrived) stay in the chip, as on the HTTP way.
function liveLost(ch, lost, why) {
  if (!lost || !lost.length) return;
  if (!termHere(ch.host, ch.pane)) return lostElsewhere(ch.host, ch.pane, why);
  rawFailed = { host: ch.host, pane: ch.pane, text: Keys.describeRaw(lost), why };
}
// Keys lost on a shell no longer on screen: only a notice can say so, naming that shell.
function lostElsewhere(host, pane, why) {
  const t = (state.terminals || []).find((x) => same(x, host, pane));
  toastErr(`「${t ? termTitle(t) : pane}」 셸에 키를 보내지 못했습니다: ${why}`);
}

function liveMessage(ch, data) {
  if (ch !== liveCh) return;
  let m;
  try {
    m = JSON.parse(data);
  } catch {
    return;
  }
  ch.heardAt = Date.now();
  const tr = liveTracing() && { e: m.t, t: performance.now() };
  if (tr) {
    if (m.t === 'ack') tr.s = m.s;
    if (m.t === 'tr') tr.m = m;
    window.liveTrace.push(tr);
  }
  if (m.t === 'hello') {
    ch.open = true;
    ch.resume = Boolean(m.resume);
    liveLog[ch.host] = { ...(liveLog[ch.host] || {}), fails: 0 };
    if (ch.resume) ch.ws.send(JSON.stringify({ t: 'resume', c: liveCid, s: liveSeqs.get(liveSeqKey(ch.host, ch.pane)) || 0 }));
    else if (liveHeldFor(ch.host, ch.pane)) liveGiveUp('연결이 끊겼습니다');
    return drawSending();
  }
  if (m.t === 'resumed') {
    liveResumed(ch, Number.isInteger(m.s) ? m.s : null);
    return;
  }
  if (m.t === 'ack') {
    ch.pred.acked(m.s, performance.now());
    ch.sent = Live.acked(ch.sent, m.s);
    detail.keyAt = Date.now();
    return drawSending();
  }
  if (m.t === 'kerr') {
    const r = Live.failed(ch.sent, m.from, m.to);
    ch.sent = r.left;
    liveLost(ch, r.lost, shortReason(m.message || m.error || ''));
    return drawSending();
  }
  if (m.t === 'err') {
    if (termHere(ch.host, ch.pane)) screenError(shortReason(m.message || m.error || ''));
    return;
  }
  if (m.t === 'gone') {
    ch.gone = true;
    return;
  }
  const f = Live.screenFrame(ch.cur, m, ScreenDiff);
  if (!f) return;
  if (f.full) {
    ch.cur = null;
    return ch.ws.send(JSON.stringify({ t: 'full' }));
  }
  ch.cur = f;
  // A whole screen read with the longer scrollback is the one that goes on above (drawTerminal).
  if (!termHere(ch.host, ch.pane)) return;
  ch.pred.screen(f.lines, performance.now()); // the screen confirms or drops what was predicted
  drawTerminal(f.screen, ++termReads, m.t === 'f' && ch.shape.lines === TERM_LINES_DEEP);
  predRender();
  if (tr) {
    tr.drawn = performance.now();
    requestAnimationFrame(() => (tr.frame = performance.now()));
  }
}

function liveClosed(ch) {
  if (ch !== liveCh) return; // stopped on purpose, or replaced
  liveCh = null;
  clearInterval(liveWatch);
  ch.pred.end();
  predRender();
  if (ch.gone || !liveHold(ch)) liveLost(ch, ch.sent, '연결이 끊겼습니다');
  drawSending();
  if (ch.gone) return liveHeldFor(ch.host, ch.pane) && liveGiveUp('셸이 닫혔습니다'); // the shell closed: its state says so
  const r = Live.ended(liveLog[ch.host] || {}, { opened: ch.open, now: Date.now() });
  liveLog[ch.host] = r.log;
  if (r.off) {
    if (liveHeldFor(ch.host, ch.pane)) liveGiveUp('연결이 끊겼습니다');
    liveOff[ch.host] = Date.now() + Live.OFF_MS;
    console.warn(`[live] ${ch.host}: the channel ${ch.open ? 'keeps dropping' : 'does not open'}; reading over HTTP for now`);
  } else
    liveRetry = setTimeout(() => {
      liveRetry = null;
      if (view.name === 'term') loadTerminal();
    }, r.delay);
  // HTTP in the meantime.
  if (view.name === 'term') loadTerminal();
}


// ------------------------------------------------------------ 셸 예측 입력 (predict.js)
// What is typed at the prompt is drawn at the caret before the host's echo, over the line the
// host drew (one line element of the screen box, screen.js); the host's next screen confirms or
// drops it. Only over the live channel, in 키 직접 입력, with the box following the prompt and
// not held (a selection, a finger on it). 설정 → 입력 → 셸 예측 입력: 자동 (a round trip above
// 30 ms) / 켜기 / 끄기.
const predictors = new Map(); // host + pane → Predict (its round trip lasts across channels)
function predictorFor(host, pane) {
  const k = liveSeqKey(host, pane);
  let p = predictors.get(k);
  if (!p) {
    if (predictors.size > 16) predictors.delete(predictors.keys().next().value);
    predictors.set(k, (p = Predict.create({ strip: (l) => Ansi.strip(l) })));
  }
  return p;
}
let predDrawn = null; // { el, html, flag }: the line drawn over and what the host had there
let predTimer = null;
function predEnd() {
  if (liveCh) liveCh.pred.end();
  predRender();
}
function predClear() {
  const d = predDrawn;
  predDrawn = null;
  if (!d || !d.el.isConnected) return;
  d.el.innerHTML = d.html;
  d.el._bg = null;
}
function predDraw() {
  const s = scr;
  const ch = liveCh;
  if (!s || s.kind !== 'term' || !ch || !detail.raw || !termHere(ch.host, ch.pane)) return;
  if (s.pending != null || !s.follow || !ch.pred.show(Prefs.get('shellPredict'))) return;
  const v = ch.pred.view(performance.now());
  const el = v && s.pre.children[v.row];
  if (!el) return;
  predDrawn = { el, html: el.innerHTML, flag: v.flag };
  overLine(el, v);
}
// Draw a view over a line element (its text ends in a newline): keep `keep` characters, then the
// predicted text (blanks first if the line is shorter), `skip` of the line's characters gone.
// The prediction joins the run before it, so it takes the colour of what was typed before.
function overLine(el, v) {
  const at = (off) => {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let left = off;
    for (let n; (n = w.nextNode()); ) {
      if (left <= n.data.length) return [n, left];
      left -= n.data.length;
    }
    return [el, el.childNodes.length];
  };
  const len = el.textContent.length - 1;
  const from = Math.min(v.keep, len);
  const to = Math.max(from, Math.min(len, v.keep + v.skip));
  const r = document.createRange();
  r.setStart(...at(from));
  r.setEnd(...at(to));
  r.deleteContents();
  const text = ' '.repeat(v.keep - from) + v.text;
  if (text) {
    const sp = document.createElement('span');
    sp.className = v.flag ? 'pred flag' : 'pred';
    sp.textContent = text;
    r.insertNode(sp);
  }
  el._bg = null;
}
function predRender() {
  predClear();
  predDraw();
  if (predDrawn && scr && scr.follow) scr.body.scrollTop = scr.body.scrollHeight;
  // While predictions wait: time ends one that never echoes, and underlines a slow one.
  const waiting = Boolean(liveCh && liveCh.pred.pending);
  if (waiting && !predTimer)
    predTimer = setInterval(() => {
      const ch = liveCh;
      if (!ch || !ch.pred.pending) {
        clearInterval(predTimer);
        predTimer = null;
        return;
      }
      const v = ch.pred.view(performance.now());
      if (ch.pred.tick(performance.now()) || (predDrawn && v && v.flag !== predDrawn.flag)) predRender();
    }, 50);
}
