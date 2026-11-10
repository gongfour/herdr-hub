'use strict';
// One line per tool call (lib/tools.js): the chat's tool lines and the home screen's 작업 중 line.
const test = require('node:test');
const assert = require('node:assert/strict');
const { toolSummary, toolCommand, stripCd } = require('../lib/tools');

const bash = (command, description) => ({ name: 'Bash', input: { command, ...(description ? { description } : {}) } });

test('a shell command without its leading cd, with the folder as context', () => {
  assert.equal(toolSummary(bash('cd /Users/alex/Project/herdr-hub && npm test')), 'npm test · herdr-hub');
  assert.equal(toolSummary(bash('cd "C:/Users/alice/AppData/Local/Temp/claude/D--x" && git status; git diff')), 'git status; git diff · D--x');
  assert.equal(toolSummary(bash("cd '/tmp/my dir' ; ls -la")), 'ls -la · my dir');
  assert.equal(toolSummary(bash('cd /a && cd src && rg -l "MapEditSection"')), 'rg -l "MapEditSection" · src');
  assert.equal(toolSummary(bash('cd /d D:\\project\\robots && dir')), 'dir · robots');
  assert.equal(toolSummary(bash('Set-Location C:\\src\\hub; npm ci')), 'npm ci · hub');
  assert.equal(toolSummary(bash('cd ~ && ls')), 'ls');
  assert.equal(toolSummary(bash('npm test')), 'npm test');
  assert.equal(toolSummary(bash('cd /tmp')), 'cd /tmp'); // nothing after it: the cd is the command
  assert.equal(toolSummary(bash('cd /a && ')), 'cd /a &&');
  assert.equal(toolSummary(bash('echo cd /a && ls')), 'echo cd /a && ls'); // only a leading cd
});

test('leading variables set with ; or && go too; a cd to one names its folder', () => {
  assert.equal(toolSummary(bash("S='C:/Users/alice/src/hub'; cd \"$S\" && git log -3")), 'git log -3 · hub');
  assert.equal(toolSummary(bash('S="/a/b"; cd "${S}/lib" && ls')), 'ls · lib');
  assert.equal(toolSummary(bash('export NODE_ENV=test && npm test')), 'npm test');
  assert.equal(toolSummary(bash('A=1; B="x y" && cd /p/q && make')), 'make · q');
  assert.equal(toolSummary(bash('cd /p && X=1; run')), 'run · p');
  assert.equal(toolSummary(bash('NODE_ENV=test npm test')), 'NODE_ENV=test npm test'); // an env prefix is part of the command
  assert.equal(toolSummary(bash('A=1;')), 'A=1;'); // nothing after it
  assert.equal(toolSummary(bash('cd "$HOME/x" && ls')), 'ls · x'); // a variable not set here: as written
});

test("Claude Code's description of a command comes first", () => {
  assert.equal(toolSummary(bash('cd /x && npm test -- --watch=false', 'Run the  unit tests')), 'Run the unit tests');
  assert.equal(toolCommand(bash('cd /x && npm test', 'Run tests')), 'cd /x && npm test');
  assert.equal(toolCommand({ name: 'Read', input: { file_path: '/a/b' } }), '');
});

test('file tools lead with the file name, then its folder', () => {
  assert.equal(toolSummary({ name: 'Read', input: { file_path: '/Users/alex/Project/herdr-hub/lib/http.js' } }), 'http.js · herdr-hub/lib');
  assert.equal(toolSummary({ name: 'Edit', input: { file_path: 'C:\\Users\\alice\\src\\hub\\server.js', old_string: 'a' } }), 'server.js · src/hub');
  assert.equal(toolSummary({ name: 'Write', input: { file_path: '/notes.md' } }), 'notes.md');
  assert.equal(toolSummary({ name: 'NotebookEdit', input: { notebook_path: '/w/a.ipynb' } }), 'a.ipynb · w');
});

test('other tools as before; long lines are cut', () => {
  assert.equal(toolSummary({ name: 'Grep', input: { pattern: 'foo\\s+bar', path: '/x' } }), 'foo\\s+bar');
  assert.equal(toolSummary({ name: 'Task', input: { description: 'Find the bug', prompt: 'long' } }), 'Find the bug');
  assert.equal(toolSummary({ name: 'AskUserQuestion', input: { questions: [{ question: 'Pick?' }] } }), 'Pick?');
  assert.equal(toolSummary({ name: 'X', input: {} }), '');
  assert.equal(toolSummary({ name: 'X' }), '');
  const long = toolSummary(bash(`cd /a && echo ${'x'.repeat(300)}`));
  assert.equal(long.length, 140);
  assert.ok(long.endsWith('…'));
});

test('stripCd: the command after the cd steps, and the last folder', () => {
  assert.deepEqual(stripCd('cd /a/b && make'), { rest: 'make', dir: '/a/b' });
  assert.deepEqual(stripCd('make'), { rest: 'make', dir: '' });
});

test('Skill: the skill\'s name, then its arguments', () => {
  assert.equal(toolSummary({ name: 'Skill', input: { skill: 'design:design-critique' } }), 'design:design-critique');
  assert.equal(toolSummary({ name: 'Skill', input: { skill: 'loop', args: '5m  /foo' } }), 'loop · 5m /foo');
});
