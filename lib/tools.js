'use strict';
// One line per tool call, for the chat's tool lines and the home screen's 작업 중 line
// ("Bash: npm test"). Pure.
//
// Claude Code starts almost every shell command with `cd <folder> &&`, which used to fill the
// line: that prefix goes, and the folder's name follows the command as context
// ("rg -l Foo · src"). Claude Code's own description of a command, when it sent one, is
// shorter still and is used instead. File tools lead with the file's name ("http.js · herdr-hub/lib").

const MAX = 140;
const one = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const clip = (s) => (s.length > MAX ? `${s.slice(0, MAX - 1)}…` : s);
const parts = (p) => String(p || '').split(/[\\/]+/).filter(Boolean);
const tail = (p, n) => parts(p).slice(-n).join('/');

// Leading `cd <dir> &&` / `cd <dir>;` steps (also `cd /d`, pushd, Set-Location), in a row.
// -> { rest, dir }: the command after them and the last folder changed to ('' when none).
const CD = /^\s*(?:cd|pushd|set-location|sl)\s+(?:\/d\s+)?(?:-literalpath\s+|-path\s+)?("([^"]*)"|'([^']*)'|([^\s;&|]+))\s*(?:&&|;)\s*/i;
function stripCd(command) {
  let rest = String(command || '');
  let dir = '';
  for (let m; (m = CD.exec(rest)) && rest.slice(m[0].length).trim(); ) {
    dir = m[2] ?? m[3] ?? m[4];
    rest = rest.slice(m[0].length);
  }
  return { rest, dir };
}

function toolSummary(block) {
  const input = (block && block.input) || {};
  if (typeof input.command === 'string') {
    const desc = one(input.description);
    if (desc) return clip(desc);
    const { rest, dir } = stripCd(input.command);
    const where = dir ? tail(dir, 1) : '';
    return clip(`${one(rest)}${where && where !== '.' && where !== '~' ? ` · ${where}` : ''}`);
  }
  const file = input.file_path || input.notebook_path;
  if (typeof file === 'string' && file) {
    const name = tail(file, 1);
    const parent = parts(file).slice(-3, -1).join('/');
    return clip(parent ? `${name} · ${parent}` : name);
  }
  // Skill: its name ("design:design-critique"), then what it was given.
  if (typeof input.skill === 'string' && input.skill) return clip(`${one(input.skill)}${one(input.args) ? ` · ${one(input.args)}` : ''}`);
  const asked = Array.isArray(input.questions) ? input.questions.map((q) => q && q.question).filter(Boolean).join(' / ') : '';
  return clip(one(input.description || input.pattern || input.url || input.query || input.prompt || asked || ''));
}

// The whole command, for a tool line opened in the chat, when the summary doesn't show it.
function toolCommand(block) {
  const input = (block && block.input) || {};
  if (typeof input.command !== 'string') return '';
  const cmd = String(input.command).replace(/\r/g, '').trim();
  return cmd.length > 1000 ? `${cmd.slice(0, 1000)}…` : cmd;
}

module.exports = { toolSummary, toolCommand, stripCd };
