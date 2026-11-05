'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { waitEcho, echoPattern, lastScreens, rxEscape, CAP_MS } = require('../lib/echo');

// A fake herdr on a virtual clock: the pane shows `before` until echoAt ms after the send, then
// `after`. Each call takes callMs (herdr on the Mac: ~1 ms, or ~105 ms in a stall).
function fakeHerdr({ before, after, echoAt = 4, callMs = 1, regexOk = true }) {
  let t = 0;
  const calls = [];
  const shown = () => (t >= echoAt ? after : before);
  const io = {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    read: async () => {
      t += callMs;
      calls.push(['read', t]);
      return { text: shown() };
    },
    // wait_for_output: returns when the pattern is on screen, or false at its timeout.
    waitFor: async (pattern, ms) => {
      calls.push(['wait', t, pattern, ms]);
      const re = regexOk ? new RegExp(pattern.replace(/\\([#&~-])/g, '$1'), 'm') : null;
      const has = (text) => re && re.test(text.replace(/\x1b\[[0-9;]*m/g, ''));
      if (has(shown())) return (t += callMs), true;
      if (echoAt - t <= ms && has(after)) return (t = Math.max(t, echoAt) + callMs), true;
      t += ms + callMs;
      return false;
    },
  };
  return { io, calls, at: () => t };
}

test('echoPattern: the last line’s end, spaces, then what was typed; none when already on screen', () => {
  assert.equal(echoPattern('PS C:\\> ', 'g'), 'PS C:\\\\>[ \\t]*g');
  assert.equal(echoPattern('\x1b[1;32m❯\x1b[0m zq\n\n', 'k'), '❯ zq[ \\t]*k');
  // The last line with text counts; long lines give their last 12 characters.
  assert.equal(echoPattern('a very long prompt line here $\n  \n', 'ls'), ' line here \\$[ \\t]*ls');
  // Typed text that is already after that line end somewhere: no use waiting for it.
  assert.equal(echoPattern('❯ ls\nfoo\n❯', ' ls'), null);
  assert.equal(echoPattern('❯ ls\nfoo\n❯', 'ls'), null);
  // Nothing to go by: no screen, an empty one, control characters, nothing typed.
  assert.equal(echoPattern(null, 'a'), null);
  assert.equal(echoPattern('\n  \n', 'a'), null);
  assert.equal(echoPattern('❯', 'a\tb'), null);
  assert.equal(echoPattern('❯', ''), null);
  // A long paste: its start.
  assert.equal(echoPattern('❯', 'x'.repeat(100)), `❯[ \\t]*${'x'.repeat(24)}`);
});

test('rxEscape: what the Rust regex crate treats as syntax is escaped, nothing else', () => {
  assert.equal(rxEscape('a.b*c(d)|[e]{f}^$#&-~\\'), 'a\\.b\\*c\\(d\\)\\|\\[e\\]\\{f\\}\\^\\$\\#\\&\\-\\~\\\\');
  assert.equal(rxEscape('PS C:/한글 >'), 'PS C:/한글 >');
});

test('waitEcho: typed text with a pattern waits for herdr to see it, then reads once', async () => {
  const f = fakeHerdr({ before: '❯ zq', after: '❯ zqk', echoAt: 4 });
  const r = await waitEcho(f.io, { text: 'k', before: { text: '❯ zq' } });
  assert.equal(r.how, 'match');
  assert.equal(r.screen.text, '❯ zqk');
  assert.equal(r.reads, 1);
  assert.deepEqual(f.calls.map((c) => c[0]), ['wait', 'read']);
  assert.ok(f.at() <= 6, `answered at ${f.at()} ms`);
  assert.ok(f.calls[0][3] <= CAP_MS);
});

test('waitEcho: no match within the cap (a hint after the caret) reads at the cap, as before', async () => {
  const f = fakeHerdr({ before: '❯ zqabc', after: '❯ zqabc', echoAt: 4 });
  // "❯ zq" + "abc" hint: the typed "a" does not follow the line's end.
  const r = await waitEcho(f.io, { text: 'a', before: { text: '❯ zqabc' } });
  assert.equal(r.how, 'cap');
  assert.ok(f.at() <= CAP_MS + 2);
});

test('waitEcho: keys read until the screen differs, a few reads at most', async () => {
  const f = fakeHerdr({ before: '❯ ab', after: '❯ a', echoAt: 7 });
  const r = await waitEcho(f.io, { text: '', before: { text: '❯ ab' } });
  assert.equal(r.how, 'changed');
  assert.equal(r.screen.text, '❯ a');
  assert.equal(r.reads, 2); // at 5 ms (not yet), at 15 ms (there)
  assert.ok(f.at() <= 17);
});

test('waitEcho: a key with no visible effect ends at the cap', async () => {
  const f = fakeHerdr({ before: '❯', after: '❯', echoAt: 1 });
  const r = await waitEcho(f.io, { text: '', before: { text: '❯' } });
  assert.equal(r.how, 'cap');
  assert.ok(r.reads <= 3);
  assert.ok(f.at() >= CAP_MS && f.at() <= CAP_MS + 2);
});

test('waitEcho: herdr stalling ~100 ms per call costs one read, not three', async () => {
  const f = fakeHerdr({ before: '❯ ab', after: '❯ a', echoAt: 3, callMs: 105 });
  const r = await waitEcho(f.io, { text: '', before: { text: '❯ ab' } });
  assert.equal(r.reads, 1);
  assert.equal(r.screen.text, '❯ a');
  const g = fakeHerdr({ before: '❯', after: '❯', echoAt: 3, callMs: 105 });
  const s = await waitEcho(g.io, { text: '', before: { text: '❯' } });
  assert.equal(s.reads, 1); // past the cap after the first read: no more
});

test('waitEcho: nothing to compare against reads once at the cap', async () => {
  const f = fakeHerdr({ before: '❯', after: '❯ a', echoAt: 3 });
  const r = await waitEcho(f.io, { text: 'a', before: null });
  assert.equal(r.reads, 1);
  assert.equal(r.screen.text, '❯ a');
  assert.deepEqual(f.calls.map((c) => c[0]), ['read']);
  assert.ok(f.calls[0][1] >= CAP_MS);
});

test('waitEcho: typed text already on screen falls back to reading for a change', async () => {
  const f = fakeHerdr({ before: '❯ ls\nfoo\n❯', after: '❯ ls\nfoo\n❯ ls', echoAt: 3 });
  const r = await waitEcho(f.io, { text: 'ls', before: { text: '❯ ls\nfoo\n❯' } });
  assert.equal(r.how, 'changed');
  assert.ok(!f.calls.some((c) => c[0] === 'wait'));
});

test('lastScreens: per pane and per kind of read; the oldest panes go first', () => {
  const m = lastScreens(2);
  const ansi = { source: 'recent_unwrapped', format: 'ansi', lines: 200 };
  m.set('w1:p1', ansi, { text: 'a' });
  assert.deepEqual(m.get('w1:p1', ansi), { text: 'a' });
  assert.equal(m.get('w1:p1', { ...ansi, format: 'text' }), null);
  assert.equal(m.get('w1:p1', { ...ansi, lines: 400 }), null);
  // No format asked for and "text" are the same read.
  m.set('w1:p2', { ...ansi, format: null }, { text: 'b' });
  assert.deepEqual(m.get('w1:p2', { ...ansi, format: 'text' }), { text: 'b' });
  m.set('w1:p3', ansi, { text: 'c' });
  assert.equal(m.size(), 2);
  assert.equal(m.get('w1:p1', ansi), null);
  m.drop('w1:p3');
  assert.equal(m.get('w1:p3', ansi), null);
});
