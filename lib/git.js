'use strict';
// Git on request paths (저장소 그래프, lib/repos.js): the one place that starts git. A child
// process does not block the event loop, but one can hang (a dead mount, a lock held elsewhere)
// past any kill: a git stuck in uninterruptible I/O ignores even SIGKILL. So, as lib/fsq.js does
// for fs calls:
//   - every call has a time limit raced against its own timer; past it the call gives up (the
//     caller answers with what it has), the child is killed, and until it really ends its folder
//     counts as stuck: later calls in that folder give up at once;
//   - at most MAX_STUCK may be stuck at once; past that every call gives up at once;
//   - at most LIMIT run at once (a stuck one no longer counts); the same call already running is
//     shared, not started twice.
// The child never reads what the hub process has: GIT_* variables (GIT_DIR, GIT_WORK_TREE …) are
// dropped, so -C is the folder git reads; no prompt, no lazy fetch (a partial clone would fetch
// from its remote: the hub never goes to the network), no optional locks (git status would write
// the index of a repository someone works in), no fsmonitor daemon, pathspecs taken literally.
// Commands that diff add --no-ext-diff --no-textconv themselves (lib/repos.js): those run programs
// a repository's config names.
// State is per createGit() (one per hub; tests start several in one process).
const { spawn: realSpawn } = require('child_process');

const LIMIT = 2;
const MAX_STUCK = 4;
const DEFAULT_MS = 4000;
const DEFAULT_BYTES = 4 << 20;
const ERR_BYTES = 4096;
const GROUP = process.platform !== 'win32';

const FIXED = [
  '--no-optional-locks',
  '--literal-pathspecs',
  '-c', 'core.fsmonitor=false',
  '-c', 'core.quotePath=false',
  '-c', 'i18n.logOutputEncoding=UTF-8',
  '-c', 'log.showSignature=false',
  '-c', 'color.ui=false',
];

function cleanEnv(from) {
  const env = {};
  for (const [k, v] of Object.entries(from || {})) if (!/^GIT_/i.test(k)) env[k] = v;
  return Object.assign(env, {
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    GIT_NO_LAZY_FETCH: '1',
    GIT_PAGER: 'cat',
    LC_ALL: 'C',
  });
}

const fail = (code, extra) => Object.assign(new Error(code), { code, gitError: true }, extra);

// What a failed git said, as a code the page words itself (git's own words carry paths).
function reason(stderr) {
  const s = String(stderr || '');
  if (/dubious ownership|safe\.directory/i.test(s)) return 'unsafe_repo';
  if (/not a git repository/i.test(s)) return 'not_repo';
  if (/does not have any commits|bad default revision|unknown revision|bad revision|bad object|invalid object/i.test(s)) return 'no_commit';
  if (/missing blob|promisor|lazy fetch/i.test(s)) return 'not_here';
  return 'git_failed';
}

function createGit({ bin = 'git', env = process.env, spawn = realSpawn, log = (l) => console.error(`${new Date().toISOString()} ${l}`), limit = LIMIT, maxStuck = MAX_STUCK } = {}) {
  const childEnv = cleanEnv(env);
  let running = 0;
  const queue = []; // { go, timer }
  const stuck = new Map(); // dir -> since
  const shared = new Map(); // key -> promise
  let missing = false; // git is not there (ENOENT): said at once until the hub restarts

  function slot(ms) {
    if (running < limit) {
      running++;
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const w = {
        go: () => {
          running++;
          resolve(true);
        },
      };
      w.timer = setTimeout(() => {
        const i = queue.indexOf(w);
        if (i >= 0) queue.splice(i, 1);
        resolve(false);
      }, Math.max(0, ms));
      queue.push(w);
    });
  }
  function release() {
    running--;
    const next = queue.shift();
    if (next) {
      clearTimeout(next.timer);
      next.go();
    }
  }

  // git -C dir …args -> { code, out (Buffer), cut }. Rejects with err.code: no_git, git_timeout,
  // git_stuck, git_jammed, git_busy, or (exit status not in ok) the reason git gave.
  // opts: ms (limit, also the wait for a slot), bytes (stdout kept; past it the child is killed
  // and cut is true), ok (exit statuses that are answers, default [0]).
  function run(dir, args, opts = {}) {
    const key = JSON.stringify([dir, args, opts.bytes || 0, opts.ok || 0]);
    const was = shared.get(key);
    if (was) return was;
    const p = start(dir, args, opts).finally(() => shared.delete(key));
    shared.set(key, p);
    return p;
  }

  async function start(dir, args, { ms = DEFAULT_MS, bytes = DEFAULT_BYTES, ok = [0] } = {}) {
    if (missing) throw fail('no_git');
    if (stuck.has(dir)) throw fail('git_stuck');
    if (stuck.size >= maxStuck) throw fail('git_jammed');
    const end = Date.now() + ms;
    if (!(await slot(ms))) throw fail('git_busy');
    return new Promise((resolve, reject) => {
      let child;
      try {
        // Its own process group (not on Windows): a kill reaches what git started too, which
        // would otherwise hold the pipes open.
        child = spawn(bin, ['-C', dir, ...FIXED, ...args], { env: childEnv, windowsHide: true, detached: GROUP, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (err) {
        release();
        return reject(err.code === 'ENOENT' ? fail('no_git') : err);
      }
      const out = [];
      let outLen = 0;
      let cut = false;
      let errText = '';
      let done = false;
      let isStuck = false;
      const finish = (fn) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        fn();
      };
      const kill = () => {
        try {
          if (GROUP && child.pid) process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch {
          try {
            child.kill('SIGKILL');
          } catch {}
        }
      };
      child.stdout.on('data', (c) => {
        if (cut) return;
        const room = bytes - outLen;
        if (c.length > room) {
          out.push(c.subarray(0, room));
          outLen = bytes;
          cut = true;
          kill();
          return;
        }
        out.push(c);
        outLen += c.length;
      });
      child.stderr.on('data', (c) => {
        if (errText.length < ERR_BYTES) errText += c.toString('utf8');
      });
      child.on('error', (err) => {
        if (err.code === 'ENOENT') missing = true;
        if (!isStuck) release();
        finish(() => reject(err.code === 'ENOENT' ? fail('no_git') : fail('git_failed')));
      });
      // A stuck one is free once it has exited (its pipes may stay open a moment longer).
      child.on('exit', () => {
        if (!isStuck || !stuck.has(dir)) return;
        stuck.delete(dir);
        log(`git unstuck: ${dir}`);
      });
      child.on('close', (code) => {
        if (isStuck) {
          if (stuck.delete(dir)) log(`git unstuck: ${dir}`);
          return;
        }
        release();
        finish(() => {
          if (cut || ok.includes(code)) return resolve({ code, out: Buffer.concat(out), cut });
          reject(fail(reason(errText), { status: code, stderr: errText }));
        });
      });
      // Past the limit: give up now; the child is killed, and its folder is stuck until it ends.
      const timer = setTimeout(() => {
        isStuck = true;
        stuck.set(dir, Date.now());
        release();
        kill();
        log(`git stuck: ${dir} ${args[0] || ''} (${stuck.size} stuck${stuck.size >= maxStuck ? ', refusing more' : ''})`);
        finish(() => reject(fail('git_timeout')));
      }, Math.max(0, end - Date.now()));
    });
  }

  const stats = () => ({ running, queued: queue.length, stuck: stuck.size, missing });
  return { run, stats };
}

module.exports = { createGit, cleanEnv, reason, FIXED, LIMIT, MAX_STUCK };
