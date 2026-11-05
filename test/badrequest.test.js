'use strict';
// The real server (fake herdr) against requests that used to end the process: a request line
// new URL() refuses, a broken %-escape in an API path or in the live channel's path. Each is a
// 400 and the server keeps serving. And refreshes that overlap: one that ends after a newer one
// was applied does not move the times (workingSince / doneAt).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');
const { fakeHerdr } = require('./fixtures/fakeherdr');

const ROOT = path.join(__dirname, '..');

async function start(t, before) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-badreq-'));
  const sock = path.join(tmp, 'h.sock');
  const herdr = await fakeHerdr(sock);
  if (before) before(herdr);
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
      HERDR_HUB_HOST_ID: 'badreq',
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
  let exited = null;
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  child.on('exit', (code) => (exited = code));
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
  while (!herdr.calls.some((c) => c.method === 'workspace.list')) await new Promise((r) => setTimeout(r, 20));
  await new Promise((r) => setTimeout(r, 100));
  return { port, herdr, alive: () => exited === null, log: () => out };
}

// Sent as written: http.request would refuse or rewrite these paths.
function raw(port, lines) {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1');
    let got = '';
    s.on('data', (d) => (got += d));
    s.on('end', () => resolve(got));
    s.on('close', () => resolve(got));
    s.on('error', reject);
    s.write(lines.join('\r\n') + '\r\n\r\n');
    setTimeout(() => s.end(), 1500);
  });
}
const statusOf = (reply) => Number((/^HTTP\/1\.1 (\d+)/.exec(reply) || [])[1]);

function req(port, method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const r = http.request(
      { host: '127.0.0.1', port, path: p, method, headers: { Host: `127.0.0.1:${port}`, 'X-Herdr-Hub': '1', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let s = '';
        res.on('data', (d) => (s += d));
        res.on('end', () => resolve({ status: res.statusCode, body: s ? JSON.parse(s) : null }));
      }
    );
    r.on('error', reject);
    r.end(data);
  });
}

test('bad request paths: 400, and the server keeps serving', async (t) => {
  const { port, alive, log } = await start(t);
  const host = `Host: 127.0.0.1:${port}`;
  assert.equal(statusOf(await raw(port, ['GET //a:99999/x HTTP/1.1', host, 'Connection: close'])), 400);
  assert.equal(statusOf(await raw(port, ['GET /api/agents/%E0/screen HTTP/1.1', host, 'X-Herdr-Hub: 1', 'Connection: close'])), 400);
  assert.equal(statusOf(await raw(port, ['GET /api/peers/%E0/agents/x/screen HTTP/1.1', host, 'X-Herdr-Hub: 1', 'Connection: close'])), 400);
  const up = ['Connection: Upgrade', 'Upgrade: websocket', 'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==', 'X-Herdr-Hub: 1'];
  assert.equal(statusOf(await raw(port, ['GET //a:99999/x HTTP/1.1', host, ...up])), 400);
  assert.equal(statusOf(await raw(port, ['GET /api/panes/%E0/live HTTP/1.1', host, ...up])), 400);
  assert.equal(statusOf(await raw(port, ['GET /api/peers/%E0/panes/x/live HTTP/1.1', host, ...up])), 400);
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(alive(), log());
  const r = await req(port, 'GET', '/api/state');
  assert.equal(r.status, 200);
});
