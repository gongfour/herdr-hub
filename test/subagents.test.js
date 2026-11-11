'use strict';
// Subagents (the Agent tool): their lines in the chat (lib/transcript.js), the ones running now
// (lib/subagents.js), what that does to the status, the clock and the 완료 notification, and the
// state and route on a host and through a hub. The files are laid out as Claude Code 2.1.322 does.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const T = require('../lib/transcript');
const Sub = require('../lib/subagents');
const times = require('../lib/times');
const notify = require('../lib/notify');
const RowText = require('../public/rowtext');
const Inbox = require('../public/inbox');
const { startHub } = require('./fixtures/hub');

const line = (o) => JSON.stringify(o);
const SID = '11111111-2222-3333-4444-555555555555';
const at = (ms) => new Date(ms).toISOString();
const T0 = Date.parse('2026-11-11T07:00:00Z');

// A task notification as Claude Code writes it.
const noteText = ({ task, tool, status = 'completed', summary }) =>
  `<task-notification>\n<task-id>${task}</task-id>\n<tool-use-id>${tool}</tool-use-id>\n<output-file>/tmp/x/tasks/${task}.output</output-file>\n<status>${status}</status>\n<summary>${summary}</summary>\n<note>A task-notification fires each time this agent stops.</note>\n</task-notification>`;
const noteAttachment = (o, ms) => line({ type: 'attachment', uuid: `n-${o.task}-${ms}`, timestamp: at(ms), attachment: { type: 'queued_command', prompt: noteText(o), commandMode: 'task-notification', origin: { kind: 'task-notification' } } });
const noteUser = (o, ms) => line({ type: 'user', uuid: `u-${o.task}-${ms}`, timestamp: at(ms), origin: { kind: 'task-notification' }, message: { role: 'user', content: noteText(o) } });
const agentUse = (id, toolId, desc, type = 'general-purpose') => line({ type: 'assistant', uuid: `x${id}`, timestamp: at(T0), message: { id, content: [{ type: 'tool_use', id: toolId, name: 'Agent', input: { description: desc, subagent_type: type, prompt: 'Do the thing', run_in_background: true } }] } });
const launched = (toolId, agentId) =>
  line({
    type: 'user',
    uuid: `r-${toolId}`,
    timestamp: at(T0 + 100),
    toolUseResult: { isAsync: true, status: 'async_launched', agentId, description: 'x', prompt: 'Do the thing' },
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content: [{ type: 'text', text: 'Async agent launched successfully.\nagentId: ' + agentId }] }] },
  });

test('chat: an Agent line carries its subagent and how it ended; a notice is one line where it came', () => {
  const text = [
    line({ type: 'user', uuid: 'u1', timestamp: at(T0 - 1000), message: { role: 'user', content: '리뷰 둘 돌려' } }),
    agentUse('m1', 'tu1', 'Security review', 'Explore'),
    launched('tu1', 'a111'),
    agentUse('m2', 'tu2', 'Code review'),
    launched('tu2', 'a222'),
    line({ type: 'assistant', uuid: 'xm3', timestamp: at(T0 + 200), message: { id: 'm3', content: [{ type: 'tool_use', id: 'tu3', name: 'Bash', input: { command: 'npm test', run_in_background: true, description: 'Run the tests' } }] } }),
    line({ type: 'user', uuid: 'r3', timestamp: at(T0 + 300), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu3', content: 'Command running in background with ID: b123' }] } }),
    // Logged twice for one stop (mid-turn attachment, then the turn it started): one line.
    noteAttachment({ task: 'a111', tool: 'tu1', summary: 'Agent "Security review" finished' }, T0 + 60e3),
    noteUser({ task: 'a111', tool: 'tu1', summary: 'Agent "Security review" finished' }, T0 + 61e3),
    noteUser({ task: 'b123', tool: 'tu3', status: 'failed', summary: 'Background command "Run the tests" failed' }, T0 + 70e3),
    // A notice quoted in a tool's output (a grep of a transcript) is not one.
    line({ type: 'assistant', uuid: 'xm4', timestamp: at(T0 + 80e3), message: { id: 'm4', content: [{ type: 'tool_use', id: 'tu4', name: 'Bash', input: { command: 'grep task-notification x.jsonl' } }] } }),
    line({ type: 'user', uuid: 'r4', timestamp: at(T0 + 81e3), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu4', content: noteText({ task: 'a222', tool: 'tu2', summary: 'Agent "Code review" finished' }) }] } }),
    // Nor is one in a message someone typed (it doesn't start the message).
    line({ type: 'user', uuid: 'u2', timestamp: at(T0 + 90e3), message: { role: 'user', content: `이거 봐 ${noteText({ task: 'a222', tool: 'tu2', summary: 'Agent "Code review" finished' })}` } }),
  ].join('\n');
  const m = T.parse(text);
  const tools = m.flatMap((x) => x.tools || []);
  const sec = tools.find((t) => t.summary === 'Security review');
  assert.deepEqual(sec, { name: 'Agent', summary: 'Security review', type: 'Explore', agent: 'a111', async: true, state: 'completed' });
  // Launched, no notice yet: its id, no state, and not the launch's fixed text as a result.
  const code = tools.find((t) => t.summary === 'Code review');
  assert.deepEqual(code, { name: 'Agent', summary: 'Code review', type: 'general-purpose', agent: 'a222', async: true });
  assert.equal(tools.find((t) => t.name === 'Bash' && t.summary === 'Run the tests').state, 'failed');
  const tasks = m.filter((x) => x.role === 'task');
  assert.deepEqual(
    tasks.map(({ id, ts, ...x }) => x),
    [
      { role: 'task', status: 'completed', text: 'Security review', sub: true, task: 'a111' },
      { role: 'task', status: 'failed', text: 'Run the tests', task: 'b123' },
    ],
  );
  // No notice became a message of its own (the typed one stays the person's).
  assert.equal(m.filter((x) => x.role === 'user').length, 2);
  assert.equal(code.state, undefined);
});

test('chat: a notice beside a tool result still brings that result; one whose Agent line is not in the part read says what it says', () => {
  const text = [
    line({ type: 'assistant', uuid: 'xm1', timestamp: at(T0), message: { id: 'm1', content: [{ type: 'tool_use', id: 'tu9', name: 'Bash', input: { command: 'ls' } }] } }),
    line({
      type: 'user',
      uuid: 'r9',
      timestamp: at(T0 + 10),
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu9', content: 'a.txt' }, { type: 'text', text: `<tools-used-before-summary>SubagentHandback</tools-used-before-summary>\n[SYSTEM NOTIFICATION - NOT USER INPUT]\n${noteText({ task: 'a333', tool: 'tu8', summary: 'Agent "Old one" finished' })}` }] },
    }),
  ].join('\n');
  const m = T.parse(text);
  assert.equal(m[0].tools[0].result, 'a.txt');
  // Its Agent line isn't in this part: the line says what the notice says.
  assert.deepEqual(m.slice(1).map(({ id, ts, ...x }) => x), [{ role: 'task', status: 'completed', text: 'Agent "Old one" finished', sub: true, task: 'a333' }]);
});

test('chat: older pages join a notice to its Agent line across the cut', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-hub-sub-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 's.jsonl');
  const pad = (i) => line({ type: 'user', uuid: `p${i}`, timestamp: at(T0 + i), message: { role: 'user', content: `filler ${i} ${'x'.repeat(300)}` } });
  const lines = [agentUse('m1', 'tu1', 'Far review'), launched('tu1', 'a444')];
  for (let i = 0; i < 40; i++) lines.push(pad(i));
  lines.push(noteUser({ task: 'a444', tool: 'tu1', summary: 'Agent "Far review" finished' }, T0 + 100e3));
  fs.writeFileSync(file, lines.join('\n') + '\n');
  T._setChunk(2048);
  t.after(() => T._setChunk(2 * 1024 * 1024));
  const last = T.parse(lines.slice(-1).join('\n'));
  let before = last[last.length - 1].id;
  let found = null;
  for (let i = 0; i < 30 && !found; i++) {
    const p = await T.pageBefore(file, before, 10);
    const tool = p.messages.flatMap((x) => x.tools || []).find((x) => x.agent === 'a444');
    if (tool) found = tool;
    if (p.messages.length) before = p.messages[0].id;
    if (!p.more) break;
  }
  assert.ok(found, 'the Agent line was reached');
  assert.equal(found.state, 'completed');
});

// A session with subagents, as Claude Code lays it out.
function sessionDir(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-hub-subs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const proj = path.join(root, 'projects', '-work');
  const dir = path.join(proj, SID, 'subagents');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(proj, `${SID}.jsonl`);
  fs.writeFileSync(file, '');
  const side = (id, entries) => fs.writeFileSync(path.join(dir, `agent-${id}.jsonl`), entries.map((e) => line({ isSidechain: true, agentId: id, ...e })).join('\n') + '\n');
  const meta = (id, m) => fs.writeFileSync(path.join(dir, `agent-${id}.meta.json`), JSON.stringify({ agentType: 'general-purpose', spawnDepth: 1, requestShape: 'background', ...m }));
  const touch = (id, ms) => fs.utimesSync(path.join(dir, `agent-${id}.jsonl`), ms / 1000, ms / 1000);
  return { root, file, dir, side, meta, touch };
}
const work = (id, tools, words = '') => [
  { type: 'user', uuid: `${id}-u`, timestamp: at(T0), message: { role: 'user', content: 'You are reviewing …' } },
  ...tools.map((tl, i) => ({ type: 'assistant', uuid: `${id}-a${i}`, timestamp: at(T0 + i), message: { id: `${id}-m${i}`, content: [{ type: 'tool_use', id: `${id}-t${i}`, ...tl }] } })),
  ...(words ? [{ type: 'assistant', uuid: `${id}-w`, timestamp: at(T0 + 99), message: { id: `${id}-mw`, content: [{ type: 'text', text: words }] } }] : []),
];

test('running: no finished, written lately and not notified since; the rest are not', async (t) => {
  const s = sessionDir(t);
  const now = Date.now();
  s.meta('a1', { description: 'Review keymap' });
  s.side('a1', work('a1', [{ name: 'Read', input: { file_path: '/w/public/keymap.js' } }, { name: 'Bash', input: { command: 'npm test', description: 'Run the tests' } }]));
  s.meta('a2', { description: 'Done one', finished: true });
  s.side('a2', work('a2', [{ name: 'Read', input: { file_path: '/w/x.js' } }]));
  s.meta('a3', { description: 'Gone quiet' }); // killed with its session: never says it stopped
  s.side('a3', work('a3', []));
  s.touch('a3', now - Sub.STALE_MS - 60e3);
  s.meta('a4', { description: 'Notified' });
  s.side('a4', work('a4', []));
  s.touch('a4', now - 30e3);
  s.meta('a5', { description: 'Nested', agentType: 'Explore', spawnDepth: 2, parentAgentId: 'a1' });
  s.side('a5', work('a5', [{ name: 'Grep', input: { pattern: 'subagent' } }]));
  fs.writeFileSync(path.join(s.dir, 'notes.txt'), 'not a subagent');
  const r = Sub.reader({ now: () => now });
  const list = await r.running(s.file, { a4: now - 20e3 });
  assert.deepEqual(list.map((x) => x.id).sort(), ['a1', 'a5']);
  const a1 = list.find((x) => x.id === 'a1');
  assert.equal(a1.desc, 'Review keymap');
  assert.equal(a1.type, 'general-purpose');
  assert.equal(a1.tool, 'Bash: Run the tests');
  assert.equal(typeof a1.since, 'number');
  assert.equal(a1.depth, undefined);
  assert.deepEqual({ type: list.find((x) => x.id === 'a5').type, depth: list.find((x) => x.id === 'a5').depth }, { type: 'Explore', depth: 2 });
  // It finishes: gone from the list (the meta says so).
  s.meta('a1', { description: 'Review keymap', finished: true });
  const later = new Date(Date.now() + 2000);
  fs.utimesSync(path.join(s.dir, 'agent-a1.meta.json'), later, later);
  assert.deepEqual((await r.running(s.file, {})).map((x) => x.id), ['a5']);
  // A session with no subagents folder (most), or one Claude Code lays out otherwise: none.
  assert.deepEqual(await r.running(path.join(s.root, 'projects', '-work', 'other.jsonl'), {}), []);
});

test('log: its tool lines, its report (or its last words while running), unknown ids', async (t) => {
  const s = sessionDir(t);
  s.meta('a1', { description: 'Review keymap' });
  s.side('a1', [
    ...work('a1', [{ name: 'Read', input: { file_path: '/w/public/keymap.js' } }, { name: 'Bash', input: { command: 'npm test', description: 'Run the tests' } }], '테스트를 돌리는 중입니다.'),
  ]);
  const r = Sub.reader();
  const running = await r.log(s.file, 'a1', {});
  assert.equal(running.found, true);
  assert.equal(running.running, true);
  assert.deepEqual(running.tools, [{ name: 'Read', summary: 'keymap.js · w/public' }, { name: 'Bash', summary: 'Run the tests' }]);
  assert.equal(running.report, '테스트를 돌리는 중입니다.');
  s.meta('a2', { description: 'Done one', finished: true });
  s.side('a2', work('a2', [{ name: 'Edit', input: { file_path: '/w/a.js' } }, { name: 'SubagentHandback', input: { message: '## 결과\n- a.js 고침' } }], 'ignored'));
  const done = await r.log(s.file, 'a2', {});
  assert.equal(done.running, false);
  assert.deepEqual(done.tools, [{ name: 'Edit', summary: 'a.js · w' }]);
  assert.equal(done.report, '## 결과\n- a.js 고침');
  assert.deepEqual(await r.log(s.file, 'nope', {}), { found: false });
  assert.deepEqual(await r.log(s.file, '../../etc', {}), { found: false });
});

test('a turn that ends while its subagents run: still in turn for the clock, no 완료 yet, shown as theirs', () => {
  const subs = [{ id: 'a1', type: 'general-purpose', desc: 'x', since: 1 }];
  // The clock: working from 1500, idle with subagents at 2000 (no finish), idle without at 3000 (finish).
  let m = times.track(new Map(), [{ pane: 'p', status: 'idle' }], 1000, (a) => a.pane);
  m = times.track(m, [{ pane: 'p', status: 'working' }], 1500, (a) => a.pane);
  const waiting = { pane: 'p', status: 'idle', subagents: subs };
  m = times.track(m, [waiting], 2000, (a) => a.pane);
  assert.equal(waiting.doneAt, null);
  assert.equal(waiting.workingSince, 1500);
  const back = { pane: 'p', status: 'working' };
  m = times.track(m, [back], 2500, (a) => a.pane);
  assert.equal(back.workingSince, 1500, 'the same turn');
  const finished = { pane: 'p', status: 'idle' };
  times.track(m, [finished], 3000, (a) => a.pane);
  assert.equal(finished.doneAt, 3000);
  // The 완료 notification: not while they run (herdr 0.9.3's working -> done, or a newer completion).
  assert.equal(notify.transitionKind({ status: 'working' }, { status: 'done', subagents: subs }), null);
  assert.equal(notify.transitionKind({ status: 'working', completion: 1 }, { status: 'idle', completion: 2, subagents: subs }), null);
  assert.equal(notify.transitionKind({ status: 'working', completion: 2 }, { status: 'idle', completion: 3 }), 'done');
  // A question still notifies.
  assert.equal(notify.transitionKind({ status: 'idle' }, { status: 'blocked', subagents: subs }), 'blocked');
  // On the page: 'sub', counted, no unread finish.
  assert.equal(RowText.shownStatus({ status: 'idle', subagents: subs }), 'sub');
  assert.equal(RowText.shownStatus({ status: 'done', subagents: subs }), 'sub');
  assert.equal(RowText.shownStatus({ status: 'working', subagents: subs }), 'working');
  assert.equal(RowText.shownStatus({ status: 'blocked', subagents: subs }), 'blocked');
  assert.equal(RowText.subsOf({ status: 'idle', subagents: subs }), 1);
  assert.equal(RowText.subsOf({ status: 'idle' }), 0);
  assert.equal(Inbox.unread({ pane: 'p', status: 'idle', doneAt: Date.now(), subagents: subs }), false);
  assert.equal(Inbox.unread({ pane: 'p', status: 'idle', doneAt: Date.now() }), true);
});

test('hub: running subagents in the state and their work through the route, on the host and through a hub', async (t) => {
  const claude = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-claude-'));
  t.after(() => fs.rmSync(claude, { recursive: true, force: true }));
  const proj = path.join(claude, 'projects', '-work');
  const dir = path.join(proj, SID, 'subagents');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(proj, `${SID}.jsonl`), [agentUse('m1', 'tu1', 'Review keymap'), launched('tu1', 'a1')].join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'agent-a1.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'Review keymap', toolUseId: 'tu1', spawnDepth: 1 }));
  fs.writeFileSync(path.join(dir, 'agent-a1.jsonl'), work('a1', [{ name: 'Grep', input: { pattern: 'keymap' } }]).map((e) => line({ isSidechain: true, ...e })).join('\n') + '\n');
  const agent = { pane_id: 'w1-p2', workspace_id: 'w1', tab_id: 't1', agent: 'claude', agent_status: 'idle', cwd: '/work', agent_session: { kind: 'id', value: SID } };
  const peer = await startHub(t, { id: 'ps', agents: [agent], env: { CLAUDE_CONFIG_DIR: claude } });
  const hub = await startHub(t, { id: 'hs', env: { HERDR_HUB_PEERS: `ps=http://127.0.0.1:${peer.port}` } });
  const until = async (fn, what) => {
    for (let i = 0; i < 200; i++) {
      const v = await fn();
      if (v) return v;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`timed out: ${what}`);
  };
  const subsOn = async (h, host) => ((await h.request('GET', '/api/state')).body.agents.find((a) => a.pane === 'w1-p2' && (!host || a.host === host)) || {}).subagents;
  const subs = await until(() => subsOn(peer), 'subagents on the host');
  assert.deepEqual(subs.map(({ since, ...x }) => x), [{ id: 'a1', type: 'Explore', desc: 'Review keymap', tool: 'Grep: keymap' }]);
  assert.deepEqual(await until(() => subsOn(hub, 'ps'), 'subagents through the hub'), subs);
  const log = (await peer.request('GET', '/api/agents/w1-p2/subagents/a1')).body;
  assert.deepEqual({ found: log.found, running: log.running, type: log.type, tools: log.tools }, { found: true, running: true, type: 'Explore', tools: [{ name: 'Grep', summary: 'keymap' }] });
  const through = await hub.request('GET', '/api/peers/ps/agents/w1-p2/subagents/a1');
  assert.equal(through.status, 200);
  assert.deepEqual(through.body, log);
  assert.deepEqual((await peer.request('GET', '/api/agents/w1-p2/subagents/zz9')).body, { supported: true, found: false });
  // It finishes: gone from the state.
  fs.writeFileSync(path.join(dir, 'agent-a1.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'Review keymap', toolUseId: 'tu1', spawnDepth: 1, finished: true }));
  await until(async () => (await subsOn(peer)) === undefined, 'gone once finished');
});
