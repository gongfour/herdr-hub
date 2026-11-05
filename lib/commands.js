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

const fsq = require('./fsq');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const CACHE_MS = 60 * 1000;
// Time budgets (lib/fsq.js): past them a list comes back with what was found, partial.
const LIST_MS = 3000;
const WALK_MS = 2000;
const MAX_DESC = 200;

// Built-ins and bundled skills/workflows from the table on code.claude.com/docs/en/commands
// (checked 2026-11-03; removed ones such as /vim, /pr-comments and /ultraplan left out; aliases
// left out). Some only appear for some plans or platforms, as the docs say. menu: the bare
// command opens a picker or dialog in the terminal, answered from the screen sheet.
const BUILTIN = [
  ['add-dir', '작업 폴더를 하나 더 추가', '<path>'],
  ['advisor', '조언 모델(advisor) 켜기·끄기', '[model|off]'],
  ['agents', '서브에이전트 만들기·관리 안내'],
  ['artifact-capabilities', '아티팩트 런타임 기능 참고 불러오기(스킬)'],
  ['artifact-diagramming', '아티팩트 다이어그램 지침 불러오기(스킬)'],
  ['artifacts', '내 아티팩트 목록·첨부·열기', '', true],
  ['auto-mode-setup', 'auto 모드 환경 설정 초안 만들기'],
  ['autocompact', '자동 압축 시점 설정', '[auto|<tokens>]'],
  ['autofix-pr', 'PR 을 지켜보며 고치는 클라우드 세션', '[prompt]'],
  ['background', '이 세션을 백그라운드 에이전트로 보내기', '[prompt]'],
  ['batch', '큰 변경을 여러 작업으로 나눠 병렬 실행(스킬)', '<instruction>'],
  ['branch', '대화를 이 지점에서 갈래로 나누기', '[name]'],
  ['btw', '대화에 남기지 않고 옆길 질문', '[question]'],
  ['bug', '버그 신고·대화 공유', '[report]'],
  ['cd', '대화를 유지한 채 작업 폴더 옮기기', '<path>'],
  ['chrome', 'Claude in Chrome 설정', '', true],
  ['claude-api', 'Claude API 참고 자료 불러오기(스킬)', '[subcommand]'],
  ['claude-in-chrome', '브라우저에서 작업 시키기(스킬)', '[task]'],
  ['clear', '새 대화 시작(문맥 비우기)', '[name]'],
  ['code-review', '현재 변경을 코드 리뷰(스킬)', '[level] [target]'],
  ['color', '이 세션 입력 막대 색 바꾸기', '[color|default]'],
  ['compact', '대화를 요약해 문맥 비우기', '[instructions]'],
  ['config', '설정 화면 열기', '[key=value]', true],
  ['context', '문맥 사용량 보기', '[all]'],
  ['copy', '마지막 응답 복사', '[N]'],
  ['cost', '/usage 와 같음: 비용·사용량'],
  ['dataviz', '차트·대시보드 디자인 지침(스킬)', '[request]'],
  ['debug', '디버그 로그로 문제 진단(스킬)', '[description]'],
  ['deep-research', '웹 조사 후 출처 달린 보고서(워크플로)', '<question>'],
  ['design', 'UI 시안을 Claude Design 으로(스킬)', '[brief]'],
  ['design-login', 'Claude Design 디자인 시스템 접근 허용'],
  ['design-sync', '저장소 디자인 시스템을 Claude Design 에 올리기(스킬)', '[hint]'],
  ['desktop', 'Claude Code 데스크톱 앱에서 이어가기'],
  ['diff', '작업 트리 변경 보기', '', true],
  ['doctor', '설치·설정 점검(스킬)'],
  ['effort', '추론 노력 수준 설정', '[level|auto|status]'],
  ['exit', 'Claude Code 종료'],
  ['export', '대화를 텍스트로 내보내기', '[filename]', true],
  ['fast', '빠른 모드 켜기·끄기', '[on|off]'],
  ['feedback', 'Claude Code 의견 보내기', '[report]'],
  ['fewer-permission-prompts', '자주 쓰는 읽기 명령 허용 목록 만들기(스킬)'],
  ['focus', '집중 보기 켜기·끄기'],
  ['fork', '대화를 새 백그라운드 세션으로 복사', '[prompt]'],
  ['goal', '조건이 맞을 때까지 계속 일하는 목표', '[condition|clear]'],
  ['heapdump', '메모리 스냅숏 저장(진단)'],
  ['help', '도움말과 명령 목록', '', true],
  ['hooks', '훅 설정 보기', '', true],
  ['ide', 'IDE 연동 관리·상태', '', true],
  ['import', 'Codex·Gemini·Cursor 설정 가져오기', '[codex|gemini|cursor]'],
  ['init', 'CLAUDE.md 만들기'],
  ['insights', '최근 세션 분석 HTML 보고서'],
  ['install-github-app', 'Claude GitHub 앱 설치', '', true],
  ['install-slack-app', 'Claude Slack 앱 설치'],
  ['keybindings', '단축키 파일 열기'],
  ['list-agents', '메시지 보낼 수 있는 에이전트·세션 목록'],
  ['login', 'Anthropic 계정 로그인', '', true],
  ['logout', 'Anthropic 계정 로그아웃'],
  ['loop', '프롬프트를 되풀이해 실행(스킬)', '[interval] [prompt]'],
  ['mcp', 'MCP 서버 연결 관리', '[reconnect|enable|disable]', true],
  ['memory', 'CLAUDE.md·자동 메모리 편집', '', true],
  ['mobile', 'Claude 모바일 앱 QR 코드', '', true],
  ['model', '모델 바꾸기', '[model]', true],
  ['output-style', '출력 스타일 보기·바꾸기', '[style]'],
  ['passes', 'Claude Code 무료 일주일 나누기', '', true],
  ['permissions', '도구 권한 규칙 관리', '', true],
  ['plan', '계획 모드로 들어가기', '[description]'],
  ['plugin', '플러그인 관리', '[subcommand]', true],
  ['plugin-authoring', '모드(mod) 만들기 참고 불러오기'],
  ['powerup', '기능을 짧은 강의로 알아보기', '', true],
  ['privacy-settings', '개인정보 설정', '', true],
  ['radio', 'Claude FM 라디오를 브라우저로 열기'],
  ['rate-limit-options', '사용 한도에 걸렸을 때 선택지', '', true],
  ['recap', '이번 세션 한 줄 요약'],
  ['release-notes', '변경 기록 보기', '', true],
  ['reload-plugins', '플러그인 다시 읽기'],
  ['reload-skills', '스킬·명령 다시 읽기'],
  ['remote-control', '이 세션을 claude.ai 원격 제어로 열기'],
  ['remote-env', '클라우드 세션 기본 환경 고르기', '', true],
  ['rename', '세션 이름 바꾸기', '[name]'],
  ['restart', 'Claude Code 다시 시작(업데이트 적용)'],
  ['resume', '이전 대화 이어가기', '[session]', true],
  ['review', '/code-review 와 같음', '[level] [target]'],
  ['rewind', '대화·코드를 이전 지점으로 되돌리기', '', true],
  ['run', '앱을 띄워 변경이 실제로 되는지 보기(스킬)'],
  ['run-skill-generator', '/run·/verify 용 프로젝트 스킬 만들기(스킬)'],
  ['sandbox', '샌드박스 모드 켜기·끄기', '', true],
  ['schedule', '클라우드 예약 작업 만들기·관리', '[description]'],
  ['scroll-speed', '마우스 휠 스크롤 속도', '', true],
  ['security-review', '현재 브랜치 보안 검토'],
  ['setup-bedrock', 'Amazon Bedrock 설정 마법사', '', true],
  ['setup-vertex', 'Google Cloud 설정 마법사', '', true],
  ['simplify', '바뀐 코드 정리(스킬)', '[target]'],
  ['skill-doctor', '스킬별 문맥 비용·사용 빈도'],
  ['skills', '스킬 목록', '', true],
  ['slides', '발표 자료를 Claude Slides 로(스킬)', '[brief]'],
  ['stats', '/usage 와 같음'],
  ['status', '버전·모델·계정 상태', '', true],
  ['statusline', '상태 줄 설정'],
  ['stickers', 'Claude Code 스티커 주문'],
  ['stop', '붙어 있는 백그라운드 세션 멈추기'],
  ['subtask', '대화를 이어받는 백그라운드 서브에이전트', '<task>'],
  ['tasks', '백그라운드 작업 보기', '', true],
  ['team-onboarding', '팀 온보딩 안내서 만들기'],
  ['teleport', '클라우드 세션을 이 터미널로 가져오기', '', true],
  ['terminal-setup', 'Shift+Enter 줄바꿈 키 설치'],
  ['theme', '색 테마 바꾸기', '', true],
  ['tui', '터미널 화면 방식 바꾸고 다시 열기', '[default|fullscreen]'],
  ['ultrareview', '클라우드 다중 에이전트 코드 리뷰', '[PR or branch]'],
  ['update-config', 'settings.json 바꾸기(스킬)', '[request]'],
  ['upgrade', '상위 요금제 페이지 열기'],
  ['usage', '비용·사용량 보기', '', true],
  ['usage-credits', '사용 크레딧 설정·요청', '', true],
  ['verify', '앱을 띄워 변경을 직접 확인(스킬)'],
  ['voice', '음성 받아쓰기', '[hold|tap|off]'],
  ['web-setup', '클라우드 세션용 GitHub 연결'],
  ['workflow-authoring', '워크플로 스크립트 작성 참고(스킬)'],
  ['workflows', '워크플로 진행 화면', '', true],
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

// Only the head of each file: frontmatter never needs more. All reads below are asynchronous and
// share the request's budget b (lib/fsq.js); a read that failed or gave up counts as missing.
async function readHead(b, file, bytes = 16 * 1024) {
  try {
    return (await fsq.readPart(b, file, bytes)).buf.toString('utf8');
  } catch {
    return null;
  }
}

const isDir = (b, p) => fsq.isDir(b, p);

async function readJson(b, file) {
  try {
    return JSON.parse(await fsq.readFile(b, file));
  } catch {
    return null;
  }
}

const readdir = (b, d) => fsq.readdir(b, d).catch(() => null);

// ---------------------------------------------------------------- sources

// Every *.md under a commands folder; "a/b.md" is "a:b".
async function commandsIn(b, dir, source, prefix = '') {
  const out = [];
  const walk = async (d, ns, depth) => {
    const entries = await readdir(b, d);
    if (!entries) return;
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(d, e.name);
      const dir = e.isDirectory() || (e.isSymbolicLink() && (await isDir(b, full)));
      if (dir && depth < 4) await walk(full, [...ns, e.name], depth + 1);
      else if (!dir && /\.md$/i.test(e.name)) {
        const text = await readHead(b, full);
        if (text == null) continue;
        const { meta, body } = frontmatter(text);
        out.push({ name: prefix + [...ns, e.name.replace(/\.md$/i, '')].join(':'), desc: oneLine(meta.description || firstLine(body)), hint: hintOf(meta), source });
      }
    }
  };
  await walk(dir, [], 0);
  return out;
}

// <dir>/<name>/SKILL.md for each folder; the frontmatter name wins over the folder's.
async function skillsIn(b, dir, source, prefix = '', hidden = new Set()) {
  const out = [];
  const entries = await readdir(b, dir);
  if (!entries) return out;
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const text = await readHead(b, path.join(dir, e.name, 'SKILL.md'));
    if (text == null) continue;
    const { meta, body } = frontmatter(text);
    const name = String(meta.name || e.name).trim();
    if (!name || falsy(meta['user-invocable']) || hidden.has(name) || hidden.has(prefix + name)) continue;
    out.push({ name: prefix + name, desc: oneLine(meta.description || firstLine(body)), hint: hintOf(meta), source });
  }
  return out;
}

// cwd and each parent up to the git root (just cwd outside a repository).
async function projectDirs(cwd, b = fsq.budget()) {
  const dirs = [];
  let d = path.resolve(cwd);
  for (let i = 0; i < 40; i++) {
    dirs.push(d);
    if (await fsq.exists(b, path.join(d, '.git')).catch(() => false)) return dirs;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return [path.resolve(cwd)];
}

// Enabled plugins: installed_plugins.json, switched on by enabledPlugins in the user's
// settings and the project's (later wins). Project-scoped installs count only in their project.
async function plugins(b, home, roots) {
  const installed = await readJson(b, path.join(home, '.claude', 'plugins', 'installed_plugins.json'));
  if (!installed || !installed.plugins) return [];
  const enabled = {};
  const settingsFiles = [path.join(home, '.claude', 'settings.json'), ...roots.slice().reverse().flatMap((r) => [path.join(r, '.claude', 'settings.json'), path.join(r, '.claude', 'settings.local.json')])];
  for (const f of settingsFiles) Object.assign(enabled, ((await readJson(b, f)) || {}).enabledPlugins || {});
  const out = [];
  for (const [key, installs] of Object.entries(installed.plugins)) {
    if (enabled[key] !== true || !Array.isArray(installs)) continue;
    const inst = installs.find((x) => x.scope !== 'project' && x.scope !== 'local') || installs.find((x) => x.projectPath && roots.some((r) => path.resolve(x.projectPath) === r));
    if (!inst || !inst.installPath || !(await isDir(b, inst.installPath))) continue;
    const manifest = (await readJson(b, path.join(inst.installPath, '.claude-plugin', 'plugin.json'))) || {};
    out.push({ name: manifest.name || key.split('@')[0], dir: inst.installPath, manifest });
  }
  return out;
}

// Extra folders a plugin.json names for commands/skills, besides the default ones.
const extraDirs = (p, field) => [].concat(p.manifest[field] || []).filter((x) => typeof x === 'string').map((x) => path.resolve(p.dir, x));

async function skillOverridesOff(b, home, roots) {
  const off = new Set();
  for (const f of [path.join(home, '.claude', 'settings.json'), ...roots.flatMap((r) => [path.join(r, '.claude', 'settings.json'), path.join(r, '.claude', 'settings.local.json')])]) {
    const o = ((await readJson(b, f)) || {}).skillOverrides;
    if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (v === 'off') off.add(k);
  }
  return off;
}

const GROUP = { builtin: 0, project: 1, user: 2, skill: 3, plugin: 4 };
const byGroup = (a, b) => GROUP[a.source] - GROUP[b.source] || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });

// b: the time budget; past it the list holds what was read by then and b.partial is set.
async function collect(cwd, home = os.homedir(), b = fsq.budget(LIST_MS)) {
  const roots = await projectDirs(cwd, b);
  const off = await skillOverridesOff(b, home, roots);
  const claude = path.join(home, '.claude');

  // Name clashes among the unprefixed ones: skill over command, personal over project.
  const named = new Map();
  const put = (list, rank) => {
    for (const c of list) {
      const prev = named.get(c.name);
      if (!prev || rank > prev.rank) named.set(c.name, { ...c, rank });
    }
  };
  for (const r of roots.slice().reverse()) put(await commandsIn(b, path.join(r, '.claude', 'commands'), 'project'), 1);
  put(await commandsIn(b, path.join(claude, 'commands'), 'user'), 2);
  for (const r of roots.slice().reverse()) put((await skillsIn(b, path.join(r, '.claude', 'skills'), 'skill', '', off)).map((s) => ({ ...s, scope: 'project' })), 3);
  put((await skillsIn(b, path.join(claude, 'skills'), 'skill', '', off)).map((s) => ({ ...s, scope: 'user' })), 4);

  // claude.ai skills synced into ~/.claude/skills/synced/<bucket>/: plain "/name" in the menu
  // (checked in 2.1.317), below your own skills of the same name.
  for (const bucket of (await readdir(b, path.join(claude, 'skills', 'synced'))) || [])
    if (bucket.isDirectory()) put((await skillsIn(b, path.join(claude, 'skills', 'synced', bucket.name), 'skill', '', off)).map((s) => ({ ...s, scope: 'claude.ai' })), 2.5);

  const fromPlugins = [];
  for (const p of await plugins(b, home, roots)) {
    for (const d of [path.join(p.dir, 'commands'), ...extraDirs(p, 'commands')]) fromPlugins.push(...(await commandsIn(b, d, 'plugin', `${p.name}:`)));
    for (const d of [path.join(p.dir, 'skills'), ...extraDirs(p, 'skills')]) fromPlugins.push(...(await skillsIn(b, d, 'plugin', `${p.name}:`, off)));
  }

  // A skill or command of a built-in's name replaces it.
  const builtin = BUILTIN.filter((b) => !named.has(b.name));
  const seen = new Set();
  const all = [...builtin, ...[...named.values()].map(({ rank, ...c }) => c), ...fromPlugins].filter((c) => !seen.has(c.name) && seen.add(c.name));
  return all.sort(byGroup);
}

// One read per cwd at a time: requests that arrive meanwhile share it. A partial list (the budget
// ran out) is not cached: the paths that were stuck are skipped next time (lib/fsq.js).
const cache = new Map(); // cwd -> { at, commands }
const listing = new Map(); // cwd -> promise of { commands, partial }
async function list(cwd, { home, now = Date.now(), budgetMs = LIST_MS } = {}) {
  const key = path.resolve(cwd);
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return { commands: hit.commands, partial: false };
  if (!listing.has(key)) {
    const b = fsq.budget(budgetMs);
    const job = collect(key, home, b)
      .then((commands) => {
        if (!b.partial) {
          cache.set(key, { at: now, commands });
          if (cache.size > 50) cache.delete(cache.keys().next().value);
        } else log(`commands for ${key}: partial (time budget)`);
        return { commands, partial: b.partial };
      })
      .finally(() => listing.delete(key));
    listing.set(key, job);
  }
  return listing.get(key);
}

let log = (line) => console.error(`${new Date().toISOString()} ${line}`);
const setLog = (f) => (log = f);

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

async function walkFiles(cwd, b = fsq.budget(WALK_MS)) {
  const out = [];
  const queue = [['', 0]];
  while (queue.length && out.length < 5000) {
    const [rel, depth] = queue.shift();
    if (b.left() <= 0) {
      b.partial = true;
      break;
    }
    const entries = await readdir(b, path.join(cwd, rel));
    if (!entries) continue;
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

// A folder that holds the home folder (/, /Users) or is it: never walked. That walk reaches folders
// macOS guards (Desktop, Documents, Library, /Volumes), where one readdir can block for good (when
// the walk was synchronous it froze the server: a new agent briefly reported / as its folder,
// 2026-11-05). Each guarded folder would now cost a stuck pool thread and the budget.
function tooWide(cwd, home = os.homedir()) {
  const rel = path.relative(cwd, home);
  return cwd === path.parse(cwd).root || rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// One listing per cwd at a time (requests meanwhile share it). A partial walk is not cached.
const walking = new Map(); // cwd -> promise of { files, partial }
const tooWideLogged = new Set();
async function allFiles(cwd, { now = Date.now(), budgetMs = WALK_MS } = {}) {
  if (tooWide(cwd)) {
    if (!tooWideLogged.has(cwd)) {
      tooWideLogged.add(cwd);
      log(`@-files: not walking ${cwd} (holds the home folder)`);
    }
    return { files: [], partial: false };
  }
  const hit = fileCache.get(cwd);
  if (hit && now - hit.at < CACHE_MS) return { files: hit.files, partial: false };
  if (!walking.has(cwd)) {
    const job = (async () => {
      const git = await gitFiles(cwd);
      const b = fsq.budget(budgetMs);
      const files = git || (await walkFiles(cwd, b));
      if (b.partial) log(`@-files: walk of ${cwd} partial (time budget), ${files.length} files`);
      else {
        fileCache.set(cwd, { at: now, files });
        if (fileCache.size > 20) fileCache.delete(fileCache.keys().next().value);
      }
      return { files, partial: b.partial };
    })().finally(() => walking.delete(cwd));
    walking.set(cwd, job);
  }
  return walking.get(cwd);
}

// Paths for "@<q>": files and folders (folders end in "/"). With a "/" in q, the entries of
// that folder whose names start with or contain the rest; without, a match anywhere in the
// path, name matches first. Prefix matches come before substring ones.
// partial: the walk ran out of time; files holds what it found (truncated is then true too).
async function files(cwd, q = '', limit = 40, opts = {}) {
  const root = path.resolve(cwd);
  const { files: list, partial } = await allFiles(root, opts);
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
  const out = { files: pick.slice(0, limit).map((p) => ({ path: p, dir: p.endsWith('/') })), truncated: pick.length > limit || partial };
  if (partial) out.partial = true;
  return out;
}

module.exports = { list, files, collect, frontmatter, BUILTIN, projectDirs, tooWide, setLog, WALK_MS, LIST_MS };
