'use strict';
// 지금 보내기 (POST /api/agents/<pane>/sendnow) through the real server (fake herdr): Claude Code's
// chat:sendNow as Ctrl+X Ctrl+S, only to a Claude agent at work; and the composer's key for it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { fakeHerdr } = require('./fixtures/fakeherdr');
const { enterAction } = require('../public/keys.js');
const KM = require('../public/keymap.js');

const ROOT = path.join(__dirname, '..');

async function start(t, agents) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-sendnow-'));
  const sock = path.join(tmp, 'h.sock');
  const herdr = await fakeHerdr(sock);
  herdr.agents.push(...agents);
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
      HERDR_HUB_HOST_ID: 'sendnow',
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
  while (!herdr.calls.some((c) => c.method === 'agent.list')) await new Promise((r) => setTimeout(r, 20));
  await new Promise((r) => setTimeout(r, 100));
  return { port, herdr };
}

function post(port, p) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: p, method: 'POST', headers: { Host: `127.0.0.1:${port}`, 'X-Herdr-Hub': '1', 'Content-Type': 'application/json', 'Content-Length': 2 } },
      (res) => {
        let s = '';
        res.on('data', (d) => (s += d));
        res.on('end', () => resolve({ status: res.statusCode, body: s ? JSON.parse(s) : null }));
      }
    );
    req.on('error', reject);
    req.end('{}');
  });
}

test('sendnow: Ctrl+X Ctrl+S to a working Claude agent; nothing while idle; not another kind', async (t) => {
  const agent = (pane, kind, status) => ({ pane_id: pane, workspace_id: 'w1', tab_id: 't1', agent: kind, agent_status: status, cwd: '/' });
  const { port, herdr } = await start(t, [agent('w1-p2', 'claude', 'working'), agent('w1-p3', 'claude', 'idle'), agent('w1-p4', 'codex', 'working')]);
  const sent = () => herdr.calls.filter((c) => c.method === 'agent.send_keys');

  assert.deepEqual(await post(port, '/api/agents/w1-p2/sendnow'), { status: 200, body: { ok: true, sent: true } });
  assert.deepEqual(sent().map((c) => c.params), [{ target: 'w1-p2', keys: ['ctrl+x', 'ctrl+s'] }]);

  assert.deepEqual(await post(port, '/api/agents/w1-p3/sendnow'), { status: 200, body: { ok: true, sent: false } });
  assert.deepEqual(await post(port, '/api/agents/w1-p4/sendnow'), { status: 400, body: { error: 'not_claude' } });
  assert.equal((await post(port, '/api/agents/w1-p9/sendnow')).status, 404);
  assert.equal(sent().length, 1, 'only the working Claude agent got keys');
});

test('the composer: ⌘/Ctrl+Enter on an empty field is 지금 보내기; plain Enter never', () => {
  const key = (k, mods = {}) => ({ key: k, keyCode: 0, isComposing: false, ...mods });
  for (const mode of ['send', 'newline']) {
    assert.equal(enterAction(key('Enter', { ctrlKey: true }), mode, true), 'send-queued');
    assert.equal(enterAction(key('Enter', { metaKey: true }), mode, true), 'send-queued');
    // Something typed (or a photo): the chord sends it, as before.
    assert.equal(enterAction(key('Enter', { ctrlKey: true }), mode, false), 'send');
    assert.equal(enterAction(key('Enter', { ctrlKey: true }), mode), 'send');
  }
  // A plain Enter on an empty field sends (nothing), it never cuts a turn short.
  assert.equal(enterAction(key('Enter'), 'send', true), 'send');
  assert.equal(enterAction(key('Enter'), 'newline', true), 'newline');
  // A syllable still being composed is not an empty field's.
  assert.equal(enterAction(key('Enter', { isComposing: true, ctrlKey: true }), 'send', true), 'send-later');
});

test('the 단축키 page lists 지금 보내기 under 메시지 칸 with the send chord, and the table does not bind it', () => {
  const row = KM.LOCAL.find((x) => x.name === '지금 보내기');
  assert.ok(row && row.group === '메시지 칸');
  assert.equal(KM.localTab(row), 'chat');
  assert.deepEqual(KM.localKeys(row), ['Ctrl+Enter']);
  assert.equal(KM.match({ key: 'Enter', ctrlKey: true }, { field: true }), null); // the composer takes it
});
