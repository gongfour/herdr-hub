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
// ACTIONS give each action its words for the sheet: name, the 단축키 page's short row, and label, the
// whole of it; group, the screen it is listed under (its tab there, tabsOf; also: more tabs); fixed: its
// keys are what it means (1–9 pick that choice), so they can't be changed; twice: pressed twice;
// noShell: means nothing in the shell view (no 「셸 화면에서도」 switch); shellEsc: in the shell's
// 키 직접 입력 its keys send the shell Esc (뒤로 there is the shell's Esc).
// Every action is also a command in 명령 (the quick switcher's > mode, Ctrl+Shift+P, palette.js),
// named by its label up to the first 「:」 or 「 (」, or by cmd; noCommand: not one (a key that only
// means something as a key: scrolling, stepping the focus).
//
// Changing keys (the 단축키 sheet's 바꾸기): a device keeps overrides, { action: [key, …] }, the
// whole list for each action it changed (core.js, localStorage). setOverrides lays them over the
// table; a key moved to another action leaves the one it had. A key of the action's defaults keeps
// its default places. A new key's places come from its action's defaults, cut down so it never
// takes a typed character (no Ctrl/Alt/⌘: not in a field) or a key the shell uses (keys.js
// rawKeyName: not in the shell view). The 단축키 page's 「셸 화면에서도」 switch overrides the
// shell part for one key: an entry { key, shell } in place of the key string (shellFor).
//
// The device (setEnv): mac, where ⌘ is the user's key, and app, the installed app (display-mode
// standalone): there the browser's tab and window keys (Ctrl+W, Ctrl+N, ⌘W, ⌘N …) come to the
// page first, as VS Code for the Web takes them; in a plain tab the browser keeps them. The
// table is built for the device; the keys that quit or are the system's stay refused anywhere.
(function (root) {
  const ACTIONS = {
    back: { group: '어디서나', name: '뒤로·닫기', label: '시트·메뉴 닫기, 에이전트에 열린 메뉴(/model …) 취소, 입력 칸에서 나가기, 뒤로 (셸의 키 직접 입력에서는 셸의 Esc)', shellEsc: true, noCommand: true },
    leaveView: { group: '어디서나', name: '대화창 닫기', label: '대화창 닫기: 연 에이전트·셸·워크스페이스(또는 시트, 설정)에서 나온다. 에이전트는 그대로 돈다 (Ctrl+W·⌘W 는 설치한 앱에서만; 닫을 것이 없으면 앱 창이 닫힌다)' },
    help: { group: '어디서나', name: '단축키', label: '단축키 보기' },
    settings: { group: '어디서나', name: '설정', label: '설정 열기·닫기 (두 칸이면 오른쪽에)' },
    focusInput: { group: '어디서나', name: '입력 칸으로', label: '입력 칸으로 (대화의 메시지 칸, 셸의 명령 줄)', noShell: true },
    newAgent: { group: '어디서나', name: '새 에이전트', label: '새 에이전트 바로 시작: 지금 연 것의 워크스페이스·폴더에, 이 기기에서 마지막에 쓴 종류·옵션으로 (목록이면 새 워크스페이스)' },
    newWorkspace: { group: '어디서나', name: '새 워크스페이스', label: '새 워크스페이스' },
    menu: { group: '어디서나', name: '⋯ 메뉴', label: '⋯ 메뉴 열기: 지금 연 에이전트·셸·워크스페이스의 것 (목록 줄에 포커스가 있으면 그 줄의 것)' },
    switcher: { group: '어디서나', name: '빠른 이동', label: '빠른 이동: 에이전트·셸을 이름·워크스페이스·호스트로 찾아 열기 (셸 화면에서는 Alt+P)' },
    commands: { group: '어디서나', name: '명령 팔레트', label: '명령: 할 수 있는 일을 이름으로 찾아 하기 (빠른 이동에서 > 를 먼저 쳐도; VS Code 의 Ctrl+Shift+P·F1)', noCommand: true },
    lastView: { group: '어디서나', name: '직전에 보던 것', label: '직전에 보던 에이전트·셸로 (다시 누르면 돌아온다; 목록에서는 방금 나온 것, 「방금 본 대화」)' },
    nextBlocked: { group: '어디서나', name: '다음 답 필요', label: '다음 답 필요 에이전트 열기 (목록 순서로 돌아가며)' },
    prevBlocked: { group: '어디서나', name: '이전 답 필요', label: '이전 답 필요 에이전트 열기' },
    jumpEnd: { group: '대화·터미널 화면', name: '맨 아래로', label: '맨 아래로, 그리고 입력 칸으로' },
    jumpTop: { group: '대화·터미널 화면', name: '맨 위로', label: '맨 위로 (대화에서는 앞 대화를 한 쪽 더 불러온다)' },
    prevMine: { group: '대화·터미널 화면', name: '내 이전 메시지', label: '내가 보낸 이전 메시지로 (터미널 화면은 한 화면 위로)', noCommand: true },
    nextMine: { group: '대화·터미널 화면', name: '내 다음 메시지', label: '내가 보낸 다음 메시지로 (마지막 다음은 맨 아래, 입력 칸으로)', noCommand: true },
    scrollUp: { group: '대화·터미널 화면', name: '위로 스크롤', label: '위로 스크롤 (누르고 있으면 계속)', noCommand: true },
    scrollDown: { group: '대화·터미널 화면', name: '아래로 스크롤', label: '아래로 스크롤 (누르고 있으면 계속)', noCommand: true },
    answer: { group: '대화·터미널 화면', name: '선택지 고르기', label: '답 필요: 그 번호의 선택지 고르기 (입력 칸 밖에서)', fixed: true, noShell: true },
    stop: { group: '대화·터미널 화면', name: '에이전트 중단', label: '작업 중인 에이전트 중단: 2초 안에 두 번 (입력 칸에서도)', twice: true, noShell: true, cmd: '에이전트 중단' },
    wrap: { group: '대화·터미널 화면', name: '줄바꿈', label: '줄바꿈 켜기·끄기: 셸 화면, 에이전트의 터미널 화면 (VS Code 의 Alt+Z)' },
    terminal: { group: '대화·터미널 화면', name: '터미널 화면', label: '대화 화면에서 터미널 화면 열기·닫기', noShell: true, cmd: '터미널 화면 열기·닫기' },
    termFontUp: { group: '대화·터미널 화면', name: '셸 글자 키우기', label: '셸 글자 키우기 (설정 → 셸 글자 크기)' },
    termFontDown: { group: '대화·터미널 화면', name: '셸 글자 줄이기', label: '셸 글자 줄이기' },
    closeView: { group: '대화·터미널 화면', name: '끝내기', label: '끝내기: 연 에이전트·셸을 끝낸다 (워크스페이스 화면이면 그 워크스페이스를 닫는다). 확인 창에서 같은 키를 한 번 더 누르거나 Ctrl+리턴으로 끝내고, Esc 로 그만둔다' },
    closeWorkspace: { group: '대화·터미널 화면', name: '워크스페이스 닫기', also: ['list'], label: '워크스페이스 닫기: 연 에이전트·셸·워크스페이스가 든 워크스페이스를 (목록에서는 포커스가 있는 줄의 것) 닫는다. 확인 창에서 같은 키를 한 번 더 누르거나 Ctrl+리턴으로 닫는다' },
    usage: { group: '대화·터미널 화면', name: '사용량', label: '사용량 보기: Claude 에이전트의 모델·컨텍스트와 그 호스트의 5시간·주간 사용 한도', noShell: true, cmd: '사용량 보기' },
    mode: { group: '대화·터미널 화면', name: '모드 바꾸기', label: '에이전트 모드 바꾸기 (메시지 칸에서 다음 모드로, Claude Code 의 Shift+Tab; 명령·모드 칩은 골라서)', noShell: true },
    prevHost: { group: '목록', name: '이전 호스트', label: '이전 호스트 (전체 / 각 호스트)' },
    nextHost: { group: '목록', name: '다음 호스트', label: '다음 호스트 (두 칸이면 사이드바를 펼친다)' },
    prevRow: { group: '목록', name: '이전 줄 열기', label: '두 칸: 목록의 이전 에이전트·셸 열기', cmd: '목록의 이전 에이전트·셸 열기' },
    nextRow: { group: '목록', name: '다음 줄 열기', label: '두 칸: 목록의 다음 에이전트·셸 열기', cmd: '목록의 다음 에이전트·셸 열기' },
    reorder: { group: '목록', name: '순서 바꾸기', label: '순서 바꾸기 켜기·끄기: 목록의 워크스페이스 카드와 그 안의 에이전트·셸 줄을 옮긴다 (손잡이를 끌어서; 모든 기기에 같게 보인다. 호스트 순서는 설정 → 연결)', noShell: true },
    toggleSide: { group: '목록', name: '사이드바', label: '두 칸: 사이드바 접기·펴기 (입력 칸에서도)', cmd: '사이드바 접기·펴기' },
    nextPane: { group: '목록', name: '다음 칸으로', label: '두 칸: 다음 칸으로 포커스 (활동 막대 → 목록의 고른 줄 → 오른쪽의 입력 칸, VS Code 의 F6)', noCommand: true },
    prevPane: { group: '목록', name: '이전 칸으로', label: '두 칸: 이전 칸으로 포커스', noCommand: true },
  };

  const b = (action, key, o = {}) => ({ action, key, field: false, shell: false, layer: false, split: false, ...o });
  // The table for a device. On the Mac the ⌘ form of a Hub chord comes first (the one hints show)
  // and the Ctrl form stays: ⌘ never reaches the shell (keys.js rawKeyName), so a ⌘ key works in
  // the shell view too.
  function table({ mac = false, app = false } = {}) {
    const when = (yes, ...xs) => (yes ? xs : []);
    return [
      // Always taken (app.js): Android turns an Esc the page leaves alone into Back, which closes
      // the app. Ctrl+[ is the terminal's Esc, for a keyboard cover whose Esc the system keeps.
      // In the shell's 키 직접 입력 they are the shell's Esc (shellEsc): the field sends it.
      b('back', 'Escape', { field: true, shell: true, layer: true }),
      b('back', 'Ctrl+[', { field: true, shell: true, layer: true }),
      // Scroll Lock: a key with no text and no system meaning, for a key remapper to turn the
      // cover's Esc into (Key Mapper sends no Ctrl with a key it injects, and its own Esc is taken).
      b('back', 'ScrollLock', { field: true, shell: true, layer: true }),
      // 대화창 닫기 (‹ without the step out of a field): the browser's close keys, which only the
      // installed app gets (in a tab they close the tab). ⌘W in the shell view too (no shell key);
      // Ctrl+W there is the shell's (delete a word). Under a sheet it closes the sheet, so the key
      // never falls through to close the window while something is still open.
      ...when(app && mac, b('leaveView', 'Meta+w', { field: true, shell: true, layer: true })),
      ...when(app && !mac, b('leaveView', 'Ctrl+w', { field: true, layer: true })),
      // Ctrl+? (Ctrl+Shift+/ on the key): the 단축키 page from anywhere, a field and the shell view
      // too (no shell key); a bare ? is typed. Not Ctrl+/ (no Shift).
      ...when(mac, b('help', 'Meta+?', { field: true, shell: true })),
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
      // Ctrl+, as in VS Code (⌘, on the Mac, the shell view too). Ctrl+, not in the shell, whose
      // keys stay its own; it types nothing in a field.
      ...when(mac, b('settings', 'Meta+,', { field: true, shell: true })),
      b('settings', 'Ctrl+,', { field: true }),
      // Ctrl+P is the shell's (previous line): there Alt+P, taken from the shell (its rarely used
      // history search by prefix); ⌘P on the Mac, the shell view too. Taken under a sheet too, so
      // the browser never prints; switcher.js decides what it means there.
      ...when(mac, b('switcher', 'Meta+p', { field: true, shell: true, layer: true })),
      b('switcher', 'Ctrl+p', { field: true, layer: true }),
      b('switcher', 'Alt+p', { field: true, shell: true, layer: true }),
      // 명령, VS Code's keys: Ctrl+Shift+P (⌘⇧P on the Mac) and F1, the shell view too. A terminal
      // gets Ctrl+Shift+P as Ctrl+P (which stays the shell's) and F1 is rarely anything there (a
      // TUI's help: htop, mc), so both are taken from the shell, as VS Code's terminal does. Under
      // a sheet too: in 빠른 이동 it turns to 명령 (switcher.js).
      ...when(mac, b('commands', 'Meta+Shift+p', { field: true, shell: true, layer: true })),
      b('commands', 'Ctrl+Shift+p', { field: true, shell: true, layer: true }),
      b('commands', 'F1', { field: true, shell: true, layer: true }),
      // A digit is typed in a field and is the shell's: only on the page of an agent.
      ...'123456789'.split('').map((n) => b('answer', n)),
      // Ctrl+B is the shell's (back a character), Alt+. its last argument. ⌘B on the Mac.
      ...when(mac, b('toggleSide', 'Meta+b', { field: true, shell: true, split: true })),
      b('toggleSide', 'Ctrl+b', { field: true, split: true }),
      // Alt+B in the shell view too, taken from the shell (its back-a-word is also Alt+←); Ctrl+B
      // there stays the shell's.
      b('toggleSide', 'Alt+b', { field: true, shell: true, split: true }),
      // F6 / Shift+F6 as VS Code's: the focus to the next (previous) column, past the list's many
      // Tab stops. Taken from the shell too (its F6 is rarely anything): the way out to the list.
      b('nextPane', 'F6', { field: true, shell: true, split: true }),
      b('prevPane', 'Shift+F6', { field: true, shell: true, split: true }),
      b('stop', 'Alt+.', { field: true }),
      // Ctrl+N is the shell's (next line), so not in the shell view. In a tab Chrome keeps Ctrl+N
      // and Ctrl+Shift+N (a new window) on Windows, Linux and ChromeOS: there the Alt twins come
      // first (Alt+N is readline's, so not in the shell view either). On the Mac a tab gets
      // Ctrl+N (Chrome's is ⌘N) and the app ⌘N, the shell view too.
      ...when(mac && app, b('newAgent', 'Meta+n', { field: true, shell: true })),
      ...when(!mac && !app, b('newAgent', 'Alt+n', { field: true })),
      b('newAgent', 'Ctrl+n', { field: true }),
      ...when(mac && app, b('newWorkspace', 'Meta+Shift+n', { field: true, shell: true })),
      ...when(!mac && !app, b('newWorkspace', 'Alt+Shift+n', { field: true })),
      b('newWorkspace', 'Ctrl+Shift+n', { field: true }),
      // Alt+Shift+↑/↓: Alt+↑/↓ (the next row) narrowed to the agents waiting for an answer. No shell
      // key (rawKeyName), so the shell view too.
      b('nextBlocked', 'Alt+Shift+ArrowDown', { field: true, shell: true }),
      b('prevBlocked', 'Alt+Shift+ArrowUp', { field: true, shell: true }),
      // Alt+Z as VS Code's word wrap; in the shell view Alt+Z is the shell's, so Ctrl+Alt+Z there
      // (no shell key: keys.js sends no Ctrl+Alt chord to the shell).
      b('wrap', 'Alt+z', { field: true }),
      b('wrap', 'Ctrl+Alt+z', { field: true, shell: true }),
      // Ctrl+= / Ctrl+- are the browser's zoom; with Alt they are no shell key (no Ctrl+Alt chord
      // goes to the shell), so the shell view too. Read by code as well (a Mac's Option+= is ≠).
      b('termFontUp', 'Ctrl+Alt+=', { field: true, shell: true }),
      b('termFontDown', 'Ctrl+Alt+-', { field: true, shell: true }),
      // Alt+T is the shell's (swap words); the agent view has no shell, and it closes its own sheet.
      b('terminal', 'Alt+t', { field: true, layer: true }),
      // 끝내기, Alt+W (Option+W): not Ctrl+W, which is 대화창 닫기 in the app and the browser's in
      // a tab. Alt+W is the shell's (copy a word back), so not in the shell view.
      b('closeView', 'Alt+w', { field: true }),
      // Ctrl+Alt+W in the shell view too: no shell key (keys.js sends no Ctrl+Alt chord to the shell).
      b('closeView', 'Ctrl+Alt+w', { field: true, shell: true }),
      // 워크스페이스 닫기, Alt+Shift+W (⌥⇧W): 끝내기's key with Shift, a bigger close. A terminal
      // gets it as Alt+W (keys.js drops the Shift), so not in the shell view; there Ctrl+Alt+Shift+W
      // (no Ctrl+Alt chord goes to the shell). Not ⌘⇧W / Ctrl+Shift+W: the browser's close-window.
      b('closeWorkspace', 'Alt+Shift+w', { field: true }),
      b('closeWorkspace', 'Ctrl+Alt+Shift+w', { field: true, shell: true }),
      // Alt+M: the ⋯ menu (M for menu). Alt+M is the shell's (back to indentation), so in the shell
      // view Ctrl+Alt+M (no shell key: keys.js sends no Ctrl+Alt chord to the shell).
      b('menu', 'Alt+m', { field: true }),
      b('menu', 'Ctrl+Alt+m', { field: true, shell: true }),
      // Shift+Tab is the shell's (and moves the focus back on the page): only the message box takes it
      // (KEY_ACTIONS.mode), so a field, not the shell view.
      b('mode', 'Shift+Tab', { field: true }),
      // Alt+U (U for usage): the agent view's 사용량 sheet. Alt+U is the shell's (upcase a word), and
      // the shell view has no agent, so not there.
      b('usage', 'Alt+u', { field: true }),
      // Alt+` as an app switcher's last app; the backquote key by code too (a Mac's Option+` is a
      // dead key). No shell key either.
      b('lastView', 'Alt+`', { field: true, shell: true }),
      // Alt+O (O for order): only with the focus on the page (a Mac's Option+O types ø in a field);
      // the shell's in the shell view. Esc also ends it (KEY_ACTIONS.back).
      b('reorder', 'Alt+o'),
    ];
  }

  // Keys handled in their own field, listed in the sheet but not dispatched from here.
  const LOCAL = [
    { group: '메시지 칸', name: '보내기', key: 'Ctrl+Enter', label: '보내기. 리턴 키 설정이 「보내기」면 리턴, 줄바꿈은 Shift+리턴' },
    { group: '메시지 칸', name: '지금 보내기', key: 'Ctrl+Enter', label: '빈 칸에서: 대기 중인 메시지를 지금 보내기 — 작업 중인 Claude 가 하던 일(셸 명령·서브에이전트)은 뒤로 돌리거나 쓰던 답을 멈추고 먼저 읽는다 (Claude Code 의 Ctrl+Enter; 대기 중 말풍선의 「지금 보내기」와 같다)' },
    { group: '메시지 칸', name: '전에 보낸 메시지', key: 'ArrowUp', label: '빈 칸에서: 전에 보낸 메시지 불러오기 (↓ 는 다음)' },
    { group: '메시지 칸', name: '명령 제안', key: '/', label: '맨 앞에서: 명령 제안 (↑↓ 로 고르고 리턴·Tab)' },
    { group: '메시지 칸', name: '밖에서 친 글자도 메시지 칸으로', key: '', label: '대화 화면에서 입력 칸 밖에서 친 글자도 메시지 칸으로 간다 (단축키·선택지 숫자·Space 는 빼고)' },
    { group: '셸', name: '밖에서 누른 키도 셸로', key: '', label: '입력 칸 밖에서 누른 키도 셸로 간다. 나가려면 ‹ (✕) 나 두 칸의 Alt+↑/↓ (Alt+K/J)' },
    { group: '셸', name: '셸의 Esc', key: 'Ctrl+[', label: '키 직접 입력: Esc' },
    { group: '셸', name: '셸의 완성', key: 'Tab', label: '한 줄 입력: 쓴 것을 셸에 넘기고 셸의 완성 (Shift+Tab 은 포커스 이동)' },
    { group: '셸', name: '앞 단어 지우기', key: 'Ctrl+w', label: '한 줄 입력: 커서 앞 단어 지우기 (셸의 Ctrl+W 처럼; 설치한 앱에서도 창을 닫지 않는다)' },
    { group: '셸', name: '칸에서 나가기', key: 'Escape', label: '한 줄 입력: 한 번이면 칸에서 나가고, 두 번이면 뒤로 (대화 화면과 같다)' },
    { group: '셸', name: '나머지 키는 셸로', key: '', label: '단축키 페이지의 「셸」 탭에 있는 키만 Hub 가 쓰고, 나머지는 모두 셸로 간다. 키 줄의 Alt·Ctrl 을 누르고 친 키는 언제나 셸로 (Alt 다음 B 는 셸의 alt+b)' },
    { group: '폼', name: '시작·만들기', key: 'Ctrl+Enter', label: '에이전트 시작·새 워크스페이스: 시작 / 만들기 (어느 칸에서나)' },
    { group: '순서 바꾸기', name: '한 칸 옮기기', key: 'ArrowUp', label: '순서 바꾸기에서 손잡이에 포커스가 있을 때 ↑ / ↓ 로 그 카드·줄을 한 칸 위·아래로 (Esc 로 끝내기)' },
    { group: '목록 칸 폭', name: '목록 칸 폭', key: 'ArrowRight', label: '두 칸: 목록 칸 가장자리에 포커스가 있을 때 ←/→ 로 16px 씩 좁히고 넓힌다. 리턴(두 번 누르기)은 자동으로' },
    { group: '빠른 이동', name: '고른 것 열기', key: 'Enter', label: '고른 것 열기 (명령이면 하기). Esc·Ctrl+[ 로 닫기 (태블릿 키보드 덮개의 Esc·뒤로도)' },
    { group: '빠른 이동', name: '명령으로', key: '>', label: '맨 앞에 치면 명령: 할 수 있는 일을 찾는다 (> 를 지우면 다시 에이전트·셸)' },
    { group: '빠른 이동', name: '다음 것', key: 'Ctrl+j', follows: 'scrollDown', label: '다음 것 고르기 (↓ 와 같다. 맨 끝 다음은 맨 앞; 아래로 스크롤의 키)' },
    { group: '빠른 이동', name: '이전 것', key: 'Ctrl+k', follows: 'scrollUp', label: '이전 것 고르기 (↑ 와 같다; 위로 스크롤의 키)' },
    { group: '메뉴·확인 창', name: '다음 항목', key: 'ArrowDown', label: '메뉴의 다음 항목 (↑ 는 이전. 끝 다음은 처음)' },
    { group: '메뉴·확인 창', name: '다음 항목', key: 'Ctrl+j', follows: 'scrollDown', label: '메뉴의 다음 항목 (↓ 와 같다)' },
    { group: '메뉴·확인 창', name: '이전 항목', key: 'Ctrl+k', follows: 'scrollUp', label: '메뉴의 이전 항목 (↑ 와 같다)' },
    { group: '메뉴·확인 창', name: '첫 항목', key: 'Home', label: '메뉴의 첫 항목 (End 는 마지막)' },
    { group: '메뉴·확인 창', name: '확인', key: 'Ctrl+Enter', label: '되돌릴 수 없는 일의 확인 창에서 확인 (그 창을 연 키를 한 번 더 눌러도 확인; Esc 는 그만두기)' },
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
  const CODES = { '[': 'BracketLeft', ']': 'BracketRight', '/': 'Slash', '?': 'Slash', '.': 'Period', ',': 'Comma', '`': 'Backquote', '=': 'Equal', '-': 'Minus' };
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
  // An input method at work (Android's with a keyboard cover, Korean on any system) sends its
  // keys as keyCode 229 / isComposing with e.key "Process": then only a chord (Ctrl, Alt or ⌘
  // held) can be a shortcut, read by e.code alone, so a key the IME is composing never is one.
  function match(e, ctx = {}) {
    if (!e) return null;
    if (e.isComposing || e.keyCode === 229) {
      if (!(e.ctrlKey || e.altKey || e.metaKey) || !e.code) return null;
      e = { code: e.code, key: '', ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, shiftKey: e.shiftKey };
    }
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

  // Keys that quit or are the system's, never the page's (or it would quit by a slip): ⌘Q, ⌘H,
  // ⌘M, ⌘Tab, ⌘Space, ⌘`, Alt+F4, Ctrl+Shift+Q (Ctrl+Q on Linux).
  const SYSTEM = ['Alt+F4', 'Ctrl+q', 'Ctrl+Shift+q', 'Meta+q', 'Meta+Shift+q', 'Meta+h', 'Meta+m', 'Meta+Tab', 'Meta+Shift+Tab', 'Meta+ ', 'Meta+`'].map(norm);
  // The browser's tab and window keys: its own in a tab (the page never sees them, or it would
  // close the tab); the page's in the installed app.
  const BROWSER = ['Ctrl+w', 'Ctrl+Shift+w', 'Ctrl+t', 'Ctrl+Shift+t', 'Ctrl+Tab', 'Ctrl+Shift+Tab', 'Meta+w', 'Meta+Shift+w', 'Meta+t', 'Meta+Shift+t', 'Meta+n', 'Meta+Shift+n'].map(norm);
  // Why key can't be given to action, or ''. stored: a key this device kept, which may be one
  // the app has and the tab not (the same storage): only the system's keys are dropped then.
  function refuse(action, key, stored = false) {
    if (!key) return '이 키는 받을 수 없습니다';
    const k = parse(key);
    const mod = k.ctrl || k.alt || k.meta;
    if (SYSTEM.includes(norm(key))) return `${label(key)} 는 시스템이 가져갑니다 (끝내기·숨기기·창 바꾸기)`;
    if (!env.app && !stored && BROWSER.includes(norm(key))) return `${label(key)} 는 브라우저 탭에서는 브라우저가 먼저 가져갑니다 (설치한 앱에서는 쓸 수 있습니다)`;
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
        if (!realKey(key) || refuse(action, key, true) || taken.has(norm(key))) continue;
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

  let env = { mac: false, app: false };
  let BINDINGS = table(env);
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

  // The device the table is for: { mac, app } (the page reads them, core.js; the tests pass them).
  // The overrides are laid over the new defaults again.
  function setEnv(e = {}) {
    env = { mac: Boolean(e.mac), app: Boolean(e.app) };
    BINDINGS = table(env);
    setOverrides(current);
    return env;
  }
  // A Ctrl chord as this device says it: its ⌘ form on the Mac (Ctrl+리턴 → ⌘+리턴), for a key a
  // field takes both ways.
  const deviceKey = (key) => (env.mac ? key.replace(/^Ctrl\+/, 'Meta+') : key);

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
        name: a.name,
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

  // The keys a button shows (its title, a menu row's key, a key line):
  // the first key that works where it is shown. ctx: as for match ({ field, shell, layer, split });
  // split: false leaves out the keys of the two-column layout.
  // 뒤로 shows Esc and Ctrl+[ both (a keyboard cover's Esc never reaches the page); in the shell
  // view its keys are the shell's Esc, so it shows none there.
  function usable(x, ctx) {
    return !((ctx.field && !x.field) || (ctx.shell && !x.shell) || (ctx.layer && !x.layer) || (x.split && ctx.split === false));
  }
  // 'prevHost|nextHost': a pair of actions as one, 「Alt+←→」.
  function hint(action, ctx = {}) {
    if (action.includes('|')) {
      const [p, q] = action.split('|').map((x) => hint(x, ctx));
      if (!p || !q) return p || q;
      const pre = (k) => k.slice(0, k.lastIndexOf('+') + 1);
      return pre(p) && pre(p) === pre(q) ? p + q.slice(pre(q).length) : `${p} · ${q}`;
    }
    const a = ACTIONS[action];
    if (!a || (ctx.shell && a.shellEsc)) return '';
    const own = active.filter((y) => y.action === action && usable(y, ctx));
    if (!own.length) return '';
    if (action === 'back') {
      const two = [own.find((y) => y.key === 'Escape'), own.find((y) => parse(y.key).ctrl || parse(y.key).alt)].filter(Boolean);
      if (two.length) return two.map((y) => label(y.key)).join(' · ');
    }
    return a.twice ? `${label(own[0].key)} ×2` : label(own[0].key);
  }

  // A LOCAL row's keys: an action's (follows: the field uses that action's keys), else its own.
  // Ctrl+리턴 (the field takes ⌘ too) reads as ⌘+리턴 first on the Mac.
  function localKeys(x) {
    if (x.follows) return keysFor(x.follows);
    if (x.key === 'Ctrl+Enter' && env.mac) return ['Meta+Enter', x.key];
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

  // ---- the 단축키 page's tabs (keyspage.js): one per screen, an action in each it works on.

  const TABS = [
    { id: 'any', name: '어디서나' },
    { id: 'chat', name: '대화' },
    { id: 'shell', name: '셸' },
    { id: 'list', name: '목록' },
  ];
  const GROUP_TAB = { 어디서나: 'any', '대화·터미널 화면': 'chat', 목록: 'list' };
  const LOCAL_TAB = { '메시지 칸': 'chat', 셸: 'shell', 폼: 'any', '목록 칸 폭': 'list', '순서 바꾸기': 'list', '빠른 이동': 'any', '메뉴·확인 창': 'any' };
  // The tabs an action is listed under: its group's (and also's), and 셸 when one of its keys is
  // the Hub's in the shell view now (the active table: a key switched off leaves it). 뒤로's keys
  // there are the shell's Esc (LOCAL says so), not the Hub's.
  function tabsOf(action) {
    const a = ACTIONS[action];
    if (!a) return [];
    const on = new Set([GROUP_TAB[a.group], ...(a.also || [])]);
    if (!a.shellEsc && active.some((x) => x.action === action && x.shell)) on.add('shell');
    return TABS.map((t) => t.id).filter((id) => on.has(id));
  }
  const localTab = (x) => LOCAL_TAB[x.group] || 'any';
  // The context a tab's keys are read in: the shell view's keys on 셸.
  const tabCtx = (tab) => (tab === 'shell' ? { shell: true } : {});
  // An action's keys that work in ctx, this device's first (⌘ on the Mac: the table's order).
  function keysIn(action, ctx = {}) {
    return active.filter((x) => x.action === action && usable(x, ctx)).map((x) => x.key);
  }
  // The one key a row shows: 뒤로's Esc, else the first that works there.
  function primaryKey(action, ctx = {}) {
    const keys = keysIn(action, ctx);
    if (action === 'back' && keys.includes('Escape')) return 'Escape';
    return keys[0] || '';
  }

  // The 단축키 page's search, over every tab: each word in an action's name, label or a key
  // ("ctrl+k", "alt+↓"). [{ action, tabs }] in the table's order, then [{ local, tabs }].
  function search(q) {
    const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
    const hit = (hay) => words.every((w) => hay.toLowerCase().includes(w));
    const keys = (ks) => ks.map(label).join(' ');
    const out = [];
    for (const [action, a] of Object.entries(ACTIONS)) {
      const ks = active.filter((x) => x.action === action).map((x) => x.key);
      if (hit(`${a.name} ${a.label} ${keys(ks)}`)) out.push({ action, tabs: tabsOf(action) });
    }
    for (const x of LOCAL) if (hit(`${x.group} ${x.name} ${x.label} ${keys(localKeys(x))}`)) out.push({ local: x, tabs: [localTab(x)] });
    return out;
  }

  const api = {
    ACTIONS,
    get BINDINGS() {
      return BINDINGS;
    },
    get env() {
      return { ...env };
    },
    setEnv,
    deviceKey,
    table,
    ...{ LOCAL, MODS, parse, matches, match, label, hint, sheetGroups, keyOf, refuse, refuseShell, shellKey, setOverrides, assign, unassign, reset, setShell, shellFor, shellLoses, keysFor, actionRows, whereText, localKeys, TABS, tabsOf, localTab, tabCtx, keysIn, primaryKey, search, canShellAction },
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Keymap = api;
})(typeof self !== 'undefined' ? self : this);
