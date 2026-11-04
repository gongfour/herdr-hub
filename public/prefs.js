'use strict';
// Every setting on 설정, in one table: what it stores where, its default, and how 설정 shows it.
// A new setting is a row here and nowhere else (AGENTS.md); 설정 (settings.js) draws the table,
// and the code that uses a setting reads it with Prefs.get(key). Something to do the moment it
// changes (화면 모드 repaints) goes in core.js's PREF_EFFECTS.
// Pure: loaded as a plain script in the page (window.Prefs), required by the tests.
//
// A row: { key, store, group, label, type, options, default, clearOnDefault, hint, note }
//   store           the localStorage key. Never rename one: every device keeps its settings
//                   under it (index.html reads herdr-hub.theme itself before first paint).
//   type            'choice' (a segmented radiogroup of options) or 'bool' (a switch).
//   options         choice: { value: label } in the order shown.
//   default         what a missing or unknown stored value means.
//   clearOnDefault  choosing the default removes the key instead of storing it (화면 모드).
//   hint            one line under the control: a string, or { value: line } for the chosen one.
// Stored values: a choice as its value, a bool as '1' / '0' (as the app always stored them).
// GROUPS give the order of the groups between 알림 (first) and 연결 · 정보 (last), hand-drawn.
(function (root) {
  const GROUPS = [
    { id: 'input', label: '입력' },
    { id: 'screen', label: '화면', note: '줄바꿈을 끄면 긴 줄이 한 줄로 남고 옆으로 밀어 봅니다. 표나 전체 화면 프로그램의 모양은 끈 쪽이 지켜집니다.' },
  ];

  const PREFS = [
    {
      key: 'enter', store: 'herdr-hub.enter', group: 'input', label: '메시지 칸의 리턴 키', type: 'choice',
      options: { newline: '줄바꿈', send: '보내기' }, default: 'newline',
      hint: {
        newline: '보내기는 ↑ 버튼이나 ⌘/Ctrl+리턴. 셸 명령 줄은 늘 리턴으로 실행합니다.',
        send: '줄바꿈은 키보드의 Shift+리턴(iPhone 화면 키보드에는 없음). 셸 명령 줄은 늘 리턴으로 실행합니다.',
      },
    },
    {
      key: 'shellInput', store: 'herdr-hub.shellInput', group: 'input', label: '셸 입력', type: 'choice',
      options: { raw: '키 직접 입력', line: '한 줄 입력' }, default: 'raw',
      hint: {
        raw: '화면을 탭해 키보드를 올리면 누르는 키가 바로 셸로 갑니다(탭 완성·기록 그대로).',
        line: '아래 줄에 명령을 다 쓰고 리턴으로 실행합니다. 한글·긴 명령에 편합니다.',
      },
    },
    {
      key: 'theme', store: 'herdr-hub.theme', group: 'screen', label: '화면 모드', type: 'choice',
      options: { system: '시스템', light: '밝게', dark: '어둡게' }, default: 'system', clearOnDefault: true,
      hint: { system: '기기의 밝게·어둡게 설정을 따릅니다.', light: '', dark: '' },
    },
    { key: 'color', store: 'herdr-hub.color', group: 'screen', label: '터미널 색상', type: 'bool', default: true },
    { key: 'wrap.term', store: 'herdr-hub.wrap.term', group: 'screen', label: '줄바꿈 · 셸', type: 'bool', default: true },
    { key: 'wrap.agent', store: 'herdr-hub.wrap.agent', group: 'screen', label: '줄바꿈 · 에이전트 터미널 화면', type: 'bool', default: false },
  ];
  const BY_KEY = new Map(PREFS.map((p) => [p.key, p]));
  const row = (key) => {
    const p = BY_KEY.get(key);
    if (!p) throw new Error(`unknown pref ${key}`);
    return p;
  };

  // The stored string -> the value; anything unknown (or missing) is the default.
  function decode(p, raw) {
    if (p.type === 'bool') return raw === '1' ? true : raw === '0' ? false : p.default;
    return raw != null && Object.prototype.hasOwnProperty.call(p.options, raw) ? raw : p.default;
  }
  // The value -> the string to store, or null to remove the key.
  function encode(p, v) {
    if (p.type === 'bool') return v ? '1' : '0';
    if (p.clearOnDefault && v === p.default) return null;
    return String(v);
  }
  const valid = (p, v) => (p.type === 'bool' ? typeof v === 'boolean' : Object.prototype.hasOwnProperty.call(p.options, v));
  const hintOf = (p, v) => (typeof p.hint === 'string' ? p.hint : (p.hint && p.hint[v]) || '');

  // A store over storage() (localStorage in the page; it may throw in private mode or with site
  // data blocked). A choice made while storage fails lasts in memory until the page reloads.
  function createStore(storage) {
    const mem = new Map();
    const get = (key) => {
      const p = row(key);
      if (mem.has(key)) return mem.get(key);
      try {
        return decode(p, storage().getItem(p.store));
      } catch {
        return p.default;
      }
    };
    const set = (key, v) => {
      const p = row(key);
      if (!valid(p, v)) throw new Error(`bad value for ${key}: ${v}`);
      mem.set(key, v);
      const s = encode(p, v);
      try {
        const st = storage();
        if (s == null) st.removeItem(p.store);
        else st.setItem(p.store, s);
      } catch {
        /* private mode: the choice lasts until reload */
      }
    };
    return { get, set };
  }

  const api = { GROUPS, PREFS, row, decode, encode, valid, hintOf, createStore };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    const store = createStore(() => root.localStorage);
    root.Prefs = { ...api, get: store.get, set: store.set };
  }
})(typeof self !== 'undefined' ? self : this);
