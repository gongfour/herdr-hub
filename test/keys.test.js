'use strict';
// What a keydown means in the composer and in the shell's 키 직접 입력 (public/keys.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { enterAction, rawKeyName } = require('../public/keys.js');

const key = (k, mods = {}) => ({ key: k, keyCode: 0, isComposing: false, ...mods });

test('enterAction: newline by default, send with ⌘/Ctrl, Shift keeps a newline in send mode', () => {
  assert.equal(enterAction(key('Enter'), 'newline'), 'newline');
  assert.equal(enterAction(key('Enter', { metaKey: true }), 'newline'), 'send');
  assert.equal(enterAction(key('Enter', { ctrlKey: true }), 'newline'), 'send');
  assert.equal(enterAction(key('Enter'), 'send'), 'send');
  assert.equal(enterAction(key('Enter', { shiftKey: true }), 'send'), 'newline');
  assert.equal(enterAction(key('Enter', { altKey: true }), 'send'), 'newline');
});

test('enterAction: never while an IME is composing, nothing for other keys', () => {
  assert.equal(enterAction(key('Enter', { isComposing: true }), 'send'), null);
  assert.equal(enterAction(key('Enter', { keyCode: 229 }), 'send'), null);
  assert.equal(enterAction(key('a'), 'send'), null);
});

test('rawKeyName: editing and navigation keys by herdr name', () => {
  const names = { Enter: 'enter', Escape: 'esc', Tab: 'tab', Backspace: 'backspace', Delete: 'delete', ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', PageUp: 'pageup', PageDown: 'pagedown', Home: 'home', End: 'end' };
  for (const [k, name] of Object.entries(names)) assert.equal(rawKeyName(key(k)), name, k);
  assert.equal(rawKeyName(key('Tab', { shiftKey: true })), 'shift+tab');
});

test('rawKeyName: Ctrl and Alt letter chords; typed text and ⌘ shortcuts are not keys', () => {
  assert.equal(rawKeyName(key('c', { ctrlKey: true })), 'ctrl+c');
  assert.equal(rawKeyName(key('R', { ctrlKey: true, shiftKey: true })), 'ctrl+r');
  assert.equal(rawKeyName(key('b', { altKey: true })), 'alt+b');
  assert.equal(rawKeyName(key('a')), null);
  assert.equal(rawKeyName(key('1', { ctrlKey: true })), null);
  assert.equal(rawKeyName(key('c', { metaKey: true })), null);
  assert.equal(rawKeyName(key('Enter', { ctrlKey: true })), null);
});
