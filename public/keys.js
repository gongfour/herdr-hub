'use strict';
// What a keydown means: Enter in the agent composer, and the herdr key name a key press in the
// shell's 키 직접 입력 sends.
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

  const api = { enterAction, rawKeyName };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Keys = api;
})(typeof self !== 'undefined' ? self : this);
