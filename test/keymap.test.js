'use strict';
// The shortcut table (public/keymap.js): what each key means where, and that no two clash.
const test = require('node:test');
const assert = require('node:assert/strict');
const { ACTIONS, BINDINGS, LOCAL, parse, match, label, sheetGroups } = require('../public/keymap.js');
const { rawKeyName } = require('../public/keys.js');

// A keydown from a key string: 'Ctrl+ArrowDown' -> { key: 'ArrowDown', ctrlKey: true, … }.
function ev(key, extra = {}) {
  const k = parse(key);
  return { key: k.name, code: '', keyCode: 0, isComposing: false, ctrlKey: k.ctrl, altKey: k.alt, metaKey: k.meta, shiftKey: k.shift, ...extra };
}
const act = (key, ctx, extra) => (match(ev(key, extra), ctx) || {}).action || null;

test('every binding names an action with words for the sheet', () => {
  for (const x of BINDINGS) assert.ok(ACTIONS[x.action] && ACTIONS[x.action].label, x.action);
  for (const x of LOCAL) assert.ok(x.group && x.label);
});

// Every binding is live on the page of the split layout with nothing open (field, shell and
// layer only add places), so two bindings of one key always meet there: one key, one binding.
test('no key is bound twice', () => {
  const seen = new Map();
  for (const x of BINDINGS) {
    const k = JSON.stringify(parse(x.key));
    assert.ok(!seen.has(k), `${x.key}: ${seen.get(k)} and ${x.action}`);
    seen.set(k, x.action);
  }
});

test('the shell view takes no key the shell needs (rawKeyName), Esc and Ctrl+[ aside', () => {
  // In 키 직접 입력 the shell's field sends those two to the shell before the page sees them.
  for (const x of BINDINGS.filter((y) => y.shell && y.action !== 'back')) assert.equal(rawKeyName(ev(x.key)), null, x.key);
});

test('Esc and Ctrl+[ go back everywhere, a sheet and the shell included', () => {
  for (const ctx of [{}, { field: true }, { shell: true }, { layer: true }]) {
    assert.equal(act('Escape', ctx), 'back');
    assert.equal(act('Ctrl+[', ctx), 'back');
  }
  assert.equal(match({ key: 'ㅔ', code: 'BracketLeft', ctrlKey: true }, {}).action, 'back'); // a layout without [ there
});

test('jumpEnd: Ctrl+↓, Ctrl+End and ⌘+↓ anywhere, End alone only outside a field', () => {
  for (const ctx of [{}, { field: true }, { shell: true }, { layer: true }]) {
    assert.equal(act('Ctrl+ArrowDown', ctx), 'jumpEnd');
    assert.equal(act('Ctrl+End', ctx), 'jumpEnd');
    assert.equal(act('Meta+ArrowDown', ctx), 'jumpEnd');
  }
  assert.equal(act('End', {}), 'jumpEnd');
  assert.equal(act('End', { field: true }), null); // the caret's end of line
  assert.equal(act('Ctrl+Meta+ArrowDown', {}), null);
  assert.equal(act('ArrowDown', {}), null);
  assert.equal(act('Shift+End', {}), null); // selects to the end
  assert.equal(act('Ctrl+End', {}, { isComposing: true }), null);
  assert.equal(act('Ctrl+End', {}, { keyCode: 229 }), null);
});

test('prevMine / nextMine: Ctrl+↑ and Ctrl+K back, Ctrl+J on; K and J stay the shell\'s', () => {
  assert.equal(act('Ctrl+ArrowUp', {}), 'prevMine');
  assert.equal(act('Ctrl+ArrowUp', { field: true }), 'prevMine');
  assert.equal(act('Ctrl+ArrowUp', { shell: true }), 'prevMine');
  assert.equal(act('Ctrl+k', { field: true }), 'prevMine');
  assert.equal(act('Ctrl+j', { field: true }), 'nextMine');
  assert.equal(act('Ctrl+k', {}, { key: 'ㅏ', code: 'KeyK' }), 'prevMine'); // keyboard set to Korean
  assert.equal(act('Ctrl+j', {}, { key: 'ㅓ', code: 'KeyJ' }), 'nextMine');
  assert.equal(act('Ctrl+Shift+k', {}, { key: 'K' }), null); // Ctrl+Shift+K is not it
  assert.equal(act('Ctrl+k', { shell: true }), null);
  assert.equal(act('Ctrl+j', { shell: true }), null);
  assert.equal(act('k', {}), null);
  assert.equal(act('ArrowUp', { field: true }), null); // the composer's recall
  assert.equal(act('Ctrl+Alt+ArrowUp', {}), null);
});

test('hosts: Alt+←/→ in a field too, never in the shell or under a sheet', () => {
  assert.equal(act('Alt+ArrowLeft', {}), 'prevHost');
  assert.equal(act('Alt+ArrowRight', { field: true }), 'nextHost');
  assert.equal(act('Alt+ArrowRight', { shell: true }), null); // the shell's word keys
  assert.equal(act('Alt+ArrowRight', { layer: true }), null);
  assert.equal(act('Ctrl+Alt+ArrowRight', {}), null);
  assert.equal(act('Alt+Shift+ArrowRight', {}), null);
});

test('rows (split only): Alt+↑/↓ anywhere, the shell included; [ ] only on the page, not in the shell', () => {
  const sp = { split: true };
  assert.equal(act('Alt+ArrowDown', sp), 'nextRow');
  assert.equal(act('Alt+ArrowUp', { ...sp, field: true }), 'prevRow');
  assert.equal(act('Alt+ArrowDown', { ...sp, shell: true }), 'nextRow');
  assert.equal(act(']', sp), 'nextRow');
  assert.equal(act('[', sp), 'prevRow');
  assert.equal(act(']', { ...sp, field: true }), null); // typed into the composer
  assert.equal(act(']', { ...sp, shell: true }), null);
  assert.equal(act('Alt+ArrowDown', { ...sp, layer: true }), null);
  assert.equal(act('Alt+ArrowDown', {}), null); // the phone: no list beside it
  assert.equal(act('Ctrl+]', sp), null);
  assert.equal(act(']', sp, { code: 'BracketRight', key: 'ㅔ' }), null); // a bare symbol never by code
});

test('/ and ? only on the page, not in the shell or under a sheet', () => {
  assert.equal(act('/', {}), 'focusInput');
  assert.equal(act('?', {}, { shiftKey: true }), 'help');
  for (const ctx of [{ field: true }, { shell: true }, { layer: true }]) {
    assert.equal(act('/', ctx), null);
    assert.equal(act('?', ctx, { shiftKey: true }), null);
  }
});

test('label reads as on the keycap; the sheet lists every action once with all its keys', () => {
  assert.equal(label('Ctrl+ArrowDown'), 'Ctrl+↓');
  assert.equal(label('Meta+ArrowDown'), '⌘+↓');
  assert.equal(label('Ctrl+k'), 'Ctrl+K');
  assert.equal(label('Escape'), 'Esc');
  const groups = sheetGroups();
  const rows = groups.flatMap((g) => g.rows);
  for (const a of Object.values(ACTIONS)) assert.equal(rows.filter((r) => r.label === a.label).length, 1, a.label);
  const jump = rows.find((r) => r.label === ACTIONS.jumpEnd.label);
  assert.deepEqual(jump.keys, ['Ctrl+↓', 'Ctrl+End', '⌘+↓', 'End']);
});
