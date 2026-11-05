'use strict';
// lib/herdr.js's connect helper (lib/herdr-helper.py) against a stand-in herdr that reads like
// herdr 0.9.5 on macOS (test/fixtures/sleepyherdr.py: non-blocking first read, 100 ms sleep when
// the request is not there yet). The Node way is held; the helper is not.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const herdr = require('../lib/herdr');

const PYTHON = process.env.HERDR_HUB_PYTHON || '/usr/bin/python3';
const hasPython = process.platform !== 'win32' && spawnSync(PYTHON, ['-c', '1']).status === 0;
const skip = hasPython ? false : 'no python3 here';
const quiet = { log() {}, error() {} };

function sleepy(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-'));
  const sock = path.join(dir, 's.sock');
  const p = spawn(PYTHON, ['-I', '-u', path.join(__dirname, 'fixtures', 'sleepyherdr.py'), sock], { stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => {
    p.kill('SIGKILL');
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return new Promise((resolve) => p.stdout.once('data', () => resolve(sock)));
}
const until = async (f, ms = 3000) => {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 10));
  }
};
async function helperOn(t, opts = {}) {
  herdr.useHelper(true, { log: quiet, ...opts });
  t.after(() => herdr.useHelper(false));
  try {
    await herdr.call('ping', {}, { socketPath: '/nonexistent', timeoutMs: 500 }); // starts it
  } catch {}
  await until(() => herdr.helperState().ready);
}
// Bursts of calls sent at once (as a key and the reads beside it are); how many took > 50 ms.
async function held(sock, rounds = 8, size = 4) {
  let n = 0;
  for (let i = 0; i < rounds; i++) {
    const t0 = performance.now();
    const r = await Promise.all(Array.from({ length: size }, () => herdr.call('ping', {}, { socketPath: sock }).then(() => performance.now() - t0)));
    n += r.filter((ms) => ms > 50).length;
  }
  return n;
}

test('helperFromEnv: on on darwin by default, 1/0 force it', () => {
  assert.equal(herdr.helperFromEnv(undefined, 'darwin'), true);
  assert.equal(herdr.helperFromEnv('', 'win32'), false);
  assert.equal(herdr.helperFromEnv(undefined, 'linux'), false);
  assert.equal(herdr.helperFromEnv('0', 'darwin'), false);
  assert.equal(herdr.helperFromEnv('off', 'darwin'), false);
  assert.equal(herdr.helperFromEnv('1', 'linux'), true);
});

test('the Node way is held by a herdr that sleeps on its first read', { skip }, async (t) => {
  const sock = await sleepy(t);
  herdr.useHelper(false);
  const n = await held(sock);
  t.diagnostic(`Node way: held ${n}/32`);
  assert.ok(n >= 8, `held ${n}/32`);
});

test('through the helper, the same calls are not held', { skip }, async (t) => {
  const sock = await sleepy(t);
  await helperOn(t);
  assert.deepEqual(await herdr.call('ping', {}, { socketPath: sock }), { type: 'pong' });
  const n = await held(sock);
  assert.ok(n <= 1, `held ${n}/32`);
  assert.equal(herdr.helperState().pending, 0);
});

test('helper: errors keep their codes, and a timeout is kept and leaves nothing behind', { skip }, async (t) => {
  const sock = await sleepy(t);
  await helperOn(t);
  await assert.rejects(herdr.call('ping', {}, { socketPath: sock + '.missing' }), { code: 'unreachable' });
  const t0 = Date.now();
  await assert.rejects(herdr.call('hang', {}, { socketPath: sock, timeoutMs: 200 }), { code: 'timeout' });
  assert.ok(Date.now() - t0 < 400);
  assert.equal(herdr.helperState().pending, 0);
  // The helper closes the socket at its own deadline (t + 50 ms): its fds come back.
  const pid = herdr.helperState().pid;
  const fds = () => spawnSync('lsof', ['-p', String(pid)]).stdout.toString().split('\n').filter((l) => /unix/i.test(l)).length;
  await new Promise((r) => setTimeout(r, 150));
  const before = fds();
  await Promise.all(Array.from({ length: 5 }, () => herdr.call('hang', {}, { socketPath: sock, timeoutMs: 100 }).catch(() => {})));
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(fds(), before);
  assert.deepEqual(await herdr.call('ping', {}, { socketPath: sock }), { type: 'pong' });
});

test('helper crash: calls in flight fail, the Node way meanwhile, then it comes back', { skip }, async (t) => {
  const sock = await sleepy(t);
  await helperOn(t, { minBackoff: 300 });
  const inFlight = herdr.call('hang', {}, { socketPath: sock, timeoutMs: 5000 });
  await new Promise((r) => setTimeout(r, 30));
  herdr.helperKill();
  await assert.rejects(inFlight, { code: 'helper_lost' });
  assert.equal(herdr.helperState().ready, false);
  assert.deepEqual(await herdr.call('ping', {}, { socketPath: sock }), { type: 'pong' }); // Node way
  await until(() => herdr.helperState().ready);
  assert.equal(herdr.helperState().starts, 2);
  assert.deepEqual(await herdr.call('ping', {}, { socketPath: sock }), { type: 'pong' });
});

test('no python: the Node way, and it keeps retrying quietly', { skip: process.platform === 'win32' }, async (t) => {
  const sock = await sleepy(t).catch(() => null);
  herdr.useHelper(true, { python: '/nonexistent/python3', log: quiet, minBackoff: 50, maxBackoff: 100 });
  t.after(() => herdr.useHelper(false));
  if (sock) assert.deepEqual(await herdr.call('ping', {}, { socketPath: sock }), { type: 'pong' });
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(herdr.helperState().ready, false);
  assert.ok(herdr.helperState().starts >= 2);
});

test('the helper dies with the node, even by SIGKILL', { skip }, async () => {
  const script = `const h=require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'herdr'))});h.useHelper(true,{log:{log(){},error(){}}});h.call('ping',{}, {socketPath:'/nonexistent',timeoutMs:300}).catch(()=>{});
    const iv=setInterval(()=>{const s=h.helperState();if(s.ready){console.log(s.pid);clearInterval(iv);setInterval(()=>{},1000)}},10)`;
  const node = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
  const pid = Number(await new Promise((r) => node.stdout.once('data', (d) => r(String(d).trim()))));
  assert.ok(pid > 0);
  const alive = () => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  assert.ok(alive());
  node.kill('SIGKILL');
  await until(() => !alive());
});
