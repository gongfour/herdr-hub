'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const fsq = require('../lib/fsq');
const commands = require('../lib/commands');

const lines = [];
fsq._setLog((l) => lines.push(l));
commands.setLog((l) => lines.push(l));

// A call that never answers until let go, like a readdir in a folder macOS guards.
function hang() {
  let release;
  const p = new Promise((r) => (release = r));
  return { fn: () => p, release: () => release([]) };
}

test('a call past the budget gives up and marks it partial; the path is then skipped until it ends', async () => {
  const h = hang();
  const b = fsq.budget(fsq.SLOW_MS + 300);
  const t0 = Date.now();
  await assert.rejects(fsq.run(b, '/stuck/a', h.fn), { code: 'fs_budget' });
  assert.ok(Date.now() - t0 < fsq.SLOW_MS + 1000);
  assert.equal(b.partial, true);
  assert.deepEqual(fsq.stats().paths, ['/stuck/a']);
  // Skipped at once while stuck, without waiting for the budget.
  const b2 = fsq.budget(5000);
  const t1 = Date.now();
  await assert.rejects(fsq.run(b2, '/stuck/a', h.fn), { code: 'fs_stuck' });
  assert.ok(Date.now() - t1 < 50);
  assert.ok(lines.some((l) => l.includes('fs stuck: /stuck/a')));
  h.release();
  await new Promise((r) => setImmediate(r));
  assert.equal(fsq.stats().stuck, 0);
  assert.deepEqual(await fsq.run(fsq.budget(), '/stuck/a', h.fn), []);
});

test('stuck calls do not hold up the others; at most LIMIT run at once', async () => {
  const hs = Array.from({ length: fsq.LIMIT }, hang);
  const pending = hs.map((h, i) => fsq.run(fsq.budget(10000), `/stuck/${i}`, h.fn).catch(() => {}));
  // All slots taken: a fresh call waits for one, then runs once the stuck ones stop counting.
  let ran = 0;
  const t0 = Date.now();
  const r = await fsq.run(fsq.budget(5000), '/ok', async () => ++ran);
  assert.equal(r, 1);
  const waited = Date.now() - t0;
  assert.ok(waited >= fsq.SLOW_MS - 100 && waited < fsq.SLOW_MS + 1000, `waited ${waited}`);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(fsq.stats().stuck, fsq.LIMIT);
  // A real read goes through meanwhile.
  assert.ok((await fsq.readdir(fsq.budget(), os.tmpdir())).length >= 0);
  hs.forEach((h) => h.release());
  await Promise.all(pending);
  assert.equal(fsq.stats().stuck, 0);
});

test('@-files: a stuck folder gives a partial walk within the budget, the rest still listed', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-hub-nohang-'));
  fs.mkdirSync(path.join(root, 'stuck'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'stuck', 'hidden.txt'), '');
  fs.writeFileSync(path.join(root, 'src', 'app.js'), '');
  fs.writeFileSync(path.join(root, 'readme.md'), '');
  const real = fs.promises.readdir;
  let release;
  const gate = new Promise((r) => (release = r));
  fs.promises.readdir = (p, ...rest) => (path.resolve(String(p)) === path.join(root, 'stuck') ? gate.then(() => real.call(fs.promises, p, ...rest)) : real.call(fs.promises, p, ...rest));
  t.after(() => {
    fs.promises.readdir = real;
    release();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const t0 = Date.now();
  const r = await commands.files(root, '', 40, { budgetMs: 800 });
  const ms = Date.now() - t0;
  assert.ok(ms < 1500, `took ${ms}`);
  assert.equal(r.partial, true);
  assert.equal(r.truncated, true);
  const got = r.files.map((f) => f.path);
  assert.deepEqual(got, ['src/', 'readme.md']);
  assert.ok(lines.some((l) => l.includes(`walk of ${root} partial`)));
  // Not cached: once the folder answers, the full list.
  release();
  await new Promise((r) => setTimeout(r, 50));
  const r2 = await commands.files(root, 'hidden');
  assert.equal(r2.partial, undefined);
  assert.deepEqual(r2.files.map((f) => f.path), ['stuck/hidden.txt']);
});

test('@-files: a folder that holds the home folder is logged once, not walked', async () => {
  lines.length = 0;
  await commands.files('/', '');
  await commands.files('/', 'x');
  assert.equal(lines.filter((l) => l.includes('not walking /')).length, 1);
});
