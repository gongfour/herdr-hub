'use strict';
// The server itself, in a child process: a blocked main thread is killed by the watchdog, and a
// stuck filesystem call does not stop other requests (test/fixtures/stall.js simulates both).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');

function startServer(t, env) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-hub-nohang-srv-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ['-r', path.join(__dirname, 'fixtures', 'stall.js'), 'server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      HERDR_HUB_ALLOW_LOCAL: '1',
      HERDR_HUB_ALLOWED_LOGINS: '',
      HERDR_HUB_PUSH: '0',
      HERDR_HUB_HOST_ID: 'nohang',
      HERDR_HUB_PEERS: '',
      HERDR_HUB_DATA: path.join(tmp, 'data'),
      HERDR_HUB_UPLOADS: path.join(tmp, 'uploads'),
      HERDR_SOCKET: path.join(tmp, 'no-herdr.sock'),
      ...env(tmp),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = { text: '' };
  child.stdout.on('data', (d) => (out.text += d));
  child.stderr.on('data', (d) => (out.text += d));
  const exited = new Promise((r) => child.on('exit', (code, signal) => r({ code, signal, at: Date.now() })));
  t.after(() => {
    child.kill('SIGKILL');
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  return { child, port, tmp, out, exited };
}

function get(port, p, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: p, headers: { Host: `127.0.0.1:${port}` }, timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null }));
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })));
    req.on('error', reject);
  });
}

async function listening(srv, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (srv.out.text.includes('herdr-hub on http')) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`server did not start:\n${srv.out.text}`);
}

test('watchdog: a main thread that stops is killed within the timeout, with a log line', async (t) => {
  const srv = startServer(t, () => ({ HERDR_HUB_WATCHDOG_MS: '1500', HUB_TEST_BLOCK_AFTER_MS: '1500' }));
  await listening(srv);
  assert.equal((await get(srv.port, '/api/version')).status, 200);
  const startedAt = Date.now(); // the block starts at most 1.5 s after this
  const r = await Promise.race([srv.exited, new Promise((res) => setTimeout(() => res(null), 8000))]);
  assert.ok(r, `still running:\n${srv.out.text}`);
  assert.equal(r.signal, 'SIGKILL');
  assert.ok(r.at - startedAt < 1500 + 1500 + 2500, `${r.at - startedAt} ms`);
  assert.match(srv.out.text, /watchdog: main thread silent for \d+ ms; last request started: GET \/api\/version/);
});

test('watchdog: 0 turns it off', async (t) => {
  const srv = startServer(t, () => ({ HERDR_HUB_WATCHDOG_MS: '0' }));
  await listening(srv);
  assert.doesNotMatch(srv.out.text, /watchdog:/);
});

test('a stuck readdir: that request gives up, /api/version answers meanwhile, the slow one is logged', async (t) => {
  const srv = startServer(t, (tmp) => {
    fs.mkdirSync(path.join(tmp, 'stuck'), { recursive: true });
    return { HERDR_HUB_WATCHDOG_MS: '2000', HUB_TEST_STUCK_DIR: path.join(tmp, 'stuck') };
  });
  await listening(srv);
  const t0 = Date.now();
  const slow = get(srv.port, `/api/dirs?path=${encodeURIComponent(path.join(srv.tmp, 'stuck'))}`, 10000);
  await new Promise((r) => setTimeout(r, 300));
  for (let i = 0; i < 3; i++) {
    const t1 = Date.now();
    assert.equal((await get(srv.port, '/api/version', 2000)).status, 200);
    assert.ok(Date.now() - t1 < 1000, 'answers while the readdir is stuck (the stuck call takes 4 s)');
    await new Promise((r) => setTimeout(r, 500));
  }
  const r = await slow;
  assert.equal(r.status, 200);
  assert.equal(r.body.denied, true);
  assert.equal(r.body.slow, true);
  assert.ok(Date.now() - t0 < 6000);
  // The other folders still list (the stuck call leaves the pool room).
  assert.equal((await get(srv.port, `/api/dirs?path=${encodeURIComponent(srv.tmp)}`)).body.dirs.includes('stuck'), true);
  await new Promise((r) => setTimeout(r, 100));
  assert.match(srv.out.text, /fs stuck: .*stuck/);
  assert.match(srv.out.text, /slow request GET \/api\/dirs \d+ms -> 200/);
  assert.equal(srv.child.exitCode, null, 'the watchdog left it alone');
});
