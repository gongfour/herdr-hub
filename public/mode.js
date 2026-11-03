'use strict';
// Claude Code's permission mode, read off the footer under its input box, e.g.
//   ⏵⏵ auto mode on (shift+tab to cycle)      ⏸ manual mode on · ? for shortcuts
//   ⏵⏵ accept edits on (shift+tab to cycle)   ⏸ plan mode on (shift+tab to cycle)
//   ⏵⏵ bypass permissions on (shift+tab to cycle)
// (Claude Code 2.1.317; older versions show only "? for shortcuts" in the default mode.)
// Pure: screen text (plain) in, 'auto' | 'manual' | 'accept' | 'plan' | 'bypass' or null out.
// Loaded as a plain script in the page (window.parseMode) and required by the tests.
(function (root) {
  const MODES = [
    ['bypass', /bypass permissions on/i],
    ['accept', /accept[- ]?edits on|auto-accept edits on/i],
    ['plan', /plan mode on/i],
    ['auto', /auto mode on/i],
    ['manual', /manual mode on|default mode on/i],
  ];
  const SCAN = 6; // non-empty lines from the bottom: the footer sits right under the input box

  function parseMode(text) {
    if (text == null) return null;
    const lines = String(text).replace(/\r/g, '').split('\n');
    let seen = 0;
    for (let i = lines.length - 1; i >= 0 && seen < SCAN; i--) {
      const line = lines[i];
      if (!line.trim()) continue;
      seen++;
      for (const [mode, re] of MODES) if (re.test(line)) return mode;
      // The default mode of older versions: the shortcuts hint alone, under the input box.
      if (/^\s*\?\s+for shortcuts\s*$/.test(line)) return 'manual';
    }
    return null;
  }

  if (typeof module === 'object' && module.exports) module.exports = { parseMode };
  else root.parseMode = parseMode;
})(typeof self !== 'undefined' ? self : this);
