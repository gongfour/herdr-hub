'use strict';
// 명령 (public/palette.js): the > mode, the commands the keymap gives, and how a query finds them.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../public/palette.js');
const KM = require('../public/keymap.js');

test('parseQuery: > first is 명령, the rest the query; anything else is 빠른 이동 as typed', () => {
  assert.deepEqual(P.parseQuery('>'), { commands: true, query: '' });
  assert.deepEqual(P.parseQuery('> 설정 '), { commands: true, query: '설정' });
  assert.deepEqual(P.parseQuery('  >끝내기'), { commands: true, query: '끝내기' });
  assert.deepEqual(P.parseQuery('hub>x'), { commands: false, query: 'hub>x' });
  assert.deepEqual(P.parseQuery(''), { commands: false, query: '' });
  assert.deepEqual(P.parseQuery(null), { commands: false, query: '' });
});

test('commandName: cmd, else the label up to 「:」 or 「 (」', () => {
  assert.equal(P.commandName({ label: '대화창 닫기: 연 …' }), '대화창 닫기');
  assert.equal(P.commandName({ label: '설정 열기·닫기 (두 칸이면 오른쪽에)' }), '설정 열기·닫기');
  assert.equal(P.commandName({ label: '새 워크스페이스' }), '새 워크스페이스');
  assert.equal(P.commandName({ label: '두 칸: 사이드바', cmd: '사이드바 접기·펴기' }), '사이드바 접기·펴기');
  assert.equal(P.commandName(null), '');
});

test('every keymap action is a command unless fixed or noCommand, with a short name', () => {
  const cmds = P.actionCommands(KM.ACTIONS);
  const ids = cmds.map((c) => c.action);
  for (const [action, a] of Object.entries(KM.ACTIONS)) assert.equal(ids.includes(action), !a.fixed && !a.noCommand, action);
  for (const gone of ['back', 'answer', 'commands', 'scrollUp', 'scrollDown', 'prevMine', 'nextMine', 'nextPane', 'prevPane']) assert.ok(!ids.includes(gone), gone);
  for (const c of cmds) {
    assert.ok(c.name && c.name.length <= 24, `${c.action}: ${c.name}`);
    assert.ok(!/^두 칸/.test(c.name), c.name);
  }
  assert.equal(cmds.find((c) => c.action === 'closeWorkspace').name, '워크스페이스 닫기');
  assert.equal(cmds.find((c) => c.action === 'leaveView').name, '대화창 닫기');
});

test('actionCommands: can hides, name renames, hint gives the keys, in the table order', () => {
  const cmds = P.actionCommands(KM.ACTIONS, {
    can: (a) => a !== 'stop',
    name: (a) => (a === 'closeView' ? '에이전트 끝내기' : ''),
    sub: (a) => (a === 'closeView' ? 'hub-qtest' : ''),
    hint: (a) => KM.hint(a),
  });
  assert.ok(!cmds.some((c) => c.action === 'stop'));
  const close = cmds.find((c) => c.action === 'closeView');
  assert.equal(close.name, '에이전트 끝내기');
  assert.equal(close.sub, 'hub-qtest');
  assert.equal(close.keys, 'Alt+W');
  assert.equal(close.id, 'key:closeView');
  const order = Object.keys(KM.ACTIONS).filter((a) => cmds.some((c) => c.action === a));
  assert.deepEqual(cmds.map((c) => c.action), order);
});

test('filter: nothing typed keeps the order; the name first, then a word of it, then the label, then the letters in order', () => {
  const C = (name, hay = '') => ({ id: name, name, hay: `${name} ${hay}`, sub: '', keys: '' });
  const cmds = [C('새 워크스페이스'), C('워크스페이스 닫기', '든 워크스페이스를 닫는다'), C('설정 열기'), C('줄바꿈 켜기', 'VS Code 의 Alt+Z'), C('셸 끝내기'), C('에이전트 끝내기')];
  assert.deepEqual(P.filter(cmds, '').map((c) => c.id), cmds.map((c) => c.id));
  assert.deepEqual(P.filter(cmds, '워크').map((c) => c.id), ['워크스페이스 닫기', '새 워크스페이스']); // starts with it, then a word of it
  assert.deepEqual(P.filter(cmds, '끝내기').map((c) => c.id), ['셸 끝내기', '에이전트 끝내기']); // the same fit: as given
  assert.deepEqual(P.filter(cmds, 'vs code').map((c) => c.id), ['줄바꿈 켜기']); // by the label
  assert.deepEqual(P.filter(cmds, '셸끝').map((c) => c.id), ['셸 끝내기']); // the letters in order
  assert.deepEqual(P.filter(cmds, '에이전트 끝').map((c) => c.id), ['에이전트 끝내기']); // every word must fit
  assert.deepEqual(P.filter(cmds, 'xyz'), []);
  assert.deepEqual(P.filter(cmds, 'SET').length, 0);
  assert.deepEqual(P.filter([C('Settings')], 'set').map((c) => c.id), ['Settings']); // case folded
});

test('filter by key: typing a key finds its command', () => {
  const cmds = P.actionCommands(KM.ACTIONS, { hint: (a) => KM.hint(a) });
  assert.equal(P.filter(cmds, 'alt+shift+w')[0].action, 'closeWorkspace');
  assert.equal(P.filter(cmds, '설정')[0].action, 'settings');
  assert.equal(P.filter(cmds, '단축키')[0].action, 'help');
});

test('subsequence', () => {
  assert.ok(P.subsequence('셸끝내기', '셸끝'));
  assert.ok(P.subsequence('newagent', 'nwa'));
  assert.ok(!P.subsequence('newagent', 'awn'));
  assert.ok(P.subsequence('abc', ''));
});
