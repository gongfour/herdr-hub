'use strict';
// Filesystem calls on request paths, for folders the server does not own (an agent's cwd,
// ~/.claude, transcripts, the folder browser). Never synchronous: one readdir or stat in a folder
// macOS guards (Desktop, Documents, Library, /Volumes) or on a dead mount can block for good, and a
// synchronous one stopped the whole server (2026-11-05). An asynchronous one only holds a libuv
// pool thread, so:
//   - each request gets a time budget (budget(ms)); a call that would end past it gives up, the
//     budget is marked partial, and the caller returns what it has;
//   - a call still running after SLOW_MS counts as stuck: its path is skipped by later calls until
//     it ends, and it no longer counts toward LIMIT, but at most MAX_STUCK may be stuck at once
//     (each holds a pool thread; UV_THREADPOOL_SIZE is 16, see server.js) — past that every call
//     gives up at once, so the pool stays free for the rest of the server;
//   - at most LIMIT calls run at once.
// The server's own files (data/, public/, uploads) are read as before.

const fs = require('fs');

const LIMIT = 4;
const MAX_STUCK = 8;
const SLOW_MS = 1500;
const DEFAULT_MS = 5000;

let running = 0;
let stuckCount = 0;
const stuck = new Map(); // key (a path) -> since
const queue = []; // waiting for a slot: { go, timer }
let log = (line) => console.error(`${new Date().toISOString()} ${line}`);

// A request's allowance: left() ms; partial once anything gave up.
function budget(ms = DEFAULT_MS) {
  const end = Date.now() + ms;
  return { end, partial: false, left: () => end - Date.now() };
}

const giveUp = (b, code) => {
  if (b) b.partial = true;
  return Object.assign(new Error(code), { code, gaveUp: true });
};

function release() {
  running--;
  const next = queue.shift();
  if (next) {
    clearTimeout(next.timer);
    next.go();
  }
}

// Wait for a slot until ms run out; false when they did.
function slot(ms) {
  if (running < LIMIT) {
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

// fn() -> a promise of one fs call on key (its path). opts.ms: a cap below the budget's.
async function run(b, key, fn, { ms = Infinity } = {}) {
  if (key && stuck.has(key)) throw giveUp(b, 'fs_stuck');
  if (stuckCount >= MAX_STUCK) throw giveUp(b, 'fs_jammed');
  const allow = () => Math.min(ms, b ? b.left() : DEFAULT_MS);
  if (allow() <= 0) throw giveUp(b, 'fs_budget');
  if (!(await slot(allow()))) throw giveUp(b, 'fs_busy');
  let p;
  try {
    p = Promise.resolve(fn());
  } catch (err) {
    release();
    throw err;
  }
  let isStuck = false;
  const slowTimer = setTimeout(() => {
    isStuck = true;
    stuckCount++;
    if (key) stuck.set(key, Date.now());
    release(); // a stuck call does not hold up the others; MAX_STUCK bounds how many there are
    log(`fs stuck: ${key || '?'} (${stuckCount} stuck${stuckCount >= MAX_STUCK ? ', refusing more' : ''})`);
  }, SLOW_MS);
  slowTimer.unref?.();
  p.then(
    () => settled(),
    () => settled()
  );
  function settled() {
    clearTimeout(slowTimer);
    if (!isStuck) return release();
    stuckCount--;
    if (key) stuck.delete(key);
    log(`fs unstuck: ${key || '?'}`);
  }
  let timer;
  const out = await Promise.race([p.then((v) => ({ v }), (e) => ({ e })), new Promise((r) => (timer = setTimeout(() => r(null), Math.max(0, allow()))))]);
  clearTimeout(timer);
  if (!out) throw giveUp(b, 'fs_budget');
  if (out.e) throw out.e;
  return out.v;
}

const P = () => fs.promises;
const readdir = (b, dir, opts) => run(b, dir, () => P().readdir(dir, { withFileTypes: true }), opts);
const stat = (b, p, opts) => run(b, p, () => P().stat(p), opts);
const exists = (b, p, opts) => stat(b, p, opts).then(() => true, (err) => (err.gaveUp ? Promise.reject(err) : false));
const isDir = (b, p, opts) => stat(b, p, opts).then((s) => s.isDirectory(), () => false);
const readFile = (b, p, opts) => run(b, p, () => P().readFile(p, 'utf8'), opts);
const mkdir = (b, p, opts) => run(b, p, () => P().mkdir(p), opts);

// The first `bytes` (or the last, from: 'end') of a file: one open, one read, one close.
async function readPart(b, file, bytes, { from = 'start' } = {}) {
  return run(b, file, async () => {
    const fh = await P().open(file, 'r');
    try {
      const { size } = await fh.stat();
      const start = from === 'end' ? Math.max(0, size - bytes) : 0;
      const len = from === 'end' ? size - start : Math.min(bytes, size);
      const buf = Buffer.alloc(len);
      const { bytesRead } = await fh.read(buf, 0, len, start);
      return { buf: buf.subarray(0, bytesRead), start, size };
    } finally {
      await fh.close();
    }
  });
}

const stats = () => ({ running, queued: queue.length, stuck: stuckCount, paths: [...stuck.keys()] });
// Tests: where log lines go.
function _setLog(logger) {
  log = logger;
}

module.exports = { budget, run, readdir, stat, exists, isDir, readFile, readPart, mkdir, stats, LIMIT, MAX_STUCK, SLOW_MS, _setLog };
