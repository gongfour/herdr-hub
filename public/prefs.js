'use strict';
// Every setting on 설정, in one table: what it stores where, its default, and how 설정 shows it.
// A new setting is a row here and nowhere else (AGENTS.md); 설정 (settings.js) draws the table,
// and the code that uses a setting reads it with Prefs.get(key). Something to do the moment it
// changes (화면 모드 repaints) goes in core.js's PREF_EFFECTS.
// Pure: loaded as a plain script in the page (window.Prefs), required by the tests.
//
// A row: { key, store, group, label, type, options, default, defaults, clearOnDefault, hint, note }
//   store           the localStorage key. Never rename one: every device keeps its settings
//                   under it (index.html reads herdr-hub.theme itself before first paint).
//   type            'choice' (a segmented radiogroup of options) or 'bool' (a switch).
//   options         choice: { value: label } in the order shown.
//   default         what a missing or unknown stored value means.
//   defaults        per platform ('ios' | 'android' | 'desktop', push.js platformOf), in place of
//                   default on that platform: { ios: true } is on for an iPhone, default elsewhere.
//   clearOnDefault  choosing the default removes the key instead of storing it (화면 모드).
//   free            choice: { min, max, hint }: a whole number in min..max is a value too, one no
//                   option names (목록 칸 폭 set by dragging); hint says it ('{}' is the number).
//   hint            one line under the control: a string, or { value: line } for the chosen one.
//   when            'touch': only on a device with a touch screen (a gesture's setting); 설정 leaves
//                   it out elsewhere (a laptop with a mouse has nothing to swipe).
// Stored values: a choice as its value, a bool as '1' / '0' (as the app always stored them).
// GROUPS give the order of the groups between 알림 (first) and 키보드 · 연결 · 정보 · 이 기기 (last), hand-drawn.
(function (root) {
  const GROUPS = [
    { id: 'input', label: '입력' },
    { id: 'screen', label: '화면' },
    { id: 'switch', label: '빠른 이동' },
  ];

  const PREFS = [
    {
      key: 'enter', store: 'herdr-hub.enter', group: 'input', label: '메시지 칸의 리턴 키', type: 'choice',
      options: { newline: '줄바꿈', send: '보내기' }, default: 'newline',
      hint: {
        newline: '보내기는 ↑ 버튼이나 Ctrl+리턴(Mac 은 ⌘+리턴)입니다.',
        send: '줄바꿈은 Shift+리턴입니다. iPhone 화면 키보드에는 없습니다.',
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
    {
      key: 'edgeForward', store: 'herdr-hub.edgeForward', group: 'input', label: '오른쪽 끝에서 밀어 방금 본 대화로', type: 'bool',
      default: false, defaults: { ios: true }, when: 'touch',
      hint: '목록에서 화면 오른쪽 끝을 왼쪽으로 밀면 방금 본 대화·셸로 돌아갑니다. Android 는 뒤로 제스처와 겹쳐 처음엔 꺼져 있습니다.',
    },
    { key: 'color', store: 'herdr-hub.color', group: 'screen', label: '터미널 색상', type: 'bool', default: true, hint: '끄면 셸과 터미널 화면을 한 가지 색으로 봅니다.' },
    {
      key: 'wrap.term', store: 'herdr-hub.wrap.term', group: 'screen', label: '셸 줄바꿈', type: 'bool', default: true,
      hint: '끄면 긴 줄을 접지 않고 옆으로 밀어 봅니다. 표나 전체 화면 프로그램은 꺼야 모양이 맞습니다.',
    },
    {
      key: 'termFont', store: 'herdr-hub.termFont', group: 'screen', label: '셸 글자 크기', type: 'choice',
      options: { 11: '작게', 12: '보통', 14: '크게' }, default: '12',
      hint: { 11: '표가 넓을 때: 한 줄에 더 많이 들어갑니다.', 12: '', 14: '넓은 화면에서 읽기 편합니다.' },
    },
    { key: 'wrap.agent', store: 'herdr-hub.wrap.agent', group: 'screen', label: '에이전트 터미널 화면 줄바꿈', type: 'bool', default: false, hint: '에이전트의 「터미널 화면 보기」에서 같은 일을 합니다.' },
    {
      key: 'chatW', store: 'herdr-hub.chatW', group: 'screen', label: '대화 폭', type: 'choice',
      options: { auto: '자동', narrow: '좁게', wide: '넓게', full: '꽉 차게' }, default: 'auto', clearOnDefault: true,
      hint: {
        auto: '두 칸 화면의 대화 글 폭: 칸을 거의 다 쓰되 양옆에 24px 여백을 두고(760–1680px), 큰 화면에서는 글자도 조금 커집니다.',
        narrow: '760px 로 둡니다. 한 줄이 짧아 읽기 편합니다.',
        wide: '양옆 여백을 16px 로 줄여 더 넓게 씁니다(최대 2400px).',
        full: '칸 끝에서 끝까지 씁니다.',
      },
    },
    {
      key: 'listW', store: 'herdr-hub.listW', group: 'screen', label: '목록 칸 폭', type: 'choice',
      options: { auto: '자동', narrow: '좁게', wide: '넓게' }, default: 'auto', clearOnDefault: true,
      free: { min: 240, max: 480, hint: '목록 칸 가장자리를 끌어 {}px 로 맞췄습니다. 두 번 누르면 자동으로 돌아갑니다.' },
      hint: {
        auto: '두 칸 화면(가로 태블릿·노트북)의 왼쪽 목록 폭입니다. 가장자리를 끌어도 바뀝니다.',
        narrow: '대화 칸을 넓게 씁니다. 긴 제목은 두 줄로 꺾입니다.',
        wide: '긴 제목을 한 줄에 더 보입니다.',
      },
    },
    {
      key: 'paletteOrder', store: 'herdr-hub.paletteOrder', group: 'switch', label: '빠른 이동의 순서', type: 'choice',
      options: { done: '완료 먼저', working: '작업 중 먼저', recent: '최근 연 순' }, default: 'done', clearOnDefault: true,
      hint: {
        done: '답 필요 → 완료 → 작업 중 → 쉬는 중 → 셸. 같은 무리 안에서는 최근에 연 순서입니다.',
        working: '답 필요 → 작업 중 → 완료 → 쉬는 중 → 셸. 같은 무리 안에서는 최근에 연 순서입니다.',
        recent: '답 필요 다음은 상태와 상관없이 최근에 연 순서입니다.',
      },
    },
  ];
  // The px each named width is (core.js applyListWidth); auto is style.css's, per pointer.
  const LIST_WIDTHS = { narrow: 264, wide: 400 };
  const BY_KEY = new Map(PREFS.map((p) => [p.key, p]));
  const row = (key) => {
    const p = BY_KEY.get(key);
    if (!p) throw new Error(`unknown pref ${key}`);
    return p;
  };

  // The default on this platform.
  const defaultOf = (p, platform) => (p.defaults && platform && Object.prototype.hasOwnProperty.call(p.defaults, platform) ? p.defaults[platform] : p.default);
  // The stored string -> the value; anything unknown (or missing) is the default.
  // A free value (a whole number in range), as the string it is stored as.
  const isFree = (p, v) => Boolean(p.free) && typeof v === 'string' && /^\d{1,4}$/.test(v) && Number(v) >= p.free.min && Number(v) <= p.free.max;
  function decode(p, raw, platform) {
    const d = defaultOf(p, platform);
    if (p.type === 'bool') return raw === '1' ? true : raw === '0' ? false : d;
    return raw != null && (Object.prototype.hasOwnProperty.call(p.options, raw) || isFree(p, raw)) ? raw : d;
  }
  // The value -> the string to store, or null to remove the key.
  function encode(p, v) {
    if (p.type === 'bool') return v ? '1' : '0';
    if (p.clearOnDefault && v === p.default) return null;
    return String(v);
  }
  const valid = (p, v) => (p.type === 'bool' ? typeof v === 'boolean' : Object.prototype.hasOwnProperty.call(p.options, v) || isFree(p, v));
  const hintOf = (p, v) => (isFree(p, v) ? p.free.hint.replace('{}', v) : typeof p.hint === 'string' ? p.hint : (p.hint && p.hint[v]) || '');
  // 목록 칸 폭's value in px, or null for 자동 (style.css decides by the pointer).
  const listWidth = (v) => (isFree(BY_KEY.get('listW'), v) ? Number(v) : LIST_WIDTHS[v] || null);

  // A store over storage() (localStorage in the page; it may throw in private mode or with site
  // data blocked). A choice made while storage fails lasts in memory until the page reloads.
  // platform: the device's, for the rows whose default depends on it.
  function createStore(storage, platform) {
    const mem = new Map();
    const get = (key) => {
      const p = row(key);
      if (mem.has(key)) return mem.get(key);
      try {
        return decode(p, storage().getItem(p.store), platform);
      } catch {
        return defaultOf(p, platform);
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

  // The device, as push.js platformOf tells it (that file loads later): iPadOS says Macintosh.
  function platformOf(ua, touchPoints) {
    if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) return 'ios';
    return /Android/.test(ua) ? 'android' : 'desktop';
  }

  // Whether a row is shown on this device (touch: it has a touch screen).
  const shownOn = (p, { touch }) => p.when !== 'touch' || Boolean(touch);

  const api = { shownOn, GROUPS, PREFS, row, defaultOf, decode, encode, valid, isFree, hintOf, listWidth, createStore, platformOf };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    const nav = root.navigator || {};
    const store = createStore(() => root.localStorage, platformOf(nav.userAgent || '', nav.maxTouchPoints || 0));
    root.Prefs = { ...api, get: store.get, set: store.set };
  }
})(typeof self !== 'undefined' ? self : this);
