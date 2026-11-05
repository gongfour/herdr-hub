'use strict';
// 키 직접 입력: a key item's screen comes back with the reply, as soon as its echo is on it
// instead of after a fixed sleep. herdr has the echo on screen 2–8 ms after the send.
//
// - Text with a pattern that is new on screen: herdr's pane.wait_for_output on it (it returns
//   the moment the line shows it), then the read. The pattern is the end of the screen's last
//   line (where the prompt and caret usually are), any spaces, then the start of the typed text.
//   herdr matches text already on screen at once, so a pattern found in the screen before the
//   key is no use; then, and when the caret is elsewhere (a hint after it, mid-line editing),
//   the next way.
// - Otherwise (keys, or no usable pattern): read until the screen differs from the last one
//   read for that pane, at READ_AT ms after the send at most, so a few reads at most: on the
//   Mac herdr intermittently takes ~100 ms per call, and more calls would only queue up there.
// Keys with no visible effect end at the cap, as with the old fixed sleep.

const CAP_MS = 40;
const READ_AT = [5, 15, CAP_MS];
const TAIL = 12; // characters of the last line in the pattern
const TYPED = 24; // characters of the typed text in it

// Colour codes, OSC titles and other escapes out; the text herdr matches patterns against.
const strip = (s) =>
  String(s == null ? '' : s)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-_]/g, '')
    .replace(/\r/g, '');

// herdr is Rust: the regex crate's metacharacters, escaped as its regex::escape does.
const rxEscape = (s) => s.replace(/[\\.+*?()|[\]{}^$#&\-~]/g, '\\$&');

// Does the pattern already match the text? (The same pattern, as a JavaScript regex.)
const jsEscape = (s) => s.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');
const occurs = (text, tail, typed) => new RegExp(`${jsEscape(tail)}[ \\t]*${jsEscape(typed)}`, 'u').test(text);

// The wait_for_output regex for typed text, given the screen before it (raw, colour codes and
// all); null when there is none worth waiting for.
function echoPattern(before, text) {
  if (before == null || typeof text !== 'string' || !text || /[\x00-\x1f\x7f]/.test(text)) return null;
  const plain = strip(before);
  const lines = plain.split('\n');
  let last = '';
  for (let i = lines.length - 1; i >= 0 && !last; i--) last = lines[i].replace(/\s+$/, '');
  if (!last) return null;
  const tail = Array.from(last).slice(-TAIL).join('');
  const typed = Array.from(text).slice(0, TYPED).join('');
  if (occurs(plain, tail, typed)) return null;
  return `${rxEscape(tail)}[ \\t]*${rxEscape(typed)}`;
}

// The screen after a key item was sent. io: { waitFor(pattern, ms) → true/false (never throws),
// read() → { text, … }, sleep(ms), now() }. before: the last screen read for this pane in the
// same shape ({ text }), or null. Returns { screen, how, reads }.
async function waitEcho(io, { text, before }) {
  const start = io.now();
  const left = () => CAP_MS - (io.now() - start);
  const pattern = before ? echoPattern(before.text, text) : null;
  if (pattern) {
    const matched = await io.waitFor(pattern, Math.max(1, left()));
    return { screen: await io.read(), how: matched ? 'match' : 'cap', reads: 1 };
  }
  let screen = null;
  let reads = 0;
  for (const at of before ? READ_AT : [CAP_MS]) {
    const wait = at - (io.now() - start);
    if (wait > 0) await io.sleep(wait);
    screen = await io.read();
    reads++;
    if (screen.text !== before?.text) return { screen, how: before ? 'changed' : 'cap', reads };
    if (left() <= 0) break;
  }
  return { screen, how: 'cap', reads };
}

// The last screen read per pane (any read: the page's own, an echo), keyed by what was read so
// a comparison is between like reads. A few dozen panes at most; the oldest go first.
function lastScreens(max = 64) {
  const m = new Map();
  const key = (shape) => `${shape.source}\u0000${shape.format === 'ansi' ? 'ansi' : 'text'}\u0000${shape.lines}`;
  return {
    get(pane, shape) {
      const e = m.get(pane);
      return e && e.key === key(shape) ? e.screen : null;
    },
    set(pane, shape, screen) {
      m.delete(pane);
      m.set(pane, { key: key(shape), screen });
      if (m.size > max) m.delete(m.keys().next().value);
    },
    drop(pane) {
      m.delete(pane);
    },
    size: () => m.size,
  };
}

module.exports = { waitEcho, echoPattern, lastScreens, strip, rxEscape, CAP_MS, READ_AT };
