'use strict';
// What a keydown means in the composer and in the shell's 키 직접 입력 (public/keys.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { enterAction, rawKeyName, withMods, tapMod, recall } = require('../public/keys.js');
const { validKeys, PANE_KEYS } = require('../lib/validate.js');

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
  // ⌘/Ctrl+Enter on the last syllable: sent once the IME is done with it.
  assert.equal(enterAction(key('Enter', { isComposing: true, ctrlKey: true }), 'newline'), 'send-later');
  assert.equal(enterAction(key('Process', { keyCode: 229, code: 'Enter', metaKey: true }), 'newline'), 'send-later');
  assert.equal(enterAction(key('a'), 'send'), null);
});

test('rawKeyName: editing and navigation keys by herdr name', () => {
  const names = { Enter: 'enter', Escape: 'esc', Tab: 'tab', Backspace: 'backspace', Delete: 'delete', ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', PageUp: 'pageup', PageDown: 'pagedown', Home: 'home', End: 'end', Insert: 'insert' };
  for (const [k, name] of Object.entries(names)) assert.equal(rawKeyName(key(k)), name, k);
  assert.equal(rawKeyName(key('Tab', { shiftKey: true })), 'shift+tab');
});

test('rawKeyName: Ctrl and Alt letter chords; typed text and ⌘ shortcuts are not keys', () => {
  assert.equal(rawKeyName(key('c', { ctrlKey: true })), 'ctrl+c');
  assert.equal(rawKeyName(key('R', { ctrlKey: true, shiftKey: true })), 'ctrl+r');
  assert.equal(rawKeyName(key('f', { altKey: true })), 'alt+f');
  assert.equal(rawKeyName(key('a')), null);
  assert.equal(rawKeyName(key('1', { ctrlKey: true })), null);
  assert.equal(rawKeyName(key('c', { metaKey: true })), null);
  assert.equal(rawKeyName(key('Enter', { ctrlKey: true })), null);
});

test('rawKeyName: F-keys, word keys, Ctrl+[ and the meta keys', () => {
  for (let i = 1; i <= 12; i++) assert.equal(rawKeyName(key(`F${i}`)), `f${i}`);
  assert.equal(rawKeyName(key('Backspace', { altKey: true })), 'ctrl+w');
  assert.equal(rawKeyName(key('Backspace', { ctrlKey: true })), 'ctrl+w');
  assert.equal(rawKeyName(key('ArrowLeft', { altKey: true })), 'alt+left');
  assert.equal(rawKeyName(key('ArrowRight', { altKey: true })), 'alt+right');
  assert.equal(rawKeyName(key('ArrowLeft', { ctrlKey: true })), 'ctrl+left');
  assert.equal(rawKeyName(key('ArrowRight', { ctrlKey: true })), 'ctrl+right');
  assert.equal(rawKeyName(key('[', { ctrlKey: true, code: 'BracketLeft' })), 'esc');
  assert.equal(rawKeyName(key('ScrollLock')), 'esc'); // a remapped cover Esc
  assert.equal(rawKeyName(key('.', { altKey: true, code: 'Period' })), 'alt+.');
  // A Mac keyboard's Option types a symbol: the physical key says which letter it was.
  assert.equal(rawKeyName(key('ƒ', { altKey: true, code: 'KeyF' })), 'alt+f');
  assert.equal(rawKeyName(key('≥', { altKey: true, code: 'Period' })), 'alt+.');
});

// rawKeyName says what the shell would get, nothing more: which of those keys the Hub keeps in
// the shell view is the keymap's (keymap.test.js, 'the shell keys the defaults take').
test('rawKeyName: Alt+P/B/J/K are shell keys too; paste chords, Alt+↑/↓ and AltGr are none', () => {
  assert.equal(rawKeyName(key('p', { altKey: true, code: 'KeyP' })), 'alt+p');
  assert.equal(rawKeyName(key('b', { altKey: true, code: 'KeyB' })), 'alt+b');
  assert.equal(rawKeyName(key('π', { altKey: true, code: 'KeyP' })), 'alt+p'); // a Mac's Option+P
  assert.equal(rawKeyName(key('p', { ctrlKey: true, code: 'KeyP' })), 'ctrl+p');
  assert.equal(rawKeyName(key('k', { altKey: true, code: 'KeyK' })), 'alt+k');
  assert.equal(rawKeyName(key('j', { altKey: true, code: 'KeyJ' })), 'alt+j');
  assert.equal(rawKeyName(key('∆', { altKey: true, code: 'KeyJ' })), 'alt+j'); // a Mac's Option+J
  assert.equal(rawKeyName(key('h', { altKey: true, code: 'KeyH' })), 'alt+h');
  assert.equal(rawKeyName(key('l', { altKey: true, code: 'KeyL' })), 'alt+l');
  assert.equal(rawKeyName(key('k', { ctrlKey: true, code: 'KeyK' })), 'ctrl+k');
  assert.equal(rawKeyName(key(',', { ctrlKey: true, code: 'Comma' })), null); // Ctrl+, sends nothing either way
  assert.equal(rawKeyName(key('b', { ctrlKey: true, code: 'KeyB' })), 'ctrl+b');
  assert.equal(rawKeyName(key('[', { altKey: true, code: 'BracketLeft' })), null);
  assert.equal(rawKeyName(key('v', { ctrlKey: true, code: 'KeyV' })), null);
  assert.equal(rawKeyName(key('V', { ctrlKey: true, shiftKey: true, code: 'KeyV' })), null);
  assert.equal(rawKeyName(key('v', { metaKey: true, code: 'KeyV' })), null);
  assert.equal(rawKeyName(key('ArrowUp', { altKey: true })), null);
  assert.equal(rawKeyName(key('ArrowDown', { altKey: true })), null);
  assert.equal(rawKeyName(key('a', { ctrlKey: true, altKey: true, code: 'KeyA' })), null); // AltGr
});

test('shellMeaning: well-known shell keys in words, else nothing', () => {
  const { shellMeaning } = require('../public/keys.js');
  assert.equal(shellMeaning('alt+b'), '한 단어 뒤로');
  assert.equal(shellMeaning('ctrl+r'), '기록 찾기');
  assert.equal(shellMeaning('alt+j'), '');
});

test('withMods: the sticky Ctrl and Alt turn the next key into a chord', () => {
  const ctrl = { ctrl: true };
  const alt = { alt: true };
  assert.deepEqual(withMods({ text: 'd' }, ctrl), { key: 'ctrl+d' });
  assert.deepEqual(withMods({ text: 'D' }, ctrl), { key: 'ctrl+d' }); // the keyboard's auto-capital
  assert.deepEqual(withMods({ text: '[' }, ctrl), { key: 'esc' });
  assert.deepEqual(withMods({ text: 'b' }, alt), { key: 'alt+b' });
  assert.deepEqual(withMods({ text: '.' }, alt), { key: 'alt+.' });
  assert.deepEqual(withMods({ key: 'backspace' }, ctrl), { key: 'ctrl+w' });
  assert.deepEqual(withMods({ key: 'backspace' }, alt), { key: 'ctrl+w' });
  assert.deepEqual(withMods({ key: 'left' }, alt), { key: 'alt+left' });
  assert.deepEqual(withMods({ key: 'right' }, ctrl), { key: 'ctrl+right' });
  // No chord for these: the press goes as it is.
  assert.deepEqual(withMods({ key: 'tab' }, ctrl), { key: 'tab' });
  assert.deepEqual(withMods({ key: 'ctrl+c' }, alt), { key: 'ctrl+c' });
  assert.deepEqual(withMods({ text: '한' }, ctrl), { text: '한' });
  assert.deepEqual(withMods({ text: 'ls' }, ctrl), { text: 'ls' });
  assert.deepEqual(withMods({ text: '.' }, ctrl), { text: '.' });
  assert.deepEqual(withMods({ text: 'd' }, {}), { text: 'd' });
  assert.deepEqual(withMods({ text: 'd' }, { ctrl: true, alt: true }), { key: 'ctrl+d' });
});

test('tapMod: once, locked on a double tap, off again', () => {
  let m = tapMod(null, 1000);
  assert.equal(m.state, 'once');
  assert.equal(tapMod(m, 1300).state, 'lock');
  assert.equal(tapMod(m, 2000).state, 'off');
  assert.equal(tapMod(tapMod(m, 1300), 5000).state, 'off');
});

test('every key the shell view can send passes the server check', () => {
  const sent = ['f1', 'f12', 'insert', 'ctrl+w', 'alt+left', 'alt+right', 'ctrl+left', 'ctrl+right', 'alt+.', 'esc', 'ctrl+d', 'alt+b', 'shift+tab', 'pageup'];
  for (const k of sent) assert.equal(validKeys([k], PANE_KEYS), true, k);
  assert.equal(validKeys(['alt+up'], PANE_KEYS), false);
  assert.equal(validKeys(['ctrl+.'], PANE_KEYS), false);
});

test('queueRaw: presses merge per pane and never cross to another one', () => {
  const { queueRaw } = require('../public/keys');
  const A = { host: 'server', pane: 'w1:p1' };
  const B = { host: 'server', pane: 'w1:p2' };
  const q = [];
  queueRaw(q, A, { text: 'rm -rf ' });
  queueRaw(q, A, { text: 'build' });
  queueRaw(q, A, { key: 'enter' });
  queueRaw(q, B, { text: 'ls' }); // the view moved to B: a new item for B
  queueRaw(q, B, { key: 'enter' });
  queueRaw(q, B, { key: 'up' });
  queueRaw(q, { host: 'desktop', pane: 'w1:p2' }, { key: 'enter' }); // same pane id, other host
  assert.deepEqual(q, [
    { ...A, text: 'rm -rf build', keys: [] },
    { ...A, text: '', keys: ['enter'] },
    { ...B, text: 'ls', keys: [] },
    { ...B, text: '', keys: ['enter', 'up'] },
    { host: 'desktop', pane: 'w1:p2', text: '', keys: ['enter'] },
  ]);
  const many = [];
  for (let i = 0; i < 10; i++) queueRaw(many, A, { key: 'down' });
  assert.deepEqual(many.map((x) => x.keys.length), [8, 2]); // herdr takes 8 keys at once
});

test('recall: ↑ on an empty field walks back through what was sent, ↓ comes forward to empty', () => {
  const sent = ['one', 'two', 'three'];
  assert.deepEqual(recall(sent, null, '', -1), { at: 2, text: 'three' });
  assert.deepEqual(recall(sent, 2, 'three', -1), { at: 1, text: 'two' });
  assert.deepEqual(recall(sent, 0, 'one', -1), { at: 0, text: 'one' });
  assert.deepEqual(recall(sent, 1, 'two', 1), { at: 2, text: 'three' });
  assert.deepEqual(recall(sent, 2, 'three', 1), { at: null, text: '' });
});

test('recall: typed or changed text, ↓ on an empty field and an empty history leave the key alone', () => {
  const sent = ['one', 'two'];
  assert.equal(recall(sent, null, 'draft', -1), null);
  assert.equal(recall(sent, 1, 'two!', -1), null);
  assert.equal(recall(sent, null, '', 1), null);
  assert.equal(recall([], null, '', -1), null);
});

test('withMods: the key row\'s sticky Alt still sends Alt+J/K to the shell', () => {
  assert.deepEqual(withMods({ text: 'j' }, { alt: true }), { key: 'alt+j' });
  assert.deepEqual(withMods({ text: 'k' }, { alt: true }), { key: 'alt+k' });
});

test('describeRaw: the keys still on their way, as the 보내는 중 chip shows them', () => {
  const { describeRaw } = require('../public/keys');
  assert.equal(describeRaw([]), '');
  assert.equal(describeRaw([{ text: 'ls -la', keys: [] }, { text: '', keys: ['enter'] }]), 'ls -la⏎');
  assert.equal(describeRaw([{ text: 'cd', keys: [] }, { text: '', keys: ['backspace', 'backspace'] }]), 'cd⌫⌫');
  assert.equal(describeRaw([{ text: '', keys: ['ctrl+c', 'esc'] }]), 'Ctrl+C Esc');
  assert.equal(describeRaw([{ text: 'git', keys: [] }, { text: '', keys: ['alt+.', 'pageup'] }]), 'git Alt+. PgUp');
  const long = describeRaw([{ text: 'x'.repeat(50) + 'END', keys: [] }], 10);
  assert.equal(long, `…${'x'.repeat(6)}END`);
  assert.equal(Array.from(long).length, 10);
});
