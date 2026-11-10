'use strict';
// 대기 중 취소 (POST /api/agents/<pane>/unqueue) through the real server, a fake herdr and a test
// playing Claude Code 2.1.31x: ↑ on an empty input pulls the whole queue back into it (logged as
// popAll), Ctrl+U clears it a line at a time, a prompt sent while it works queues (enqueue). And
// lib/claudequeue.js on its own, with a screen read from the real thing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { fakeHerdr } = require('./fixtures/fakeherdr');
const CQ = require('../lib/claudequeue');

const ROOT = path.join(__dirname, '..');
const SID = '3fa64cb5-2f4a-4087-ad06-b403d74de83a';
const RULE = '─'.repeat(60);

async function start(t, agents) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-unqueue-'));
  const sock = path.join(tmp, 'h.sock');
  const herdr = await fakeHerdr(sock);
  herdr.agents.push(...agents);
  const claudeDir = path.join(tmp, 'claude');
  fs.mkdirSync(path.join(claudeDir, 'projects', '-work'), { recursive: true });
  const file = path.join(claudeDir, 'projects', '-work', `${SID}.jsonl`);
  fs.writeFileSync(file, JSON.stringify({ type: 'user', message: { role: 'user', content: 'Run the long thing' } }) + '\n');
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
      HERDR_HUB_HOST_ID: 'unqueue',
      HERDR_HUB_PEERS: '',
      HERDR_HUB_DATA: path.join(tmp, 'data'),
      HERDR_HUB_UPLOADS: path.join(tmp, 'uploads'),
      CLAUDE_CONFIG_DIR: claudeDir,
      HERDR_SOCKET: sock,
      HERDR_HUB_WATCHDOG_MS: '0',
      HERDR_HUB_UNQUEUE_STEP_MS: '20',
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
  return { port, herdr, file };
}

// Claude Code at work on pane, with `queued` waiting. typed: what sits in its input at first.
// pull: what ↑ does (default: the real thing). Returns its state, to look at afterwards.
function playClaude(herdr, file, pane, queued, { typed = '', pull = null } = {}) {
  const st = { queue: [], box: typed, sent: [] };
  const log = (operation, content) =>
    fs.appendFileSync(file, JSON.stringify({ type: 'queue-operation', operation, timestamp: new Date().toISOString(), sessionId: SID, ...(content != null ? { content } : {}) }) + '\n');
  const draw = () => {
    const box = st.box ? st.box.split('\n').map((l, i) => (i ? `  ${l}` : `❯ ${l}`)) : [st.queue.length ? '❯ Press up to edit queued messages' : '❯ '];
    herdr.screens[pane] = ['⏺ Running the long thing', ...st.queue.map((q) => `❯ ${q}`), '  ctrl+enter to send now', '✶ Drizzling… (20s)', RULE, ...box, RULE, '  ⏵⏵ auto mode on (shift+tab to cycle)'].join('\n');
  };
  const enqueue = (c) => {
    st.queue.push(c);
    log('enqueue', c);
  };
  queued.forEach(enqueue);
  herdr.on['agent.send_keys'] = ({ target, keys }) => {
    if (target !== pane) return;
    for (const k of keys) {
      if (k === 'up' && pull) pull(st, log);
      else if (k === 'up' && !st.box && st.queue.length) {
        for (const c of st.queue.filter((q) => !q.startsWith('<'))) log('popAll', c);
        st.box = st.queue.filter((c) => !c.startsWith('<')).join('\n');
        st.queue = st.queue.filter((c) => c.startsWith('<'));
      } else if (k === 'ctrl+u') st.box = st.box.endsWith('\n') ? st.box.slice(0, -1) : st.box.slice(0, st.box.lastIndexOf('\n') + 1);
    }
    draw();
  };
  herdr.on['agent.prompt'] = ({ target, text }) => {
    if (target !== pane) return;
    st.sent.push(text);
    enqueue(text);
    draw();
  };
  draw();
  return st;
}

function post(port, p, body) {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
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

const agent = (pane, kind, status, session = SID) => ({ pane_id: pane, workspace_id: 'w1', tab_id: 't1', agent: kind, agent_status: status, cwd: '/work', agent_session: { kind: 'id', value: session } });
const keysTo = (herdr, pane) => herdr.calls.filter((c) => c.method === 'agent.send_keys' && c.params.target === pane).flatMap((c) => c.params.keys);
const promptsTo = (herdr, pane) => herdr.calls.filter((c) => c.method === 'agent.prompt' && c.params.target === pane).map((c) => c.params.text);

test('unqueue: the middle one of three; ↑, Ctrl+U until empty, the other two again in their order; no Esc', async (t) => {
  const { port, herdr, file } = await start(t, [agent('w1-p2', 'claude', 'working')]);
  const st = playClaude(herdr, file, 'w1-p2', ['QA say alpha', 'QB say bravo\nand more', 'QC say charlie']);
  assert.deepEqual(await post(port, '/api/agents/w1-p2/unqueue', { text: 'QB say  bravo and more' }), { status: 200, body: { ok: true, kept: 2 } });
  const keys = keysTo(herdr, 'w1-p2');
  assert.equal(keys[0], 'up');
  assert.ok(keys.slice(1).every((k) => k === 'ctrl+u') && keys.length > 8, keys.join(' '));
  assert.ok(!keys.includes('esc') && !keys.includes('escape'), 'never Esc: it stops the turn');
  assert.deepEqual(promptsTo(herdr, 'w1-p2'), ['QA say alpha', 'QC say charlie']);
  assert.deepEqual(st.queue, ['QA say alpha', 'QC say charlie']);
  assert.equal(st.box, '');
  // The keys came before the prompts.
  const order = herdr.calls.filter((c) => ['agent.send_keys', 'agent.prompt'].includes(c.method)).map((c) => c.method);
  assert.equal(order.lastIndexOf('agent.send_keys') < order.indexOf('agent.prompt'), true);
});

test('unqueue: the only one queued, a harness note queued too stays; nothing sent again', async (t) => {
  const { port, herdr, file } = await start(t, [agent('w1-p2', 'claude', 'working')]);
  const st = playClaude(herdr, file, 'w1-p2', ['<task-notification>done</task-notification>', 'only me']);
  assert.deepEqual(await post(port, '/api/agents/w1-p2/unqueue', { text: 'only me' }), { status: 200, body: { ok: true, kept: 0 } });
  assert.deepEqual(promptsTo(herdr, 'w1-p2'), []);
  assert.deepEqual(st.queue, ['<task-notification>done</task-notification>']);
});

test('unqueue refusals press nothing: not at work, not Claude, not queued, typed input, a photo in another', async (t) => {
  const { port, herdr, file } = await start(t, [agent('w1-p2', 'claude', 'working'), agent('w1-p3', 'claude', 'idle'), agent('w1-p4', 'codex', 'working')]);
  playClaude(herdr, file, 'w1-p2', ['QA say alpha', 'QB say bravo']);
  assert.deepEqual(await post(port, '/api/agents/w1-p3/unqueue', { text: 'QA say alpha' }), { status: 409, body: { error: 'not_queued' } });
  assert.deepEqual(await post(port, '/api/agents/w1-p4/unqueue', { text: 'QA say alpha' }), { status: 400, body: { error: 'not_claude' } });
  assert.equal((await post(port, '/api/agents/w1-p9/unqueue', { text: 'x' })).status, 404);
  assert.deepEqual(await post(port, '/api/agents/w1-p2/unqueue', { text: '' }), { status: 400, body: { error: 'empty_text' } });
  assert.deepEqual(await post(port, '/api/agents/w1-p2/unqueue', { text: 'never sent' }), { status: 409, body: { error: 'not_queued' } });
  assert.deepEqual(keysTo(herdr, 'w1-p2'), []);

  // Someone typing in Claude Code's own input: ↑ would walk it, not the queue.
  playClaude(herdr, file, 'w1-p2', [], { typed: 'half a thought' });
  assert.deepEqual(await post(port, '/api/agents/w1-p2/unqueue', { text: 'QA say alpha' }), { status: 409, body: { error: 'input_busy' } });
  playClaude(herdr, file, 'w1-p2', ['look [Image #1]']);
  assert.deepEqual(await post(port, '/api/agents/w1-p2/unqueue', { text: 'QA say alpha' }), { status: 409, body: { error: 'images_queued' } });
  assert.deepEqual(keysTo(herdr, 'w1-p2'), []);
  assert.deepEqual(promptsTo(herdr, 'w1-p2'), []);
});

test('unqueue: ↑ pulled back something else than it logged: unsure, the input left as it is, nothing sent', async (t) => {
  const { port, herdr, file } = await start(t, [agent('w1-p2', 'claude', 'working')]);
  const st = playClaude(herdr, file, 'w1-p2', ['QA say alpha', 'QB say bravo'], {
    pull: (s, log) => {
      for (const c of s.queue) log('popAll', c);
      s.box = 'QA say alpha\nsomething else';
      s.queue = [];
    },
  });
  assert.deepEqual(await post(port, '/api/agents/w1-p2/unqueue', { text: 'QB say bravo' }), { status: 409, body: { error: 'unsure' } });
  assert.deepEqual(keysTo(herdr, 'w1-p2'), ['up']);
  assert.deepEqual(promptsTo(herdr, 'w1-p2'), []);
  assert.equal(st.box, 'QA say alpha\nsomething else');
});

test('unqueue: taken between the read and ↑ (nothing pulled, the input empty): not_queued, nothing more pressed', async (t) => {
  const { port, herdr, file } = await start(t, [agent('w1-p2', 'claude', 'working')]);
  playClaude(herdr, file, 'w1-p2', ['QA say alpha'], {
    pull: (s, log) => {
      log('remove', 'QA say alpha');
      s.queue = [];
    },
  });
  assert.deepEqual(await post(port, '/api/agents/w1-p2/unqueue', { text: 'QA say alpha' }), { status: 409, body: { error: 'not_queued' } });
  assert.deepEqual(keysTo(herdr, 'w1-p2'), ['up']);
  assert.deepEqual(promptsTo(herdr, 'w1-p2'), []);
});

test('claudequeue: the queue from the transcript, the input box from a real screen, a bubble against a prompt', () => {
  const ops = CQ.queueOps(
    [
      { type: 'queue-operation', operation: 'enqueue', content: 'a' },
      { type: 'user', message: { content: 'x' } },
      { type: 'queue-operation', operation: 'enqueue', content: 'b' },
      { type: 'queue-operation', operation: 'enqueue', content: 'c' },
      { type: 'queue-operation', operation: 'dequeue' },
      { type: 'queue-operation', operation: 'remove', content: 'c' },
      { type: 'queue-operation', operation: 'remove', content: 'never seen' },
    ]
      .map((e) => JSON.stringify(e))
      .join('\n') + '\n{"type":"queue-operation","operation":"enq'
  );
  assert.deepEqual(CQ.replay(ops), ['b']);
  assert.deepEqual(CQ.replay([{ op: 'popAll', content: 'b' }], ['b']), []);

  // Claude Code 2.1.322, three prompts pulled back by ↑ (read with herdr agent read --source visible).
  const screen = `⏺ Running 18 ticks with 5-second sleeps in foreground · 18s
  ⎿  $ for i in $(seq 18); do echo tick $i; sleep 5; done (18s · 5 lines)
     (ctrl+b to run in background)

✶ Drizzling… (20s · ↓ 241 tokens)
                                                                                            ctrl+g to edit in VS Code
───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
❯ QA say alpha
  QB say bravo
  QC say charlie
───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  ⏵⏵ auto mode on (shift+tab to cycle)
`;
  assert.equal(CQ.promptBox(screen), 'QA say alpha\nQB say bravo\nQC say charlie');
  assert.ok(CQ.boxHolds(CQ.promptBox(screen), ['QA say alpha', 'QB say bravo', 'QC say charlie']));
  // Queued ones drawn above the spinner also start with ❯, but not under a rule.
  const queued = `❯ QA say alpha
❯ QB say bravo
  ctrl+enter to send now
✢ Drizzling… (17s · ↓ 241 tokens)
${RULE}
❯ Press up to edit queued messages
${RULE}
  ⏵⏵ auto mode on (shift+tab to cycle) · esc to interrupt`;
  assert.equal(CQ.promptBox(queued), 'Press up to edit queued messages');
  assert.ok(CQ.boxEmpty(CQ.promptBox(queued)));
  assert.ok(CQ.boxEmpty(CQ.promptBox(`${RULE}\n❯ \n${RULE}\n  x`)));
  assert.equal(CQ.promptBox('no prompt here'), null);

  assert.ok(CQ.sameQueued('fix  this\n/home/k/herdr-hub-uploads/20261110-163000-0123abcd.jpg', 'fix this'));
  assert.ok(CQ.sameQueued('fix  this\n/home/k/.local/share/herdr-hub/data/uploads/20261110-163000-0123abcd.jpg', 'fix this')); // data/uploads since 1.0.300
  assert.ok(CQ.sameQueued('fix this [Image #1]', 'fix this'));
  assert.ok(!CQ.sameQueued('fix that', 'fix this'));
  assert.ok(CQ.typed('fix') && !CQ.typed('<task-notification>x</task-notification>'));
});
