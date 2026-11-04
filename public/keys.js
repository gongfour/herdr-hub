'use strict';
// What a keydown means: Enter in the agent composer, and the herdr key name a key press in the
// shell's 키 직접 입력 sends (and how those queue up).
// Pure: loaded as a plain script in the page (window.Keys), required by the tests.
(function (root) {
  // What Enter does in the composer: 'send', 'newline' or null (leave it to the IME).
  // Korean (and other) IMEs send Enter while a syllable is still being composed: never act then.
  // ⌘/Ctrl+Enter on a syllable still being composed (the last one typed) says to send once the
  // IME has put it in: 'send-later'.
  function enterAction(e, mode) {
    const composing = e.isComposing || e.keyCode === 229;
    if (composing && (e.metaKey || e.ctrlKey) && (e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter')) return 'send-later';
    if (e.key !== 'Enter' || composing) return null;
    if (e.metaKey || e.ctrlKey) return 'send';
    if (mode === 'send' && !e.shiftKey && !e.altKey) return 'send';
    return 'newline';
  }

  // Raw mode (키 직접 입력): editing and navigation keys and Ctrl/Alt chords by herdr name;
  // null for anything typed as text (beforeinput sends that), for ⌘ shortcuts, and for the
  // paste chords (Ctrl+V, Ctrl+Shift+V), which go to the browser's own paste. Word keys: Alt or
  // Ctrl + Backspace deletes the word before the caret (ctrl+w); Alt + ←/→ and Alt + . are the
  // xterm meta keys (herdr types ESC[1;3D, ESC .), Ctrl + ←/→ too. Ctrl+[ is Esc, for keyboard
  // covers without one. Alt + ↑/↓ is left to the split layout (open the previous or next row),
  // Alt + P to the Hub's 빠른 이동 (Ctrl+P, the switcher elsewhere, is the shell's here).
  const RAW_NAMES = { Enter: 'enter', Escape: 'esc', Tab: 'tab', Backspace: 'backspace', Delete: 'delete', ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', PageUp: 'pageup', PageDown: 'pagedown', Home: 'home', End: 'end', Insert: 'insert' };
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
    if (e.altKey) return c === '[' || c === 'p' ? null : `alt+${c}`;
    return null;
  }

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

  // The raw-mode send queue: { host, pane, text, keys } items, one request each, in order. A new
  // key press joins the last item when that is for the same pane and of the same kind (text runs
  // merge; keys gather up to 8, the most herdr takes at once); otherwise it starts its own. Each
  // item keeps the pane it was typed for, so keys still waiting when the view moves on go there
  // and nowhere else. Mutates and returns q.
  function queueRaw(q, target, press) {
    const last = q[q.length - 1];
    const here = last && last.host === target.host && last.pane === target.pane;
    if (press.text != null && here && last.text != null && !last.keys.length && last.text.length < 2000) last.text += press.text;
    else if (press.key && here && !last.text && last.keys.length < 8) last.keys.push(press.key);
    else q.push({ host: target.host, pane: target.pane, text: press.text || '', keys: press.key ? [press.key] : [] });
    return q;
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

  const api = { enterAction, rawKeyName, withMods, tapMod, queueRaw, recall };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Keys = api;
})(typeof self !== 'undefined' ? self : this);
