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
//   shell  also in the shell view. There the shell's field asks this table first (shell.js): a
//          key bound with shell is the Hub's, every other key goes to the shell as keys.js
//          rawKeyName names it. So a shell binding takes that key from the shell; the defaults
//          take only a few (the tests list them), and 뒤로's keys there are the shell's Esc.
//   layer  also while a sheet or menu is open (the action decides what it means there).
//   split  only in the two-column layout.
// ACTIONS give each action its words for the sheet, in the group it is listed under; fixed: its
// keys are what it means (1–9 pick that choice), so they can't be changed; twice: pressed twice;
// noShell: means nothing in the shell view (no 「셸 화면에서도」 switch); shellEsc: in the shell's
// 키 직접 입력 its keys send the shell Esc (뒤로 there is the shell's Esc).
//
// Changing keys (the 단축키 sheet's 바꾸기): a device keeps overrides, { action: [key, …] }, the
// whole list for each action it changed (core.js, localStorage). setOverrides lays them over the
// table; a key moved to another action leaves the one it had. A key of the action's defaults keeps
// its default places. A new key's places come from its action's defaults, cut down so it never
// takes a typed character (no Ctrl/Alt/⌘: not in a field) or a key the shell uses (keys.js
// rawKeyName: not in the shell view). The 단축키 page's 「셸 화면에서도」 switch overrides the
// shell part for one key: an entry { key, shell } in place of the key string (shellFor).
(function (root) {
  const ACTIONS = {
    back: { group: '어디서나', label: '시트·메뉴 닫기, 입력 칸에서 나가기, 뒤로 (셸의 키 직접 입력에서는 셸의 Esc)', shellEsc: true },
    help: { group: '어디서나', label: '단축키 보기' },
    settings: { group: '어디서나', label: '설정 열기·닫기 (두 칸이면 오른쪽에)' },
    focusInput: { group: '어디서나', label: '입력 칸으로 (대화의 메시지 칸, 셸의 명령 줄)', noShell: true },
    newAgent: { group: '어디서나', label: '새 에이전트: 지금 연 것의 작업공간에 (목록이면 새 워크스페이스)' },
    newWorkspace: { group: '어디서나', label: '새 워크스페이스' },
    switcher: { group: '어디서나', label: '빠른 이동: 에이전트·셸을 이름·작업공간·호스트로 찾아 열기 (셸 화면에서는 Alt+P)' },
    lastView: { group: '어디서나', label: '직전에 보던 에이전트·셸로 (다시 누르면 돌아온다)' },
    nextBlocked: { group: '어디서나', label: '다음 답 필요 에이전트 열기 (목록 순서로 돌아가며)' },
    prevBlocked: { group: '어디서나', label: '이전 답 필요 에이전트 열기' },
    jumpEnd: { group: '대화·터미널 화면', label: '맨 아래로, 그리고 입력 칸으로' },
    jumpTop: { group: '대화·터미널 화면', label: '맨 위로' },
    prevMine: { group: '대화·터미널 화면', label: '내가 보낸 이전 메시지로 (터미널 화면은 한 화면 위로)' },
    nextMine: { group: '대화·터미널 화면', label: '내가 보낸 다음 메시지로 (마지막 다음은 맨 아래, 입력 칸으로)' },
    scrollUp: { group: '대화·터미널 화면', label: '위로 스크롤 (누르고 있으면 계속)' },
    scrollDown: { group: '대화·터미널 화면', label: '아래로 스크롤 (누르고 있으면 계속)' },
    answer: { group: '대화·터미널 화면', label: '답 필요: 그 번호의 선택지 고르기 (입력 칸 밖에서)', fixed: true, noShell: true },
    stop: { group: '대화·터미널 화면', label: '작업 중인 에이전트 중단: 2초 안에 두 번 (입력 칸에서도)', twice: true, noShell: true },
    terminal: { group: '대화·터미널 화면', label: '대화 화면에서 터미널 화면 열기·닫기', noShell: true },
    closeView: { group: '대화·터미널 화면', label: '연 에이전트·셸(또는 워크스페이스) 닫기: 확인 창에서 리턴으로 닫고 Esc 로 그만둔다' },
    mode: { group: '대화·터미널 화면', label: '에이전트 모드 바꾸기 (메시지 칸에서; Claude Code 의 Shift+Tab)', noShell: true },
    prevHost: { group: '목록', label: '이전 호스트 (전체 / 각 기기)' },
    nextHost: { group: '목록', label: '다음 호스트 (두 칸이면 사이드바를 펼친다)' },
    prevRow: { group: '목록', label: '두 칸: 목록의 이전 에이전트·셸 열기' },
    nextRow: { group: '목록', label: '두 칸: 목록의 다음 에이전트·셸 열기' },
    toggleSide: { group: '목록', label: '두 칸: 사이드바 접기·펴기 (입력 칸에서도)' },
  };

  const b = (action, key, o = {}) => ({ action, key, field: false, shell: false, layer: false, split: false, ...o });
  const BINDINGS = [
    // Always taken (app.js): Android turns an Esc the page leaves alone into Back, which closes
    // the app. Ctrl+[ is the terminal's Esc, for a keyboard cover whose Esc the system keeps.
    // In the shell's 키 직접 입력 they are the shell's Esc (shellEsc): the field sends it.
    b('back', 'Escape', { field: true, shell: true, layer: true }),
    b('back', 'Ctrl+[', { field: true, shell: true, layer: true }),
    // Scroll Lock: a key with no text and no system meaning, for a key remapper to turn the
    // cover's Esc into (Key Mapper sends no Ctrl with a key it injects, and its own Esc is taken).
    b('back', 'ScrollLock', { field: true, shell: true, layer: true }),
    // Ctrl+? (Ctrl+Shift+/ on the key): the 단축키 page from anywhere, a field and the shell view
    // too (no shell key); a bare ? is typed. Not Ctrl+/ (no Shift).
    b('help', 'Ctrl+?', { field: true, shell: true }),
    b('focusInput', '/'),
    // Ctrl+Shift+↑/↓: Ctrl+↑/↓ (by your messages) all the way. Easy on a keyboard cover, where
    // End is Fn+→ and ⌘ may belong to the system.
    b('jumpEnd', 'Ctrl+Shift+ArrowDown', { field: true, shell: true, layer: true }),
    b('jumpTop', 'Ctrl+Shift+ArrowUp', { field: true, shell: true, layer: true }),
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
    // Alt+H/L as vim's h and l: the same, by e.code (a Mac's Option+H is ˙, a Korean layout ㅗ).
    // In the shell they stay the shell's, as Alt+←/→ do.
    b('prevHost', 'Alt+h', { field: true }),
    b('nextHost', 'Alt+l', { field: true }),
    // Alt+↑/↓ works in the shell too: it is the way out of a shell that has every other key.
    b('prevRow', 'Alt+ArrowUp', { field: true, shell: true, split: true }),
    b('nextRow', 'Alt+ArrowDown', { field: true, shell: true, split: true }),
    // Alt+K/J as vim's k and j: the same, the shell included (taken from the shell there).
    b('prevRow', 'Alt+k', { field: true, shell: true, split: true }),
    b('nextRow', 'Alt+j', { field: true, shell: true, split: true }),
    // Ctrl+, as in VS Code. Not in the shell, whose keys stay its own; it types nothing in a field.
    b('settings', 'Ctrl+,', { field: true }),
    // Ctrl+P is the shell's (previous line): there Alt+P, taken from the shell (its rarely used
    // history search by prefix). Taken
    // under a sheet too, so the browser never prints; switcher.js decides what it means there.
    b('switcher', 'Ctrl+p', { field: true, layer: true }),
    b('switcher', 'Alt+p', { field: true, shell: true, layer: true }),
    // A digit is typed in a field and is the shell's: only on the page of an agent.
    ...'123456789'.split('').map((n) => b('answer', n)),
    // Ctrl+B is the shell's (back a character), Alt+. its last argument.
    b('toggleSide', 'Ctrl+b', { field: true, split: true }),
    // Alt+B in the shell view too, taken from the shell (its back-a-word is also Alt+←); Ctrl+B
    // there stays the shell's.
    b('toggleSide', 'Alt+b', { field: true, shell: true, split: true }),
    b('stop', 'Alt+.', { field: true }),
    // Ctrl+N is the shell's (next line) and Alt+N readline's; Chrome may keep Ctrl+N (and
    // Ctrl+Shift+N) for a new window, so each has an Alt twin.
    b('newAgent', 'Ctrl+n', { field: true }),
    b('newAgent', 'Alt+n', { field: true }),
    b('newWorkspace', 'Ctrl+Shift+n', { field: true }),
    b('newWorkspace', 'Alt+Shift+n', { field: true }),
    // Alt+Shift+↑/↓: Alt+↑/↓ (the next row) narrowed to the agents waiting for an answer. No shell
    // key (rawKeyName), so the shell view too.
    b('nextBlocked', 'Alt+Shift+ArrowDown', { field: true, shell: true }),
    b('prevBlocked', 'Alt+Shift+ArrowUp', { field: true, shell: true }),
    // Alt+T is the shell's (swap words); the agent view has no shell, and it closes its own sheet.
    b('terminal', 'Alt+t', { field: true, layer: true }),
    // Alt+W: Ctrl+W is the browser's (close the tab or the app window). Alt+W is the shell's
    // (copy a word back), so not in the shell view; close a shell with ⋯ or exit.
    b('closeView', 'Alt+w', { field: true }),
    // Ctrl+Alt+W in the shell view too: no shell key (keys.js sends no Ctrl+Alt chord to the shell).
    b('closeView', 'Ctrl+Alt+w', { field: true, shell: true }),
    // Shift+Tab is the shell's (and moves the focus back on the page): only the message box takes it
    // (KEY_ACTIONS.mode), so a field, not the shell view.
    b('mode', 'Shift+Tab', { field: true }),
    // Alt+` as an app switcher's last app; the backquote key by code too (a Mac's Option+` is a
    // dead key). No shell key either.
    b('lastView', 'Alt+`', { field: true, shell: true }),
  ];

  // Keys handled in their own field, listed in the sheet but not dispatched from here.
  const LOCAL = [
    { group: '메시지 칸', key: 'Ctrl+Enter', label: '보내기 (⌘+리턴도). 리턴 키 설정이 「보내기」면 리턴, 줄바꿈은 Shift+리턴' },
    { group: '메시지 칸', key: 'ArrowUp', label: '빈 칸에서: 전에 보낸 메시지 불러오기 (↓ 는 다음)' },
    { group: '메시지 칸', key: '/', label: '맨 앞에서: 명령 제안 (↑↓ 로 고르고 리턴·Tab)' },
    { group: '메시지 칸', key: '', label: '대화 화면에서 입력 칸 밖에서 친 글자도 메시지 칸으로 간다 (단축키·선택지 숫자·Space 는 빼고)' },
    { group: '셸', key: '', label: '입력 칸 밖에서 누른 키도 셸로 간다. 나가려면 ‹ (✕) 나 두 칸의 Alt+↑/↓ (Alt+K/J)' },
    { group: '셸', key: 'Ctrl+[', label: '키 직접 입력: Esc' },
    { group: '셸', key: '', label: '「셸 화면에서도」가 켜진 키만 Hub 가 쓰고, 나머지는 모두 셸로 간다. 키 줄의 Alt·Ctrl 을 누르고 친 키는 언제나 셸로 (Alt 다음 B 는 셸의 alt+b)' },
    { group: '빠른 이동', key: 'Enter', label: '고른 것 열기. Esc·Ctrl+[ 로 닫기 (태블릿 키보드 덮개의 Esc·뒤로도)' },
    { group: '빠른 이동', key: 'Ctrl+j', follows: 'scrollDown', label: '다음 것 고르기 (↓ 와 같다. 맨 끝 다음은 맨 앞; 아래로 스크롤의 키)' },
    { group: '빠른 이동', key: 'Ctrl+k', follows: 'scrollUp', label: '이전 것 고르기 (↑ 와 같다; 위로 스크롤의 키)' },
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
  const CODES = { '[': 'BracketLeft', ']': 'BracketRight', '/': 'Slash', '?': 'Slash', '.': 'Period', ',': 'Comma', '`': 'Backquote' };
  const SHIFTED = new Set(['?']); // a symbol typed with Shift: by code only with Shift held

  function matches(e, key) {
    const k = parse(key);
    if (Boolean(e.ctrlKey) !== k.ctrl || Boolean(e.altKey) !== k.alt || Boolean(e.metaKey) !== k.meta) return false;
    if (!isSymbol(k.name) && Boolean(e.shiftKey) !== k.shift) return false;
    if (isLetter(k.name)) return (typeof e.key === 'string' && e.key.toLowerCase() === k.name.toLowerCase()) || e.code === `Key${k.name.toUpperCase()}`;
    if (e.key === k.name) return true;
    // Ctrl+[ on a layout where e.key is something else (Alt+. is ≥ on a Mac); never a bare symbol by code, which
    // would turn a typed character into a shortcut on another layout.
    return Boolean(CODES[k.name] && (k.ctrl || k.alt || k.meta) && e.code === CODES[k.name] && (!SHIFTED.has(k.name) || e.shiftKey));
  }

  // The binding a keydown means here, or null. ctx: { field, shell, layer, split }.
  function match(e, ctx = {}) {
    if (!e || e.isComposing || e.keyCode === 229) return null;
    for (const x of active) {
      if ((ctx.field && !x.field) || (ctx.shell && !x.shell) || (ctx.layer && !x.layer) || (x.split && !ctx.split)) continue;
      if (matches(e, x.key)) return x;
    }
    return null;
  }

  // What a key pressed in the shell's 키 직접 입력 sends to the shell (ctx: as for match, with
  // shell): null when a binding gives it to the Hub, 'esc' for 뒤로's keys (the shell's Esc),
  // else keys.js rawKeyName (null: typed text, which the field sends, or no shell key).
  function shellKey(e, ctx = { shell: true }) {
    const x = match(e, ctx);
    if (x) return ACTIONS[x.action].shellEsc ? 'esc' : null;
    return rawKeyName(e);
  }

  // ---- changed keys

  const rawKeyName = (e) => {
    const K = typeof module === 'object' && module.exports ? require('./keys.js') : root.Keys;
    return K ? K.rawKeyName(e) : null;
  };
  const eventOf = (key) => {
    const k = parse(key);
    return { key: k.name, code: '', keyCode: 0, ctrlKey: k.ctrl, altKey: k.alt, metaKey: k.meta, shiftKey: k.shift };
  };
  const norm = (key) => JSON.stringify(parse(key));
  const MOD_KEYS = new Set(['Control', 'Alt', 'AltGraph', 'Shift', 'Meta', 'OS', 'CapsLock', 'Fn', 'FnLock', 'Hyper', 'Super', 'Symbol']);

  // The key string a keydown would be bound as, or null (a modifier alone, an IME at work). A
  // letter, a digit with a modifier, or a symbol with one is read by e.code, so a Korean layout
  // or a Mac's Option characters record the key itself. Shift is dropped for a symbol, which says it.
  function keyOf(e) {
    if (!e || e.isComposing || e.keyCode === 229 || MOD_KEYS.has(e.key)) return null;
    const mod = e.ctrlKey || e.altKey || e.metaKey;
    const code = e.code || '';
    const letter = /^Key([A-Z])$/.exec(code);
    const digit = /^Digit(\d)$/.exec(code);
    const sym = Object.keys(CODES).find((c) => CODES[c] === code && !SHIFTED.has(c));
    let name = null;
    if (letter && (mod || !/^[a-z]$/i.test(e.key || ''))) name = letter[1].toLowerCase();
    else if (/^[a-z]$/i.test(e.key || '')) name = e.key.toLowerCase();
    else if (digit && mod) name = digit[1];
    // The symbol the key gives with Shift where that is ours (Ctrl+Shift+/ is Ctrl+?), else its own.
    else if (sym && mod) name = e.shiftKey ? Object.keys(CODES).find((c) => CODES[c] === code && SHIFTED.has(c)) || sym : sym;
    else if (typeof e.key === 'string' && e.key && !['Unidentified', 'Process', 'Dead'].includes(e.key)) name = e.key;
    if (!name) return null;
    return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.metaKey && 'Meta', e.shiftKey && !isSymbol(name) && 'Shift', name].filter(Boolean).join('+');
  }

  // Keys the browser or the system keeps (the page never sees them, or it would close a tab).
  const RESERVED = ['Ctrl+w', 'Ctrl+Shift+w', 'Ctrl+t', 'Ctrl+Shift+t', 'Ctrl+Tab', 'Ctrl+Shift+Tab', 'Ctrl+q', 'Meta+w', 'Meta+q', 'Meta+t', 'Alt+F4'].map(norm);
  // Why key can't be given to action, or ''. overrides: the device's changes so far.
  function refuse(action, key) {
    if (!key) return '이 키는 받을 수 없습니다';
    const k = parse(key);
    const mod = k.ctrl || k.alt || k.meta;
    if (RESERVED.includes(norm(key))) return `${label(key)} 는 브라우저가 먼저 가져갑니다`;
    if (k.name === '+') return '+ 는 쓸 수 없습니다';
    if (!mod && !(k.shift && k.name === 'Tab') && ['Enter', 'Tab', ' ', 'Backspace', 'Delete'].includes(k.name)) return `${label(key)} 만으로는 쓸 수 없습니다: 단추 누르기·이동·지우기에 씁니다`;
    if (k.name === 'Escape' && action !== 'back') return 'Esc 는 뒤로·닫기에만 씁니다';
    const fixed = BINDINGS.find((x) => ACTIONS[x.action].fixed && norm(x.key) === norm(key));
    if (fixed) return `${label(key)} 는 「${ACTIONS[fixed.action].label}」에 씁니다`;
    if (ACTIONS[action] && ACTIONS[action].fixed) return '이 동작의 키는 바꿀 수 없습니다';
    return '';
  }

  // An override entry is a key string, or { key, shell } with the 「셸 화면에서도」 switch set.
  const keyOfEntry = (x) => (typeof x === 'string' ? x : x && x.key);
  const defaultOf = (action, key) => BINDINGS.find((x) => x.action === action && norm(x.key) === norm(key));
  // A key that types a character (no Ctrl/Alt/⌘): never the Hub's in a field or the shell view.
  const typesText = (key) => {
    const k = parse(key);
    return !(k.ctrl || k.alt || k.meta) && [...k.name].length === 1;
  };

  // Whether the Hub takes key (of action) in the shell view when the switch is left alone: a
  // default key as the table says; a new one if its action works there and the shell doesn't
  // use the key.
  function autoShell(action, key) {
    const def = defaultOf(action, key);
    if (def) return def.shell;
    const k = parse(key);
    return BINDINGS.some((x) => x.action === action && x.shell) && (k.ctrl || k.alt || k.meta) && rawKeyName(eventOf(key)) == null;
  }
  // Whether an action's keys can have the switch at all.
  const canShellAction = (action) => Boolean(ACTIONS[action] && !ACTIONS[action].fixed && !ACTIONS[action].noShell && !ACTIONS[action].shellEsc);
  // Why the switch can't be turned on for key of action, or ''.
  function refuseShell(action, key) {
    const a = ACTIONS[action];
    if (a && a.shellEsc) return '셸 화면에서는 셸의 Esc 입니다';
    if (!canShellAction(action)) return '이 동작은 셸 화면에서 쓸 일이 없습니다';
    if (typesText(key)) return `${label(key)} 는 글자를 칩니다: 셸 화면에서는 셸로 갑니다`;
    return '';
  }

  // A changed key's binding: its default places, or the action's places cut down (the comment at
  // the top); the switch, if set, decides the shell view.
  function bindingFor(action, entry) {
    const key = keyOfEntry(entry);
    const def = defaultOf(action, key);
    const shell = typeof entry === 'object' && typeof entry.shell === 'boolean' && !refuseShell(action, key) ? entry.shell : autoShell(action, key);
    if (def) return { ...def, key, shell, custom: shell !== def.shell };
    const own = BINDINGS.filter((x) => x.action === action);
    const any = (f) => own.some((x) => x[f]);
    const k = parse(key);
    return {
      action,
      key,
      field: any('field') && (k.ctrl || k.alt || k.meta),
      shell,
      layer: any('layer'),
      split: own.length > 0 && own.every((x) => x.split),
      custom: true,
    };
  }

  // An action's override entries (its default keys when it has none of its own).
  function entriesFor(action, overrides = current) {
    return overrides && Array.isArray(overrides[action]) ? overrides[action] : BINDINGS.filter((x) => x.action === action).map((x) => x.key);
  }
  // The keys an action has under overrides (its defaults when it has none of its own).
  function keysFor(action, overrides = current) {
    return entriesFor(action, overrides).map(keyOfEntry);
  }

  // A key string this page could have recorded: modifiers, then one character or a key's name.
  const NAMED = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete', 'Backspace', 'Enter', 'Tab', 'Escape', 'ScrollLock', 'ContextMenu']);
  function realKey(key) {
    if (typeof key !== 'string' || !key) return false;
    const parts = key.split('+');
    const name = parts.pop();
    if (!parts.every((m) => MODS.includes(m)) || new Set(parts).size !== parts.length) return false;
    return [...name].length === 1 || NAMED.has(name) || /^F([1-9]|1\d|2[0-4])$/.test(name);
  }

  // overrides with only what can stand: known, changeable actions; keys that are allowed and
  // not given twice (the first action keeps one); 뒤로 always with Esc.
  function clean(overrides) {
    const out = {};
    const taken = new Map();
    for (const [action, keys] of Object.entries(overrides || {})) {
      if (!ACTIONS[action] || ACTIONS[action].fixed || !Array.isArray(keys)) continue;
      out[action] = [];
      for (const entry of keys) {
        const key = keyOfEntry(entry);
        if (!realKey(key) || refuse(action, key) || taken.has(norm(key))) continue;
        taken.set(norm(key), action);
        // The switch is kept only where it says something: on a key that can have it, and not
        // what the key would do anyway.
        const sw = entry && typeof entry === 'object' && typeof entry.shell === 'boolean' && !refuseShell(action, key) && entry.shell !== autoShell(action, key);
        out[action].push(sw ? { key, shell: entry.shell } : key);
      }
    }
    if (out.back && !out.back.some((k) => norm(k) === norm('Escape'))) out.back.unshift('Escape');
    return out;
  }

  let current = {};
  let active = BINDINGS;
  // The table this page goes by: the defaults with overrides laid over them. A default key that
  // an override gave to another action leaves its own. Returns the overrides as kept.
  function setOverrides(overrides) {
    current = clean(overrides);
    const given = new Set(Object.values(current).flat().map(keyOfEntry).map(norm));
    active = [
      ...BINDINGS.filter((x) => !(x.action in current) && !given.has(norm(x.key))),
      ...Object.entries(current).flatMap(([action, keys]) => keys.map((entry) => bindingFor(action, entry))),
    ];
    return current;
  }

  // key given to action: new overrides, and the action it was taken from (or null). Throws the
  // reason when it can't be.
  function assign(overrides, action, key) {
    const why = refuse(action, key);
    if (why) throw new Error(why);
    const was = active.find((x) => norm(x.key) === norm(key));
    if (was && was.action === action) return { overrides, from: null };
    const out = { ...overrides };
    if (was) out[was.action] = entriesFor(was.action, overrides).filter((x) => norm(keyOfEntry(x)) !== norm(key));
    out[action] = [...entriesFor(action, overrides), key];
    return { overrides: out, from: was ? was.action : null };
  }
  // key taken off action (뒤로 keeps Esc).
  function unassign(overrides, action, key) {
    if (action === 'back' && norm(key) === norm('Escape')) throw new Error('Esc 는 뺄 수 없습니다: 뒤로·닫기의 기본 키입니다');
    return { ...overrides, [action]: entriesFor(action, overrides).filter((x) => norm(keyOfEntry(x)) !== norm(key)) };
  }
  // The 「셸 화면에서도」 switch of one key of action: on, the Hub takes it in the shell view; off,
  // it goes to the shell there. Back to what the key does anyway, the switch is dropped (and the
  // action's override with it when nothing else is changed). Throws the reason when it can't be.
  function setShell(overrides, action, key, on) {
    const why = refuseShell(action, key);
    if (why && on !== autoShell(action, key)) throw new Error(why);
    const entries = entriesFor(action, overrides).map((x) => {
      const k = keyOfEntry(x);
      if (norm(k) !== norm(key)) return x;
      return on === autoShell(action, k) ? k : { key: k, shell: on };
    });
    const out = { ...overrides, [action]: entries };
    const defaults = BINDINGS.filter((x) => x.action === action).map((x) => x.key);
    if (entries.length === defaults.length && entries.every((x, i) => x === defaults[i])) delete out[action];
    return out;
  }
  // Whether the Hub takes key in the shell view now (the active table).
  function shellFor(action, key) {
    const x = active.find((y) => y.action === action && norm(y.key) === norm(key));
    return Boolean(x && x.shell);
  }
  // What the shell loses when the Hub takes key there: 「셸의 한 단어 뒤로(alt+b) 대신 Hub 가
  // 씁니다」, 「셸이 이 키(alt+j)를 받지 못합니다」, or '' (a key the shell never gets).
  function shellLoses(key) {
    const name = rawKeyName(eventOf(key));
    if (!name) return '';
    const K = typeof module === 'object' && module.exports ? require('./keys.js') : root.Keys;
    const what = K && K.shellMeaning ? K.shellMeaning(name) : '';
    return what ? `셸의 ${what}(${name}) 대신 Hub 가 씁니다` : `셸이 이 키(${name})를 받지 못합니다`;
  }
  // action back to its defaults.
  function reset(overrides, action) {
    const out = { ...overrides };
    delete out[action];
    return out;
  }

  // Where an action's keys work, in words for the 단축키 page: 「입력 칸에서도 (End 빼고)」,
  // 「셸 화면에서도」, 「두 칸에서만」, 「시트 위에서도」. Empty when only on the page.
  function whereText(action) {
    const own = active.filter((x) => x.action === action);
    if (!own.length) return '';
    const some = (f) => own.filter((x) => x[f]);
    const but = (f) => {
      const yes = some(f);
      if (!yes.length) return null;
      const no = own.filter((x) => !x[f]).map((x) => label(x.key));
      return no.length ? ` (${no.join('·')} 빼고)` : '';
    };
    const out = [];
    const field = but('field');
    if (field != null) out.push(`입력 칸에서도${field}`);
    // The keys' own 「셸」 switches say it where there are switches.
    const shell = but('shell');
    if (shell != null && !canShellAction(action)) out.push(`셸 화면에서도${shell}`);
    if (own.every((x) => x.split)) out.push('두 칸에서만');
    if (own.every((x) => x.layer)) out.push('시트 위에서도');
    return out.join(' · ');
  }

  // The 바꾸기 rows: each action, its keys now, and whether this device changed them.
  // shells: per key, whether the 「셸 화면에서도」 switch can be there (can), is on (on), and what
  // the shell loses to it (loses, only when on).
  function actionRows() {
    return Object.entries(ACTIONS).map(([action, a]) => {
      const keys = active.filter((x) => x.action === action).map((x) => x.key);
      return {
        action,
        group: a.group,
        label: a.label,
        fixed: Boolean(a.fixed),
        changed: action in current,
        keys,
        shells: keys.map((key) => {
          const on = shellFor(action, key);
          const can = !refuseShell(action, key);
          return { key, can, on, loses: on && can ? shellLoses(key) : '' };
        }),
      };
    });
  }

  // How a key reads in the sheet: Ctrl+↓, ⌘+↓, Esc.
  const NAMES = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', Enter: '리턴', ' ': 'Space' };
  function label(key) {
    if (!key) return '';
    const k = parse(key);
    const name = NAMES[k.name] || (isLetter(k.name) ? k.name.toUpperCase() : k.name);
    return [k.ctrl && 'Ctrl', k.alt && 'Alt', k.meta && '⌘', k.shift && 'Shift', name].filter(Boolean).join('+');
  }

  // The keys a button shows (its title, and the badge while Ctrl or Alt is held): an action's own
  // hint, else its first key.
  function hint(action) {
    const a = ACTIONS[action];
    const x = active.find((y) => y.action === action);
    if (!x) return '';
    return a && a.twice ? `${label(x.key)} ×2` : label(x.key);
  }

  // A LOCAL row's keys: an action's (follows: the field uses that action's keys), else its own.
  function localKeys(x) {
    if (x.follows) return keysFor(x.follows);
    return x.key ? [x.key] : [];
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
    for (const x of active) add(ACTIONS[x.action].group, ACTIONS[x.action].label, [label(x.key)]);
    for (const x of LOCAL) add(x.group, x.label, localKeys(x).map(label));
    // 1 … 9 read as one key: 1–9.
    for (const rows of groups.values())
      for (const r of rows) if (r.keys.length > 2 && r.keys.every((k) => /^\d$/.test(k))) r.keys = [`${r.keys[0]}–${r.keys[r.keys.length - 1]}`];
    return [...groups].map(([group, rows]) => ({ group, rows }));
  }

  const api = { ACTIONS, BINDINGS, LOCAL, MODS, parse, matches, match, label, hint, sheetGroups, keyOf, refuse, refuseShell, shellKey, setOverrides, assign, unassign, reset, setShell, shellFor, shellLoses, keysFor, actionRows, whereText, localKeys };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Keymap = api;
})(typeof self !== 'undefined' ? self : this);
