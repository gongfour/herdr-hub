'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { shellName, entries, newestFirst, files } = require('../lib/history');

test('shellName normalizes process names', () => {
  assert.equal(shellName('-nu'), 'nu');
  assert.equal(shellName('/bin/zsh'), 'zsh');
  assert.equal(shellName('C:\\Program Files\\PowerShell\\7\\pwsh.exe'), 'pwsh');
  assert.equal(shellName('claude'), null);
});

test('each format becomes one command per entry, multi-line ones dropped', () => {
  assert.deepEqual(entries('nu', 'ls\nfor x in [1 2] {<\\n>  echo $x<\\n>}\ngit status\n'), ['ls', null, 'git status', '']);
  assert.deepEqual(entries('pwsh', 'cd D:/x\nGet-Thing `\n  -Name a\ndir\n'), ['cd D:/x', null, 'dir', '']);
  assert.deepEqual(entries('zsh', ': 1700000000:0;brew\n: 1700000001:0;echo a \\\nb\nls\n'), ['brew', null, 'ls', '']);
  assert.deepEqual(entries('bash', '#1700000000\nmake\nls\n'), ['make', 'ls', '']);
  assert.deepEqual(entries('fish', '- cmd: ls\n  when: 1\n- cmd: echo a\\nb\n- cmd: git log\n'), ['ls', null, 'git log']);
});

test('newestFirst keeps the latest of each command and skips blanks and long lines', () => {
  assert.deepEqual(newestFirst(['git status', 'ls', null, '', 'x'.repeat(400), 'git status', ' ls ']), ['ls', 'git status']);
  const launch = "if((Get-Command claude -ErrorAction SilentlyContinue).CommandType -eq 'ExternalScript'){& claude '--model' haiku}else{Start-Process -FilePath claude}";
  assert.deepEqual(newestFirst(['dir', launch]), ['dir']); // herdr's agent start, not the user's
});

test('history files by shell and platform', () => {
  assert.match(files('nu', { home: '/Users/k', env: {}, platform: 'darwin' })[0], /Application Support\/nushell\/history\.txt$/);
  assert.match(files('pwsh', { home: 'C:\\Users\\k', env: { APPDATA: 'C:\\Users\\k\\AppData\\Roaming' }, platform: 'win32' })[0], /ConsoleHost_history\.txt$/);
  assert.deepEqual(files('cmd'), []);
});
