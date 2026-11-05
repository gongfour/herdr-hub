'use strict';
// POST /api/workspaces/<id>/tabs|agents with an optional cwd: checked like a new workspace's
// folder and passed to herdr's tab.create; without it herdr picks (its active tab's folder).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { fakeHerdr } = require('./fixtures/fakeherdr');

const ROOT = path.join(__dirname, '..');

async function start(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-tabcwd-'));
  const sock = path.join(tmp, 'h.sock');
  const herdr = await fakeHerdr(sock);
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      HERDR_HUB_ALLOW_LOCAL: '1',
      HERDR_HUB_ALLOWED_LOGINS: '',
      HERDR_HUB_PUSH: '0',
      HERDR_HUB_HOST_ID: 'tabcwd',
      HERDR_HUB_PEERS: '',
      HERDR_HUB_DATA: path.join(tmp, 'data'),
      HERDR_HUB_UPLOADS: path.join(tmp, 'uploads'),
      CLAUDE_CONFIG_DIR: path.join(tmp, 'claude'),
      HERDR_SOCKET: sock,
      HERDR_HUB_WATCHDOG_MS: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  t.after(() => {
    child.kill('SIGKILL');
    herdr.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  const end = Date.now() + 8000;
  while (!out.includes('herdr-hub on http')) {
    if (Date.now() > end) throw new Error(`server did not start:\n${out}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  // The first refresh has seen workspace w1.
  while (!herdr.calls.some((c) => c.method === 'workspace.list')) await new Promise((r) => setTimeout(r, 20));
  await new Promise((r) => setTimeout(r, 100));
  return { port, herdr, tmp };
}

function post(port, p, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      { host: '127.0.0.1', port, path: p, method: 'POST', headers: { Host: `127.0.0.1:${port}`, 'X-Herdr-Hub': '1', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let s = '';
        res.on('data', (d) => (s += d));
        res.on('end', () => resolve({ status: res.statusCode, body: s ? JSON.parse(s) : null }));
      }
    );
    req.on('error', reject);
    req.end(data);
  });
}

const tabCreates = (h) => h.calls.filter((c) => c.method === 'tab.create').map((c) => c.params);

test('tabs/agents: cwd is checked and passed to tab.create; without it, none is sent', async (t) => {
  const { port, herdr, tmp } = await start(t);
  const dir = fs.realpathSync(tmp);

  let r = await post(port, '/api/workspaces/w1/agents', { kind: 'claude', cwd: dir + path.sep });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(tabCreates(herdr).at(-1).cwd, dir); // trailing separator dropped
  assert.equal(herdr.calls.filter((c) => c.method === 'agent.start').length, 1);

  r = await post(port, '/api/workspaces/w1/tabs', { cwd: dir });
  assert.equal(r.status, 200);
  assert.equal(tabCreates(herdr).at(-1).cwd, dir);

  for (const body of [{}, { cwd: '' }, { cwd: null }]) {
    r = await post(port, '/api/workspaces/w1/tabs', body);
    assert.equal(r.status, 200);
    assert.ok(!('cwd' in tabCreates(herdr).at(-1)), JSON.stringify(body));
  }

  const before = tabCreates(herdr).length;
  for (const [cwd, error] of [
    ['relative/dir', 'cwd_not_absolute'],
    [path.join(dir, 'nope'), 'cwd_not_found'],
    [__filename, 'cwd_not_directory'],
    [42, 'bad_cwd'],
  ]) {
    r = await post(port, '/api/workspaces/w1/agents', { kind: 'claude', cwd });
    assert.equal(r.status, 400, `${cwd}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.error, error);
  }
  assert.equal(tabCreates(herdr).length, before, 'no tab for a bad folder');
});
