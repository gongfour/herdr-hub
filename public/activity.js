'use strict';
// Reads what a working agent is doing off its visible screen. For Claude Code that is the
// spinner line above the input box, e.g.
//   ✻ Flowing… (1m 17s · ↓ 5.1k tokens · thinking)
//   · Thinking…
// and the last tool block above it (⏺ Bash(npm test) / ⏺ Running npm test…, then ⎿ …;
// Windows draws ● for ⏺).
// Pure: screen text (plain, no ANSI) in, { word, elapsed, seconds, tokens, detail, tool } or
// null out. Loaded as a plain script in the page (window.Activity) and required by the tests.
(function (root) {
  // Claude Code's spinner glyphs (macOS and the Windows fallback set), drawn one per frame.
  const GLYPHS = '·✢✳✶✻✽*✦✧⋆∗';
  // "Word…" or "Doing the thing…" (todo activeForm), then an optional "(…)" with the details.
  const SPINNER = new RegExp(`^\\s*[${GLYPHS}]\\s+(\\S[^()]{0,80}?)(?:…|\\.\\.\\.)\\s*(?:\\(([^()]*)\\))?\\s*$`);
  const ELAPSED = /^(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?$/;
  const TOKENS = /^[↓↑]\s*[\d.,]+\s*[kKmM]?\s*tokens?$/;
  const HINT = /^(?:esc|ctrl|shift)\b/i; // "esc to interrupt" and the like: not activity
  // The bullet in front of a tool block: ⏺ on macOS, ● on Windows.
  const TOOL_CALL = /^\s*[⏺●]\s+((?:mcp__)?[A-Za-z][\w.-]*(?:\s\(MCP\))?)\((.*)$/;
  const BULLET = /^\s*[⏺●]\s+(\S.*)$/;
  const TOOL_CLOCK = /\s+·\s+(?:\d+[hms]\s*)+$/; // "Reading nothing.txt · 3s": the tool's own timer
  const RESULT = /^\s*⎿/;
  const BLINKED = /^ {1,2}[A-Z]\S*/; // "  Sleeping for 15 seconds" right above its ⎿ line
  const SCAN = 30; // lines from the bottom: the spinner sits just above the input box

  function seconds(s) {
    const m = ELAPSED.exec(String(s || '').trim());
    if (!m || !(m[1] || m[2] || m[3])) return null;
    return (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
  }

  // 77 -> "1m 17s", the way Claude Code writes it.
  function formatElapsed(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h) return `${h}h ${m}m`;
    if (m) return `${m}m ${s}s`;
    return `${s}s`;
  }

  const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

  // The last tool block above line `end`: a "⏺ Name(args" line, or any ⏺ line whose next
  // non-blank line is a ⎿ result. Prose bullets ("⏺ I'll read…") are neither.
  function lastTool(lines, end) {
    for (let i = end - 1; i >= 0; i--) {
      const call = TOOL_CALL.exec(lines[i]);
      if (call) {
        const arg = call[2].replace(/\)\s*$/, '').trim();
        return clip(arg ? `${call[1]}: ${arg}` : call[1], 80);
      }
      const b = BULLET.exec(lines[i]);
      if (b) {
        let j = i + 1;
        while (j < end && !lines[j].trim()) j++;
        if (j < end && RESULT.test(lines[j])) return clip(b[1].replace(TOOL_CLOCK, '').trim(), 80);
      } else if (BLINKED.test(lines[i]) && i + 1 < end && RESULT.test(lines[i + 1])) {
        // The bullet of a running tool blinks; caught off, the line keeps only its indent.
        return clip(lines[i].replace(TOOL_CLOCK, '').trim(), 80);
      }
    }
    return null;
  }

  function parseActivity(text) {
    if (text == null) return null;
    const lines = String(text).replace(/\r/g, '').split('\n');
    let seen = 0;
    for (let i = lines.length - 1; i >= 0 && seen < SCAN; i--) {
      const line = lines[i];
      if (!line.trim()) continue;
      seen++;
      const m = SPINNER.exec(line);
      if (!m) continue;
      const word = m[1].trim();
      // A sentence that happens to end in "…" is prose, not the spinner.
      if (!m[2] && word.split(/\s+/).length > 6) continue;
      const out = { word: `${word}…`, elapsed: null, seconds: null, tokens: null, detail: null, tool: lastTool(lines, i) };
      const extra = [];
      for (const part of (m[2] || '').split('·').map((p) => p.trim()).filter(Boolean)) {
        const sec = out.seconds == null ? seconds(part) : null;
        if (sec != null) {
          out.seconds = sec;
          out.elapsed = part;
        } else if (TOKENS.test(part)) out.tokens = part;
        else if (!HINT.test(part)) extra.push(part);
      }
      if (extra.length) out.detail = extra.join(' · ');
      return out;
    }
    return null;
  }

  const api = { parseActivity, formatElapsed, elapsedSeconds: seconds };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Activity = api;
})(typeof self !== 'undefined' ? self : this);
