'use strict';
// lib/git.js: the one place git starts — limits, a stuck folder, git missing, the env it gets.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { execFileSync } = require('child_process');
const { createGit, cleanEnv, reason } = require('../lib/git');

const hasGit = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const quiet = () => {};

function tmpRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-run-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', dir]);
  return dir;
}

test('cleanEnv drops the GIT_* the hub has and sets its own', () => {
  const env = cleanEnv({ PATH: '/bin', GIT_DIR: '/elsewhere/.git', git_work_tree: '/x', HOME: '/Users/alex' });
  assert.equal(env.PATH, '/bin');
  assert.equal(env.HOME, '/Users/alex');
  assert.equal(env.GIT_DIR, undefined);
  assert.equal(env.git_work_tree, undefined);
  assert.equal(env.GIT_NO_LAZY_FETCH, '1');
  assert.equal(env.GIT_OPTIONAL_LOCKS, '0');
  assert.equal(env.LC_ALL, 'C');
});

test('reason: what git said, as a code', () => {
  assert.equal(reason("fatal: detected dubious ownership in repository at '/x'"), 'unsafe_repo');
  assert.equal(reason('fatal: not a git repository (or any of the parent directories): .git'), 'not_repo');
  assert.equal(reason("fatal: your current branch 'main' does not have any commits yet"), 'no_commit');
  assert.equal(reason('something else'), 'git_failed');
});

test('runs in the folder it is given, even with GIT_DIR set in the hub', { skip: !hasGit }, async (t) => {
  const a = tmpRepo(t);
  const b = tmpRepo(t);
  const git = createGit({ env: { ...process.env, GIT_DIR: path.join(b, '.git') }, log: quiet });
  const r = await git.run(a, ['rev-parse', '--show-toplevel']);
  assert.equal(fs.realpathSync(r.out.toString().trim()), fs.realpathSync(a));
  // A failure is a code, not git's words.
  await assert.rejects(git.run(os.tmpdir(), ['rev-parse', '--show-toplevel']), (e) => e.code === 'not_repo' || e.code === 'git_failed');
});

test('output past the byte limit is cut, not an error', { skip: !hasGit }, async (t) => {
  const dir = tmpRepo(t);
  fs.writeFileSync(path.join(dir, 'big.txt'), 'x'.repeat(100000));
  const git = createGit({ log: quiet });
  const r2 = await git.run(dir, ['cat-file', '-p', execFileSync('git', ['-C', dir, 'hash-object', '-w', 'big.txt']).toString().trim()], { bytes: 1000 });
  assert.equal(r2.cut, true);
  assert.equal(r2.out.length, 1000);
});

test('git missing: no_git at once', async () => {
  const git = createGit({ bin: path.join(os.tmpdir(), 'no-such-git-here'), log: quiet });
  await assert.rejects(git.run(os.tmpdir(), ['status']), { code: 'no_git' });
  assert.equal(git.stats().missing, true);
  const t0 = Date.now();
  await assert.rejects(git.run(os.tmpdir(), ['status']), { code: 'no_git' });
  assert.ok(Date.now() - t0 < 50);
});

test('a git that hangs gives up at its limit; the same folder is skipped until it ends', { skip: process.platform === 'win32' }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-hang-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'git');
  fs.writeFileSync(bin, '#!/bin/sh\nsleep 30\n', { mode: 0o755 });
  const lines = [];
  const git = createGit({ bin, log: (l) => lines.push(l) });
  const t0 = Date.now();
  await assert.rejects(git.run(dir, ['log'], { ms: 200 }), { code: 'git_timeout' });
  assert.ok(Date.now() - t0 < 1500);
  assert.ok(lines.some((l) => l.includes('git stuck')));
  // SIGKILL ends sleep at once: the folder is free again soon.
  for (let i = 0; i < 50 && git.stats().stuck; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(git.stats().stuck, 0);
  assert.equal(git.stats().running, 0);
});

// A child that never ends, even killed (uninterruptible I/O).
function stuckSpawn() {
  const kids = [];
  const spawn = () => {
    const c = new EventEmitter();
    c.stdout = new EventEmitter();
    c.stderr = new EventEmitter();
    c.kill = () => {};
    kids.push(c);
    return c;
  };
  return { spawn, kids };
}

test('a child that never ends: its folder stuck, the slot freed, past MAX_STUCK all refused', async () => {
  const s = stuckSpawn();
  const git = createGit({ spawn: s.spawn, log: quiet, maxStuck: 2 });
  await assert.rejects(git.run('/repo/a', ['log'], { ms: 50 }), { code: 'git_timeout' });
  assert.equal(git.stats().running, 0);
  await assert.rejects(git.run('/repo/a', ['status'], { ms: 50 }), { code: 'git_stuck' });
  await assert.rejects(git.run('/repo/b', ['log'], { ms: 50 }), { code: 'git_timeout' });
  await assert.rejects(git.run('/repo/c', ['log'], { ms: 50 }), { code: 'git_jammed' });
  // It ends at last: the folder is free.
  s.kids[0].emit('exit', null);
  s.kids[1].emit('close', null);
  assert.equal(git.stats().stuck, 0);
  const p = git.run('/repo/a', ['log'], { ms: 500 });
  await new Promise((r) => setImmediate(r));
  s.kids[2].stdout.emit('data', Buffer.from('ok'));
  s.kids[2].emit('close', 0);
  assert.equal((await p).out.toString(), 'ok');
});

test('at most two at once; the same call is shared; a wait past the limit gives up', async () => {
  const s = stuckSpawn();
  const git = createGit({ spawn: s.spawn, log: quiet });
  const a = git.run('/r', ['log'], { ms: 1000 });
  const a2 = git.run('/r', ['log'], { ms: 1000 });
  assert.equal(a, a2);
  const b = git.run('/r', ['status'], { ms: 1000 });
  await new Promise((r) => setImmediate(r));
  assert.equal(s.kids.length, 2);
  await assert.rejects(git.run('/r', ['show'], { ms: 30 }), { code: 'git_busy' });
  const c = git.run('/r', ['show'], { ms: 1000 });
  s.kids[0].emit('close', 0);
  await a;
  await new Promise((r) => setImmediate(r));
  assert.equal(s.kids.length, 3);
  s.kids[1].emit('close', 0);
  s.kids[2].emit('close', 1);
  await b;
  await assert.rejects(c, { code: 'git_failed', status: 1 });
});
