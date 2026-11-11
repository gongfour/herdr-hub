'use strict';
// The shortcut table (public/keymap.js): what each key means where, and that no two clash.
const test = require('node:test');
const assert = require('node:assert/strict');
const { ACTIONS, BINDINGS, LOCAL, parse, match, label, hint, sheetGroups } = require('../public/keymap.js');
const KM0 = require('../public/keymap.js');
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

// The shell's field asks the keymap first (shellKey): a binding with shell takes its key from
// the shell there. The defaults take exactly these shell keys; every other one goes to the shell.
test('the shell keys the defaults take are exactly this list', () => {
  const taken = BINDINGS.filter((x) => x.shell && rawKeyName(ev(x.key)) != null).map((x) => `${x.key} ${x.action}`);
  assert.deepEqual(taken, [
    'Escape back', // 뒤로's keys: the shell's Esc there (shellEsc)
    'Ctrl+[ back',
    'ScrollLock back',
    'Alt+k prevRow', // vim's k and j, the split layout only
    'Alt+j nextRow',
    'Alt+p switcher', // Ctrl+P stays the shell's
    'Ctrl+Shift+p commands', // VS Code's: a terminal gets it as Ctrl+P, which stays the shell's
    'F1 commands', // VS Code's; a TUI's help (htop, mc) is all the shell loses
    'Alt+b toggleSide', // the split layout only; Alt+← is the shell's back-a-word too
    'F6 nextPane', // the split layout only: the focus to the next column, out of the shell too
    'Shift+F6 prevPane',
  ]);
});

test('shellKey: what a key in the shell\'s 키 직접 입력 sends there under the defaults', () => {
  const sp = { shell: true, split: true };
  const sk = (key, ctx, extra) => KM0.shellKey(ev(key, extra), ctx);
  assert.equal(sk('Alt+b', sp), null); // folds the sidebar
  assert.equal(sk('Alt+b', sp, { key: '∫', code: 'KeyB' }), null); // a Mac's Option+B
  assert.equal(sk('Alt+b', { shell: true }), 'alt+b'); // the phone: no sidebar, the shell's
  assert.equal(sk('Ctrl+b', sp), 'ctrl+b');
  assert.equal(sk('Alt+ArrowLeft', sp), 'alt+left'); // the shell's back-a-word
  assert.equal(sk('Alt+p', sp), null);
  assert.equal(sk('Ctrl+p', sp), 'ctrl+p');
  assert.equal(sk('Alt+j', sp), null);
  assert.equal(sk('Alt+j', { shell: true }), 'alt+j');
  for (const k of ['Escape', 'Ctrl+[', 'ScrollLock']) assert.equal(sk(k, sp), 'esc', k);
  assert.equal(sk('Ctrl+ArrowUp', sp), null); // prevMine
  assert.equal(sk('Ctrl+Alt+w', sp), null); // closeView (no shell key anyway)
  assert.equal(sk('a', sp), null); // typed text: the field sends it
});

test('Scroll Lock goes back too (a remapped cover Esc: no text, no Ctrl needed), everywhere', () => {
  for (const ctx of [{}, { field: true }, { shell: true }, { layer: true }]) assert.equal(act('ScrollLock', ctx), 'back');
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
  assert.equal(act('ArrowDown', {}), 'menuKey'); // a slash command's menu's only (answer.js); else the page scrolls
  assert.equal(act('Shift+End', {}), null); // selects to the end
  assert.equal(act('Ctrl+End', {}, { isComposing: true }), null);
  assert.equal(act('Ctrl+End', {}, { keyCode: 229 }), null);
});

test('an IME at work: a chord still matches by code, a plain key or e.key alone never', () => {
  // Android with a keyboard cover and Korean on: Alt+` in the message box comes as keyCode 229.
  assert.equal(act('Alt+`', { field: true }, { key: 'Process', code: 'Backquote', keyCode: 229 }), 'lastView');
  assert.equal(act('Alt+`', { field: true }, { key: 'Process', code: '', keyCode: 229 }), null);
  assert.equal(act('1', {}, { key: 'Process', code: 'Digit1', keyCode: 229 }), null);
  // A syllable still being composed when Ctrl+Enter is pressed: e.key says Enter, which is the IME's.
  assert.equal(act('Ctrl+Enter', { field: true }, { isComposing: true, code: '' }), null);
});

test('prevMine / nextMine: Ctrl+↑ and Ctrl+↓ anywhere, the shell and a sheet included', () => {
  for (const ctx of [{}, { field: true }, { shell: true }, { layer: true }]) {
    assert.equal(act('Ctrl+ArrowUp', ctx), 'prevMine');
    assert.equal(act('Ctrl+ArrowDown', ctx), 'nextMine');
  }
  assert.equal(act('ArrowUp', { field: true }), 'menuKey'); // a slash command's menu's when the box is empty (answer.js); else the composer's recall
  assert.equal(act('Ctrl+Alt+ArrowUp', {}), null);
});

test('menuKey: the arrows and Enter on the page and in a field; never in the shell, under a sheet, with a modifier or an IME', () => {
  for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter']) {
    for (const ctx of [{}, { field: true }]) assert.equal(act(k, ctx), 'menuKey', `${k} ${JSON.stringify(ctx)}`);
    assert.equal(act(k, { shell: true }), null, `${k} in the shell`);
    assert.equal(act(k, { layer: true }), null, `${k} under a sheet or menu`);
    assert.equal(act(`Shift+${k}`, {}), null, `Shift+${k}`);
  }
  assert.equal(act('Enter', { field: true }, { isComposing: true, code: '' }), null);
  assert.equal(act('ArrowDown', {}, { keyCode: 229 }), null);
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

test('/ only on the page; Ctrl+? (Ctrl+Shift+/) the 단축키 page anywhere but under a sheet', () => {
  assert.equal(act('/', {}), 'focusInput');
  for (const ctx of [{ field: true }, { shell: true }, { layer: true }]) assert.equal(act('/', ctx), null);
  for (const ctx of [{}, { field: true }, { shell: true }, { split: true }]) assert.equal(act('Ctrl+?', ctx, { shiftKey: true, code: 'Slash' }), 'help');
  assert.equal(act('Ctrl+?', { layer: true }, { shiftKey: true }), null);
  assert.equal(act('?', {}, { shiftKey: true }), null); // a typed ?
  assert.equal(act('Ctrl+/', {}, { code: 'Slash' }), null); // no Shift: not it
  assert.equal(act('Ctrl+?', {}, { key: '/', code: 'Slash', shiftKey: true }), 'help'); // a layout giving / with Shift held
  assert.equal(KM0.label('Ctrl+?'), 'Ctrl+?');
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
  assert.equal(act('Ctrl+Shift+p', {}, { key: 'P' }), 'commands'); // not the switcher: 명령
  assert.equal(act('p', {}), null);
});

test('commands (명령): Ctrl+Shift+P and F1 everywhere, the shell, a field and under a sheet; ⌘⇧P on the Mac', () => {
  for (const ctx of [{}, { field: true }, { layer: true }, { shell: true }, { shell: true, field: true }, { split: true }]) {
    assert.equal(act('Ctrl+Shift+p', ctx, { key: 'P' }), 'commands', JSON.stringify(ctx));
    assert.equal(act('F1', ctx), 'commands', JSON.stringify(ctx));
  }
  assert.equal(act('Ctrl+Shift+p', {}, { key: 'ㅖ', code: 'KeyP' }), 'commands'); // keyboard set to Korean
  assert.equal(KM0.shellKey(ev('Ctrl+Shift+p', { key: 'P' })), null);
  assert.equal(KM0.shellKey(ev('F1')), null);
  assert.equal(KM0.shellKey(ev('Ctrl+p')), 'ctrl+p'); // the shell's previous line stays
  assert.equal(KM0.shellKey(ev('F2')), 'f2');
  assert.equal(hint('commands'), 'Ctrl+Shift+P');
  try {
    for (const app of [false, true]) {
      KM0.setEnv({ mac: true, app });
      assert.equal(hint('commands'), '⌘+Shift+P');
      for (const ctx of [{}, { field: true }, { shell: true }, { layer: true }]) assert.equal(act('Meta+Shift+p', ctx, { key: 'p' }), 'commands');
      KM0.setEnv({ mac: false, app });
      assert.equal(act('Meta+Shift+p', {}, { key: 'p' }), null);
    }
  } finally {
    KM0.setEnv({});
  }
  assert.ok(ACTIONS.commands.noCommand); // no command to open the commands
});

test('closeWorkspace (워크스페이스 닫기): Alt+Shift+W on the page and in a field, Ctrl+Alt+Shift+W in the shell view', () => {
  for (const ctx of [{}, { field: true }, { split: true }]) {
    assert.equal(act('Alt+Shift+w', ctx, { key: 'W' }), 'closeWorkspace');
    assert.equal(act('Ctrl+Alt+Shift+w', ctx, { key: 'W' }), 'closeWorkspace');
  }
  assert.equal(act('Alt+Shift+w', {}, { key: '„', code: 'KeyW' }), 'closeWorkspace'); // a Mac's Option+Shift+W
  assert.equal(act('Alt+Shift+w', { shell: true }, { key: 'W' }), null); // the shell gets it as Alt+W
  assert.equal(KM0.shellKey(ev('Alt+Shift+w', { key: 'W' })), 'alt+w');
  assert.equal(act('Ctrl+Alt+Shift+w', { shell: true }, { key: 'W' }), 'closeWorkspace');
  assert.equal(KM0.shellKey(ev('Ctrl+Alt+Shift+w', { key: 'W' })), null);
  assert.equal(act('Alt+Shift+w', { layer: true }, { key: 'W' }), null); // a sheet decides (its confirm: the same key again)
  assert.equal(act('Alt+w', {}), 'closeView'); // 끝내기 is still Alt+W
  assert.equal(hint('closeWorkspace'), 'Alt+Shift+W');
  assert.equal(hint('closeWorkspace', { shell: true }), 'Ctrl+Alt+Shift+W');
  for (const d of [{ mac: false, app: false }, { mac: true, app: true }]) {
    try {
      KM0.setEnv(d);
      assert.deepEqual(KM0.keysFor('closeWorkspace'), ['Alt+Shift+w', 'Ctrl+Alt+Shift+w']);
    } finally {
      KM0.setEnv({});
    }
  }
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
  // Alt+B: the same, the shell view included; Option+B on a Mac and a Korean layout by e.code
  for (const ctx of [{ split: true }, { split: true, field: true }, { split: true, shell: true }]) assert.equal(act('Alt+b', ctx), 'toggleSide');
  assert.equal(act('Alt+b', { split: true, shell: true }, { key: '∫', code: 'KeyB' }), 'toggleSide');
  assert.equal(act('Alt+b', {}), null);
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

test('new agent / workspace (a tab, not a Mac): Ctrl or Alt + N (Shift for a workspace), never in the shell or under a sheet', () => {
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
  // Every action with a key here (대화창 닫기 has none in a tab).
  for (const [name, a] of Object.entries(ACTIONS)) assert.equal(rows.filter((r) => r.label === a.label).length, name === 'leaveView' ? 0 : 1, a.label);
  const jump = rows.find((r) => r.label === ACTIONS.jumpEnd.label);
  assert.deepEqual(jump.keys, ['Ctrl+Shift+↓', 'Ctrl+End', '⌘+↓', 'End']);
  assert.deepEqual(rows.find((r) => r.label === ACTIONS.answer.label).keys, ['1–9']);
  assert.deepEqual(rows.find((r) => r.label === ACTIONS.switcher.label).keys, ['Ctrl+P', 'Alt+P']);
  assert.deepEqual(rows.find((r) => r.label === ACTIONS.newWorkspace.label).keys, ['Alt+Shift+N', 'Ctrl+Shift+N']); // a tab: Chrome keeps Ctrl+Shift+N
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

test('Alt+U: 사용량 in the agent view, the message box too; not over a sheet; the shell keeps it', () => {
  for (const ctx of [{}, { field: true }, { split: true }]) assert.equal(act('Alt+u', ctx), 'usage', JSON.stringify(ctx));
  assert.equal(act('Alt+u', {}, { key: 'Dead', code: 'KeyU' }), 'usage'); // a Mac's Option+U (¨)
  for (const ctx of [{ shell: true }, { layer: true }]) assert.equal(act('Alt+u', ctx), null, JSON.stringify(ctx)); // upcase-word
  assert.equal(act('u', {}), null);
  assert.ok(ACTIONS.usage.noShell);
  assert.equal(hint('usage'), 'Alt+U');
});

test('Alt+`: the last agent or shell, the shell view and a field included; by code for a dead key', () => {
  for (const ctx of [{}, { field: true }, { shell: true }]) assert.equal(act('Alt+`', ctx), 'lastView');
  assert.equal(act('Alt+`', {}, { key: 'Dead', code: 'Backquote' }), 'lastView');
  assert.equal(act('`', {}), null);
  assert.equal(act('Alt+`', { layer: true }), null);
});

test('Alt+O: 순서 바꾸기 with the focus on the page only (a field types ø on a Mac; the shell keeps it); by code too', () => {
  assert.equal(act('Alt+o', {}), 'reorder');
  assert.equal(act('Alt+o', { split: true }), 'reorder');
  assert.equal(act('Alt+o', {}, { key: 'ø', code: 'KeyO' }), 'reorder');
  assert.equal(act('Alt+o', {}, { key: 'ㅐ', code: 'KeyO' }), 'reorder');
  for (const ctx of [{ field: true }, { shell: true }, { layer: true }]) assert.equal(act('Alt+o', ctx), null, JSON.stringify(ctx));
  assert.equal(act('o', {}), null);
  assert.ok(ACTIONS.reorder.noShell);
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
  // Ctrl+W stays though a tab refuses it: the same storage serves the installed app, which has it.
  const kept = KM.setOverrides({ nope: ['Ctrl+g'], answer: ['Ctrl+g'], jumpEnd: ['Meta+q', 'Ctrl+w', 'Ctrl+g'], jumpTop: ['Ctrl+g'], back: ['Ctrl+q2'] });
  try {
    assert.deepEqual(Object.keys(kept).sort(), ['back', 'jumpEnd', 'jumpTop']);
    assert.deepEqual(kept.jumpEnd, ['Ctrl+w', 'Ctrl+g']); // ⌘Q never
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
  assert.deepEqual(KM.unassign({}, 'back', 'Ctrl+['), { back: ['Escape', 'ScrollLock'] });
  assert.deepEqual(KM.reset({ jumpEnd: [], back: ['Escape'] }, 'jumpEnd'), { back: ['Escape'] });
});

test('stop says ×2 whatever its key', () => {
  withKeys({ stop: ['Ctrl+Shift+x'] }, () => assert.equal(KM.hint('stop'), 'Ctrl+Shift+X ×2'));
});

test('whereText: where an action\'s keys work, the odd one named', () => {
  // The shell view is each key's own 「셸」 switch on the page, except where there is none (뒤로).
  assert.equal(KM.whereText('jumpEnd'), '입력 칸에서도 (End 빼고) · 시트 위에서도');
  assert.equal(KM.whereText('nextRow'), '입력 칸에서도 · 두 칸에서만');
  assert.equal(KM.whereText('help'), '입력 칸에서도');
  assert.equal(KM.whereText('back'), '입력 칸에서도 · 셸 화면에서도 · 시트 위에서도');
  assert.equal(KM.whereText('focusInput'), ''); // only on the page
  withKeys({ help: [] }, () => assert.equal(KM.whereText('help'), ''));
});

test('the quick switcher\'s Ctrl+J/K are the scroll keys: changed with them', () => {
  const row = (re) => KM.LOCAL.find((x) => re.test(x.label));
  assert.deepEqual(KM.localKeys(row(/다음 것 고르기/)), ['Ctrl+j']);
  withKeys({ scrollDown: ['Alt+j'] }, () => assert.deepEqual(KM.localKeys(row(/다음 것 고르기/)), ['Alt+j']));
});

test('the start form\'s Ctrl+리턴 is listed on the 단축키 page and dispatches nothing', () => {
  const row = KM.LOCAL.find((x) => x.group === '폼');
  assert.deepEqual(KM.localKeys(row), ['Ctrl+Enter']);
  assert.ok(KM.sheetGroups().find((g) => g.group === '폼').rows.some((r) => r.keys.includes(label('Ctrl+Enter'))));
  assert.equal(act('Ctrl+Enter', { field: true }), null); // the form takes it (forms.js), not the table
});

test('keyOf records Ctrl+Shift+/ as Ctrl+?, Ctrl+/ as itself', () => {
  assert.equal(KM.keyOf({ key: '?', code: 'Slash', ctrlKey: true, shiftKey: true }), 'Ctrl+?');
  assert.equal(KM.keyOf({ key: '/', code: 'Slash', ctrlKey: true }), 'Ctrl+/');
});

test('Shift+Tab: 모드 in a field (the message box decides), not in the shell view; can be added back', () => {
  assert.equal(act('Shift+Tab', { field: true }), 'mode');
  assert.equal(act('Shift+Tab', {}), 'mode'); // the action leaves it to the focus there
  assert.equal(act('Shift+Tab', { shell: true }), null); // the shell's shift+tab
  assert.equal(act('Tab', { field: true }), null);
  assert.equal(KM.refuse('mode', 'Shift+Tab'), '');
  assert.match(KM.refuse('mode', 'Tab'), /만으로는/);
});

test('Alt+W: close what is open (a sheet asks first), a field too; never in the shell view or under a sheet', () => {
  assert.equal(act('Alt+w', {}), 'closeView');
  assert.equal(act('Alt+w', { field: true }), 'closeView');
  assert.equal(act('Alt+w', {}, { key: '∑', code: 'KeyW' }), 'closeView'); // a Mac's Option+W
  assert.equal(act('Alt+w', { shell: true }), null); // the shell's alt+w
  assert.equal(act('Alt+w', { layer: true }), null);
  assert.match(KM.refuse('closeView', 'Ctrl+w'), /브라우저/); // a tab
});

test('Ctrl+Alt+W: the same close, the shell view included (no shell key)', () => {
  for (const ctx of [{}, { field: true }, { shell: true }, { shell: true, field: true }]) assert.equal(act('Ctrl+Alt+w', ctx), 'closeView');
  assert.equal(rawKeyName(ev('Ctrl+Alt+w')), null);
  assert.equal(act('Ctrl+Alt+w', { layer: true }), null);
});

test('Ctrl+Alt+= / Ctrl+Alt+-: the shell\'s text size, the shell view and a field too (no shell key)', () => {
  for (const ctx of [{}, { field: true }, { shell: true }, { shell: true, field: true, split: true }]) {
    assert.equal(act('Ctrl+Alt+=', ctx), 'termFontUp');
    assert.equal(act('Ctrl+Alt+-', ctx), 'termFontDown');
  }
  assert.equal(rawKeyName(ev('Ctrl+Alt+=')), null);
  assert.equal(rawKeyName(ev('Ctrl+Alt+-')), null);
  assert.equal(KM0.shellKey(ev('Ctrl+Alt+='), { shell: true }), null);
  // A Mac's Ctrl+Option+= types ≠, and Shift (+) still means the same key; by code.
  assert.equal(act('Ctrl+Alt+=', { shell: true }, { key: '≠', code: 'Equal' }), 'termFontUp');
  assert.equal(act('Ctrl+Alt+=', { shell: true }, { key: '+', code: 'Equal', shiftKey: true }), 'termFontUp');
  assert.equal(act('Ctrl+Alt+-', { shell: true }, { key: '–', code: 'Minus' }), 'termFontDown');
  // Without Alt they are the browser's zoom; a bare - or = is typed.
  assert.equal(act('Ctrl+=', {}), null);
  assert.equal(act('-', {}), null);
  assert.equal(act('-', {}, { code: 'Minus' }), null);
  assert.equal(KM0.keyOf({ key: '≠', code: 'Equal', ctrlKey: true, altKey: true }), 'Ctrl+Alt+=');
  assert.equal(hint('termFontUp'), 'Ctrl+Alt+=');
});

// ---- the shell view and the 「셸 화면에서도」 switch
const { withMods } = require('../public/keys.js');
const sp = { shell: true, split: true };

test('unbinding Alt+B gives alt+b back to the shell; the sidebar keeps Ctrl+B', () => {
  withKeys(KM.unassign({}, 'toggleSide', 'Alt+b'), () => {
    assert.equal(KM.shellKey(ev('Alt+b'), sp), 'alt+b');
    assert.equal(act('Alt+b', { split: true }), null);
    assert.equal(act('Ctrl+b', { split: true }), 'toggleSide');
  });
  assert.equal(KM.shellKey(ev('Alt+b'), sp), null); // the defaults again
});

test('a new key: the switch on takes it in the shell view, off (or left alone) leaves it to the shell', () => {
  // Alt+S (the shell's alt+s) for newAgent: automatic is off, the shell uses the key.
  let over = KM.assign({}, 'newAgent', 'Alt+s').overrides;
  withKeys(over, () => {
    assert.equal(KM.shellFor('newAgent', 'Alt+s'), false);
    assert.equal(KM.shellKey(ev('Alt+s'), sp), 'alt+s');
    assert.equal(act('Alt+s', { field: true }), 'newAgent'); // still in a field
  });
  over = KM.setShell(over, 'newAgent', 'Alt+s', true);
  assert.deepEqual(over.newAgent, ['Alt+n', 'Ctrl+n', { key: 'Alt+s', shell: true }]);
  withKeys(over, () => {
    assert.equal(KM.shellFor('newAgent', 'Alt+s'), true);
    assert.equal(KM.shellKey(ev('Alt+s'), sp), null);
    assert.equal(KM.shellKey(ev('Alt+s'), { shell: true }), null); // not split-only
    assert.equal(act('Alt+s', { shell: true, field: true }), 'newAgent'); // 한 줄 입력's line too
    assert.equal(KM.shellKey(ev('Alt+n'), sp), 'alt+n'); // the others as they were
    const row = KM.actionRows().find((r) => r.action === 'newAgent');
    assert.deepEqual(row.shells.find((x) => x.key === 'Alt+s'), { key: 'Alt+s', can: true, on: true, loses: '셸이 이 키(alt+s)를 받지 못합니다' });
  });
  over = KM.setShell(over, 'newAgent', 'Alt+s', false); // back to automatic: the plain key
  assert.deepEqual(over.newAgent, ['Alt+n', 'Ctrl+n', 'Alt+s']);
  withKeys(over, () => assert.equal(KM.shellKey(ev('Alt+s'), sp), 'alt+s'));
});

test('the switch on a default key: off gives it to the shell; back on drops the override', () => {
  let over = KM.setShell({}, 'toggleSide', 'Alt+b', false);
  assert.deepEqual(over, { toggleSide: ['Ctrl+b', { key: 'Alt+b', shell: false }] });
  withKeys(over, () => {
    assert.equal(KM.shellKey(ev('Alt+b'), sp), 'alt+b');
    assert.equal(act('Alt+b', { split: true, field: true }), 'toggleSide'); // elsewhere still the sidebar
  });
  over = KM.setShell(over, 'toggleSide', 'Alt+b', true);
  assert.deepEqual(over, {});
  // On for a default the shell keeps: Ctrl+B takes the shell's back-a-character, and says so.
  over = KM.setShell({}, 'toggleSide', 'Ctrl+b', true);
  withKeys(over, () => {
    assert.equal(KM.shellKey(ev('Ctrl+b'), sp), null);
    const row = KM.actionRows().find((r) => r.action === 'toggleSide');
    assert.equal(row.shells.find((x) => x.key === 'Ctrl+b').loses, '셸의 한 글자 뒤로(ctrl+b) 대신 Hub 가 씁니다');
    assert.equal(row.shells.find((x) => x.key === 'Alt+b').loses, '셸의 한 단어 뒤로(alt+b) 대신 Hub 가 씁니다');
  });
});

test('the switch: not for 뒤로, actions meaningless in the shell view, or a key that types', () => {
  assert.throws(() => KM.setShell({}, 'back', 'Ctrl+[', false), /Esc/);
  assert.throws(() => KM.setShell({}, 'stop', 'Alt+.', true), /셸 화면에서 쓸 일이 없습니다/);
  assert.throws(() => KM.setShell({}, 'focusInput', '/', true), /셸 화면에서 쓸 일이 없습니다/);
  assert.throws(() => KM.setShell(KM.assign({}, 'jumpEnd', 'g').overrides, 'jumpEnd', 'g', true), /글자를 칩니다/);
  assert.equal(KM.refuseShell('jumpEnd', 'End'), ''); // a key that types nothing may
  const rows = KM.actionRows();
  for (const a of ['back', 'stop', 'answer', 'focusInput', 'terminal', 'mode']) assert.ok(rows.find((r) => r.action === a).shells.every((x) => !x.can), a);
  // A stored switch where none can be is dropped, and one that says what the key does anyway too.
  const kept = KM.setOverrides({ stop: [{ key: 'Alt+.', shell: true }], toggleSide: ['Ctrl+b', { key: 'Alt+b', shell: true }] });
  try {
    assert.deepEqual(kept, { stop: ['Alt+.'], toggleSide: ['Ctrl+b', 'Alt+b'] });
  } finally {
    KM.setOverrides({});
  }
});

test('stored overrides of the current format (plain key strings) still load as before', () => {
  const stored = JSON.parse('{"jumpEnd":["Ctrl+g","End"],"toggleSide":["Ctrl+b"],"back":["Escape","ScrollLock"]}');
  withKeys(stored, () => {
    assert.equal(act('Ctrl+g', { field: true, layer: true }), 'jumpEnd');
    assert.equal(KM.shellKey(ev('Ctrl+g'), sp), 'ctrl+g'); // a new key the shell uses: the shell's
    assert.equal(act('End', {}), 'jumpEnd');
    assert.equal(act('End', { field: true }), null);
    assert.equal(KM.shellKey(ev('Alt+b'), sp), 'alt+b'); // Alt+B off the sidebar: the shell's
    assert.equal(KM.shellKey(ev('Ctrl+['), sp), 'esc'); // off 뒤로: still the shell's Esc (rawKeyName)
    assert.equal(KM.shellKey(ev('Escape'), sp), 'esc');
    assert.equal(act('Escape', { field: true }), 'back'); // a kept default key keeps its places
    assert.deepEqual(KM.keysFor('jumpEnd'), ['Ctrl+g', 'End']);
  });
});

test('the key row\'s sticky Alt still sends alt+b: a typed b is no key, and withMods makes it the chord', () => {
  assert.equal(KM.shellKey(ev('b'), sp), null); // the field's beforeinput sends it as text
  assert.deepEqual(withMods({ text: 'b' }, { alt: true }), { key: 'alt+b' });
  assert.deepEqual(withMods({ text: 'p' }, { alt: true }), { key: 'alt+p' });
});

test('wrap: Alt+Z as VS Code, in a field too; in the shell view Ctrl+Alt+Z, Alt+Z stays the shell\'s', () => {
  assert.equal(act('Alt+z', {}), 'wrap');
  assert.equal(act('Alt+z', { field: true }), 'wrap');
  assert.equal(act('Alt+z', {}, { key: 'Ω', code: 'KeyZ' }), 'wrap'); // a Mac's Option+Z
  assert.equal(act('Alt+z', { shell: true, field: true }), null);
  assert.equal(KM0.shellKey(ev('Alt+z'), { shell: true, field: true }), 'alt+z');
  for (const ctx of [{}, { field: true }, { shell: true, field: true }]) assert.equal(act('Ctrl+Alt+z', ctx), 'wrap');
  assert.equal(rawKeyName(ev('Ctrl+Alt+z')), null);
  assert.equal(act('Alt+z', { layer: true }), null);
});

test('F6 / Shift+F6: the focus to the next / previous column, split only; a field, the shell view too, not under a sheet', () => {
  for (const ctx of [{ split: true }, { split: true, field: true }, { split: true, shell: true }]) {
    assert.equal(act('F6', ctx), 'nextPane', JSON.stringify(ctx));
    assert.equal(act('Shift+F6', ctx), 'prevPane', JSON.stringify(ctx));
  }
  assert.equal(act('F6', {}), null); // the phone: one column
  assert.equal(act('F6', { split: true, layer: true }), null);
  assert.equal(KM0.shellKey(ev('F6'), { shell: true, split: true }), null); // the Hub's in the shell
  assert.equal(KM0.shellKey(ev('F6'), { shell: true }), 'f6'); // the phone: the shell's
  assert.equal(act('Ctrl+F6', { split: true }), null);
});

test('hint follows where it is shown: the shell view, the split layout', () => {
  // The shell view: the keys that reach the Hub there, never the shell's own.
  assert.equal(hint('wrap'), 'Alt+Z');
  assert.equal(hint('wrap', { shell: true }), 'Ctrl+Alt+Z');
  assert.equal(hint('closeView', { shell: true }), 'Ctrl+Alt+W');
  assert.equal(hint('toggleSide', { shell: true, split: true }), 'Alt+B');
  assert.equal(hint('switcher', { shell: true }), 'Alt+P');
  assert.equal(hint('menu', { shell: true }), 'Ctrl+Alt+M');
  assert.equal(hint('nextHost', { shell: true }), ''); // Alt+←/→ are the shell's word keys
  assert.equal(hint('back', { shell: true }), ''); // the shell's Esc there
  // 뒤로: Esc and Ctrl+[ (a keyboard cover's Esc never reaches the page).
  assert.equal(hint('back'), 'Esc · Ctrl+[');
  // A pair as one: the host row's 「Alt+←→」, none in the shell view.
  assert.equal(hint('prevHost|nextHost'), 'Alt+←→');
  assert.equal(hint('prevHost|nextHost', { shell: true }), '');
  // Split-only keys say nothing on the phone.
  assert.equal(hint('nextRow', { split: false }), '');
  // A changed key is what it shows.
  withKeys({ wrap: ['Alt+q'] }, () => assert.equal(hint('wrap', { shell: true }), ''));
});

test('menu: Alt+M on the page and in a field, not in the shell view; Ctrl+Alt+M everywhere but a sheet', () => {
  assert.equal(act('Alt+m', {}), 'menu');
  assert.equal(act('Alt+m', { field: true }), 'menu');
  assert.equal(act('Alt+m', {}, { key: 'µ', code: 'KeyM' }), 'menu'); // a Mac's Option+M
  assert.equal(act('Alt+m', { shell: true, field: true }), null); // the shell's alt+m
  assert.equal(KM0.shellKey(ev('Alt+m'), { shell: true, field: true }), 'alt+m');
  for (const ctx of [{}, { field: true }, { shell: true }, { shell: true, field: true }]) assert.equal(act('Ctrl+Alt+m', ctx), 'menu');
  assert.equal(rawKeyName(ev('Ctrl+Alt+m')), null);
  assert.equal(act('Alt+m', { layer: true }), null);
  assert.equal(act('Ctrl+Alt+m', { layer: true }), null);
});

test('the sheet lists the menu keys and the confirm key', () => {
  const g = sheetGroups().find((x) => x.group === '메뉴·확인 창');
  const keys = g.rows.flatMap((r) => r.keys);
  for (const k of ['↓', 'Ctrl+J', 'Ctrl+K', 'Home', 'Ctrl+리턴']) assert.ok(keys.includes(k), k);
});

// ---- the device: the Mac (⌘) and the installed app (the browser's tab and window keys are the
// page's). Each test puts the default device (not a Mac, a tab) back.
const onDevice = (env, fn) => {
  try {
    KM.setEnv(env);
    fn();
  } finally {
    KM.setEnv({});
  }
};
const DEVICES = [
  { mac: false, app: false },
  { mac: false, app: true },
  { mac: true, app: false },
  { mac: true, app: true },
];
const name = (d) => `${d.mac ? 'Mac' : 'other'} ${d.app ? 'app' : 'tab'}`;

test('every device: no key bound twice, every binding an action, and the shell keys taken are the same list', () => {
  const base = KM.BINDINGS.filter((x) => x.shell && rawKeyName(ev(x.key)) != null).map((x) => `${x.key} ${x.action}`);
  for (const d of DEVICES)
    onDevice(d, () => {
      const seen = new Map();
      for (const x of KM.BINDINGS) {
        assert.ok(ACTIONS[x.action], x.action);
        const k = JSON.stringify(parse(x.key));
        assert.ok(!seen.has(k), `${name(d)} ${x.key}: ${seen.get(k)} and ${x.action}`);
        seen.set(k, x.action);
      }
      // ⌘ never reaches the shell: the Mac's ⌘ keys in the shell view take nothing from it.
      assert.deepEqual(KM.BINDINGS.filter((x) => x.shell && rawKeyName(ev(x.key)) != null).map((x) => `${x.key} ${x.action}`), base, name(d));
    });
});

test('대화창 닫기: Ctrl+W (⌘W on the Mac) only in the installed app; a tab leaves them to the browser', () => {
  const leave = (key, ctx, extra) => (KM.match(ev(key, extra), ctx) || {}).action || null;
  onDevice({ mac: false, app: true }, () => {
    for (const ctx of [{}, { field: true }, { layer: true }, { split: true }]) assert.equal(leave('Ctrl+w', ctx), 'leaveView');
    assert.equal(leave('Ctrl+w', {}, { key: 'ㅈ', code: 'KeyW' }), 'leaveView'); // keyboard set to Korean
    assert.equal(leave('Ctrl+w', { shell: true }), null); // the shell's delete-a-word
    assert.equal(KM.shellKey(ev('Ctrl+w'), { shell: true }), 'ctrl+w');
    assert.equal(leave('Meta+w', {}), null);
    assert.equal(KM.refuse('jumpEnd', 'Ctrl+w'), ''); // the app's to give
    assert.equal(KM.refuse('jumpEnd', 'Ctrl+t'), '');
    assert.match(KM.refuse('jumpEnd', 'Alt+F4'), /시스템/);
    assert.equal(KM.hint('leaveView'), 'Ctrl+W');
  });
  onDevice({ mac: true, app: true }, () => {
    for (const ctx of [{}, { field: true }, { layer: true }, { shell: true }, { shell: true, field: true }]) assert.equal(leave('Meta+w', ctx), 'leaveView');
    assert.equal(KM.shellKey(ev('Meta+w'), { shell: true }), null); // never the shell's
    assert.equal(leave('Ctrl+w', {}), null);
    assert.equal(KM.refuse('jumpEnd', 'Meta+w'), '');
    assert.equal(KM.hint('leaveView'), '⌘+W');
    assert.equal(KM.hint('leaveView', { shell: true }), '⌘+W');
  });
  for (const mac of [false, true])
    onDevice({ mac, app: false }, () => {
      assert.equal(leave('Ctrl+w', {}), null);
      assert.equal(leave('Meta+w', {}), null);
      assert.deepEqual(KM.keysFor('leaveView'), []);
      assert.equal(KM.hint('leaveView'), '');
      assert.match(KM.refuse('leaveView', 'Ctrl+w'), /브라우저/);
      assert.match(KM.refuse('leaveView', 'Meta+w'), /브라우저/);
      assert.match(KM.refuse('leaveView', mac ? 'Meta+n' : 'Ctrl+Shift+t'), /브라우저/);
      assert.equal(KM.refuse('leaveView', 'Alt+q'), ''); // a key of one's own still
    });
  // The quit and system keys never, app or tab.
  for (const d of DEVICES)
    onDevice(d, () => {
      for (const k of ['Meta+q', 'Meta+h', 'Meta+m', 'Meta+Tab', 'Meta+`', 'Alt+F4', 'Ctrl+Shift+q']) assert.match(KM.refuse('leaveView', k), /시스템/, `${name(d)} ${k}`);
    });
});

test('대화 종료 stays Alt+W (Option+W), Ctrl+Alt+W in the shell view, on every device', () => {
  for (const d of DEVICES)
    onDevice(d, () => {
      assert.deepEqual(KM.keysFor('closeView'), ['Alt+w', 'Ctrl+Alt+w'], name(d));
      assert.equal((KM.match(ev('Alt+w', { key: '∑', code: 'KeyW' }), {}) || {}).action, 'closeView');
      assert.equal((KM.match(ev('Ctrl+Alt+w'), { shell: true }) || {}).action, 'closeView');
    });
});

test('the Mac: the ⌘ form first (what hints and the 단축키 page show), the Ctrl form kept', () => {
  onDevice({ mac: true, app: true }, () => {
    const sp = { split: true };
    const at = (key, ctx, extra) => (KM.match(ev(key, extra), ctx) || {}).action || null;
    assert.equal(KM.hint('newAgent'), '⌘+N');
    assert.equal(KM.hint('newWorkspace'), '⌘+Shift+N');
    assert.equal(KM.hint('switcher'), '⌘+P');
    assert.equal(KM.hint('toggleSide', sp), '⌘+B');
    assert.equal(KM.hint('settings'), '⌘+,');
    assert.equal(KM.hint('help'), '⌘+?');
    // In the shell view too: ⌘ is never the shell's.
    assert.equal(KM.hint('switcher', { shell: true }), '⌘+P');
    assert.equal(KM.hint('newAgent', { shell: true }), '⌘+N');
    assert.equal(KM.hint('settings', { shell: true }), '⌘+,');
    for (const ctx of [{}, { field: true }, { shell: true }]) {
      assert.equal(at('Meta+n', ctx), 'newAgent');
      assert.equal(at('Meta+Shift+n', ctx, { key: 'N' }), 'newWorkspace');
      assert.equal(at('Meta+p', ctx), 'switcher');
      assert.equal(at('Meta+,', ctx), 'settings');
      assert.equal(at('Meta+?', ctx, { shiftKey: true, code: 'Slash' }), 'help');
      assert.equal(at('Meta+b', { ...ctx, split: true }), 'toggleSide');
    }
    assert.equal(at('Meta+n', {}, { key: 'ㅜ', code: 'KeyN' }), 'newAgent'); // keyboard set to Korean
    // The Ctrl forms as before; in the shell view still the shell's.
    assert.equal(at('Ctrl+n', {}), 'newAgent');
    assert.equal(at('Ctrl+p', { field: true }), 'switcher');
    assert.equal(at('Ctrl+p', { shell: true }), null);
    assert.equal(KM.shellKey(ev('Ctrl+n'), { shell: true }), 'ctrl+n');
    // No Alt twins in the app: Ctrl+N and ⌘N come to the page; Alt+N is readline's again.
    assert.equal(at('Alt+n', {}), null);
    assert.equal(at('Alt+Shift+n', {}, { key: 'N' }), null);
    // The 단축키 page reads ⌘ first.
    const row = (a) => KM.actionRows().find((r) => r.action === a);
    assert.deepEqual(row('newAgent').keys.map(label), ['⌘+N', 'Ctrl+N']);
    assert.deepEqual(row('leaveView').keys.map(label), ['⌘+W']);
    assert.deepEqual(row('switcher').keys.map(label), ['⌘+P', 'Ctrl+P', 'Alt+P']);
    const send = KM.LOCAL.find((x) => x.group === '메시지 칸' && x.key === 'Ctrl+Enter');
    assert.deepEqual(KM.localKeys(send).map(label), ['⌘+리턴', 'Ctrl+리턴']);
    assert.equal(KM.deviceKey('Ctrl+Enter'), 'Meta+Enter');
  });
  onDevice({ mac: true, app: false }, () => {
    // A tab: Chrome keeps ⌘N and ⌘⇧N (a new window), not Ctrl+N; ⌘P, ⌘B, ⌘, come to the page.
    assert.equal(KM.hint('newAgent'), 'Ctrl+N');
    assert.equal(KM.hint('newWorkspace'), 'Ctrl+Shift+N');
    assert.equal(KM.hint('switcher'), '⌘+P');
    assert.equal((KM.match(ev('Meta+n'), {}) || {}).action, undefined);
    assert.equal((KM.match(ev('Alt+n'), {}) || {}).action, undefined);
  });
  onDevice({ mac: false, app: false }, () => {
    assert.equal(KM.hint('switcher'), 'Ctrl+P');
    assert.equal(KM.hint('newAgent'), 'Alt+N'); // Chrome keeps Ctrl+N in a tab
    assert.equal((KM.match(ev('Meta+p'), {}) || {}).action, undefined);
    assert.equal(KM.deviceKey('Ctrl+Enter'), 'Ctrl+Enter');
  });
  onDevice({ mac: false, app: true }, () => {
    assert.equal(KM.hint('newAgent'), 'Ctrl+N');
    assert.equal(KM.hint('newWorkspace'), 'Ctrl+Shift+N');
    assert.equal((KM.match(ev('Alt+n'), {}) || {}).action, undefined);
  });
});

test('changed keys survive the device: a stored app key kept in a tab, the defaults of the device below', () => {
  // A key given in the app (Ctrl+W to something else) is kept by a tab sharing the storage.
  onDevice({ mac: false, app: true }, () => {
    const over = KM.assign({}, 'menu', 'Ctrl+w').overrides;
    assert.deepEqual(over.leaveView, []); // taken from 대화창 닫기
    KM.setOverrides(over);
    assert.equal((KM.match(ev('Ctrl+w'), {}) || {}).action, 'menu');
    KM.setEnv({ mac: false, app: false });
    assert.deepEqual(KM.keysFor('menu'), ['Alt+m', 'Ctrl+Alt+m', 'Ctrl+w']);
    KM.setOverrides({});
  });
  // setEnv lays the device's changes over the new defaults.
  KM.setOverrides({ help: ['F1'] });
  try {
    onDevice({ mac: true, app: true }, () => {
      assert.deepEqual(KM.keysFor('help'), ['F1']);
      assert.equal(KM.hint('switcher'), '⌘+P');
    });
    assert.deepEqual(KM.keysFor('help'), ['F1']);
  } finally {
    KM.setOverrides({});
  }
});

// ---- the 단축키 page (keyspage.js): names, tabs per screen, the one key a row shows, the search

test('every action and every LOCAL row has a short name (the 단축키 page\'s row; the label is the detail)', () => {
  for (const [action, a] of Object.entries(ACTIONS)) {
    assert.ok(a.name && a.name.length <= 12, `${action}: ${a.name}`);
    assert.ok(!/[:(]/.test(a.name), `${action}: ${a.name}`);
  }
  // A row without a key is a note the page says in full (its label); a name is still there to find it by.
  for (const x of LOCAL) assert.ok(x.name && (!x.key || x.name.length <= 12), `${x.group}: ${x.name}`);
  const names = Object.values(ACTIONS).map((a) => a.name);
  assert.equal(new Set(names).size, names.length, 'two actions with one name');
});

test('tabsOf: an action is listed on the screens it works on, 셸 by the keys the Hub takes there', () => {
  const KM = KM0;
  const on = (tab) => Object.keys(ACTIONS).filter((a) => KM.tabsOf(a).includes(tab));
  assert.deepEqual(KM.TABS.map((t) => t.name), ['어디서나', '대화', '셸', '목록']);
  for (const a of Object.keys(ACTIONS)) assert.ok(KM.tabsOf(a).length, `${a} on no tab`);
  assert.deepEqual(on('any'), Object.keys(ACTIONS).filter((a) => ACTIONS[a].group === '어디서나'));
  for (const a of ['jumpEnd', 'closeView', 'closeWorkspace', 'stop', 'answer', 'mode']) assert.ok(on('chat').includes(a), a);
  for (const a of ['prevHost', 'nextRow', 'toggleSide', 'closeWorkspace']) assert.ok(on('list').includes(a), a);
  // 셸: exactly the actions with a key the Hub takes in the shell view; not 뒤로 (the shell's Esc).
  const shell = on('shell');
  assert.deepEqual(shell, Object.keys(ACTIONS).filter((a) => !ACTIONS[a].shellEsc && BINDINGS.some((x) => x.action === a && x.shell)));
  for (const a of ['help', 'switcher', 'commands', 'closeView', 'wrap', 'prevRow']) assert.ok(shell.includes(a), a);
  for (const a of ['back', 'newAgent', 'stop', 'answer', 'mode', 'scrollUp', 'prevHost']) assert.ok(!shell.includes(a), a);
  assert.equal(KM.localTab(LOCAL.find((x) => x.group === '메시지 칸')), 'chat');
  assert.equal(KM.localTab(LOCAL.find((x) => x.group === '셸')), 'shell');
  assert.equal(KM.localTab(LOCAL.find((x) => x.group === '목록 칸 폭')), 'list');
  // The switch moves an action on or off 셸.
  withKeys(KM.setShell({}, 'lastView', 'Alt+`', false), () => assert.ok(!KM.tabsOf('lastView').includes('shell')));
  withKeys(KM.setShell({}, 'newAgent', 'Ctrl+n', true), () => assert.ok(KM.tabsOf('newAgent').includes('shell')));
});

test('primaryKey: the one key a row shows, this device\'s first (⌘ on the Mac), the shell view\'s on 셸', () => {
  const KM = KM0;
  const P = (action, ctx) => label(KM.primaryKey(action, ctx));
  try {
    KM.setEnv({ mac: true, app: true });
    assert.equal(P('switcher'), '⌘+P');
    assert.equal(P('switcher', { shell: true }), '⌘+P');
    assert.equal(P('settings'), '⌘+,');
    assert.equal(P('newAgent'), '⌘+N');
    assert.equal(P('leaveView'), '⌘+W');
    KM.setEnv({ mac: true, app: false });
    assert.equal(P('newAgent'), 'Ctrl+N');
    assert.equal(P('leaveView'), '');
    KM.setEnv({ mac: false, app: false });
    assert.equal(P('newAgent'), 'Alt+N');
    assert.equal(P('switcher'), 'Ctrl+P');
    assert.equal(P('switcher', { shell: true }), 'Alt+P'); // Ctrl+P is the shell's there
    assert.equal(P('closeView', { shell: true }), 'Ctrl+Alt+W');
    assert.equal(P('settings', { shell: true }), '');
    KM.setEnv({ mac: false, app: true });
    assert.equal(P('newAgent'), 'Ctrl+N');
    assert.equal(P('leaveView'), 'Ctrl+W');
    for (const env of [{}, { mac: true }]) {
      KM.setEnv(env);
      assert.equal(P('back'), 'Esc');
      assert.deepEqual(KM.keysIn('back'), KM.keysFor('back'));
    }
  } finally {
    KM.setEnv({});
  }
});

test('search: every tab at once, by name, label or key, each result with its tabs', () => {
  const KM = KM0;
  const find = (q) => KM.search(q);
  const acts = (q) => find(q).filter((x) => x.action).map((x) => x.action);
  assert.deepEqual(find('셸 글자 키우기').find((x) => x.action === 'termFontUp').tabs, ['chat', 'shell']);
  assert.ok(acts('빠른').includes('switcher'));
  assert.deepEqual(acts('alt+p'), ['switcher']); // by a key
  assert.deepEqual(acts('Alt+Shift+W'), ['closeWorkspace']);
  assert.ok(acts('vs code').includes('commands')); // by the label
  const local = find('보내기').filter((x) => x.local);
  assert.ok(local.some((x) => x.local.group === '메시지 칸' && x.tabs[0] === 'chat'));
  assert.ok(find('목록 칸 폭').some((x) => x.local && x.tabs[0] === 'list'));
  assert.deepEqual(find('없는동작이름'), []);
  // A key taken off isn't found by it any more.
  assert.deepEqual(acts('alt+b'), ['toggleSide']);
  withKeys({ toggleSide: ['Ctrl+b'] }, () => assert.deepEqual(acts('alt+b'), []));
});
