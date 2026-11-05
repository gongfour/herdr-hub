'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Predict = require('../public/predict.js');
const Ansi = require('../public/ansi.js');

const KEYS = new Set(['enter', 'tab', 'up', 'left', 'ctrl+a', 'ctrl+w', 'delete', 'esc']);

// A shell: its screen lines, a prompt on the last one. typed text echoes at the caret (with an
// optional hint after it, as nushell or PowerShell show); the host acks, then pushes the screen.
function shell({ prompt = '❯ ', above = ['out 1', 'out 2'], right = '' } = {}) {
  const p = Predict.create({ strip: (l) => Ansi.strip(l) });
  const st = { line: '', t: 0, s: 0, p };
  const lines = () => [...above, prompt + st.line + right];
  st.lines = lines;
  st.screen = () => p.screen(lines(), st.t);
  st.type = (ch) => {
    st.s++;
    return p.typed(ch === 'BS' ? { key: 'backspace' } : KEYS.has(ch) ? { key: ch } : { text: ch }, st.s, st.t);
  };
  // The host applied keys up to s: the line now has them.
  st.apply = (text) => (st.line = text);
  st.ack = (s = st.s) => p.acked(s, st.t);
  st.shown = () => {
    const v = p.view(st.t);
    return v ? Predict.applyView(Ansi.strip(lines()[lines().length - 1]), v) : null;
  };
  st.screen();
  return st;
}

test('the first key is tentative; its echo finds the caret, and the next keys are drawn at once', () => {
  const sh = shell();
  sh.type('l');
  assert.equal(sh.shown(), null); // not drawn: the caret isn't known yet
  sh.ack();
  sh.apply('l');
  sh.screen();
  assert.equal(sh.p.view(sh.t), null); // confirmed, nothing waiting
  assert.equal(sh.type('s'), true); // drawn now
  assert.equal(sh.shown(), '❯ ls');
  sh.type(' ');
  sh.type('-');
  assert.equal(sh.shown(), '❯ ls -');
  // The host catches up in steps: what it shows is confirmed, the rest still drawn.
  sh.ack(2);
  sh.apply('ls');
  sh.screen();
  assert.equal(sh.shown(), '❯ ls -');
  assert.equal(sh.p.pending, 2);
  sh.ack(4);
  sh.apply('ls -');
  sh.screen();
  assert.equal(sh.p.view(sh.t), null);
  assert.equal(sh.p.stats.confirmed, 4);
});

test('a screen that disagrees drops every prediction at once', () => {
  const sh = shell();
  sh.type('g'), sh.ack(), sh.apply('g'), sh.screen();
  sh.type('i');
  sh.type('t');
  assert.equal(sh.shown(), '❯ git');
  sh.ack();
  sh.apply('gxx'); // the shell did something else
  sh.screen(); // (this one could be a read from before the keys)
  assert.equal(sh.screen(), true);
  assert.equal(sh.p.view(sh.t), null);
  // And the next key is tentative again.
  sh.type('q');
  assert.equal(sh.shown(), null);
});

test('no echo (a password prompt): never drawn, and the epoch ends', () => {
  const sh = shell({ prompt: 'Password: ' });
  for (const ch of 'secret') sh.type(ch);
  sh.ack();
  assert.equal(sh.shown(), null);
  sh.t += Predict.ECHO_WAIT_MS + 1;
  sh.p.tick(sh.t);
  assert.equal(sh.p.pending, 0);
  assert.equal(sh.p.stats.noEcho, 1);
  sh.type('x');
  assert.equal(sh.shown(), null);
});

test('after a trusted epoch, Enter makes the next key tentative (the next prompt may be a password)', () => {
  const sh = shell();
  sh.type('s'), sh.ack(), sh.apply('s'), sh.screen();
  sh.type('u');
  assert.equal(sh.shown(), '❯ su');
  assert.equal(sh.type('enter'), true); // the drawn one goes
  assert.equal(sh.p.view(sh.t), null);
  sh.type('p');
  assert.equal(sh.shown(), null);
});

test('Tab, arrows and Ctrl chords end the epoch too', () => {
  for (const key of ['tab', 'up', 'left', 'ctrl+a', 'ctrl+w', 'delete', 'esc']) {
    const sh = shell();
    sh.type('a'), sh.ack(), sh.apply('a'), sh.screen();
    sh.type(key);
    sh.type('b');
    assert.equal(sh.shown(), null, key);
  }
});

test('Backspace over typed characters is predicted; never into the prompt', () => {
  const sh = shell();
  sh.type('a'), sh.ack(), sh.apply('a'), sh.screen();
  sh.type('b');
  sh.type('BS');
  assert.equal(sh.shown(), '❯ a');
  sh.type('BS');
  assert.equal(sh.shown(), '❯ ');
  sh.type('BS'); // the prompt's own: not predicted, the epoch ends
  assert.equal(sh.p.view(sh.t), null);
});

test('a hint after the caret (nushell, PowerShell) is overwritten, and confirmation ignores it', () => {
  const sh = shell();
  sh.type('g'), sh.ack(), sh.apply('g\x1b[90mit status\x1b[0m'), sh.screen();
  sh.type('i');
  assert.equal(sh.shown(), '❯ git status');
  sh.ack(), sh.apply('gi\x1b[90mt status\x1b[0m'), sh.screen();
  assert.equal(sh.p.view(sh.t), null);
  assert.equal(sh.p.stats.wrong, 0);
});

test('a right prompt: the caret is found where the key landed, not at the line end', () => {
  const sh = shell({ right: '          10:42 PM' });
  sh.type('c'), sh.ack();
  sh.apply('c');
  sh.screen();
  sh.type('d');
  assert.equal(sh.shown(), '❯ cd         10:42 PM');
});

test('a prompt trimmed of its trailing space still finds the caret after it', () => {
  const sh = shell({ prompt: '$ ', above: ['out'] });
  sh.p.screen(['out', '$'], 0); // the read has no trailing blank
  sh.type('e'), sh.ack(), sh.apply('e'), sh.screen();
  sh.type('c');
  assert.equal(sh.shown(), '$ ec');
  sh.type(' ');
  assert.equal(sh.shown(), '$ ec ');
});

test('full-screen programs: keys not at the end of the last line, or the screen changing elsewhere', () => {
  // vim insert mode: typed text lands up in the buffer, the last line stays "-- INSERT --".
  const p = Predict.create({ strip: Ansi.strip });
  p.screen(['hello', '~', '-- INSERT --'], 0);
  p.typed({ text: 'x' }, 1, 0);
  p.acked(1, 5);
  assert.equal(p.screen(['hellox', '~', '-- INSERT --'], 10), false);
  assert.equal(p.stats.wrong, 1);
  p.typed({ text: 'y' }, 2, 11);
  assert.equal(p.view(11), null);
  // vim's or less's command line: the key lands at the start of the line, no prompt before it.
  const q = Predict.create({ strip: Ansi.strip });
  q.screen(['text', '~', '"a.txt" 3L, 20B'], 0);
  q.typed({ text: ':' }, 1, 0);
  q.acked(1, 5);
  q.screen(['text', '~', ':'], 10);
  q.typed({ text: 'w' }, 2, 11);
  assert.equal(q.view(11), null);
  // htop-like: a line above changes with the echo.
  const r = Predict.create({ strip: Ansi.strip });
  r.screen(['cpu 3%', '> '], 0);
  r.typed({ text: 'a' }, 1, 0);
  r.acked(1, 5);
  r.screen(['cpu 4%', '> a'], 10);
  r.typed({ text: 'b' }, 2, 11);
  assert.equal(r.view(11), null);
});

test('not over the channel (no sequence number), or a paste: not predicted', () => {
  const sh = shell();
  sh.type('a'), sh.ack(), sh.apply('a'), sh.screen();
  sh.p.typed({ text: 'b' }, null, 0);
  assert.equal(sh.p.view(0), null);
  const sh2 = shell();
  sh2.type('a'), sh2.ack(), sh2.apply('a'), sh2.screen();
  sh2.type('x'.repeat(40));
  assert.equal(sh2.p.view(0), null);
});

test('Korean: a committed syllable is predicted like any character', () => {
  const sh = shell();
  sh.type('e'), sh.ack(), sh.apply('e'), sh.screen();
  sh.type('한');
  sh.type('글');
  assert.equal(sh.shown(), '❯ e한글');
  sh.ack(), sh.apply('e한글'), sh.screen();
  assert.equal(sh.p.stats.wrong, 0);
});

test('a key waiting long is flagged (underlined)', () => {
  const sh = shell();
  sh.type('a'), sh.ack(), sh.apply('a'), sh.screen();
  sh.type('b');
  assert.equal(sh.p.view(sh.t).flag, false);
  sh.t += Predict.FLAG_MS + 1;
  assert.equal(sh.p.view(sh.t).flag, true);
});

test('자동: shown while the round trip is long, with a gap before it turns off', () => {
  const p = Predict.create();
  assert.equal(p.show('auto'), false); // not measured yet
  assert.equal(p.show('on'), true);
  assert.equal(p.show('off'), false);
  let t = 0;
  const rtt = (ms, n = 30) => {
    for (let i = 0; i < n; i++) {
      p.typed({ key: 'up' }, ++t, t * 1000);
      p.acked(t, t * 1000 + ms);
    }
  };
  rtt(10);
  assert.equal(p.show('auto'), false);
  rtt(60);
  assert.equal(p.show('auto'), true);
  rtt(25); // between the two lines: stays on
  assert.equal(p.show('auto'), true);
  rtt(10);
  assert.equal(p.show('auto'), false);
});
