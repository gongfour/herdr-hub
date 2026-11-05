'use strict';
// A real Herdr Hub process (node server.js) over a fake herdr (fakeherdr.js), for the tests of its
// routes: each one in its own temp data folder and port, killed when the test ends.
// startHub(t, { id, agents, env }) -> { port, herdr, out(), request(method, path, body, headers), stop() }
// hubInProcess(t, { id, agents, env, now }): the same in this process (lib/hub.js createServer),
// with herdr's calls going to the fake one and a clock the test may move.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { fakeHerdr } = require('./fakeherdr');

const ROOT = path.join(__dirname, '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A port nothing listens on (asked of the OS, then let go).
function freePort() {
  return new Promise((resolve, reject) => {
    const s = require('net').createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

async function until(fn, what, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await sleep(25);
  }
}

// One HTTP request; body: an object (sent as JSON) or a Buffer. Mutations carry X-Herdr-Hub
// unless headers say otherwise ({ 'X-Herdr-Hub': null } leaves it out).
function request(port, method, p, body, headers = {}) {
  const h = { Host: `127.0.0.1:${port}`, ...(method === 'GET' ? {} : { 'X-Herdr-Hub': '1' }), ...headers };
  for (const k of Object.keys(h)) if (h[k] == null) delete h[k];
  const data = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  if (data) h['Content-Type'] = h['Content-Type'] || 'application/json';
  // As a browser sends it (a chunked body the server never reads ends in Node's own 400).
  if (data) h['Content-Length'] = data.length;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: h, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text, body: json });
      });
    });
    req.on('error', reject);
    req.end(data || undefined);
  });
}

async function startHub(t, { id = 'hubtest', agents = [], env = {} } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `hub-${id}-`));
  const sock = path.join(tmp, 'h.sock');
  const herdr = await fakeHerdr(sock);
  herdr.agents.push(...agents);
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      HERDR_HUB_ALLOW_LOCAL: '1',
      HERDR_HUB_ALLOWED_LOGINS: '',
      HERDR_HUB_PUSH: '0',
      HERDR_HUB_HOST_ID: id,
      HERDR_HUB_HOST_LABEL: id,
      HERDR_HUB_PEERS: '',
      HERDR_HUB_HOSTS: '',
      HERDR_HUB_DATA: path.join(tmp, 'data'),
      HERDR_HUB_UPLOADS: path.join(tmp, 'uploads'),
      CLAUDE_CONFIG_DIR: path.join(tmp, 'claude'),
      HERDR_SOCKET: sock,
      HERDR_HUB_WATCHDOG_MS: '0',
      HERDR_HUB_HERDR_HELPER: '0',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    child.kill('SIGKILL');
  };
  t.after(() => {
    stop();
    herdr.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  await until(() => out.includes('herdr-hub on http') || child.exitCode != null, 'server start');
  if (!out.includes('herdr-hub on http')) throw new Error(`server did not start:\n${out}`);
  // The first refresh has been applied.
  await until(async () => (await request(port, 'GET', '/api/state')).body?.herdr === 'up', `first refresh\n${out}`);
  return { port, herdr, tmp, out: () => out, request: (...a) => request(port, ...a), stop };
}

// The state's agent on that host and pane (waited for: a change in the fake herdr shows after a refresh).
async function agentState(hub, host, pane, test = () => true) {
  return until(async () => {
    const s = (await hub.request('GET', '/api/state')).body;
    return s && s.agents.find((a) => a.host === host && a.pane === pane && test(a));
  }, `agent ${host}/${pane}`);
}

// lib/herdr with its calls on that socket, the Node way.
function herdrAt(socketPath) {
  const lib = require('../../lib/herdr');
  return {
    ...lib,
    call: (m, p, o = {}) => lib.callNode(m, p, { ...o, socketPath }),
    subscribe: (s, f, o = {}) => lib.subscribe(s, f, { ...o, socketPath }),
    direct: () => false,
    helperOn: () => false,
  };
}

async function hubInProcess(t, { id = 'inproc', agents = [], env = {}, now } = {}) {
  const { createServer } = require('../../lib/hub');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `hub-${id}-`));
  const sock = path.join(tmp, 'h.sock');
  const herdr = await fakeHerdr(sock);
  herdr.agents.push(...agents);
  const port = await freePort();
  const h = createServer({
    herdr: herdrAt(sock),
    port,
    dataDir: path.join(tmp, 'data'),
    now,
    env: { HERDR_HUB_ALLOW_LOCAL: '1', HERDR_HUB_PUSH: '0', HERDR_HUB_HOST_ID: id, HERDR_HUB_HOST_LABEL: id, HERDR_HUB_AWAKE_MS: '0', ...env },
  });
  await new Promise((r) => h.listen('127.0.0.1', r));
  t.after(async () => {
    await h.close();
    herdr.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  await until(async () => (await request(port, 'GET', '/api/state')).body?.herdr === 'up', 'first refresh');
  return { port, herdr, tmp, hub: h, request: (...a) => request(port, ...a) };
}

module.exports = { startHub, hubInProcess, herdrAt, request, until, sleep, freePort, agentState };
