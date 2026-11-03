'use strict';
// What a Claude Code agent accepts after "/" in its prompt, and file names for "@", read on
// the host the agent runs on. Only names, descriptions, argument hints and sources leave
// this module: never file contents.
//
// Sources, as Claude Code 2.1.317 finds them (code.claude.com/docs/en/skills, /commands):
//   builtin  curated list below (built-in commands and bundled skills)
//   project  <dir>/.claude/commands/**/*.md for the agent's cwd and each parent up to the
//            git root; subfolders become "a:b"
//   user     ~/.claude/commands/**/*.md
//   skill    ~/.claude/skills/*/SKILL.md, <dir>/.claude/skills/*/SKILL.md (same walk as
//            project), and claude.ai skills synced to ~/.claude/skills/synced/<id>/*/SKILL.md
//            (plain names, like the others)
//   plugin   commands/ and skills/ of each enabled plugin, as "plugin:name"
// A skill beats a command of the same name, personal beats project; "user-invocable: false"
// and skillOverrides "off" hide a skill from the menu. MCP prompts are not listed: naming
// them means starting each server.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const CACHE_MS = 60 * 1000;
const MAX_DESC = 200;

// Built-ins checked against code.claude.com/docs/en/commands for 2.1.317. menu: the bare
// command opens a picker or dialog in the terminal, answered from the screen sheet.
const BUILTIN = [
  ['add-dir', '작업 폴더를 하나 더 추가', '<path>'],
  ['agents', '서브에이전트 만들기·관리 안내'],
  ['btw', '대화에 남기지 않고 옆길 질문', '[question]'],
  ['clear', '새 대화 시작(문맥 비우기)', '[name]'],
  ['code-review', '현재 변경을 코드 리뷰(스킬)', '[level] [target]'],
  ['compact', '대화를 요약해 문맥 비우기', '[instructions]'],
  ['config', '설정 화면 열기', '[key=value]', true],
  ['context', '문맥 사용량 보기', '[all]'],
  ['copy', '마지막 응답 복사', '[N]'],
  ['cost', '/usage 와 같음: 비용·사용량'],
  ['debug', '디버그 로그로 문제 진단(스킬)', '[description]'],
  ['diff', '작업 트리 변경 보기', '', true],
  ['doctor', '설치·설정 점검(스킬)'],
  ['effort', '추론 노력 수준 설정', '[level|auto|status]'],
  ['exit', 'Claude Code 종료'],
  ['export', '대화를 텍스트로 내보내기', '[filename]', true],
  ['fast', '빠른 모드 켜기·끄기', '[on|off]'],
  ['help', '도움말과 명령 목록', '', true],
  ['hooks', '훅 설정 보기', '', true],
  ['init', 'CLAUDE.md 만들기'],
  ['login', 'Anthropic 계정 로그인', '', true],
  ['logout', 'Anthropic 계정 로그아웃'],
  ['loop', '프롬프트를 되풀이해 실행(스킬)', '[interval] [prompt]'],
  ['mcp', 'MCP 서버 연결 관리', '[reconnect|enable|disable]', true],
  ['memory', 'CLAUDE.md·자동 메모리 편집', '', true],
  ['model', '모델 바꾸기', '[model]', true],
  ['permissions', '도구 권한 규칙 관리', '', true],
  ['plan', '계획 모드로 들어가기', '[description]'],
  ['plugin', '플러그인 관리', '[subcommand]', true],
  ['recap', '이번 세션 한 줄 요약'],
  ['reload-plugins', '플러그인 다시 읽기'],
  ['reload-skills', '스킬·명령 다시 읽기'],
  ['rename', '세션 이름 바꾸기', '[name]'],
  ['resume', '이전 대화 이어가기', '[session]', true],
  ['review', '/code-review 와 같음', '[level] [target]'],
  ['rewind', '대화·코드를 이전 지점으로 되돌리기', '', true],
  ['security-review', '현재 브랜치 보안 검토'],
  ['simplify', '바뀐 코드 정리(스킬)', '[target]'],
  ['skills', '스킬 목록', '', true],
  ['status', '버전·모델·계정 상태', '', true],
  ['tasks', '백그라운드 작업 보기', '', true],
  ['theme', '색 테마 바꾸기', '', true],
  ['usage', '비용·사용량 보기', '', true],
].map(([name, desc, hint = '', menu = false]) => ({ name, desc, hint, source: 'builtin', ...(menu ? { menu: true } : {}) }));

// ---------------------------------------------------------------- frontmatter

// Just enough YAML for frontmatter: "key: value", quoted values, and > | block scalars.
function frontmatter(text) {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^[>|][+-]?$/.test(v)) {
      const block = [];
      while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]) || !lines[i + 1].trim())) block.push(lines[++i].trim());
      v = v[0] === '>' ? block.filter(Boolean).join(' ') : block.join('\n').trim();
    } else if (/^"/.test(v)) {
      try {
        v = JSON.parse(v);
      } catch {
        v = v.replace(/^"|"$/g, '');
      }
    } else if (/^'/.test(v)) v = v.replace(/^'|'$/g, '').replace(/''/g, "'");
    else v = v.replace(/\s+#.*$/, '');
    meta[kv[1]] = v;
  }
  return { meta, body: text.slice(m[0].length) };
}

const oneLine = (s) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > MAX_DESC ? `${t.slice(0, MAX_DESC - 1)}…` : t;
};
// No description: the first non-empty line of the body, without a heading mark.
const firstLine = (body) => (String(body).split(/\r?\n/).map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean) || '');
const hintOf = (meta) => oneLine(Array.isArray(meta['argument-hint']) ? meta['argument-hint'].join(' ') : meta['argument-hint'] || '');
const falsy = (v) => v === false || /^(false|no|off)$/i.test(String(v ?? ''));

// Only the head of each file: frontmatter never needs more.
function readHead(file, bytes = 16 * 1024) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n).toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd != null) fs.closeSync(fd);
  }
}

const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- sources

// Every *.md under a commands folder; "a/b.md" is "a:b".
function commandsIn(dir, source, prefix = '') {
  const out = [];
  const walk = (d, ns, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(d, e.name);
      const dir = e.isDirectory() || (e.isSymbolicLink() && isDir(full));
      if (dir && depth < 4) walk(full, [...ns, e.name], depth + 1);
      else if (!dir && /\.md$/i.test(e.name)) {
        const text = readHead(full);
        if (text == null) continue;
        const { meta, body } = frontmatter(text);
        out.push({ name: prefix + [...ns, e.name.replace(/\.md$/i, '')].join(':'), desc: oneLine(meta.description || firstLine(body)), hint: hintOf(meta), source });
      }
    }
  };
  walk(dir, [], 0);
  return out;
}

// <dir>/<name>/SKILL.md for each folder; the frontmatter name wins over the folder's.
function skillsIn(dir, source, prefix = '', hidden = new Set()) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const text = readHead(path.join(dir, e.name, 'SKILL.md'));
    if (text == null) continue;
    const { meta, body } = frontmatter(text);
    const name = String(meta.name || e.name).trim();
    if (!name || falsy(meta['user-invocable']) || hidden.has(name) || hidden.has(prefix + name)) continue;
    out.push({ name: prefix + name, desc: oneLine(meta.description || firstLine(body)), hint: hintOf(meta), source });
  }
  return out;
}

// cwd and each parent up to the git root (just cwd outside a repository).
function projectDirs(cwd) {
  const dirs = [];
  let d = path.resolve(cwd);
  for (let i = 0; i < 40; i++) {
    dirs.push(d);
    if (fs.existsSync(path.join(d, '.git'))) return dirs;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return [path.resolve(cwd)];
}

// Enabled plugins: installed_plugins.json, switched on by enabledPlugins in the user's
// settings and the project's (later wins). Project-scoped installs count only in their project.
function plugins(home, roots) {
  const installed = readJson(path.join(home, '.claude', 'plugins', 'installed_plugins.json'));
  if (!installed || !installed.plugins) return [];
  const enabled = {};
  const settingsFiles = [path.join(home, '.claude', 'settings.json'), ...roots.slice().reverse().flatMap((r) => [path.join(r, '.claude', 'settings.json'), path.join(r, '.claude', 'settings.local.json')])];
  for (const f of settingsFiles) Object.assign(enabled, (readJson(f) || {}).enabledPlugins || {});
  const out = [];
  for (const [key, installs] of Object.entries(installed.plugins)) {
    if (enabled[key] !== true || !Array.isArray(installs)) continue;
    const inst = installs.find((x) => x.scope !== 'project' && x.scope !== 'local') || installs.find((x) => x.projectPath && roots.some((r) => path.resolve(x.projectPath) === r));
    if (!inst || !inst.installPath || !isDir(inst.installPath)) continue;
    const manifest = readJson(path.join(inst.installPath, '.claude-plugin', 'plugin.json')) || {};
    out.push({ name: manifest.name || key.split('@')[0], dir: inst.installPath, manifest });
  }
  return out;
}

// Extra folders a plugin.json names for commands/skills, besides the default ones.
const extraDirs = (p, field) => [].concat(p.manifest[field] || []).filter((x) => typeof x === 'string').map((x) => path.resolve(p.dir, x));

function skillOverridesOff(home, roots) {
  const off = new Set();
  for (const f of [path.join(home, '.claude', 'settings.json'), ...roots.flatMap((r) => [path.join(r, '.claude', 'settings.json'), path.join(r, '.claude', 'settings.local.json')])]) {
    const o = (readJson(f) || {}).skillOverrides;
    if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (v === 'off') off.add(k);
  }
  return off;
}

const GROUP = { builtin: 0, project: 1, user: 2, skill: 3, plugin: 4 };
const byGroup = (a, b) => GROUP[a.source] - GROUP[b.source] || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });

function collect(cwd, home = os.homedir()) {
  const roots = projectDirs(cwd);
  const off = skillOverridesOff(home, roots);
  const claude = path.join(home, '.claude');

  // Name clashes among the unprefixed ones: skill over command, personal over project.
  const named = new Map();
  const put = (list, rank) => {
    for (const c of list) {
      const prev = named.get(c.name);
      if (!prev || rank > prev.rank) named.set(c.name, { ...c, rank });
    }
  };
  for (const r of roots.slice().reverse()) put(commandsIn(path.join(r, '.claude', 'commands'), 'project'), 1);
  put(commandsIn(path.join(claude, 'commands'), 'user'), 2);
  for (const r of roots.slice().reverse()) put(skillsIn(path.join(r, '.claude', 'skills'), 'skill', '', off).map((s) => ({ ...s, scope: 'project' })), 3);
  put(skillsIn(path.join(claude, 'skills'), 'skill', '', off).map((s) => ({ ...s, scope: 'user' })), 4);

  // claude.ai skills synced into ~/.claude/skills/synced/<bucket>/: plain "/name" in the menu
  // (checked in 2.1.317), below your own skills of the same name.
  try {
    for (const b of fs.readdirSync(path.join(claude, 'skills', 'synced'), { withFileTypes: true }))
      if (b.isDirectory()) put(skillsIn(path.join(claude, 'skills', 'synced', b.name), 'skill', '', off).map((s) => ({ ...s, scope: 'claude.ai' })), 2.5);
  } catch {
    /* none synced */
  }

  const fromPlugins = plugins(home, roots).flatMap((p) => [
    ...[path.join(p.dir, 'commands'), ...extraDirs(p, 'commands')].flatMap((d) => commandsIn(d, 'plugin', `${p.name}:`)),
    ...[path.join(p.dir, 'skills'), ...extraDirs(p, 'skills')].flatMap((d) => skillsIn(d, 'plugin', `${p.name}:`, off)),
  ]);

  // A skill or command of a built-in's name replaces it.
  const builtin = BUILTIN.filter((b) => !named.has(b.name));
  const seen = new Set();
  const all = [...builtin, ...[...named.values()].map(({ rank, ...c }) => c), ...fromPlugins].filter((c) => !seen.has(c.name) && seen.add(c.name));
  return all.sort(byGroup);
}

const cache = new Map(); // cwd -> { at, commands }
function list(cwd, { home, now = Date.now() } = {}) {
  const key = path.resolve(cwd);
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.commands;
  const commands = collect(key, home);
  cache.set(key, { at: now, commands });
  if (cache.size > 50) cache.delete(cache.keys().next().value);
  return commands;
}

// ---------------------------------------------------------------- files for "@"

const SKIP = new Set(['.git', 'node_modules', '.hg', '.svn', '__pycache__', '.venv', 'venv', '.DS_Store']);
const MAX_FILES = 20000;
const fileCache = new Map(); // cwd -> { at, files, git }

// Files under cwd, relative with "/" separators: git's list (tracked + untracked, honouring
// .gitignore) inside a repository, else a bounded walk.
function gitFiles(cwd) {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], { timeout: 5000, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, out) => {
      if (err) return resolve(null);
      resolve(out.split('\0').filter(Boolean).slice(0, MAX_FILES));
    });
  });
}

function walkFiles(cwd) {
  const out = [];
  const queue = [['', 0]];
  while (queue.length && out.length < 5000) {
    const [rel, depth] = queue.shift();
    let entries;
    try {
      entries = fs.readdirSync(path.join(cwd, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (depth < 6) queue.push([r, depth + 1]);
      } else out.push(r);
    }
  }
  return out;
}

async function allFiles(cwd, now = Date.now()) {
  const hit = fileCache.get(cwd);
  if (hit && now - hit.at < CACHE_MS) return hit.files;
  const files = (await gitFiles(cwd)) || walkFiles(cwd);
  fileCache.set(cwd, { at: now, files });
  if (fileCache.size > 20) fileCache.delete(fileCache.keys().next().value);
  return files;
}

// Paths for "@<q>": files and folders (folders end in "/"). With a "/" in q, the entries of
// that folder whose names start with or contain the rest; without, a match anywhere in the
// path, name matches first. Prefix matches come before substring ones.
async function files(cwd, q = '', limit = 40) {
  const root = path.resolve(cwd);
  const list = await allFiles(root);
  const dirs = new Set();
  for (const f of list) {
    let i = f.lastIndexOf('/');
    while (i > 0) {
      const d = f.slice(0, i);
      if (dirs.has(d)) break;
      dirs.add(d);
      i = d.lastIndexOf('/');
    }
  }
  const entries = [...[...dirs].map((d) => `${d}/`), ...list];
  const query = String(q).replace(/\\/g, '/').replace(/^\.\//, '');
  const slash = query.lastIndexOf('/');
  const lc = (s) => s.toLowerCase();
  let pick;
  if (slash >= 0) {
    const base = lc(query.slice(0, slash + 1));
    const rest = lc(query.slice(slash + 1));
    const under = entries.filter((e) => lc(e).startsWith(base) && e.length > base.length && !e.slice(base.length).replace(/\/$/, '').includes('/'));
    const name = (e) => lc(e.slice(base.length));
    pick = [...under.filter((e) => name(e).startsWith(rest)), ...under.filter((e) => !name(e).startsWith(rest) && name(e).includes(rest))];
  } else if (!query) {
    pick = entries.filter((e) => !e.replace(/\/$/, '').includes('/'));
  } else {
    const ql = lc(query);
    const name = (e) => lc(e.replace(/\/$/, '').split('/').pop());
    const a = entries.filter((e) => name(e).startsWith(ql));
    const b = entries.filter((e) => !name(e).startsWith(ql) && name(e).includes(ql));
    const c = entries.filter((e) => !name(e).includes(ql) && lc(e).includes(ql));
    const short = (x, y) => x.split('/').length - y.split('/').length || x.localeCompare(y);
    pick = [...a.sort(short), ...b.sort(short), ...c.sort(short)];
  }
  if (slash >= 0 || !query) pick.sort((x, y) => (y.endsWith('/') ? 1 : 0) - (x.endsWith('/') ? 1 : 0) || x.localeCompare(y, 'en', { sensitivity: 'base' }));
  return { files: pick.slice(0, limit).map((p) => ({ path: p, dir: p.endsWith('/') })), truncated: pick.length > limit };
}

module.exports = { list, files, collect, frontmatter, BUILTIN, projectDirs };
