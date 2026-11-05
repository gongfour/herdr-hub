'use strict';
// The shell's live channel through the real server (fake herdr): the upgrade's checks, the
// whole screen then line changes, keys acknowledged in order.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { fakeHerdr } = require('./fixtures/fakeherdr');
const ws = require('../lib/ws');
const ScreenDiff = require('../public/screendiff');
const Live = require('../public/live');

const ROOT = path.join(__dirname, '..');

async function start(t, env = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-live-'));
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
      HERDR_HUB_HOST_ID: 'livetest',
      HERDR_HUB_PEERS: '',
      HERDR_HUB_DATA: path.join(tmp, 'data'),
      HERDR_HUB_UPLOADS: path.join(tmp, 'uploads'),
      CLAUDE_CONFIG_DIR: path.join(tmp, 'claude'),
      HERDR_SOCKET: sock,
      HERDR_HUB_WATCHDOG_MS: '0',
      ...env,
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
  while (!out.includes('herdr-hub on http') || (env.HERDR_HUB_HERDR_HELPER === '1' && !out.includes('herdr helper: ready'))) {
    if (Date.now() > end) throw new Error(`server did not start:\n${out}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  // The first refresh has seen workspace w1.
  while (!herdr.calls.some((c) => c.method === 'workspace.list')) await new Promise((r) => setTimeout(r, 20));
  await new Promise((r) => setTimeout(r, 100));
  return { port, herdr, tmp };
}


// The status a refused upgrade answers with.
function upgradeStatus(port, p, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, headers: { Host: `127.0.0.1:${port}`, Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', ...headers } });
    req.on('upgrade', (res, socket) => (socket.destroy(), resolve(101)));
    req.on('response', (res) => (res.resume(), resolve(res.statusCode)));
    req.on('error', reject);
    req.end();
  });
}

const hasPython = process.platform !== 'win32' && require('child_process').spawnSync('/usr/bin/python3', ['-c', '1']).status === 0;
// helper 0: herdr calls the Node way (desktop; the Mac without lib/herdr's connect helper);
// helper 1: through the helper (the Mac's default), where the workarounds for held calls rest.
for (const helper of ['0', '1'])
test(`live channel: checks, the screen, keys (connect helper ${helper})`, { skip: helper === '1' && !hasPython && 'no python3' }, async (t) => {
  const { port, herdr } = await start(t, { HERDR_HUB_HERDR_HELPER: helper });
  const p = '/api/panes/w1-p1/live?lines=200&format=text';
  // A browser page of another origin (a WebSocket is not held back by CORS), and a client with
  // neither an Origin nor the hub's header.
  assert.equal(await upgradeStatus(port, p, { Origin: 'https://evil.example' }), 403);
  assert.equal(await upgradeStatus(port, p, {}), 403);
  assert.equal(await upgradeStatus(port, p, { Host: 'evil.example' , 'X-Herdr-Hub': '1' }), 403);
  assert.equal(await upgradeStatus(port, '/api/panes/nope/live', { 'X-Herdr-Hub': '1' }), 404);
  assert.equal(await upgradeStatus(port, '/api/peers/server/panes/w1-p1/live', { 'X-Herdr-Hub': '1' }), 404);
  // This page's own origin.
  assert.equal(await upgradeStatus(port, p, { Origin: `http://127.0.0.1:${port}` }), 101);

  const c = await ws.connect(`ws://127.0.0.1:${port}${p}`, { headers: { 'X-Herdr-Hub': '1' } });
  const msgs = [];
  let cur = null;
  c.on('message', (m) => {
    const x = JSON.parse(m);
    msgs.push(x);
    const f = Live.screenFrame(cur, x, ScreenDiff);
    if (f && !f.full) cur = f;
  });
  const until = async (fn) => {
    const end = Date.now() + 3000;
    while (!fn()) {
      if (Date.now() > end) throw new Error(`timed out: ${JSON.stringify(msgs)}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  await until(() => cur);
  assert.equal(msgs[0].t, 'hello');
  assert.equal(msgs[0].api, 2);
  assert.equal(cur.screen.text, '$ ');
  c.send(JSON.stringify({ t: 'k', s: 1, x: 'ls', y: [] }));
  c.send(JSON.stringify({ t: 'k', s: 2, x: '', y: ['enter'] }));
  c.send(JSON.stringify({ t: 'k', s: 3, x: '', y: ['rm -rf'] }));
  await until(() => msgs.some((m) => m.t === 'ack' && m.s === 2) && msgs.some((m) => m.t === 'kerr'));
  assert.deepEqual(msgs.find((m) => m.t === 'kerr'), { t: 'kerr', from: 3, to: 3, error: 'bad_keys', message: 'bad_keys' });
  await until(() => cur.screen.text === '$ ls\n$ ');
  assert.ok(msgs.filter((m) => m.t === 'f').length === 1, 'one whole screen, then changes');
  // The Node way, herdr kept awake (the default): each key call comes right after a ping. Through
  // the helper herdr does not hold calls: no ping before the key, none to keep it awake.
  const i = herdr.calls.findIndex((x) => /send_(text|keys|input)/.test(x.method));
  if (helper === '0') assert.equal(herdr.calls.slice(0, i).reverse().find((x) => x.method !== 'pane.read')?.method, 'ping');
  else assert.equal(herdr.calls.filter((x) => x.method === 'ping').length, 0);
  const sends = herdr.calls.filter((x) => /send_(text|keys|input)/.test(x.method));
  assert.ok(sends.length >= 1 && sends.length <= 2);
  c.close();
});

test('a page that went silent (no pong, no close) is dropped and its reads stop', { timeout: 15000 }, async (t) => {
  const { port, herdr } = await start(t, { HERDR_HUB_LIVE_PING_MS: '100', HERDR_HUB_HERDR_HELPER: '0' });
  // A client that does the handshake and then never answers anything: a link that died.
  const net = require('net');
  const sock = net.connect(port, '127.0.0.1');
  await new Promise((r) => sock.once('connect', r));
  sock.write(`GET /api/panes/w1-p1/live?lines=20 HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: http://127.0.0.1:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`);
  let got = '';
  const ended = new Promise((r) => sock.on('end', r).on('close', r));
  sock.on('data', (d) => (got += d.toString('latin1')));
  t.after(() => sock.destroy());
  const reads = () => herdr.calls.filter((c) => c.method === 'pane.read').length;
  const t0 = Date.now();
  await ended;
  assert.ok(got.startsWith('HTTP/1.1 101'), got.slice(0, 40));
  assert.ok(Date.now() - t0 < 2000, `closed after ${Date.now() - t0} ms`);
  const n = reads();
  await new Promise((r) => setTimeout(r, 400));
  assert.ok(reads() <= n + 1, `reads went on: ${n} → ${reads()}`);
});
