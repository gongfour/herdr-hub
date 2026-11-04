'use strict';
// Every Hub keyboard shortcut, in one table: what app.js dispatches, what the 단축키 sheet lists,
// and what the tests check for clashes. A new shortcut goes here and nowhere else (AGENTS.md).
// Pure: loaded as a plain script in the page (window.Keymap), required by the tests.
//
// A binding: { action, key, field, shell, layer, split }
//   key    'Ctrl+ArrowDown', 'Alt+ArrowLeft', 'Ctrl+k', '/', 'End' — modifiers Ctrl, Alt, Meta
//          (⌘), Shift, then e.key. A letter also matches by e.code (KeyK), so it works with the
//          keyboard set to Korean; '[' by BracketLeft. A single symbol ('/', '?', '[') ignores
//          Shift, which the symbol already says.
//   field  also while typing in a field (the composer, the shell's line, a form); else only with
//          the focus on the page.
//   shell  also in the shell view. A key the shell itself needs (keys.js rawKeyName) must not be
//          taken there: the tests hold every shell binding to that.
//   layer  also while a sheet or menu is open (the action decides what it means there).
//   split  only in the two-column layout.
// ACTIONS give each action its words for the sheet, in the group it is listed under.
(function (root) {
  const ACTIONS = {
    back: { group: '어디서나', label: '시트·메뉴 닫기, 입력 칸에서 나가기, 뒤로' },
    help: { group: '어디서나', label: '단축키 보기' },
    focusInput: { group: '어디서나', label: '입력 칸으로 (대화의 메시지 칸, 셸의 명령 줄)' },
    jumpEnd: { group: '대화·터미널 화면', label: '맨 아래로, 그리고 입력 칸으로' },
    prevMine: { group: '대화·터미널 화면', label: '내가 보낸 이전 메시지로 (터미널 화면은 한 화면 위로)' },
    nextMine: { group: '대화·터미널 화면', label: '내가 보낸 다음 메시지로 (마지막 다음은 맨 아래, 입력 칸으로)' },
    scrollUp: { group: '대화·터미널 화면', label: '위로 스크롤 (누르고 있으면 계속)' },
    scrollDown: { group: '대화·터미널 화면', label: '아래로 스크롤 (누르고 있으면 계속)' },
    prevHost: { group: '목록', label: '이전 호스트 (전체 / 각 기기)' },
    nextHost: { group: '목록', label: '다음 호스트 (두 칸이면 사이드바를 펼친다)' },
    prevRow: { group: '목록', label: '두 칸: 목록의 이전 에이전트·셸 열기' },
    nextRow: { group: '목록', label: '두 칸: 목록의 다음 에이전트·셸 열기' },
  };

  const b = (action, key, o = {}) => ({ action, key, field: false, shell: false, layer: false, split: false, ...o });
  const BINDINGS = [
    // Always taken (app.js): Android turns an Esc the page leaves alone into Back, which closes
    // the app. Ctrl+[ is the terminal's Esc, for a keyboard cover whose Esc the system keeps.
    // In the shell's 키 직접 입력 the field takes both first and sends them to the shell.
    b('back', 'Escape', { field: true, shell: true, layer: true }),
    b('back', 'Ctrl+[', { field: true, shell: true, layer: true }),
    b('help', '?'),
    b('focusInput', '/'),
    b('jumpEnd', 'Ctrl+End', { field: true, shell: true, layer: true }),
    b('jumpEnd', 'Meta+ArrowDown', { field: true, shell: true, layer: true }),
    b('jumpEnd', 'End', { layer: true }), // in a field End is the caret's
    // Ctrl+↑/↓ step by the messages you sent; Ctrl+K/J (as vim's k and j) just scroll.
    b('prevMine', 'Ctrl+ArrowUp', { field: true, shell: true, layer: true }),
    b('nextMine', 'Ctrl+ArrowDown', { field: true, shell: true, layer: true }),
    b('scrollUp', 'Ctrl+k', { field: true, layer: true }), // the shell's kill-to-end
    b('scrollDown', 'Ctrl+j', { field: true, layer: true }), // the shell's newline
    b('prevHost', 'Alt+ArrowLeft', { field: true }), // the shell's word keys
    b('nextHost', 'Alt+ArrowRight', { field: true }),
    // Alt+↑/↓ works in the shell too: it is the way out of a shell that has every other key.
    b('prevRow', 'Alt+ArrowUp', { field: true, shell: true, split: true }),
    b('nextRow', 'Alt+ArrowDown', { field: true, shell: true, split: true }),
  ];

  // Keys handled in their own field, listed in the sheet but not dispatched from here.
  const LOCAL = [
    { group: '메시지 칸', key: 'Ctrl+Enter', label: '보내기 (⌘+리턴도). 리턴 키 설정이 「보내기」면 리턴, 줄바꿈은 Shift+리턴' },
    { group: '메시지 칸', key: 'ArrowUp', label: '빈 칸에서: 전에 보낸 메시지 불러오기 (↓ 는 다음)' },
    { group: '메시지 칸', key: '/', label: '맨 앞에서: 명령 제안 (↑↓ 로 고르고 리턴·Tab)' },
    { group: '셸', key: '', label: '입력 칸 밖에서 누른 키도 셸로 간다. 나가려면 ‹ (✕) 나 두 칸의 Alt+↑/↓' },
    { group: '셸', key: 'Ctrl+[', label: '키 직접 입력: Esc. Alt+←/→·Alt+. 은 단어 이동, Ctrl+K·Ctrl+J 도 셸로' },
  ];

  const MODS = ['Ctrl', 'Alt', 'Meta', 'Shift'];
  function parse(key) {
    const parts = key === '+' ? ['+'] : key.split('+');
    const name = parts.pop();
    const mods = new Set(parts);
    return { name, ctrl: mods.has('Ctrl'), alt: mods.has('Alt'), meta: mods.has('Meta'), shift: mods.has('Shift') };
  }
  const isLetter = (s) => /^[a-z]$/i.test(s);
  const isSymbol = (s) => s.length === 1 && !isLetter(s) && !/^\d$/.test(s);
  const CODES = { '[': 'BracketLeft', ']': 'BracketRight', '/': 'Slash' };

  function matches(e, key) {
    const k = parse(key);
    if (Boolean(e.ctrlKey) !== k.ctrl || Boolean(e.altKey) !== k.alt || Boolean(e.metaKey) !== k.meta) return false;
    if (!isSymbol(k.name) && Boolean(e.shiftKey) !== k.shift) return false;
    if (isLetter(k.name)) return (typeof e.key === 'string' && e.key.toLowerCase() === k.name.toLowerCase()) || e.code === `Key${k.name.toUpperCase()}`;
    if (e.key === k.name) return true;
    // Ctrl+[ on a layout where e.key is something else; never a bare symbol by code, which
    // would turn a typed character into a shortcut on another layout.
    return Boolean(CODES[k.name] && (k.ctrl || k.alt || k.meta) && e.code === CODES[k.name]);
  }

  // The binding a keydown means here, or null. ctx: { field, shell, layer, split }.
  function match(e, ctx = {}) {
    if (!e || e.isComposing || e.keyCode === 229) return null;
    for (const x of BINDINGS) {
      if ((ctx.field && !x.field) || (ctx.shell && !x.shell) || (ctx.layer && !x.layer) || (x.split && !ctx.split)) continue;
      if (matches(e, x.key)) return x;
    }
    return null;
  }

  // How a key reads in the sheet: Ctrl+↓, ⌘+↓, Esc.
  const NAMES = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', Enter: '리턴' };
  function label(key) {
    if (!key) return '';
    const k = parse(key);
    const name = NAMES[k.name] || (isLetter(k.name) ? k.name.toUpperCase() : k.name);
    return [k.ctrl && 'Ctrl', k.alt && 'Alt', k.meta && '⌘', k.shift && 'Shift', name].filter(Boolean).join('+');
  }

  // The sheet's rows: [{ group, rows: [{ keys: ['Ctrl+↓', …], label }] }], groups in order.
  function sheetGroups() {
    const groups = new Map();
    const add = (group, label, keys) => {
      if (!groups.has(group)) groups.set(group, []);
      const rows = groups.get(group);
      const row = rows.find((r) => r.label === label);
      if (row) row.keys.push(...keys.filter((k) => !row.keys.includes(k)));
      else rows.push({ label, keys: [...keys] });
    };
    for (const x of BINDINGS) add(ACTIONS[x.action].group, ACTIONS[x.action].label, [label(x.key)]);
    for (const x of LOCAL) add(x.group, x.label, x.key ? [label(x.key)] : []);
    return [...groups].map(([group, rows]) => ({ group, rows }));
  }

  const api = { ACTIONS, BINDINGS, LOCAL, MODS, parse, matches, match, label, sheetGroups };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Keymap = api;
})(typeof self !== 'undefined' ? self : this);
