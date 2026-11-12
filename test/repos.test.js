'use strict';
// 저장소 그래프 (lib/repos.js, lib/routes/repos.js): the parsers on fixed git output, and the routes
// on real repositories (branches, a merge, a rename, two worktrees, an uncommitted change) under a
// hub whose agents work in them. Anything refused is refused before git is asked.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const R = require('../lib/repos');
const { hubInProcess, until } = require('./fixtures/hub');
const { hasGit, makeRepo, sh, commit } = require('./fixtures/gitrepo');


test('parseLog: five fields a commit, NUL apart; a subject may hold any character but NUL', () => {
  const a = 'a'.repeat(40);
  const b = 'b'.repeat(40);
  const c = 'c'.repeat(40);
  const buf = Buffer.from([a, `${b} ${c}`, '1700000000', 'Alex', 'Merge \x1f\x1e "x" <y>', b, '', '1690000000', 'Alex', 'first', ''].join('\0'));
  assert.deepEqual(R.parseLog(buf), [
    { h: a, p: [b, c], t: 1700000000, a: 'Alex', s: 'Merge \x1f\x1e "x" <y>' },
    { h: b, p: [], t: 1690000000, a: 'Alex', s: 'first' },
  ]);
  assert.deepEqual(R.parseLog(Buffer.from('')), []);
});

test('parseWorktrees: branch, detached, bare, prunable', () => {
  const text = 'worktree /Users/alex/proj\nHEAD 1111111111111111111111111111111111111111\nbranch refs/heads/main\n\nworktree /Users/alex/proj-wt\nHEAD 2222222222222222222222222222222222222222\ndetached\n\nworktree /gone\nHEAD 3333333333333333333333333333333333333333\nbranch refs/heads/old\nprunable gitdir file points to non-existent location\n';
  const w = R.parseWorktrees(text);
  assert.equal(w.length, 3);
  assert.deepEqual(w[0], { path: '/Users/alex/proj', head: '1'.repeat(40), branch: 'main' });
  assert.equal(w[1].detached, true);
  assert.equal(w[2].prunable, true);
});

test('parseRefs: an annotated tag is its commit, a tag of a tree and a remote HEAD are left out', () => {
  const c = 'c'.repeat(40);
  const t = 'd'.repeat(40);
  const lines = [
    ['refs/heads/main', c, '', 'commit', '', ''],
    ['refs/remotes/origin/HEAD', c, '', 'commit', '', 'refs/remotes/origin/main'],
    ['refs/remotes/origin/main', c, '', 'commit', '', ''],
    ['refs/tags/v1', t, c, 'tag', 'commit', ''],
    ['refs/tags/tree', t, 'e'.repeat(40), 'tag', 'tree', ''],
  ].map((l) => l.join('\0'));
  assert.deepEqual(R.parseRefs(lines.join('\n')), [
    { name: 'main', kind: 'branch', h: c },
    { name: 'origin/main', kind: 'remote', h: c },
    { name: 'v1', kind: 'tag', h: c },
  ]);
});

test('parseTrack: ahead, behind, gone', () => {
  const t = R.parseTrack(['main\0origin/main\0ahead 2, behind 1', 'old\0origin/old\0gone', 'solo\0\0'].join('\n'));
  assert.deepEqual(t, { main: { upstream: 'origin/main', ahead: 2, behind: 1 }, old: { upstream: 'origin/old', gone: true } });
});

test('parseDiffTree: a rename, a binary file, a submodule, names with spaces', () => {
  const z = '0'.repeat(40);
  const s = '1'.repeat(40);
  const raw = [
    `:100644 100644 ${s} ${s} R066`, 'a.txt', 'b.txt',
    `:000000 100644 ${z} ${s} A`, 'bin.dat',
    `:000000 160000 ${z} ${s} A`, 'sub mod',
    '1\t0\t', 'a.txt', 'b.txt',
    '-\t-\tbin.dat',
    '1\t0\tsub mod',
    '',
  ].join('\0');
  assert.deepEqual(R.parseDiffTree(Buffer.from(raw)), [
    { st: 'R', path: 'b.txt', from: 'a.txt', add: 1, del: 0 },
    { st: 'A', path: 'bin.dat', bin: true },
    { st: 'A', path: 'sub mod', sub: true, add: 1, del: 0 },
  ]);
});

test('parseStatus: staged, unstaged, untracked, renamed, conflicted', () => {
  const h = '1'.repeat(40);
  const buf = Buffer.from(
    [`1 .M N... 100644 100644 100644 ${h} ${h} b c.txt`, `2 R. N... 100644 100644 100644 ${h} ${h} R100 new.txt`, 'old.txt', `u UU N... 100644 100644 100644 100644 ${h} ${h} ${h} x.txt`, '? n e w.txt', ''].join('\0')
  );
  const s = R.parseStatus(buf);
  assert.equal(s.staged, 1);
  assert.equal(s.unstaged, 1);
  assert.equal(s.untracked, 1);
  assert.equal(s.conflicted, 1);
  assert.deepEqual(s.files.map((f) => f.path), ['b c.txt', 'new.txt', 'x.txt', 'n e w.txt']);
  assert.equal(s.files[1].from, 'old.txt');
});

test('topoSort: children before parents, newest first among the free', () => {
  const c = (h, p, t) => ({ h, p, t });
  const out = R.topoSort([c('a', [], 1), c('m', ['b', 'x'], 5), c('b', ['a'], 4), c('x', ['a'], 6)]);
  assert.deepEqual(out.map((x) => x.h), ['m', 'x', 'b', 'a']);
});

test('okPath and cutText', () => {
  assert.equal(R.okPath('lib/a b.js'), true);
  assert.equal(R.okPath(':(glob)*'), true); // literal pathspecs: just a name
  for (const bad of ['', '/etc/passwd', 'C:\\x', 'a\nb', 'a\0b', 5, null, 'x'.repeat(5000)]) assert.equal(R.okPath(bad), false, String(bad));
  assert.equal(R.cutText(Buffer.from('one\ntwo\nthr'), true), 'one\ntwo\n');
  assert.equal(R.cutText(Buffer.from('한글\n두'), false), '한글\n두');
});

// ---- on real repositories (test/fixtures/gitrepo.js) ----

const agent = (pane, cwd) => ({ pane_id: pane, workspace_id: 'w1', agent: 'claude', agent_status: 'idle', state_change_seq: 1, terminal_title: 'claude', cwd });

test('routes: the repositories of the panes, the graph, a commit, a diff, a worktree', { skip: !hasGit }, async (t) => {
  const r = makeRepo(t);
  const other = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'notrepo-')));
  t.after(() => fs.rmSync(other, { recursive: true, force: true }));
  const hub = await hubInProcess(t, { id: 'repos', agents: [agent('w1-p2', path.join(r.dir, 'lib')), agent('w1-p3', r.wt), agent('w1-p4', other)] });

  const list = (await hub.request('GET', '/api/repos')).body;
  assert.equal(list.supported, true);
  assert.equal(list.repos.length, 1, JSON.stringify(list));
  const repo = list.repos[0];
  assert.equal(repo.name, 'proj');
  assert.match(repo.id, /^[0-9a-f]{12}$/);
  const [main, side] = repo.worktrees;
  assert.equal(main.branch, 'main');
  assert.deepEqual(main.panes, ['w1-p2']); // from a subfolder
  assert.equal(side.branch, 'side');
  assert.deepEqual(side.panes, ['w1-p3']);

  const g = (await hub.request('GET', `/api/repos/${repo.id}/graph`)).body;
  assert.deepEqual(g.commits.map((c) => c.s), ['Merge feat', 'feat work', 'rename', 'init']);
  assert.deepEqual(g.commits[0].p, [r.ren, r.feat]);
  assert.ok(g.refs.some((x) => x.kind === 'branch' && x.name === 'side' && x.h === r.ren));
  assert.ok(g.refs.some((x) => x.kind === 'tag' && x.name === 'v1' && x.h === r.init));
  assert.equal(g.more, false);
  assert.match(g.sig, /^[0-9a-f]{16}$/);
  // Nothing about a person but the name.
  assert.ok(!JSON.stringify(g).includes('example.com'));

  const live = (await hub.request('GET', `/api/repos/${repo.id}/live`)).body;
  assert.equal(live.sig, g.sig);
  assert.deepEqual(live.panes, { [main.id]: ['w1-p2'], [side.id]: ['w1-p3'] });

  // A merge's files are against its first parent; a rename knows its old name.
  const m = (await hub.request('GET', `/api/repos/${repo.id}/commits/${r.merge.slice(0, 10)}`)).body;
  assert.equal(m.h, r.merge);
  assert.deepEqual(m.files.map((f) => [f.st, f.path]), [['A', 'f.txt']]);
  const ren = (await hub.request('GET', `/api/repos/${repo.id}/commits/${r.ren}`)).body;
  assert.deepEqual(ren.files.map((f) => [f.st, f.from, f.path, f.add, f.del]), [['R', 'a.txt', 'b.txt', 1, 0]]);
  const root = (await hub.request('GET', `/api/repos/${repo.id}/commits/${r.init}`)).body;
  assert.equal(root.files.length, 2);

  const d = (await hub.request('GET', `/api/repos/${repo.id}/diff?c=${r.ren}&path=b.txt&from=a.txt`)).body;
  assert.match(d.text, /rename from a\.txt/);
  assert.match(d.text, /\+three/);
  // A name that would be a pathspec glob is just that file.
  const odd = (await hub.request('GET', `/api/repos/${repo.id}/diff?c=${r.init}&path=${encodeURIComponent(':(glob)*.txt')}`)).body;
  assert.match(odd.text, /\+odd/);
  assert.doesNotMatch(odd.text, /a\.txt/);

  const st = (await hub.request('GET', `/api/repos/${repo.id}/status?wt=${side.id}`)).body;
  assert.equal(st.unstaged, 1);
  assert.equal(st.untracked, 1);
  const wd = (await hub.request('GET', `/api/repos/${repo.id}/diff?wt=${side.id}&path=b.txt`)).body;
  assert.match(wd.text, /\+side change/);
  // An untracked file's content is never read.
  const nd = (await hub.request('GET', `/api/repos/${repo.id}/diff?wt=${side.id}&path=new.txt`)).body;
  assert.doesNotMatch(nd.text || '', /secret/);

  // Refused: unknown repository, commit, worktree, path.
  for (const [p, status, error] of [
    ['/api/repos/0123456789ab/graph', 404, 'repo_not_found'],
    ['/api/repos/..%2F..%2Fetc/graph', 404, 'repo_not_found'],
    [`/api/repos/${repo.id}/commits/HEAD`, 404, 'commit_not_found'],
    [`/api/repos/${repo.id}/commits/--output=x`, 404, 'commit_not_found'],
    [`/api/repos/${repo.id}/commits/${'f'.repeat(40)}`, 404, 'commit_not_found'],
    [`/api/repos/${repo.id}/diff?c=${r.ren}&path=%2Fetc%2Fpasswd`, 400, 'bad_path'],
    [`/api/repos/${repo.id}/diff?c=${r.ren}`, 400, 'bad_path'],
    [`/api/repos/${repo.id}/diff?wt=nope&path=b.txt`, 404, 'worktree_not_found'],
    [`/api/repos/${repo.id}/status?wt=${encodeURIComponent(r.wt)}`, 404, 'worktree_not_found'],
  ]) {
    const x = await hub.request('GET', p);
    assert.equal(x.status, status, p);
    assert.equal(x.body.error, error, p);
  }

  // A new commit changes the sig.
  fs.writeFileSync(path.join(r.dir, 'c.txt'), 'c\n');
  sh(r.dir, 'add', 'c.txt');
  commit(r.dir, 'more');
  await new Promise((res) => setTimeout(res, 3100));
  const live2 = (await hub.request('GET', `/api/repos/${repo.id}/live`)).body;
  assert.notEqual(live2.sig, g.sig);
  const g2 = (await hub.request('GET', `/api/repos/${repo.id}/graph`)).body;
  assert.equal(g2.commits[0].s, 'more');
});

test('routes: a repository no pane works in any more is not known', { skip: !hasGit }, async (t) => {
  const r = makeRepo(t);
  const hub = await hubInProcess(t, { id: 'repos-gone', agents: [agent('w1-p2', r.dir)] });
  const id = (await hub.request('GET', '/api/repos')).body.repos[0].id;
  assert.equal((await hub.request('GET', `/api/repos/${id}/graph`)).status, 200);
  hub.herdr.agents.length = 0;
  hub.herdr.event();
  await until(async () => (await hub.request('GET', '/api/state')).body.agents.length === 0, 'agent gone');
  // The id was known a moment ago, but no pane is there now.
  assert.equal((await hub.request('GET', `/api/repos/${id}/graph`)).status, 404);
});

test('routes: a diff driver or textconv in the repository config never runs', { skip: !hasGit || process.platform === 'win32' }, async (t) => {
  const r = makeRepo(t);
  const mark = path.join(r.base, 'ran');
  const prog = path.join(r.base, 'prog.sh');
  fs.writeFileSync(prog, `#!/bin/sh\ntouch '${mark}'\n`, { mode: 0o755 });
  sh(r.dir, 'config', 'diff.external', prog);
  sh(r.dir, 'config', 'diff.x.textconv', prog);
  sh(r.dir, 'config', 'diff.x.command', prog);
  fs.writeFileSync(path.join(r.dir, '.git', 'info', 'attributes'), '* diff=x\n');
  const hub = await hubInProcess(t, { id: 'repos-ext', agents: [agent('w1-p2', r.dir), agent('w1-p3', r.wt)] });
  const repo = (await hub.request('GET', '/api/repos')).body.repos[0];
  await hub.request('GET', `/api/repos/${repo.id}/commits/${r.ren}`);
  const d = await hub.request('GET', `/api/repos/${repo.id}/diff?c=${r.ren}&path=b.txt&from=a.txt`);
  assert.equal(d.status, 200);
  await hub.request('GET', `/api/repos/${repo.id}/diff?wt=${repo.worktrees[1].id}&path=b.txt`);
  assert.equal(fs.existsSync(mark), false);
});

test('routes: git missing is said, not a crash', async (t) => {
  const hub = await hubInProcess(t, { id: 'repos-nogit', agents: [agent('w1-p2', os.tmpdir())], env: { HERDR_HUB_GIT: path.join(os.tmpdir(), 'no-git-here') } });
  const x = await hub.request('GET', '/api/repos');
  assert.equal(x.status, 503);
  assert.equal(x.body.error, 'no_git');
});

test('through the hub: a peer answers for its own repositories', { skip: !hasGit }, async (t) => {
  const { startHub } = require('./fixtures/hub');
  const r = makeRepo(t);
  const peer = await startHub(t, { id: 'rpa', agents: [agent('w1-p2', r.dir)] });
  const hub = await startHub(t, { id: 'rhub', env: { HERDR_HUB_PEERS: `rpa=http://127.0.0.1:${peer.port}` } });
  await until(async () => (await hub.request('GET', '/api/state')).body.hosts.some((h) => h.id === 'rpa' && h.online), 'peer online');
  // The hub's own panes are in no repository; the peer's are.
  assert.deepEqual((await hub.request('GET', '/api/repos')).body.repos, []);
  const list = (await hub.request('GET', '/api/peers/rpa/repos')).body;
  assert.equal(list.repos.length, 1);
  const g = await hub.request('GET', `/api/peers/rpa/repos/${list.repos[0].id}/graph?remotes=0`);
  assert.equal(g.status, 200);
  assert.equal(g.body.commits[0].s, 'Merge feat');
  const d = await hub.request('GET', `/api/peers/rpa/repos/${list.repos[0].id}/diff?c=${r.ren}&path=b.txt&from=a.txt`);
  assert.match(d.body.text, /\+three/);
});
