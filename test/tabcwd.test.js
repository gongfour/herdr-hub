'use strict';
// POST /api/workspaces/<id>/tabs|agents with an optional cwd: checked like a new workspace's
// folder and passed to herdr's tab.create; without it herdr picks (its active tab's folder).
// And each workspace's 기본 폴더 (POST …/dir, lib/wsdirs): in the state as defaultCwd, kept
// while its workspace is.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { fakeHerdr } = require('./fixtures/fakeherdr');

const ROOT = path.join(__dirname, '..');

async function start(t, { data = null, before = null } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-tabcwd-'));
  if (data) {
    fs.mkdirSync(path.join(tmp, 'data'));
    for (const [name, v] of Object.entries(data)) fs.writeFileSync(path.join(tmp, 'data', name), JSON.stringify(typeof v === 'function' ? v(tmp) : v));
  }
  const sock = path.join(tmp, 'h.sock');
  const herdr = await fakeHerdr(sock);
  if (before) before(herdr, tmp);
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

function get(port, p) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: p, headers: { Host: `127.0.0.1:${port}`, 'X-Herdr-Hub': '1' } }, (res) => {
        let s = '';
        res.on('data', (d) => (s += d));
        res.on('end', () => resolve(JSON.parse(s)));
      })
      .on('error', reject);
  });
}
const defaultOf = async (port, id) => ((await get(port, '/api/state')).workspaces.find((w) => w.workspace_id === id) || {}).defaultCwd;
const saved = (tmp) => JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'wsdirs.json'), 'utf8'));
// Something that refreshes the state (the rename route does, after herdr answers).
const touch = (port) => post(port, '/api/workspaces/w1/rename', { label: 'proj' });

test('기본 폴더: set, cleared, checked; a new workspace\'s folder becomes its own', async (t) => {
  const { port, herdr, tmp } = await start(t);
  const dir = fs.realpathSync(tmp);
  assert.equal(await defaultOf(port, 'w1'), undefined);

  let r = await post(port, '/api/workspaces/w1/dir', { cwd: dir + path.sep });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(await defaultOf(port, 'w1'), dir);
  assert.deepEqual(saved(tmp), { w1: { cwd: dir, label: 'proj' } });

  for (const [cwd, error] of [
    ['relative/dir', 'cwd_not_absolute'],
    [path.join(dir, 'nope'), 'cwd_not_found'],
  ]) {
    r = await post(port, '/api/workspaces/w1/dir', { cwd });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, error);
  }
  assert.equal(await defaultOf(port, 'w1'), dir, 'a bad folder changes nothing');
  r = await post(port, '/api/workspaces/nope/dir', { cwd: dir });
  assert.equal(r.status, 404);

  r = await post(port, '/api/workspaces/w1/dir', { cwd: '' });
  assert.equal(r.status, 200);
  assert.equal(await defaultOf(port, 'w1'), undefined);
  assert.deepEqual(saved(tmp), {});

  r = await post(port, '/api/workspaces', { cwd: dir, label: 'made' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(await defaultOf(port, r.body.workspace), dir);
  // The default is the page's to send: tab.create still gets only what was asked.
  await post(port, `/api/workspaces/${r.body.workspace}/tabs`, {});
  assert.ok(!('cwd' in tabCreates(herdr).at(-1)));
});

test('기본 폴더: a rename moves it along; a closed workspace\'s goes with it', async (t) => {
  const { port, herdr, tmp } = await start(t);
  const dir = fs.realpathSync(tmp);
  await post(port, '/api/workspaces/w1/dir', { cwd: dir });
  herdr.workspaces[0].label = 'renamed';
  await touch(port);
  assert.equal(await defaultOf(port, 'w1'), dir);
  await new Promise((r) => setTimeout(r, 100)); // the write after the refresh
  assert.deepEqual(saved(tmp), { w1: { cwd: dir, label: 'renamed' } });

  const w2 = (await post(port, '/api/workspaces', { cwd: dir, label: 'two' })).body.workspace;
  assert.equal(await defaultOf(port, w2), dir);
  herdr.workspaces.splice(1, 1); // closed in herdr
  await touch(port);
  await new Promise((r) => setTimeout(r, 100)); // the write after the refresh
  assert.deepEqual(Object.keys(saved(tmp)), ['w1']);
});

test('기본 폴더: one saved under another label (its id given to a new workspace while the Hub was down) is dropped', async (t) => {
  const { port, tmp } = await start(t, { data: { 'wsdirs.json': (d) => ({ w1: { cwd: fs.realpathSync(d), label: 'gone' }, w9: { cwd: '/x', label: 'w9' } }) } });
  assert.equal(await defaultOf(port, 'w1'), undefined);
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(saved(tmp), {});
});

test('기본 폴더: kept across a Hub restart when the workspace is the same', async (t) => {
  const { port } = await start(t, { data: { 'wsdirs.json': (d) => ({ w1: { cwd: fs.realpathSync(d), label: 'proj' } }) } });
  assert.ok(await defaultOf(port, 'w1'));
});

test('a Claude agent\'s folder is where its transcript says it works, if that folder is there', async (t) => {
  const SID = '0123abcd-0000-4000-8000-000000000001';
  const SID2 = '0123abcd-0000-4000-8000-000000000002';
  const { port, tmp } = await start(t, {
    before: (herdr, tmp) => {
      const real = fs.realpathSync(tmp);
      fs.mkdirSync(path.join(real, 'work'));
      const proj = path.join(real, 'claude', 'projects', '-x');
      fs.mkdirSync(proj, { recursive: true });
      const line = (cwd) => JSON.stringify({ type: 'user', cwd, message: { role: 'user', content: 'hi' } });
      fs.writeFileSync(path.join(proj, `${SID}.jsonl`), [line(real), line(path.join(real, 'work'))].join('\n') + '\n');
      fs.writeFileSync(path.join(proj, `${SID2}.jsonl`), line(path.join(real, 'removed-worktree')) + '\n');
      const agent = (pane, sid) => ({ pane_id: pane, workspace_id: 'w1', tab_id: 't1', agent: 'claude', agent_status: 'idle', cwd: real, agent_session: { kind: 'id', value: sid } });
      herdr.agents.push(agent('w1-p8', SID), agent('w1-p9', SID2));
    },
  });
  const real = fs.realpathSync(tmp);
  const agents = (await get(port, '/api/state')).agents;
  const by = (p) => agents.find((a) => a.pane === p);
  assert.equal(by('w1-p8').cwd, path.join(real, 'work'));
  assert.equal(by('w1-p8').paneCwd, real);
  assert.equal(by('w1-p9').cwd, real, 'a folder that is gone: the pane\'s');
  assert.equal(by('w1-p9').paneCwd, undefined);
});
