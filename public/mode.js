'use strict';
// Claude Code's permission mode, read off the footer under its input box, e.g.
//   ⏵⏵ auto mode on (shift+tab to cycle)      ⏸ manual mode on · ? for shortcuts
//   ⏵⏵ accept edits on (shift+tab to cycle)   ⏸ plan mode on (shift+tab to cycle)
//   ⏵⏵ bypass permissions on (shift+tab to cycle)
// (Claude Code 2.1.317; older versions show only "? for shortcuts" in the default mode.)
// Pure: screen text (plain) in, 'auto' | 'manual' | 'accept' | 'plan' | 'bypass' or null out;
// reachMode steps the mode to the one picked. Loaded as a plain script in the page (window.parseMode,
// window.reachMode) and required by the tests.
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

  // From mode `now` to `want` one ⇧Tab at a time: step() sends one and resolves to the mode the
  // footer shows then (null: unsent or unread, or it should stop). The cycle's order is not
  // assumed (it varies with the version and with what the session allows): a mode seen twice
  // before `want` means a whole round went by without it -> missing.
  //   { mode: the mode last read (null: unknown), missing: want is not in this session's round }
  // A step that changes nothing (the key went nowhere, the footer is stale) stops it, not missing.
  async function reachMode(now, want, step, max = 6) {
    let mode = now;
    const seen = new Set([now]);
    for (let i = 0; i < max && mode !== want; i++) {
      const was = mode;
      mode = await step();
      if (!mode) return { mode: null, missing: false };
      if (mode === was) return { mode, missing: false }; // the key changed nothing: stuck, not a round
      if (mode !== want && seen.has(mode)) return { mode, missing: true };
      seen.add(mode);
    }
    return { mode, missing: false };
  }

  if (typeof module === 'object' && module.exports) module.exports = { parseMode, reachMode };
  else Object.assign(root, { parseMode, reachMode });
})(typeof self !== 'undefined' ? self : this);
