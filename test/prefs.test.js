'use strict';
// The settings table (public/prefs.js) and 설정's 알림 block (public/push.js pushView).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { GROUPS, PREFS, decode, encode, hintOf, createStore, shownOn } = require('../public/prefs.js');
const { pushView, platformOf, deniedFix } = require('../public/push.js');

// A localStorage stand-in: getItem / setItem / removeItem over a Map.
function fakeStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

test('every row is well formed: a known group, a herdr-hub.* key used once, a valid default', () => {
  const groups = new Set(GROUPS.map((g) => g.id));
  const keys = new Set();
  const stores = new Set();
  for (const p of PREFS) {
    assert.ok(groups.has(p.group), p.key);
    assert.ok(p.label, p.key);
    assert.ok(/^herdr-hub\.[\w.]+$/.test(p.store), p.store);
    assert.ok(!keys.has(p.key) && !stores.has(p.store), p.key);
    keys.add(p.key);
    stores.add(p.store);
    assert.ok(['choice', 'bool'].includes(p.type), p.key);
    assert.ok(p.when === undefined || p.when === 'touch', p.key);
    if (p.type === 'bool') assert.equal(typeof p.default, 'boolean');
    else {
      assert.ok(Object.keys(p.options).length >= 2, p.key);
      assert.ok(p.default in p.options, p.key);
    }
  }
});

// The keys and encodings every device already has: changing one would reset that setting.
test('storage keys are the ones the app always used', () => {
  assert.deepEqual(Object.fromEntries(PREFS.map((p) => [p.key, p.store])), {
    enter: 'herdr-hub.enter',
    shellInput: 'herdr-hub.shellInput',
    theme: 'herdr-hub.theme',
    color: 'herdr-hub.color',
    'wrap.term': 'herdr-hub.wrap.term',
    'wrap.agent': 'herdr-hub.wrap.agent',
    termFont: 'herdr-hub.termFont',
    edgeForward: 'herdr-hub.edgeForward',
    listW: 'herdr-hub.listW',
    paletteOrder: 'herdr-hub.paletteOrder',
  });
  // index.html applies the theme before any script: it reads this key and these values.
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.match(html, /localStorage\.getItem\('herdr-hub\.theme'\)/);
  assert.match(html, /t === 'light' \|\| t === 'dark'/);
});

test('values written by the old code read the same (and unknown or missing ones are the default)', () => {
  // What the old getters returned for each stored string.
  const old = {
    enter: (s) => (s === 'send' ? 'send' : 'newline'),
    shellInput: (s) => (s === 'line' ? 'line' : 'raw'),
    theme: (s) => (s === 'light' || s === 'dark' ? s : 'system'),
    color: (s) => s !== '0',
    'wrap.term': (s) => (s === '1' || s === '0' ? s === '1' : true),
    'wrap.agent': (s) => (s === '1' || s === '0' ? s === '1' : false),
    edgeForward: (s) => (s === '1' || s === '0' ? s === '1' : false), // new: off unless iOS
    termFont: (s) => (['11', '12', '14'].includes(s) ? s : '12'), // new
    listW: () => 'auto', // new: no sample is one of its values
    paletteOrder: () => 'done', // new: no sample is one of its values
  };
  const samples = [null, '', 'send', 'newline', 'line', 'raw', 'light', 'dark', 'system', '1', '0', 'true', 'x', '11', '12', '14', '13'];
  for (const p of PREFS)
    for (const s of samples) {
      const store = createStore(() => fakeStorage(s == null ? {} : { [p.store]: s }));
      assert.deepEqual(store.get(p.key), old[p.key](s), `${p.key} <- ${s}`);
    }
});

test('values written by the new code are what the old code wrote (old app versions read them)', () => {
  const st = fakeStorage();
  const store = createStore(() => st);
  store.set('enter', 'send');
  store.set('shellInput', 'line');
  store.set('theme', 'dark');
  store.set('color', false);
  store.set('wrap.term', false);
  store.set('wrap.agent', true);
  assert.deepEqual(Object.fromEntries(st.m), {
    'herdr-hub.enter': 'send',
    'herdr-hub.shellInput': 'line',
    'herdr-hub.theme': 'dark',
    'herdr-hub.color': '0',
    'herdr-hub.wrap.term': '0',
    'herdr-hub.wrap.agent': '1',
  });
  // 시스템 removes the theme key (index.html then sets no data-theme); the rest store their value.
  store.set('theme', 'system');
  assert.equal(st.m.has('herdr-hub.theme'), false);
  store.set('enter', 'newline');
  assert.equal(st.m.get('herdr-hub.enter'), 'newline');
  store.set('color', true);
  assert.equal(st.m.get('herdr-hub.color'), '1');
});

test('round trip: every value of every row comes back as set', () => {
  for (const p of PREFS) {
    const values = p.type === 'bool' ? [true, false] : Object.keys(p.options);
    for (const v of values) {
      assert.deepEqual(decode(p, encode(p, v)), v, `${p.key} ${v}`);
      const store = createStore(() => fakeStorage());
      store.set(p.key, v);
      assert.deepEqual(createStore(() => fakeStorage(Object.fromEntries([[p.store, encode(p, v)]].filter(([, s]) => s != null)))).get(p.key), v);
    }
  }
});

test('private mode: storage that throws gives the defaults, and a choice lasts in memory', () => {
  const boom = () => {
    throw new Error('SecurityError');
  };
  const store = createStore(boom);
  for (const p of PREFS) assert.deepEqual(store.get(p.key), p.default, p.key);
  store.set('color', false);
  store.set('enter', 'send');
  assert.equal(store.get('color'), false);
  assert.equal(store.get('enter'), 'send');
  // setItem alone throwing (Safari's old private mode: QuotaExceededError)
  const st = fakeStorage();
  st.setItem = () => {
    throw new Error('QuotaExceededError');
  };
  const s2 = createStore(() => st);
  s2.set('wrap.agent', true);
  assert.equal(s2.get('wrap.agent'), true);
});

test('셸 글자 크기: 11 / 12 / 14 px, 12 by default, stored as the number', () => {
  const { row } = require('../public/prefs.js');
  const p = row('termFont');
  assert.deepEqual(Object.keys(p.options), ['11', '12', '14']);
  assert.equal(p.default, '12');
  const st = fakeStorage();
  createStore(() => st).set('termFont', '14');
  assert.equal(st.m.get('herdr-hub.termFont'), '14');
});

test('오른쪽 끝에서 밀어: on by default on iOS only; a stored choice wins on every platform', () => {
  const { row, defaultOf, platformOf } = require('../public/prefs.js');
  const p = row('edgeForward');
  assert.equal(p.group, 'input');
  assert.equal(p.type, 'bool');
  assert.equal(defaultOf(p, 'ios'), true);
  assert.equal(defaultOf(p, 'android'), false);
  assert.equal(defaultOf(p, 'desktop'), false);
  assert.equal(defaultOf(p, undefined), false);
  assert.equal(createStore(() => fakeStorage(), 'ios').get('edgeForward'), true);
  assert.equal(createStore(() => fakeStorage(), 'android').get('edgeForward'), false);
  assert.equal(createStore(() => fakeStorage({ 'herdr-hub.edgeForward': '0' }), 'ios').get('edgeForward'), false);
  assert.equal(createStore(() => fakeStorage({ 'herdr-hub.edgeForward': '1' }), 'android').get('edgeForward'), true);
  // Storage that throws: the platform's default.
  const boom = () => {
    throw new Error('SecurityError');
  };
  assert.equal(createStore(boom, 'ios').get('edgeForward'), true);
  assert.equal(createStore(boom, 'android').get('edgeForward'), false);
  // Rows without per-platform defaults are the same everywhere.
  for (const q of PREFS.filter((x) => !x.defaults)) for (const pl of ['ios', 'android', 'desktop']) assert.deepEqual(defaultOf(q, pl), q.default);
  // The platform as push.js knew it (it now asks prefs.js).
  assert.equal(platformOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 5), 'ios');
  assert.equal(platformOf('Mozilla/5.0 (Linux; Android 14; SM-T970) Chrome/130', 5), 'android');
  assert.equal(platformOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0), 'desktop');
  // A switch with a hint line: what it does, never empty.
  assert.match(hintOf(p, true), /오른쪽 끝/);
});

test('bad values and unknown keys are refused', () => {
  const store = createStore(() => fakeStorage());
  assert.throws(() => store.set('enter', 'shout'));
  assert.throws(() => store.set('color', 'yes'));
  assert.throws(() => store.get('nope'));
});

test('hints: a choice has a line for its chosen value or none', () => {
  for (const p of PREFS.filter((x) => x.type === 'choice')) for (const v of Object.keys(p.options)) assert.equal(typeof hintOf(p, v), 'string');
  assert.match(hintOf(PREFS.find((p) => p.key === 'enter'), 'send'), /Shift\+리턴/);
});

// ---- 알림 (pushView)

test('platformOf: iPhone, iPad (desktop UA with touch), Android, desktop', () => {
  assert.equal(platformOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit', 5), 'ios');
  assert.equal(platformOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit', 5), 'ios');
  assert.equal(platformOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit', 0), 'desktop');
  assert.equal(platformOf('Mozilla/5.0 (Linux; Android 14; SM-T970) Chrome/130', 5), 'android');
  assert.equal(platformOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130', 0), 'desktop');
});

const base = { platform: 'desktop', standalone: false, supported: true, off: false, hub: '', perm: 'default', sub: false, maxActions: 2 };
const pv = (o) => pushView({ ...base, ...o });

test('pushView: subscribed shows the state and test / off, with what the buttons on alerts do', () => {
  for (const platform of ['ios', 'android', 'desktop']) {
    const v = pv({ platform, standalone: true, perm: 'granted', sub: true, maxActions: platform === 'ios' ? 0 : 2 });
    assert.equal(v.tone, 'on');
    assert.equal(v.status, '이 기기는 알림을 받습니다');
    assert.deepEqual(v.actions, ['test', 'disable']);
    assert.match(v.lines[0], platform === 'ios' ? /답 버튼이 없습니다/ : /Yes · No/);
  }
});

test('pushView: not subscribed offers 켜기; permission default says it will ask', () => {
  for (const platform of ['android', 'desktop']) for (const standalone of [true, false]) {
    const v = pv({ platform, standalone, perm: 'default', sub: false });
    assert.equal(v.tone, 'off');
    assert.deepEqual(v.actions, ['enable']);
    assert.match(v.lines[0], /권한을 묻습니다/);
  }
  const granted = pv({ platform: 'ios', standalone: true, perm: 'granted', sub: false });
  assert.deepEqual(granted.actions, ['enable']);
  assert.doesNotMatch(granted.lines[0], /권한을 묻습니다/);
});

test('pushView: iPhone in Safari (not installed) only says how to install, on iOS only', () => {
  for (const perm of ['default', 'granted', 'denied', 'unsupported']) {
    const v = pv({ platform: 'ios', standalone: false, supported: false, perm, sub: undefined });
    assert.deepEqual(v.actions, []);
    assert.match(v.lines[0], /홈 화면에 추가/);
  }
  // Android and desktop browsers get push without installing: no iPhone advice there.
  for (const platform of ['android', 'desktop']) {
    const v = pv({ platform, standalone: false, perm: 'default', sub: false });
    assert.ok(!v.lines.join(' ').includes('홈 화면'), platform);
    assert.ok(!v.lines.join(' ').includes('iPhone'), platform);
  }
});

test('pushView: denied gives no button, only the platform fix', () => {
  const ios = pv({ platform: 'ios', standalone: true, perm: 'denied', sub: false });
  assert.equal(ios.tone, 'bad');
  assert.deepEqual(ios.actions, []);
  assert.match(ios.lines[0], /iPhone 설정 → 알림/);
  const android = pv({ platform: 'android', standalone: true, perm: 'denied', sub: false });
  assert.match(android.lines[0], /앱 정보/);
  assert.match(pv({ platform: 'android', perm: 'denied' }).lines[0], /사이트 설정/);
  const desk = pv({ platform: 'desktop', perm: 'denied', sub: false });
  assert.match(desk.lines[0], /사이트 설정/);
  assert.ok(!desk.lines[0].includes('iPhone'));
  assert.equal(deniedFix('android', false), deniedFix('desktop', false));
});

test('pushView: unsupported, still looking, and a peer that leaves push to its hub', () => {
  assert.deepEqual(pv({ supported: false }).actions, []);
  assert.match(pv({ supported: false }).status, /받을 수 없습니다/);
  assert.match(pv({ perm: 'unsupported' }).status, /받을 수 없습니다/);
  const wait = pv({ perm: 'granted', sub: undefined });
  assert.equal(wait.tone, 'wait');
  assert.deepEqual(wait.actions, []);
  // push off on this host: the hub's name from the hosts list, never assumed.
  for (const platform of ['ios', 'android', 'desktop']) for (const standalone of [true, false]) {
    const off = pv({ platform, standalone, off: true, supported: false, hub: 'desktop', sub: undefined });
    assert.deepEqual(off.actions, []);
    assert.match(off.lines[0], /허브\(desktop\)에서 켜세요/);
  }
  assert.match(pv({ off: true, hub: '' }).lines[0], /^알림은 허브에서 켜세요/);
});

test('목록 칸 폭: a named width or a dragged one (a whole number in range); 자동 removes the key', () => {
  const { listWidth, isFree, row } = require('../public/prefs.js');
  const p = row('listW');
  const st = fakeStorage();
  const store = createStore(() => st);
  assert.equal(store.get('listW'), 'auto');
  store.set('listW', '312');
  assert.equal(st.m.get('herdr-hub.listW'), '312');
  assert.equal(store.get('listW'), '312');
  assert.equal(listWidth('312'), 312);
  assert.equal(listWidth('narrow'), 264);
  assert.equal(listWidth('wide'), 400);
  assert.equal(listWidth('auto'), null);
  assert.match(hintOf(p, '312'), /312px/);
  store.set('listW', 'auto');
  assert.equal(st.m.has('herdr-hub.listW'), false);
  for (const bad of ['10', '9999', '300.5', '-300', 'x', 300]) {
    assert.equal(isFree(p, bad), false, String(bad));
    assert.throws(() => store.set('listW', bad));
  }
  for (const raw of ['10', '9999', 'x']) assert.equal(decode(p, raw), 'auto', raw);
});

test('a touch gesture\'s setting shows only with a touch screen; the rest everywhere', () => {
  const edge = PREFS.find((p) => p.key === 'edgeForward');
  assert.equal(shownOn(edge, { touch: true }), true);
  assert.equal(shownOn(edge, { touch: false }), false);
  for (const p of PREFS.filter((x) => x.key !== 'edgeForward')) assert.equal(shownOn(p, { touch: false }), true, p.key);
});

test('빠른 이동의 순서: 완료 먼저 by default, the default stored as nothing', () => {
  const st = fakeStorage();
  const store = createStore(() => st);
  assert.equal(store.get('paletteOrder'), 'done');
  store.set('paletteOrder', 'working');
  assert.equal(st.m.get('herdr-hub.paletteOrder'), 'working');
  store.set('paletteOrder', 'done');
  assert.equal(st.m.has('herdr-hub.paletteOrder'), false);
});
