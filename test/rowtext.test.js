'use strict';
// The 작업공간 list's words (public/rowtext.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { shortPath, rowDir, homePath, termName, hostAria, hintText, hintDue, hintNext } = require('../public/rowtext.js');

test('a folder in short only when the name does not say it, cut to two folders', () => {
  assert.equal(shortPath('D:\\project\\digitrack\\dotori_rcs', 'dotori_rcs'), '');
  assert.equal(shortPath('D:\\project\\digitrack\\dotori_rcs', 'mob-list'), '…\\digitrack\\dotori_rcs');
  assert.equal(shortPath('/Users/kang/Project/herdr-hub', 'hub'), '…/Project/herdr-hub');
  assert.equal(shortPath('/Users/kang/Project/herdr-hub/', 'herdr-hub'), '');
  assert.equal(shortPath('/srv/app', 'x'), '/srv/app');
  assert.equal(shortPath('', 'x'), '');
  assert.equal(shortPath(null, 'x'), '');
});

test('a row shows its own folder unless the workspace or the row is named like it', () => {
  assert.equal(rowDir('/Users/kang/Project/herdr-hub', 'hub', 'fix the list'), '…/Project/herdr-hub');
  assert.equal(rowDir('/Users/kang/Project/herdr-hub', 'herdr-hub', 'fix the list'), ''); // the workspace says it
  assert.equal(rowDir('/Users/kang/Project/herdr-hub', 'hub', 'herdr-hub'), ''); // the row says it
  assert.equal(rowDir('D:\\project\\digitrack\\dotori_rcs', 'mob', 'nu'), '…\\digitrack\\dotori_rcs');
  assert.equal(rowDir('/srv/app', 'x', 'y'), '/srv/app');
  assert.equal(rowDir('', 'x', 'y'), '');
  assert.equal(rowDir(undefined, 'x'), '');
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
