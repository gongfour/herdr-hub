'use strict';
// What the API accepts from the page (lib/validate.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const v = require('../lib/validate');

const code = (fn) => {
  try {
    fn();
  } catch (err) {
    assert.equal(err.status, 400);
    return err.code;
  }
  return null;
};
const codeAsync = async (fn) => {
  try {
    await fn();
  } catch (err) {
    assert.equal(err.status, 400);
    return err.code;
  }
  return null;
};

test('validKeys: agent keys by default, the wider pane set when asked, 1 to 8 of them', () => {
  assert.equal(v.validKeys(['esc', 'shift+tab', '1']), true);
  assert.equal(v.validKeys(['pageup']), false);
  assert.equal(v.validKeys(['pageup', 'ctrl+r', 'alt+b', 'f12', 'delete'], v.PANE_KEYS), true);
  assert.equal(v.validKeys(['ctrl+1'], v.PANE_KEYS), false);
  assert.equal(v.validKeys([]), false);
  assert.equal(v.validKeys(Array(9).fill('enter')), false);
  assert.equal(v.validKeys('enter'), false);
});

test('badText: one line of at most 4000 characters', () => {
  assert.equal(v.badText(''), false);
  assert.equal(v.badText('ls -la 한글'), false);
  assert.equal(v.badText('a\nb'), true);
  assert.equal(v.badText('\x1b[A'), true);
  assert.equal(v.badText('x'.repeat(4001)), true);
  assert.equal(v.badText(3), true);
});

test('cleanLabel: trimmed, 60 characters, required when asked', () => {
  assert.equal(v.cleanLabel('  빌드 '), '빌드');
  assert.equal(v.cleanLabel(''), null);
  assert.equal(v.cleanLabel('   '), null);
  assert.equal(code(() => v.cleanLabel('', { required: true })), 'empty_label');
  assert.equal(code(() => v.cleanLabel('  ', { required: true })), 'empty_label');
  assert.equal(code(() => v.cleanLabel('x'.repeat(61))), 'bad_label');
  assert.equal(code(() => v.cleanLabel('a\tb')), 'bad_label');
});

test('cleanCwd: an existing absolute folder on this host', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-validate-'));
  const file = path.join(dir, 'f.txt');
  fs.writeFileSync(file, '');
  try {
    assert.equal(await v.cleanCwd(` ${dir}${path.sep} `), path.resolve(dir));
    assert.equal(await codeAsync(() => v.cleanCwd('relative/dir')), 'cwd_not_absolute');
    assert.equal(await codeAsync(() => v.cleanCwd(path.join(dir, 'gone'))), 'cwd_not_found');
    assert.equal(await codeAsync(() => v.cleanCwd(file)), 'cwd_not_directory');
    assert.equal(await codeAsync(() => v.cleanCwd('')), 'bad_cwd');
    assert.equal(await codeAsync(() => v.cleanCwd(`${dir}\n`)), 'bad_cwd');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cleanAgentSpec: kind, args and name checked; a missing name comes from the folder, unique', () => {
  assert.deepEqual(v.cleanAgentSpec({ kind: 'claude', args: ['--model', 'haiku'], name: 'rev' }), { kind: 'claude', args: ['--model', 'haiku'], name: 'rev' });
  assert.equal(code(() => v.cleanAgentSpec({ kind: 'bash' })), 'bad_kind');
  assert.equal(code(() => v.cleanAgentSpec({ kind: 'claude', args: ['a;b'] })), 'bad_args');
  assert.equal(code(() => v.cleanAgentSpec({ kind: 'claude', name: 'Rev' })), 'bad_agent_name');
  assert.equal(code(() => v.cleanAgentSpec(null)), 'bad_agent');
  const a = v.cleanAgentSpec({ kind: 'claude' }, ['hub-ref-a'], []);
  const b = v.cleanAgentSpec({ kind: 'claude' }, ['hub-ref-a'], [a.name]);
  assert.match(a.name, /^[a-z][a-z0-9_-]*$/);
  assert.notEqual(a.name, b.name);
});

test('cleanLines: a whole number from 1 to 400, the fallback for none, 0 or not a number', () => {
  const { cleanLines } = require('../lib/validate');
  assert.equal(cleanLines('200', 80), 200);
  assert.equal(cleanLines(null, 80), 80);
  assert.equal(cleanLines('', 120), 120);
  assert.equal(cleanLines('abc', 120), 120);
  assert.equal(cleanLines('0', 120), 120);
  assert.equal(cleanLines('-5', 120), 1);
  assert.equal(cleanLines('-0.5', 120), 1);
  assert.equal(cleanLines('2.7', 120), 2);
  assert.equal(cleanLines('9999', 120), 400);
  assert.equal(cleanLines('Infinity', 120), 400);
});
