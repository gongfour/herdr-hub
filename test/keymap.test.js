'use strict';
// The shortcut table (public/keymap.js): what each key means where, and that no two clash.
const test = require('node:test');
const assert = require('node:assert/strict');
const { ACTIONS, BINDINGS, LOCAL, parse, match, label, hint, sheetGroups } = require('../public/keymap.js');
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

test('jumpEnd / jumpTop: Ctrl+Shift+↓/↑, Ctrl+End and ⌘+↓ anywhere, End alone only outside a field', () => {
  for (const ctx of [{}, { field: true }, { shell: true }, { layer: true }]) {
    assert.equal(act('Ctrl+Shift+ArrowDown', ctx), 'jumpEnd');
    assert.equal(act('Ctrl+Shift+ArrowUp', ctx), 'jumpTop');
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

test('prevMine / nextMine: Ctrl+↑ and Ctrl+↓ anywhere, the shell and a sheet included', () => {
  for (const ctx of [{}, { field: true }, { shell: true }, { layer: true }]) {
    assert.equal(act('Ctrl+ArrowUp', ctx), 'prevMine');
    assert.equal(act('Ctrl+ArrowDown', ctx), 'nextMine');
  }
  assert.equal(act('ArrowUp', { field: true }), null); // the composer's recall
  assert.equal(act('Ctrl+Alt+ArrowUp', {}), null);
});

test('scrollUp / scrollDown: Ctrl+K and Ctrl+J, a field and a sheet too; K and J stay the shell\'s', () => {
  for (const ctx of [{}, { field: true }, { layer: true }]) {
    assert.equal(act('Ctrl+k', ctx), 'scrollUp');
    assert.equal(act('Ctrl+j', ctx), 'scrollDown');
  }
  assert.equal(act('Ctrl+k', {}, { key: 'ㅏ', code: 'KeyK' }), 'scrollUp'); // keyboard set to Korean
  assert.equal(act('Ctrl+j', {}, { key: 'ㅓ', code: 'KeyJ' }), 'scrollDown');
  assert.equal(act('Ctrl+Shift+k', {}, { key: 'K' }), null); // Ctrl+Shift+K is not it
  assert.equal(act('Ctrl+k', { shell: true }), null);
  assert.equal(act('Ctrl+j', { shell: true }), null);
  assert.equal(act('k', {}), null);
  assert.equal(act('j', {}), null);
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
  assert.equal(act(']', sp), null); // [ ] are no list keys
  assert.equal(act('[', sp), null);
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

test('switcher: Ctrl+P on the page, in a field and under a sheet, never in the shell; Alt+P everywhere', () => {
  for (const ctx of [{}, { field: true }, { layer: true }, { split: true }]) {
    assert.equal(act('Ctrl+p', ctx), 'switcher');
    assert.equal(act('Alt+p', ctx), 'switcher');
  }
  assert.equal(act('Ctrl+p', { shell: true }), null); // the shell's previous line
  assert.equal(act('Alt+p', { shell: true }), 'switcher');
  assert.equal(act('Alt+p', { shell: true, field: true }), 'switcher');
  assert.equal(act('Ctrl+p', {}, { key: 'ㅔ', code: 'KeyP' }), 'switcher'); // keyboard set to Korean
  assert.equal(act('Alt+p', {}, { key: 'π', code: 'KeyP' }), 'switcher'); // a Mac's Option+P
  assert.equal(act('Ctrl+Shift+p', {}, { key: 'P' }), null);
  assert.equal(act('p', {}), null);
});

test('answer: 1–9 only on the page, never in a field, the shell or under a sheet', () => {
  for (const n of '123456789') assert.equal(act(n, {}), 'answer');
  assert.equal(act('1', { split: true }), 'answer');
  assert.equal(act('0', {}), null);
  for (const ctx of [{ field: true }, { shell: true }, { layer: true }]) assert.equal(act('1', ctx), null);
  assert.equal(act('Ctrl+1', {}), null);
  assert.equal(act('Alt+1', {}), null);
  assert.equal(act('1', {}, { isComposing: true }), null);
});

test('toggleSide: Ctrl+B in the split layout, from the composer too; not in the shell, not on the phone', () => {
  assert.equal(act('Ctrl+b', { split: true }), 'toggleSide');
  assert.equal(act('Ctrl+b', { split: true, field: true }), 'toggleSide');
  assert.equal(act('Ctrl+b', { split: true }, { key: 'ㅠ', code: 'KeyB' }), 'toggleSide');
  assert.equal(act('Ctrl+b', { split: true, shell: true }), null); // the shell's back-a-character
  assert.equal(act('Ctrl+b', {}), null);
  assert.equal(act('Ctrl+b', { split: true, layer: true }), null);
});

test('stop: Alt+. on the page and in a field; never in the shell (its last-argument key)', () => {
  assert.equal(act('Alt+.', {}), 'stop');
  assert.equal(act('Alt+.', { field: true }), 'stop');
  assert.equal(act('Alt+.', {}, { key: '≥', code: 'Period' }), 'stop'); // a Mac's Option+.
  assert.equal(act('Alt+.', { shell: true }), null);
  assert.equal(act('Alt+.', { layer: true }), null);
  assert.equal(act('.', {}), null);
  assert.equal(act('.', {}, { code: 'Period' }), null);
  assert.equal(act('Ctrl+.', {}), null);
});

test('new agent / workspace: Ctrl or Alt + N (Shift for a workspace), never in the shell or under a sheet', () => {
  for (const ctx of [{}, { field: true }, { split: true }]) {
    assert.equal(act('Ctrl+n', ctx), 'newAgent');
    assert.equal(act('Alt+n', ctx), 'newAgent');
    assert.equal(act('Ctrl+Shift+n', ctx, { key: 'N' }), 'newWorkspace');
    assert.equal(act('Alt+Shift+n', ctx, { key: 'N' }), 'newWorkspace');
  }
  assert.equal(act('Ctrl+n', {}, { key: 'ㅜ', code: 'KeyN' }), 'newAgent'); // keyboard set to Korean
  assert.equal(act('Alt+Shift+n', {}, { key: '˜', code: 'KeyN' }), 'newWorkspace'); // a Mac's Option
  for (const ctx of [{ shell: true }, { layer: true }])
    for (const k of ['Ctrl+n', 'Alt+n', 'Ctrl+Shift+n', 'Alt+Shift+n']) assert.equal(act(k, ctx), null, k);
  assert.equal(act('n', {}), null);
  assert.equal(act('Ctrl+Alt+n', {}), null);
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
  assert.deepEqual(jump.keys, ['Ctrl+Shift+↓', 'Ctrl+End', '⌘+↓', 'End']);
  assert.deepEqual(rows.find((r) => r.label === ACTIONS.answer.label).keys, ['1–9']);
  assert.deepEqual(rows.find((r) => r.label === ACTIONS.switcher.label).keys, ['Ctrl+P', 'Alt+P']);
  assert.deepEqual(rows.find((r) => r.label === ACTIONS.newWorkspace.label).keys, ['Ctrl+Shift+N', 'Alt+Shift+N']);
});

test('Alt+H/J/K/L mirror Alt+←/↓/↑/→ in the same places, by e.code too', () => {
  const sp = { split: true };
  for (const ctx of [{}, { field: true }]) {
    assert.equal(act('Alt+h', ctx), 'prevHost');
    assert.equal(act('Alt+l', ctx), 'nextHost');
  }
  for (const ctx of [sp, { ...sp, field: true }, { ...sp, shell: true }, { ...sp, shell: true, field: true }]) {
    assert.equal(act('Alt+k', ctx), 'prevRow');
    assert.equal(act('Alt+j', ctx), 'nextRow');
  }
  // Where the arrows are not taken, neither are the letters.
  assert.equal(act('Alt+h', { shell: true }), null); // the shell's (as Alt+←/→)
  assert.equal(act('Alt+l', { shell: true }), null);
  assert.equal(act('Alt+h', { layer: true }), null);
  assert.equal(act('Alt+j', {}), null); // the phone: no list beside it
  assert.equal(act('Alt+k', { ...sp, layer: true }), null);
  // A Mac's Option letters and a Korean layout: the physical key.
  assert.equal(act('Alt+h', {}, { key: '˙', code: 'KeyH' }), 'prevHost');
  assert.equal(act('Alt+l', {}, { key: '¬', code: 'KeyL' }), 'nextHost');
  assert.equal(act('Alt+j', sp, { key: '∆', code: 'KeyJ' }), 'nextRow');
  assert.equal(act('Alt+k', sp, { key: '˚', code: 'KeyK' }), 'prevRow');
  assert.equal(act('Alt+k', sp, { key: 'ㅏ', code: 'KeyK' }), 'prevRow');
  // Plain, Shift, Ctrl+Alt: not these.
  assert.equal(act('h', {}), null);
  assert.equal(act('Alt+Shift+j', sp), null);
  assert.equal(act('Ctrl+Alt+j', sp), null);
  // The sheet lists the letters on the arrows' rows.
  const rows = sheetGroups().flatMap((g) => g.rows);
  for (const [arrow, letter] of [['Alt+↑', 'Alt+K'], ['Alt+↓', 'Alt+J'], ['Alt+←', 'Alt+H'], ['Alt+→', 'Alt+L']]) {
    const r = rows.find((x) => x.keys.includes(arrow));
    assert.ok(r && r.keys.includes(letter), `${arrow} ${letter}`);
  }
});

test('Ctrl+, opens and closes 설정: on the page and in a field, not in the shell or under a sheet', () => {
  assert.equal(act('Ctrl+,', {}), 'settings');
  assert.equal(act('Ctrl+,', { field: true }), 'settings');
  assert.equal(act('Ctrl+,', { split: true }), 'settings');
  assert.equal(act('Ctrl+,', {}, { key: '<', code: 'Comma' }), 'settings'); // another layout
  assert.equal(act('Ctrl+,', { shell: true }), null);
  assert.equal(act('Ctrl+,', { shell: true, field: true }), null);
  assert.equal(act('Ctrl+,', { layer: true }), null);
  assert.equal(act(',', {}), null); // a typed comma
  assert.equal(act('Meta+,', {}), null); // the browser's own
  assert.equal(act('Alt+,', {}), null);
});

test('answer-needed agents: Alt+Shift+↓/↑ anywhere but under a sheet, the shell and a field included', () => {
  for (const ctx of [{}, { field: true }, { shell: true }, { split: true }]) {
    assert.equal(act('Alt+Shift+ArrowDown', ctx), 'nextBlocked');
    assert.equal(act('Alt+Shift+ArrowUp', ctx), 'prevBlocked');
  }
  assert.equal(act('Alt+Shift+ArrowDown', { layer: true }), null);
  assert.equal(act('Alt+ArrowDown', { split: true }), 'nextRow'); // Shift makes the difference
});

test('Alt+T: the terminal sheet, also from the composer and to close the sheet; the shell keeps it', () => {
  for (const ctx of [{}, { field: true }, { layer: true }]) assert.equal(act('Alt+t', ctx), 'terminal');
  assert.equal(act('Alt+t', {}, { key: '†', code: 'KeyT' }), 'terminal'); // a Mac's Option+T
  assert.equal(act('Alt+t', { shell: true }), null); // the shell's swap-words
});

test('Alt+`: the last agent or shell, the shell view and a field included; by code for a dead key', () => {
  for (const ctx of [{}, { field: true }, { shell: true }]) assert.equal(act('Alt+`', ctx), 'lastView');
  assert.equal(act('Alt+`', {}, { key: 'Dead', code: 'Backquote' }), 'lastView');
  assert.equal(act('`', {}), null);
  assert.equal(act('Alt+`', { layer: true }), null);
});

test('hint: an action\'s own hint, else its first key, else nothing', () => {
  assert.equal(hint('stop'), 'Alt+. ×2');
  assert.equal(hint('terminal'), 'Alt+T');
  assert.equal(hint('toggleSide'), 'Ctrl+B');
  assert.equal(hint('jumpEnd'), 'Ctrl+Shift+↓');
  assert.equal(hint('nothing'), '');
});

test('빠른 이동: Ctrl+J/K move the selection there (its field, by e.code too); the sheet lists them', () => {
  const { matches } = require('../public/keymap.js');
  assert.ok(matches({ ctrlKey: true, key: 'j', code: 'KeyJ' }, 'Ctrl+j'));
  assert.ok(matches({ ctrlKey: true, key: 'ㅓ', code: 'KeyJ' }, 'Ctrl+j')); // keyboard set to Korean
  assert.ok(matches({ ctrlKey: true, key: 'ㅏ', code: 'KeyK' }, 'Ctrl+k'));
  assert.ok(!matches({ ctrlKey: true, shiftKey: true, key: 'J', code: 'KeyJ' }, 'Ctrl+j'));
  const qs = sheetGroups().find((g) => g.group === '빠른 이동');
  const keys = qs.rows.flatMap((r) => r.keys);
  for (const k of ['리턴', 'Ctrl+J', 'Ctrl+K']) assert.ok(keys.includes(k), k);
});

// ---- changed keys (setOverrides and friends); each test leaves the defaults back.
const KM = require('../public/keymap.js');
const withKeys = (over, fn) => {
  try {
    KM.setOverrides(over);
    fn();
  } finally {
    KM.setOverrides({});
  }
};

test('keyOf: the key a keydown is bound as, by the physical key where the character is not it', () => {
  assert.equal(KM.keyOf({ key: 'ㅏ', code: 'KeyK', ctrlKey: true }), 'Ctrl+k'); // Korean layout
  assert.equal(KM.keyOf({ key: '˚', code: 'KeyK', altKey: true }), 'Alt+k'); // a Mac's Option+K
  assert.equal(KM.keyOf({ key: 'K', code: 'KeyK', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+k');
  assert.equal(KM.keyOf({ key: 'ArrowDown', code: 'ArrowDown', altKey: true }), 'Alt+ArrowDown');
  assert.equal(KM.keyOf({ key: '≥', code: 'Period', altKey: true }), 'Alt+.');
  assert.equal(KM.keyOf({ key: '?', code: 'Slash', shiftKey: true }), '?'); // the symbol says Shift
  assert.equal(KM.keyOf({ key: 'g', code: 'KeyG' }), 'g');
  assert.equal(KM.keyOf({ key: 'Control', code: 'ControlLeft', ctrlKey: true }), null); // a modifier alone
  assert.equal(KM.keyOf({ key: 'Process', code: 'KeyA', keyCode: 229 }), null); // the IME's
});

test('refuse: browser keys, Esc off 뒤로, bare Enter/Tab/Space, 1–9, and the fixed action', () => {
  assert.match(KM.refuse('jumpEnd', 'Ctrl+w'), /브라우저/);
  assert.match(KM.refuse('jumpEnd', 'Ctrl+Tab'), /브라우저/);
  assert.match(KM.refuse('jumpEnd', 'Escape'), /Esc/);
  assert.equal(KM.refuse('back', 'Escape'), '');
  assert.match(KM.refuse('jumpEnd', 'Enter'), /만으로는/);
  assert.equal(KM.refuse('jumpEnd', 'Ctrl+Enter'), '');
  assert.match(KM.refuse('jumpEnd', '3'), /선택지/);
  assert.match(KM.refuse('answer', 'Ctrl+g'), /바꿀 수 없습니다/);
  assert.equal(KM.refuse('jumpEnd', 'Ctrl+g'), '');
});

test('setOverrides: an action\'s own keys replace its defaults; a moved key leaves the other', () => {
  withKeys({ jumpEnd: ['Ctrl+g'] }, () => {
    assert.equal(act('Ctrl+g', {}), 'jumpEnd');
    assert.equal(act('Ctrl+g', { field: true, layer: true }), 'jumpEnd'); // jumpEnd's places
    assert.equal(act('Ctrl+End', {}), null); // its defaults are gone
    assert.equal(KM.hint('jumpEnd'), 'Ctrl+G');
  });
  withKeys({ jumpEnd: ['Ctrl+k'] }, () => {
    assert.equal(act('Ctrl+k', {}), 'jumpEnd');
    assert.equal(act('Ctrl+j', {}), 'scrollDown'); // the other default stays
    assert.ok(!KM.actionRows().find((r) => r.action === 'scrollUp').keys.includes('Ctrl+k'));
  });
  assert.equal(act('Ctrl+End', {}), 'jumpEnd'); // back to the defaults
});

test('a changed key never takes a typed character or a shell key', () => {
  withKeys({ jumpEnd: ['g'], prevMine: ['Ctrl+e'], help: ['Alt+F1'] }, () => {
    assert.equal(act('g', {}), 'jumpEnd');
    assert.equal(act('g', { field: true }), null); // typed into the composer
    assert.equal(act('g', { shell: true }), null);
    assert.equal(act('Ctrl+e', { field: true }), 'prevMine');
    assert.equal(act('Ctrl+e', { shell: true }), null); // ctrl+e is the shell's (rawKeyName)
  });
  // The rule the table holds itself to holds for changed keys too.
  withKeys({ jumpEnd: ['Ctrl+a', 'Alt+ArrowDown'], scrollUp: ['Alt+b'] }, () => {
    for (const r of KM.actionRows()) for (const key of r.keys) {
      const b = KM.match(ev(key), { shell: true, field: true, layer: true, split: true });
      if (b && b.custom && b.action !== 'back') assert.equal(rawKeyName(ev(key)), null, key);
    }
  });
});

test('setOverrides keeps only what can stand: no unknown action, no refused key, a key once, 뒤로 with Esc', () => {
  const kept = KM.setOverrides({ nope: ['Ctrl+g'], answer: ['Ctrl+g'], jumpEnd: ['Ctrl+w', 'Ctrl+g'], jumpTop: ['Ctrl+g'], back: ['Ctrl+q2'] });
  try {
    assert.deepEqual(Object.keys(kept).sort(), ['back', 'jumpEnd', 'jumpTop']);
    assert.deepEqual(kept.jumpEnd, ['Ctrl+g']);
    assert.deepEqual(kept.jumpTop, []); // Ctrl+g went to jumpEnd first
    assert.deepEqual(kept.back, ['Escape']);
  } finally {
    KM.setOverrides({});
  }
});

test('assign / unassign / reset', () => {
  let r = KM.assign({}, 'jumpEnd', 'Ctrl+g');
  assert.equal(r.from, null);
  assert.deepEqual(r.overrides.jumpEnd, ['Ctrl+Shift+ArrowDown', 'Ctrl+End', 'Meta+ArrowDown', 'End', 'Ctrl+g']);
  r = KM.assign({}, 'jumpEnd', 'Ctrl+k'); // scrollUp's
  assert.equal(r.from, 'scrollUp');
  assert.deepEqual(r.overrides.scrollUp, []);
  assert.throws(() => KM.assign({}, 'jumpEnd', 'Ctrl+w'), /브라우저/);
  assert.throws(() => KM.unassign({}, 'back', 'Escape'), /Esc/);
  assert.deepEqual(KM.unassign({}, 'back', 'Ctrl+['), { back: ['Escape'] });
  assert.deepEqual(KM.reset({ jumpEnd: [], back: ['Escape'] }, 'jumpEnd'), { back: ['Escape'] });
});

test('stop says ×2 whatever its key', () => {
  withKeys({ stop: ['Ctrl+Shift+x'] }, () => assert.equal(KM.hint('stop'), 'Ctrl+Shift+X ×2'));
});
