'use strict';
// 저장소 그래프: the repositories the agents on this host work in, and what the page reads of
// them (docs/design.md 「저장소 그래프」). Read-only: no fetch, no write, nothing outside git's
// own answers (an untracked file shows by name only, never its content).
//   - A repository is found from the cwd of a pane herdr lists now (agents and shells): only
//     those are known, and an id names one of them (no request names a path).
//   - Worktrees of one repository (one common git dir) are one repository; each worktree has
//     its own short id, and its panes.
//   - Every git call goes through lib/git.js (limits, a stuck folder skipped).
// The parsers are pure and exported for the tests.
const crypto = require('crypto');
const path = require('path');
const fsq = require('./fsq');

const FIND_TTL = 60e3; // a cwd's repository
const FIND_SKIP = 5 * 60e3; // a cwd whose git timed out: not asked again for this long
const SIG_TTL = 3e3;
const STATUS_TTL = 15e3;
const GRAPH_MAX = 2000; // commits read at once and kept; pages come from memory
const GRAPH_PAGE = 400;
const GRAPH_MS = 8000; // below the hub's 15 s to a peer and the page's 15 s
const FALLBACK_N = 500;
const FILES_MAX = 1000;
const STATUS_MAX = 500;
const DIFF_BYTES = 256 << 10;
const MSG_BYTES = 64 << 10;
const GRAPHS_KEPT = 4;

const SHA = /^[0-9a-f]{7,64}$/;
const EMPTY = /^0+$/;
const hash = (s, n = 12) => crypto.createHash('sha1').update(s).digest('hex').slice(0, n);
const norm = (p, platform = process.platform) => {
  const n = String(p).replace(/[\\/]+$/, '') || String(p);
  return platform === 'win32' ? n.replace(/\//g, '\\').toLowerCase() : n;
};

// ---- parsers ----

// git log -z --format=%H%x00%P%x00%ct%x00%an%x00%s
function parseLog(buf) {
  const parts = buf.toString('utf8').split('\0');
  const out = [];
  for (let i = 0; i + 4 < parts.length; i += 5) {
    const h = parts[i].replace(/^\n/, '');
    if (!SHA.test(h)) break;
    out.push({ h, p: parts[i + 1] ? parts[i + 1].split(' ') : [], t: Number(parts[i + 2]) || 0, a: parts[i + 3], s: parts[i + 4] });
  }
  return out;
}

// git worktree list --porcelain
function parseWorktrees(text) {
  const out = [];
  for (const block of String(text).split(/\n\n+/)) {
    const w = {};
    for (const line of block.split('\n')) {
      const sp = line.indexOf(' ');
      const k = sp < 0 ? line : line.slice(0, sp);
      const v = sp < 0 ? '' : line.slice(sp + 1);
      if (k === 'worktree') w.path = v;
      else if (k === 'HEAD') w.head = v;
      else if (k === 'branch') w.branch = v.replace(/^refs\/heads\//, '');
      else if (k === 'detached') w.detached = true;
      else if (k === 'bare') w.bare = true;
      else if (k === 'prunable') w.prunable = true;
      else if (k === 'locked') w.locked = true;
    }
    if (w.path) out.push(w);
  }
  return out;
}

// git for-each-ref --format=%(refname)%00%(objectname)%00%(*objectname)%00%(objecttype)%00%(*objecttype)%00%(symref)
// -> [{ name, kind, h }] pointing at commits; a remote's HEAD (a symref) left out.
function parseRefs(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    if (!line) continue;
    const [ref, obj, peeled, type, ptype, symref] = line.split('\0');
    if (symref) continue;
    const h = peeled || obj;
    if ((peeled ? ptype : type) !== 'commit' || !SHA.test(h || '')) continue;
    let m;
    if ((m = ref.match(/^refs\/heads\/(.+)$/))) out.push({ name: m[1], kind: 'branch', h });
    else if ((m = ref.match(/^refs\/remotes\/(.+)$/))) out.push({ name: m[1], kind: 'remote', h });
    else if ((m = ref.match(/^refs\/tags\/(.+)$/))) out.push({ name: m[1], kind: 'tag', h });
  }
  return out;
}

// git for-each-ref refs/heads --format=%(refname:short)%00%(upstream:short)%00%(upstream:track,nobracket)
function parseTrack(text) {
  const out = {};
  for (const line of String(text).split('\n')) {
    if (!line) continue;
    const [name, upstream, track] = line.split('\0');
    if (!upstream) continue;
    const t = { upstream };
    if (/gone/.test(track || '')) t.gone = true;
    const a = /ahead (\d+)/.exec(track || '');
    const b = /behind (\d+)/.exec(track || '');
    if (a) t.ahead = Number(a[1]);
    if (b) t.behind = Number(b[1]);
    out[name] = t;
  }
  return out;
}

// git diff-tree -r -M -z --raw --numstat: raw entries (":old new sha sha R066", then one path, or
// two for a rename or copy), then numstat ("add\tdel\tpath", or "add\tdel\t" and two paths).
function parseDiffTree(buf) {
  const t = buf.toString('utf8').split('\0');
  const files = [];
  const stats = [];
  let i = 0;
  while (i < t.length) {
    const tok = t[i];
    if (!tok) {
      i++;
      continue;
    }
    if (tok[0] === ':') {
      const f = tok.slice(1).split(' ');
      const st = (f[4] || '?')[0];
      const two = st === 'R' || st === 'C';
      const file = { st, path: two ? t[i + 2] : t[i + 1] };
      if (two) file.from = t[i + 1];
      if (f[1] === '160000' || f[0] === '160000') file.sub = true;
      files.push(file);
      i += two ? 3 : 2;
      continue;
    }
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(tok);
    if (!m) {
      i++;
      continue;
    }
    const s = m[1] === '-' ? { bin: true } : { add: Number(m[1]), del: Number(m[2]) };
    if (m[3] === '') i += 3;
    else i += 1;
    stats.push(s);
  }
  files.forEach((f, k) => Object.assign(f, stats[k] || {}));
  return files;
}

// git status --porcelain=v2 -z -> { staged, unstaged, untracked, conflicted, files: [{ x, y, path, from? }] }
function parseStatus(buf, max = STATUS_MAX) {
  const t = buf.toString('utf8').split('\0');
  const r = { staged: 0, unstaged: 0, untracked: 0, conflicted: 0, files: [], cut: false };
  const add = (f) => (r.files.length < max ? r.files.push(f) : (r.cut = true));
  for (let i = 0; i < t.length; i++) {
    const tok = t[i];
    if (!tok) continue;
    const kind = tok[0];
    if (kind === '?') {
      r.untracked++;
      add({ x: '?', y: '?', path: tok.slice(2), untracked: true });
    } else if (kind === '1' || kind === '2') {
      const f = tok.split(' ');
      const xy = f[1] || '..';
      const p = f.slice(kind === '1' ? 8 : 9).join(' ');
      const file = { x: xy[0], y: xy[1], path: p };
      if (kind === '2') file.from = t[++i];
      if (xy[0] !== '.') r.staged++;
      if (xy[1] !== '.') r.unstaged++;
      add(file);
    } else if (kind === 'u') {
      const f = tok.split(' ');
      r.conflicted++;
      add({ x: 'U', y: 'U', path: f.slice(10).join(' '), conflict: true });
    }
  }
  return r;
}

// Commits in parent-after-child order when git could not sort them in time (log without
// --topo-order): Kahn's walk from the commits no one in the window points at, newest first.
function topoSort(commits) {
  const by = new Map(commits.map((c) => [c.h, c]));
  const kids = new Map(commits.map((c) => [c.h, 0]));
  for (const c of commits) for (const p of c.p) if (kids.has(p)) kids.set(p, kids.get(p) + 1);
  const ready = commits.filter((c) => kids.get(c.h) === 0);
  const out = [];
  while (ready.length) {
    ready.sort((a, b) => b.t - a.t);
    const c = ready.shift();
    out.push(c);
    for (const p of c.p) {
      if (!by.has(p)) continue;
      kids.set(p, kids.get(p) - 1);
      if (kids.get(p) === 0) ready.push(by.get(p));
    }
  }
  return out;
}

// A path the page asks a diff of: a string git can take after "--" (literal pathspecs).
const okPath = (p) => typeof p === 'string' && p.length > 0 && p.length <= 4096 && !/[\x00-\x1f\x7f]/.test(p) && !path.posix.isAbsolute(p) && !path.win32.isAbsolute(p);
// Cut at the last whole line within bytes (no half a UTF-8 character).
function cutText(buf, cut) {
  if (!cut) return buf.toString('utf8');
  const nl = buf.lastIndexOf(0x0a);
  return buf.subarray(0, nl > 0 ? nl + 1 : buf.length).toString('utf8');
}

// ---- per hub ----

function createRepos(hub, git) {
  const found = new Map(); // norm(cwd) -> { at, repo: { top, common, shallow } | null, skipUntil? }
  const repos = new Map(); // id -> { id, common, top, shallow, at, worktrees }
  const sigs = new Map(); // id -> { at, sig, refs, worktrees }
  const graphs = new Map(); // `${id}|${remotes}` -> { sig, commits, limited, truncated }
  const statuses = new Map(); // `${id}|${wt}` -> { at, value }

  const now = () => (hub.now ? hub.now() : Date.now());
  const run = (dir, args, opts) => git.run(dir, args, opts);

  // One cwd's repository, or null (not one, or git said no). Cached; a stuck cwd is skipped.
  async function findCwd(cwd, b) {
    const k = norm(cwd);
    const was = found.get(k);
    const t = now();
    if (was && (was.skipUntil ? t < was.skipUntil : t - was.at < FIND_TTL)) return was.repo;
    let repo = null;
    try {
      const r = await run(cwd, ['rev-parse', '--show-toplevel', '--git-common-dir', '--is-shallow-repository'], { ms: Math.max(200, Math.min(3000, b.left())) });
      const [top, common, shallow] = r.out.toString('utf8').split('\n');
      if (top && common) {
        let c = path.resolve(cwd, common);
        // The same repository read from a linked worktree names its common dir by its real path.
        c = await fsq.run(b, c, () => require('fs').promises.realpath(c), { ms: 1000 }).catch(() => c);
        repo = { top, common: c, shallow: shallow === 'true' };
      }
      found.set(k, { at: t, repo });
    } catch (err) {
      if (err.code === 'no_git') throw err;
      if (err.code === 'git_timeout' || err.code === 'git_stuck' || err.code === 'git_jammed' || err.code === 'git_busy') {
        b.partial = true;
        found.set(k, { at: t, repo: null, skipUntil: t + (err.code === 'git_busy' ? 5e3 : FIND_SKIP) });
      } else found.set(k, { at: t, repo: null, reason: err.code });
    }
    return repo;
  }

  // The panes herdr lists now, with their cwd.
  function panes() {
    const l = hub.local || {};
    return [...(l.agents || []), ...(l.terminals || [])].filter((x) => x.cwd).map((x) => ({ pane: x.pane, cwd: x.cwd }));
  }

  // All repositories of this host's panes: [{ id, name, root, worktrees: [{ id, path, branch, head, detached, prunable, panes }], shallow, fetchedAt }]
  async function list(b = fsq.budget(6000)) {
    const ps = panes();
    const cwds = [...new Map(ps.map((p) => [norm(p.cwd), p.cwd])).values()];
    const byCwd = new Map();
    for (const cwd of cwds) {
      if (b.left() <= 0) {
        b.partial = true;
        break;
      }
      byCwd.set(norm(cwd), await findCwd(cwd, b));
    }
    const groups = new Map(); // id -> { common, tops: Set, shallow }
    for (const r of byCwd.values()) {
      if (!r) continue;
      const id = hash(norm(r.common));
      const g = groups.get(id) || { common: r.common, any: r.top, shallow: r.shallow };
      groups.set(id, g);
    }
    const out = [];
    for (const [id, g] of groups) {
      const repo = await load(id, g, b).catch(() => null);
      if (!repo) continue;
      out.push(view(repo, ps, byCwd));
    }
    out.sort((a, b2) => a.name.localeCompare(b2.name));
    return out;
  }

  // A repository's worktrees (cached with its sig).
  async function load(id, g, b) {
    let repo = repos.get(id);
    if (!repo || now() - repo.at > FIND_TTL) {
      const r = await run(g.any, ['worktree', 'list', '--porcelain'], { ms: Math.max(200, Math.min(3000, b.left())) });
      const wts = parseWorktrees(r.out.toString('utf8')).filter((w) => !w.bare);
      const fetch = await fsq.stat(b, path.join(g.common, 'FETCH_HEAD'), { ms: 1000 }).catch(() => null);
      const main = wts[0] ? wts[0].path : path.dirname(g.common);
      repo = {
        id,
        common: g.common,
        any: g.any,
        shallow: g.shallow,
        at: now(),
        name: path.basename(main) || main,
        root: main,
        fetchedAt: fetch ? Math.round(fetch.mtimeMs) : null,
        worktrees: wts.map((w) => ({ id: hash(norm(w.path), 8), path: w.path, branch: w.branch || null, head: w.head && !EMPTY.test(w.head) ? w.head : null, detached: Boolean(w.detached), prunable: Boolean(w.prunable) })),
      };
      repos.set(id, repo);
    }
    return repo;
  }

  // The repository with its worktrees' panes now.
  function view(repo, ps, byCwd) {
    const panesOf = new Map(repo.worktrees.map((w) => [norm(w.path), []]));
    for (const p of ps) {
      const r = byCwd.get(norm(p.cwd));
      if (!r || hash(norm(r.common)) !== repo.id) continue;
      const k = norm(r.top);
      if (panesOf.has(k)) panesOf.get(k).push(p.pane);
    }
    return {
      id: repo.id,
      name: repo.name,
      root: repo.root,
      shallow: repo.shallow,
      fetchedAt: repo.fetchedAt,
      worktrees: repo.worktrees.map((w) => ({ ...w, panes: panesOf.get(norm(w.path)) || [] })),
    };
  }

  // The repository an id names, found from the panes now; null when none does.
  async function get(id, b = fsq.budget(6000)) {
    if (typeof id !== 'string' || !/^[0-9a-f]{12}$/.test(id)) return null;
    const known = repos.get(id);
    // Known and some pane still in it: no new search.
    if (known && now() - known.at < FIND_TTL) {
      const ps = panes();
      for (const p of ps) {
        const f = found.get(norm(p.cwd));
        if (f && f.repo && hash(norm(f.repo.common)) === id) return known;
      }
    }
    const all = await list(b);
    return all.some((r) => r.id === id) ? repos.get(id) : null;
  }

  async function viewOf(repo) {
    const ps = panes();
    const byCwd = new Map(ps.map((p) => [norm(p.cwd), (found.get(norm(p.cwd)) || {}).repo || null]));
    return view(repo, ps, byCwd);
  }

  // refs and worktree heads, and a signature of them: the graph is read again when it changes.
  async function sigOf(repo, { fresh = false } = {}) {
    const was = sigs.get(repo.id);
    if (!fresh && was && now() - was.at < SIG_TTL) return was;
    const r = await run(repo.any, ['for-each-ref', '--format=%(refname)%00%(objectname)%00%(*objectname)%00%(objecttype)%00%(*objecttype)%00%(symref)', 'refs/heads', 'refs/remotes', 'refs/tags'], { ms: 4000 });
    const refs = parseRefs(r.out.toString('utf8'));
    // Worktree heads move with a commit in any of them (and detached ones are in no ref).
    repos.delete(repo.id);
    const fresh2 = await load(repo.id, { common: repo.common, any: repo.any, shallow: repo.shallow }, fsq.budget(4000));
    const heads = fresh2.worktrees.map((w) => `${w.id}:${w.head || ''}:${w.branch || ''}`);
    const sig = hash(JSON.stringify([refs.map((x) => `${x.kind}:${x.name}:${x.h}`), heads]), 16);
    const s = { at: now(), sig, refs, worktrees: fresh2.worktrees };
    sigs.set(repo.id, s);
    return s;
  }

  // The commit graph: the first GRAPH_MAX commits of the local branches (and remote ones), the
  // worktrees' heads, in topological order; kept per sig and handed out a page at a time.
  async function graph(repo, { remotes = true, after = 0 } = {}) {
    const s = await sigOf(repo);
    const key = `${repo.id}|${remotes ? 1 : 0}`;
    let g = graphs.get(key);
    if (!g || g.sig !== s.sig) {
      const heads = [...new Set(s.worktrees.map((w) => w.head).filter(Boolean))];
      const revs = ['--branches', ...(remotes ? ['--remotes'] : []), ...heads];
      const fmt = '--format=%H%x00%P%x00%ct%x00%an%x00%s';
      let commits;
      let limited = false;
      try {
        const r = await run(repo.any, ['log', '--topo-order', '-z', '-n', String(GRAPH_MAX), fmt, ...revs, '--'], { ms: GRAPH_MS, bytes: 16 << 20 });
        commits = parseLog(r.out);
      } catch (err) {
        if (err.code !== 'git_timeout') throw err;
        // Too big to sort in time (no commit-graph file): the newest few, sorted here.
        const r = await run(repo.any, ['log', '-z', '-n', String(FALLBACK_N), fmt, ...revs, '--'], { ms: 4000, bytes: 8 << 20 });
        commits = topoSort(parseLog(r.out));
        limited = true;
      }
      g = { sig: s.sig, commits, limited, truncated: commits.length >= GRAPH_MAX };
      graphs.delete(key);
      graphs.set(key, g);
      while (graphs.size > GRAPHS_KEPT) graphs.delete(graphs.keys().next().value);
    }
    const from = Math.max(0, Math.min(Number(after) || 0, g.commits.length));
    const page = g.commits.slice(from, from + GRAPH_PAGE);
    const inPage = new Set(page.map((c) => c.h));
    const refs = s.refs.filter((x) => (remotes || x.kind !== 'remote') && (x.kind !== 'tag' || inPage.has(x.h) || from > 0));
    return {
      sig: s.sig,
      after: from,
      commits: page,
      refs: from === 0 ? refs : refs.filter((x) => inPage.has(x.h)),
      worktrees: s.worktrees,
      total: g.commits.length,
      more: from + page.length < g.commits.length,
      truncated: g.truncated && from + page.length >= g.commits.length,
      limited: g.limited,
      shallow: repo.shallow,
    };
  }

  async function branches(repo) {
    const r = await run(repo.any, ['for-each-ref', '--format=%(refname:short)%00%(upstream:short)%00%(upstream:track,nobracket)', 'refs/heads'], { ms: 4000 });
    return parseTrack(r.out.toString('utf8'));
  }

  // A full sha for what the page names, or null (not a commit in this repository).
  async function commitSha(repo, sha) {
    if (typeof sha !== 'string' || !SHA.test(sha)) return null;
    try {
      const r = await run(repo.any, ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`], { ms: 3000 });
      const h = r.out.toString('utf8').trim();
      return SHA.test(h) ? h : null;
    } catch (err) {
      if (err.status === 1 || err.code === 'no_commit' || err.code === 'git_failed') return null;
      throw err;
    }
  }

  async function commit(repo, h) {
    const r = await run(repo.any, ['show', '-s', '-z', '--format=%H%x00%P%x00%an%x00%at%x00%ct%x00%B', h], { ms: 4000, bytes: MSG_BYTES });
    const [hh, p, a, at, ct, ...msg] = r.out.toString('utf8').split('\0');
    const parents = p ? p.split(' ') : [];
    const base = parents.length ? [parents[0]] : ['--root'];
    const d = await run(repo.any, ['diff-tree', '-r', '--no-commit-id', '-M', '-z', '--raw', '--numstat', '--no-ext-diff', '--no-textconv', ...base, h], { ms: 4000, bytes: 4 << 20 });
    const files = parseDiffTree(d.out);
    return {
      h: hh,
      p: parents,
      a,
      at: Number(at) || 0,
      t: Number(ct) || 0,
      msg: msg.join('').replace(/\s+$/, ''), // -z ends the record with a NUL; a message holds none
      msgCut: r.cut,
      files: files.slice(0, FILES_MAX),
      cut: d.cut || files.length > FILES_MAX,
    };
  }

  // One file's change in a commit (from: its old path when renamed), against the first parent.
  async function commitDiff(repo, h, file, from) {
    const r0 = await run(repo.any, ['show', '-s', '--format=%P', h], { ms: 3000 });
    const parent = r0.out.toString('utf8').trim().split(' ')[0];
    const paths = from && from !== file ? [from, file] : [file];
    const args = parent
      ? ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '-M', parent, h, '--', ...paths]
      : ['show', '--format=', '--no-ext-diff', '--no-textconv', '--no-color', h, '--', ...paths];
    const r = await run(repo.any, args, { ms: 5000, bytes: DIFF_BYTES });
    return { text: cutText(r.out, r.cut), cut: r.cut };
  }

  const worktree = (repo, wt) => repo.worktrees.find((w) => w.id === wt && !w.prunable) || null;

  async function status(repo, w) {
    const key = `${repo.id}|${w.id}`;
    const was = statuses.get(key);
    if (was && now() - was.at < STATUS_TTL) return was.value;
    const r = await run(w.path, ['status', '--porcelain=v2', '-z', '--untracked-files=normal'], { ms: 4000, bytes: 4 << 20 });
    const value = parseStatus(r.out);
    statuses.set(key, { at: now(), value });
    return value;
  }

  // A tracked file's change in a worktree, staged and not, against its HEAD.
  async function worktreeDiff(repo, w, file) {
    const args = w.head ? ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '-M', 'HEAD', '--', file] : ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--cached', '--', file];
    const r = await run(w.path, args, { ms: 5000, bytes: DIFF_BYTES });
    return { text: cutText(r.out, r.cut), cut: r.cut };
  }

  // What changes while the graph is open: the sig, and which panes are in which worktree.
  async function live(repo) {
    const s = await sigOf(repo);
    const v = await viewOf({ ...repo, worktrees: s.worktrees });
    const panesBy = {};
    for (const w of v.worktrees) if (w.panes.length) panesBy[w.id] = w.panes;
    return { sig: s.sig, panes: panesBy };
  }

  return { list, get, viewOf, graph, branches, commitSha, commit, commitDiff, worktree, status, worktreeDiff, live };
}

module.exports = { createRepos, parseLog, parseWorktrees, parseRefs, parseTrack, parseDiffTree, parseStatus, topoSort, okPath, cutText, GRAPH_MAX, GRAPH_PAGE };
