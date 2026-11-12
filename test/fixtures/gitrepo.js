'use strict';
// A small git repository for the 저장소 그래프 tests (test/repos.test.js, test/ui.test.js): main
// (init -> rename -> merge of feat), feat (one commit), a tag, and a linked worktree on "side" with
// an uncommitted change and an untracked file. Example names only (Alex, you@example.com).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const hasGit = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const ENV = { GIT_AUTHOR_NAME: 'Alex', GIT_AUTHOR_EMAIL: 'you@example.com', GIT_COMMITTER_NAME: 'Alex', GIT_COMMITTER_EMAIL: 'you@example.com', GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' };
function sh(dir, ...args) {
  return execFileSync('git', ['-C', dir, ...args], { env: { ...process.env, ...ENV }, encoding: 'utf8' }).trim();
}
let clock = 1700000000;
function commit(dir, msg) {
  clock += 60;
  execFileSync('git', ['-C', dir, 'commit', '-q', '-m', msg], { env: { ...process.env, ...ENV, GIT_AUTHOR_DATE: `${clock} +0000`, GIT_COMMITTER_DATE: `${clock} +0000` } });
  return sh(dir, 'rev-parse', 'HEAD');
}

// main: init -> rename -> merge(feat); feat: one commit; a linked worktree on "side" with a change.
function makeRepo(t, { more = 0 } = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'repos-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const dir = path.join(base, 'proj');
  fs.mkdirSync(dir);
  sh(dir, 'init', '-q');
  sh(dir, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\n');
  fs.writeFileSync(path.join(dir, ':(glob)*.txt'), 'odd\n');
  sh(dir, 'add', '.');
  const init = commit(dir, 'init');
  sh(dir, 'checkout', '-q', '-b', 'feat');
  fs.writeFileSync(path.join(dir, 'f.txt'), 'feat\n');
  sh(dir, 'add', '.');
  const feat = commit(dir, 'feat work');
  sh(dir, 'checkout', '-q', 'main');
  sh(dir, 'mv', 'a.txt', 'b.txt');
  fs.appendFileSync(path.join(dir, 'b.txt'), 'three\n');
  sh(dir, 'add', '.');
  const ren = commit(dir, 'rename');
  sh(dir, 'merge', '-q', '--no-ff', '-m', 'Merge feat', 'feat');
  const merge = sh(dir, 'rev-parse', 'HEAD');
  sh(dir, 'tag', '-a', 'v1', '-m', 'v1', init);
  const wt = path.join(base, 'proj-side');
  sh(dir, 'worktree', 'add', '-q', '-b', 'side', wt, ren);
  fs.appendFileSync(path.join(wt, 'b.txt'), 'side change\n');
  fs.writeFileSync(path.join(wt, 'new.txt'), 'secret new file\n');
  fs.mkdirSync(path.join(dir, 'lib'));
  // More straight commits on main (a run to fold).
  for (let i = 1; i <= more; i++) {
    fs.writeFileSync(path.join(dir, `n${i}.txt`), `${i}\n`);
    sh(dir, 'add', '.');
    commit(dir, `step ${i}`);
  }
  return { base, dir, wt, init, feat, ren, merge };
}


module.exports = { hasGit, makeRepo, sh, commit };
