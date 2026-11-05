'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMode } = require('../public/mode.js');

const screen = (footer) => `───────────────\n❯ Try "refactor <filepath>"\n───────────────\n${footer}\n\n`;

test('every footer of Claude Code 2.1.317', () => {
  assert.equal(parseMode(screen('  ⏵⏵ auto mode on (shift+tab to cycle)')), 'auto');
  assert.equal(parseMode(screen('  ⏸ manual mode on · ? for shortcuts')), 'manual');
  assert.equal(parseMode(screen('  ⏵⏵ accept edits on (shift+tab to cycle)')), 'accept');
  assert.equal(parseMode(screen('  ⏸ plan mode on (shift+tab to cycle)')), 'plan');
  assert.equal(parseMode(screen('  ⏵⏵ bypass permissions on (shift+tab to cycle)')), 'bypass');
  assert.equal(parseMode(screen('  ? for shortcuts')), 'manual');
});

test('no footer, or the words only far up in the conversation: unknown', () => {
  assert.equal(parseMode(''), null);
  assert.equal(parseMode(null), null);
  const far = `I turned plan mode on earlier.\n${'line\n'.repeat(10)}───\n❯ \n───\n`;
  assert.equal(parseMode(far), null);
});

const { reachMode } = require('../public/mode.js');
// A fake Claude Code: ⇧Tab moves along `cycle`; reads after a step return `reads` in turn if given.
const fake = (cycle, start) => {
  let i = cycle.indexOf(start);
  const calls = { n: 0 };
  return { calls, step: async () => (calls.n++, cycle[(i = (i + 1) % cycle.length)]) };
};

test('reachMode: as many ⇧Tab as the cycle needs, whatever its order', async () => {
  const c = fake(['manual', 'accept', 'plan', 'auto'], 'manual');
  assert.deepEqual(await reachMode('manual', 'auto', c.step), { mode: 'auto', missing: false });
  assert.equal(c.calls.n, 3);
  const d = fake(['manual', 'accept', 'plan', 'bypass', 'auto'], 'auto');
  assert.deepEqual(await reachMode('auto', 'bypass', d.step), { mode: 'bypass', missing: false });
  assert.equal(d.calls.n, 4);
});

test('reachMode: a mode not in the round is missing after one round, back where it began', async () => {
  const c = fake(['manual', 'accept', 'plan', 'auto'], 'plan');
  assert.deepEqual(await reachMode('plan', 'bypass', c.step), { mode: 'plan', missing: true });
  assert.equal(c.calls.n, 4);
});

test('reachMode: an unsent key or an unread footer stops at once; a stuck footer never loops on', async () => {
  let n = 0;
  assert.deepEqual(await reachMode('manual', 'plan', async () => (n++ ? null : 'accept')), { mode: null, missing: false });
  assert.equal(n, 2);
  // The footer never changes (the key went nowhere): stop at once, and not called missing.
  let k = 0;
  assert.deepEqual(await reachMode('manual', 'plan', async () => (k++, 'manual')), { mode: 'manual', missing: false });
  assert.equal(k, 1);
});
