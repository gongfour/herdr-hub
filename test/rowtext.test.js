'use strict';
// The 작업공간 list's words (public/rowtext.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { shortPath, rowDir, metaName, homePath, termName, hostAria, hostState, hintText, hintDue, hintNext } = require('../public/rowtext.js');

test('a folder in short only when the name does not say it, cut to two folders', () => {
  assert.equal(shortPath('D:\\project\\digitrack\\dotori_rcs', 'dotori_rcs'), '');
  assert.equal(shortPath('D:\\project\\digitrack\\dotori_rcs', 'mob-list'), '…\\digitrack\\dotori_rcs');
  assert.equal(shortPath('/Users/kang/Project/herdr-hub', 'hub'), '…/Project/herdr-hub');
  assert.equal(shortPath('/Users/kang/Project/herdr-hub/', 'herdr-hub'), '');
  assert.equal(shortPath('/srv/app', 'x'), '/srv/app');
  assert.equal(shortPath('', 'x'), '');
  assert.equal(shortPath(null, 'x'), '');
});

test('a row shows its own last folder unless the workspace or the row is named like it', () => {
  assert.equal(rowDir('/Users/kang/Project/herdr-hub', 'hub', 'fix the list'), 'herdr-hub');
  assert.equal(rowDir('/Users/kang/Project/herdr-hub/', 'hub', 'fix the list'), 'herdr-hub');
  assert.equal(rowDir('/Users/kang/Project/herdr-hub', 'herdr-hub', 'fix the list'), ''); // the workspace says it
  assert.equal(rowDir('/Users/kang/Project/herdr-hub', 'hub', 'herdr-hub'), ''); // the row says it
  assert.equal(rowDir('D:\\project\\digitrack\\dotori_rcs', 'mob', 'nu'), 'dotori_rcs');
  assert.equal(rowDir('/srv/app', 'x', 'y'), 'app');
  assert.equal(rowDir('/', 'x', 'y'), '/');
  assert.equal(rowDir('', 'x', 'y'), '');
  assert.equal(rowDir(undefined, 'x'), '');
});

test('the small line has the agent name only when the title does not begin with it', () => {
  assert.equal(metaName('hub-cwd', 'hub-cwd: 새 대화 시작 폴더'), '');
  assert.equal(metaName('hub-cwd', 'hub-cwd 새 대화'), '');
  assert.equal(metaName('hub-cwd', 'hub-cwd'), '');
  assert.equal(metaName('Hub-CWD', 'hub-cwd: x'), '');
  assert.equal(metaName('hub', 'hub-cwd: x'), 'hub'); // a longer word, not the name
  assert.equal(metaName('hub-cwd', 'Nu parser failure on host'), 'hub-cwd');
  assert.equal(metaName('hub-cwd', ''), ''); // no title: the name is the title
  assert.equal(metaName('', 'x'), '');
});

test('a folder in a sentence: ~ for home, a deep one as its last two', () => {
  assert.equal(homePath('/Users/kang/Project/herdr-hub', '/Users/kang'), '~/Project/herdr-hub');
  assert.equal(homePath('/Users/kang/Project/herdr-hub', '/Users/kang/'), '~/Project/herdr-hub');
  assert.equal(homePath('/Users/kang', '/Users/kang'), '~');
  assert.equal(homePath('/Users/kangx/a', '/Users/kang'), '/Users/kangx/a'); // not under home
  assert.equal(homePath('/Users/kang/a/b/c/d', '/Users/kang'), '…/c/d');
  assert.equal(homePath('C:\\Users\\kangw\\dev\\x', 'C:\\Users\\kangw'), '~\\dev\\x');
  assert.equal(homePath('c:\\users\\KANGW\\a', 'C:\\Users\\kangw'), '~\\a'); // Windows ignores case
  assert.equal(homePath('/opt/x', ''), '/opt/x');
  assert.equal(homePath('', '/Users/kang'), '');
});

test('a shell row always has a name', () => {
  assert.equal(termName({ label: 'build', title: 'nu' }), 'build');
  assert.equal(termName({ label: null, title: 'C:\\Program Files\\nu\\nu.exe' }), 'nu.exe');
  assert.equal(termName({ label: '', title: 'htop' }), 'htop');
  assert.equal(termName({ label: '', title: '셸', cwd: '/Users/kang/Project/herdr-hub', pane: 'p3' }), 'herdr-hub');
  assert.equal(termName({ label: ' ', title: '  ', cwd: '', pane: 'p3' }), 'p3');
  assert.equal(termName({}), '셸');
});

test('a host button says offline and a version mismatch in words', () => {
  assert.equal(hostAria({ label: 'server', online: true }), 'server');
  assert.equal(hostAria({ label: 'server', online: false }), 'server, 오프라인');
  assert.equal(hostAria({ label: 'mac', online: true }, 'API 2 ≠ 3'), 'mac, API 버전 다름, 배포 필요');
});

test("a host's dot: up, herdr not answering, connecting or offline", () => {
  assert.equal(hostState({ online: true, herdr: 'up' }), 'up');
  assert.equal(hostState({ online: true, herdr: 'down' }), 'herdr');
  assert.equal(hostState({ online: true }), 'herdr');
  assert.equal(hostState({ online: false, herdr: 'up' }), 'off');
  assert.equal(hostState({ online: false, herdr: 'connecting', connecting: true }), 'connecting');
  // A hub just started, its peer not reached yet: connecting, not offline (no red flash on a restart).
  assert.equal(hostState({ online: false, herdr: 'offline', error: 'connecting', staleAt: null }), 'connecting');
  // Heard before (a ghost) or failed since: offline.
  assert.equal(hostState({ online: false, herdr: 'offline', error: 'connecting', staleAt: 1700000000000 }), 'off');
  assert.equal(hostState({ online: false, herdr: 'offline', error: 'timeout' }), 'off');
  assert.equal(hostState(null), 'off');
});

test('the first-visit hint: the host swipe only with hosts, three starts or ✕', () => {
  assert.match(hintText(true), /기기 바꾸기/);
  assert.doesNotMatch(hintText(false), /기기|호스트/);
  assert.ok(hintDue(null));
  assert.ok(hintDue('1')); // the old code's mark: seen once
  assert.ok(!hintDue('3'));
  assert.ok(!hintDue('x'));
  assert.equal(hintNext(null), '1');
  assert.equal(hintNext('2'), '3');
  assert.equal(hintNext('3'), '3');
});

test('asOf: a ghost\'s time as 「오후 10:47 기준」, yesterday and older with the day', () => {
  const { asOf, lastStatus } = require('../public/rowtext.js');
  const now = new Date(2026, 10, 5, 9, 30).getTime();
  assert.equal(asOf(new Date(2026, 10, 5, 8, 1).getTime(), now), '오전 08:01 기준');
  assert.equal(asOf(new Date(2026, 10, 4, 22, 47).getTime(), now), '어제 오후 10:47 기준');
  assert.equal(asOf(new Date(2026, 10, 2, 22, 47).getTime(), now), '11월 2일 오후 10:47 기준');
  assert.equal(asOf(null, now), '');
  assert.equal(lastStatus({ lastStatus: 'working' }), '마지막: 작업 중');
  assert.equal(lastStatus({ lastStatus: 'blocked' }), '마지막: 답 필요');
  assert.equal(lastStatus({ lastStatus: 'unknown' }), '마지막 모습');
});
