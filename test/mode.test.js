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
