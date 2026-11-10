'use strict';
// What a keydown means: Enter in the agent composer, and the herdr key name a key press in the
// shell's 키 직접 입력 sends (and how those queue up).
// Pure: loaded as a plain script in the page (window.Keys), required by the tests.
(function (root) {
  const I18n = root.I18n || require('./i18n.js');
  const T = I18n.t;
  // What Enter does in the composer: 'send', 'newline' or null (leave it to the IME).
  // Korean (and other) IMEs send Enter while a syllable is still being composed: never act then.
  // ⌘/Ctrl+Enter on a syllable still being composed (the last one typed) says to send once the
  // IME has put it in: 'send-later'. empty (nothing typed, no photo): ⌘/Ctrl+Enter is
  // 'send-queued', 지금 보내기 for what the agent holds queued (Claude Code's Ctrl+Enter, the
  // send chord pressed again); a plain Enter there is still 'send', which sends nothing.
  function enterAction(e, mode, empty = false) {
    const composing = e.isComposing || e.keyCode === 229;
    if (composing && (e.metaKey || e.ctrlKey) && (e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter')) return 'send-later';
    if (e.key !== 'Enter' || composing) return null;
    if (e.metaKey || e.ctrlKey) return empty ? 'send-queued' : 'send';
    if (mode === 'send' && !e.shiftKey && !e.altKey) return 'send';
    return 'newline';
  }

  // Raw mode (키 직접 입력): what the shell gets for a key, by herdr name — editing and
  // navigation keys and Ctrl/Alt chords; null for anything typed as text (beforeinput sends that),
  // for ⌘ shortcuts, for Ctrl+Alt chords (AltGr), and for the paste chords (Ctrl+V, Ctrl+Shift+V),
  // which go to the browser's own paste. Word keys: Alt or Ctrl + Backspace deletes the word
  // before the caret (ctrl+w); Alt + ←/→ and Alt + . are the xterm meta keys (herdr types
  // ESC[1;3D, ESC .), Ctrl + ←/→ too. Ctrl+[ is Esc, for keyboard covers without one. Which of
  // these the Hub keeps for itself in the shell view is not decided here: the keymap's bindings
  // with shell (keymap.js) are, and the shell's field asks it first (shell.js).
  const RAW_NAMES = { Enter: 'enter', Escape: 'esc', ScrollLock: 'esc', Tab: 'tab', Backspace: 'backspace', Delete: 'delete', ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', PageUp: 'pageup', PageDown: 'pagedown', Home: 'home', End: 'end', Insert: 'insert' };
  // The letter or punctuation of a chord: e.key, or e.code where Alt types a symbol instead
  // (Option+B is "∫" on a Mac keyboard).
  function chordChar(e) {
    if (typeof e.key === 'string' && e.key.length === 1 && /^[a-z.[]$/i.test(e.key)) return e.key.toLowerCase();
    const m = /^Key([A-Z])$/.exec(e.code || '');
    if (m) return m[1].toLowerCase();
    return e.code === 'Period' ? '.' : e.code === 'BracketLeft' ? '[' : null;
  }
  function rawKeyName(e) {
    if (e.metaKey) return null;
    if (e.key === 'Tab' && e.shiftKey) return 'shift+tab';
    if (/^F([1-9]|1[0-2])$/.test(e.key) && !e.ctrlKey && !e.altKey) return e.key.toLowerCase();
    if (e.key === 'Backspace' && (e.ctrlKey || e.altKey)) return 'ctrl+w';
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && (e.ctrlKey || e.altKey) && !(e.ctrlKey && e.altKey)) return `${e.ctrlKey ? 'ctrl' : 'alt'}+${RAW_NAMES[e.key]}`;
    if (RAW_NAMES[e.key] && !e.ctrlKey && !e.altKey) return RAW_NAMES[e.key];
    const c = chordChar(e);
    if (!c || (e.ctrlKey && e.altKey)) return null;
    if (e.ctrlKey) {
      if (c === 'v') return null; // paste
      if (c === '[') return 'esc';
      return c === '.' ? null : `ctrl+${c}`;
    }
    if (e.altKey) return c === '[' ? null : `alt+${c}`;
    return null;
  }

  // What a shell (readline, zsh, nushell's emacs mode) does with a key rawKeyName names, in words
  // for the 단축키 page when the Hub takes that key in the shell view; '' when nothing well known.
  const SHELL_MEANINGS = {
    'ctrl+a': T('줄 맨 앞으로'), 'ctrl+e': T('줄 끝으로'), 'ctrl+b': T('한 글자 뒤로'), 'ctrl+f': T('한 글자 앞으로'),
    'ctrl+p': T('이전 명령'), 'ctrl+n': T('다음 명령'), 'ctrl+r': T('기록 찾기'), 'ctrl+s': T('기록 앞으로 찾기'),
    'ctrl+k': T('줄 끝까지 지우기'), 'ctrl+u': T('줄 앞까지 지우기'), 'ctrl+w': T('한 단어 지우기'), 'ctrl+y': T('지운 것 붙여넣기'),
    'ctrl+l': T('화면 지우기'), 'ctrl+d': T('글자 지우기·셸 끝내기'), 'ctrl+c': T('중단@@signal'), 'ctrl+z': T('일시 정지'),
    'ctrl+t': T('두 글자 바꾸기'), 'ctrl+h': T('한 글자 지우기'), 'ctrl+j': T('줄바꿈@@keyname'), 'ctrl+o': T('실행하고 다음 기록'),
    'ctrl+g': T('취소'), 'ctrl+x': T('두 키 명령의 시작'), 'ctrl+q': T('다음 키 그대로'), 'ctrl+v': T('다음 키 그대로'),
    'alt+b': T('한 단어 뒤로'), 'alt+f': T('한 단어 앞으로'), 'alt+d': T('다음 단어 지우기'), 'alt+.': T('마지막 인자'),
    'alt+t': T('두 단어 바꾸기'), 'alt+u': T('단어를 대문자로'), 'alt+l': T('단어를 소문자로'), 'alt+c': T('단어 첫 글자를 대문자로'),
    'alt+y': T('그 전에 지운 것 붙여넣기'), 'alt+w': T('단어 복사'), 'alt+p': T('앞부분이 같은 이전 명령'), 'alt+n': T('앞부분이 같은 다음 명령'),
    'alt+left': T('한 단어 뒤로'), 'alt+right': T('한 단어 앞으로'), 'ctrl+left': T('한 단어 뒤로'), 'ctrl+right': T('한 단어 앞으로'),
    up: T('이전 명령'), down: T('다음 명령'), left: T('한 글자 뒤로'), right: T('한 글자 앞으로'), home: T('줄 맨 앞으로'), end: T('줄 끝으로'),
    tab: T('완성'), 'shift+tab': T('이전 완성'), enter: T('실행@@keyname'), backspace: T('한 글자 지우기'), delete: T('글자 지우기'), esc: 'Esc',
  };
  const shellMeaning = (name) => SHELL_MEANINGS[name] || '';

  // The key row's sticky Ctrl and Alt (for the phone's keyboard, which has neither): what a
  // press means with them held. press: { text } or { key }; mods: { ctrl, alt }. A single typed
  // letter becomes the chord (Ctrl + d → ctrl+d, Alt + . → alt+.), Ctrl + [ is Esc, Backspace
  // deletes a word, ←/→ move by word. Anything with no chord (Ctrl + Tab, a Korean syllable, a
  // paste) goes as it is.
  function withMods(press, mods) {
    const ctrl = Boolean(mods && mods.ctrl);
    const alt = Boolean(mods && mods.alt) && !ctrl;
    if (!press || (!ctrl && !alt)) return press;
    if (press.key) {
      if (press.key === 'backspace') return { key: 'ctrl+w' };
      if (press.key === 'left' || press.key === 'right') return { key: `${ctrl ? 'ctrl' : 'alt'}+${press.key}` };
      return press;
    }
    const t = press.text;
    if (typeof t !== 'string' || t.length !== 1) return press;
    if (/^[a-z]$/i.test(t)) return { key: `${ctrl ? 'ctrl' : 'alt'}+${t.toLowerCase()}` };
    if (ctrl && t === '[') return { key: 'esc' };
    if (alt && t === '.') return { key: 'alt+.' };
    return press;
  }

  // Sticky modifier taps: off → once (the next key only) → locked when tapped again within
  // DOUBLE_MS, else off; locked → off.
  const DOUBLE_MS = 400;
  function tapMod(mod, now) {
    const m = mod || { state: 'off', at: 0 };
    if (m.state === 'off') return { state: 'once', at: now };
    if (m.state === 'once' && now - m.at <= DOUBLE_MS) return { state: 'lock', at: now };
    return { state: 'off', at: now };
  }

  // The raw-mode send queue: { host, pane, text, keys } items, one request each, in order; the
  // server types an item's text first, then its keys. So a new key press joins the last item
  // when that is for the same pane and the order stays: text joins text while no keys have
  // joined yet; keys join after (up to 8, the most herdr takes at once). "ls⏎" is one item.
  // Otherwise it starts its own. Each item keeps the pane it was typed for, so keys still waiting
  // when the view moves on go there and nowhere else. Mutates and returns q.
  function queueRaw(q, target, press) {
    const last = q[q.length - 1];
    const here = last && last.host === target.host && last.pane === target.pane;
    if (press.text != null && here && !last.keys.length && last.text.length < 2000) last.text += press.text;
    else if (press.key && here && last.keys.length < 8) last.keys.push(press.key);
    else q.push({ host: target.host, pane: target.pane, text: press.text || '', keys: press.key ? [press.key] : [] });
    return q;
  }

  // The shell view's screen reads (its 300 ms tick): every tick while keys are being typed or
  // the screen is still changing (a read that differed from the one before, within the last
  // MOVING_MS), else every IDLE_MS (키 직접 입력: 1 s, 한 줄 입력: 2.5 s). t: { now, raw, keyAt,
  // changeAt, loadAt } in ms (0 when never).
  const MOVING_MS = 3000;
  function termReadDue(t) {
    const recent = (at) => Boolean(at) && t.now - at < MOVING_MS;
    if ((t.raw && recent(t.keyAt)) || recent(t.changeAt)) return true;
    return t.now - (t.loadAt || 0) >= (t.raw ? 1000 : 2500);
  }

  // The raw-mode keys still on their way (queueRaw items), as one short line for the shell view's
  // 「보내는 중」 chip: typed text as it is, the keys a terminal draws as a sign (⏎ ⌫ ⇥ ↑) as that
  // sign, any other key by name between spaces (Ctrl+C, Esc, PgUp). Longer than max: its end,
  // after an ellipsis (the end is what was just typed).
  const KEY_SIGNS = { enter: '⏎', backspace: '⌫', tab: '⇥', up: '↑', down: '↓', left: '←', right: '→' };
  const KEY_WORDS = { esc: 'Esc', pageup: 'PgUp', pagedown: 'PgDn', delete: 'Del', insert: 'Ins', home: 'Home', end: 'End' };
  const keyWord = (k) =>
    k
      .split('+')
      .map((p) => KEY_SIGNS[p] || KEY_WORDS[p] || (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)))
      .join('+');
  function describeRaw(items, max = 40) {
    let s = '';
    for (const it of items || []) {
      s += it.text || '';
      for (const k of it.keys || []) s += KEY_SIGNS[k] || ` ${keyWord(k)} `;
    }
    s = s.replace(/ {2,}/g, ' ').trim();
    const chars = Array.from(s);
    return chars.length > max ? `…${chars.slice(chars.length - max + 1).join('')}` : s;
  }

  // ↑/↓ in the agent composer: the messages sent before (sent, oldest first), as in a shell.
  // at is the one shown (an index into sent) or null. ↑ acts on an empty field, or on a recalled
  // message left as it was; anything typed or changed keeps the arrows for the caret. ↓ past the
  // newest gives the empty field back. Returns { at, text }, or null to leave the key alone.
  function recall(sent, at, text, dir) {
    const shown = at != null && sent[at] === text;
    if (!sent.length || !(shown || (dir < 0 && text === ''))) return null;
    if (dir < 0) {
      const i = shown ? Math.max(0, at - 1) : sent.length - 1;
      return { at: i, text: sent[i] };
    }
    return at + 1 < sent.length ? { at: at + 1, text: sent[at + 1] } : { at: null, text: '' };
  }

  const api = { enterAction, rawKeyName, shellMeaning, withMods, tapMod, queueRaw, termReadDue, describeRaw, recall };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Keys = api;
})(typeof self !== 'undefined' ? self : this);
