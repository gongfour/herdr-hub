'use strict';
// What a keydown means: Enter in the agent composer, and the herdr key name a key press in the
// shell's 키 직접 입력 sends (and how those queue up).
// Pure: loaded as a plain script in the page (window.Keys), required by the tests.
(function (root) {
  // What Enter does in the composer: 'send', 'newline' or null (leave it to the IME).
  // Korean (and other) IMEs send Enter while a syllable is still being composed: never act then.
  function enterAction(e, mode) {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return null;
    if (e.metaKey || e.ctrlKey) return 'send';
    if (mode === 'send' && !e.shiftKey && !e.altKey) return 'send';
    return 'newline';
  }

  // Raw mode (키 직접 입력): editing and navigation keys and Ctrl/Alt chords by herdr name;
  // null for anything typed as text (beforeinput sends that) and for ⌘ shortcuts.
  const RAW_NAMES = { Enter: 'enter', Escape: 'esc', Tab: 'tab', Backspace: 'backspace', Delete: 'delete', ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', PageUp: 'pageup', PageDown: 'pagedown', Home: 'home', End: 'end' };
  function rawKeyName(e) {
    if (e.metaKey) return null;
    if (e.key === 'Tab' && e.shiftKey) return 'shift+tab';
    if (RAW_NAMES[e.key] && !e.ctrlKey && !e.altKey) return RAW_NAMES[e.key];
    if (e.ctrlKey && /^[a-z]$/i.test(e.key)) return `ctrl+${e.key.toLowerCase()}`;
    if (e.altKey && /^[a-z]$/i.test(e.key)) return `alt+${e.key.toLowerCase()}`;
    return null;
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

  const api = { enterAction, rawKeyName, queueRaw };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Keys = api;
})(typeof self !== 'undefined' ? self : this);
