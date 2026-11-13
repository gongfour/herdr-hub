'use strict';
// 중단 (POST agents/:pane/stop) and Claude Code's input box (lib/claudequeue.js promptBoxAnsi):
// Esc only to an agent at work and not to a dialog, read again until it stops; a message refused
// while words are typed in the terminal's input box (input_busy), Claude's grey suggestion there
// read as none and offered (GET agents/:pane/input).
const test = require('node:test');
const assert = require('node:assert/strict');
const CQ = require('../lib/claudequeue');
const { hubInProcess, until } = require('./fixtures/hub');

const RULE = '─'.repeat(40);
const screen = (row) => ['● Done.', '', RULE, row, RULE, '  ? for shortcuts'].join('\n');
// As herdr reads a real Claude Code 2.1 screen with format ansi (each row ends in \r).
const EMPTY = screen('❯ \r');
const SUGGESTED = screen('❯ \u001b[0m\u001b[2mrun the tests again\u001b[0m\r');
const TYPED = screen('❯ half a mess\r');
const DIALOG = 'Teach auto mode about your environment?\n\n❯ Continue\n  Skip\n\nEnter to select · ↑/↓ to navigate · Esc to cancel';

test('promptBoxAnsi: typed words, Claude\'s grey suggestion, its cursor, its tip, an IDE pill', () => {
  assert.deepEqual(CQ.promptBoxAnsi(EMPTY), { typed: '', grey: null });
  assert.deepEqual(CQ.promptBoxAnsi(SUGGESTED), { typed: '', grey: 'run the tests again' });
  assert.deepEqual(CQ.promptBoxAnsi(TYPED), { typed: 'half a mess', grey: null });
  // Claude's own cursor (inverse) on the suggestion's first letter, or on a typed one.
  assert.deepEqual(CQ.promptBoxAnsi(screen('❯ \u001b[7mr\u001b[0m\u001b[2mun it\u001b[0m')), { typed: '', grey: 'run it' });
  assert.deepEqual(CQ.promptBoxAnsi(screen('❯ \u001b[7mh\u001b[0m')), { typed: 'h', grey: null });
  // Coloured words are typed (the 2 of 38;2;r;g;b is no dim).
  assert.deepEqual(CQ.promptBoxAnsi(screen('❯ \u001b[38;2;2;2;2mhi\u001b[0m')), { typed: 'hi', grey: null });
  // The new-session tip and the queued-messages hint: grey, but no suggestion.
  assert.deepEqual(CQ.promptBoxAnsi(screen('❯ \u001b[2mTry "how does x work?"\u001b[0m')), { typed: '', grey: null });
  assert.deepEqual(CQ.promptBoxAnsi(screen('❯ \u001b[2mPress up to edit queued messages\u001b[0m')), { typed: '', grey: null });
  // An editor's pill after the ❯ is no input.
  assert.deepEqual(CQ.promptBoxAnsi(screen('❯ \u001b[38;2;1;2;3m[⧉ In src/x.ts]\u001b[0m \u001b[2mfix it\u001b[0m')), { typed: '', grey: 'fix it' });
  assert.equal(CQ.promptBoxAnsi('no box here'), null);
  assert.equal(CQ.stripAnsi(SUGGESTED), screen('❯ run the tests again'));
});

const agent = (status, seq) => ({ pane_id: 'w1-p2', workspace_id: 'w1', agent: 'claude', agent_status: status, state_change_seq: seq, terminal_title: 'claude' });
const sent = (herdr, method) => herdr.calls.filter((x) => x.method === method && x.params.target === 'w1-p2');
const start = (t, status) => hubInProcess(t, { id: 'st', agents: [agent(status, 3)], env: { HERDR_HUB_STOP_STEP_MS: '20' } });

test('stop: Esc to a working agent, read again until it is not working', async (t) => {
  const h = await start(t, 'working');
  h.herdr.on['agent.send_keys'] = () => h.herdr.agents.splice(0, 1, agent('idle', 4));
  const r = await h.request('POST', '/api/agents/w1-p2/stop', {});
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body, { ok: true, stopped: true });
  assert.deepEqual(sent(h.herdr, 'agent.send_keys').map((x) => x.params.keys), [['esc']]);
});

test('stop: still working after the reads says so; Esc went once', async (t) => {
  const h = await start(t, 'working');
  const r = await h.request('POST', '/api/agents/w1-p2/stop', {});
  assert.deepEqual(r.body, { ok: true, stopped: false });
  assert.equal(sent(h.herdr, 'agent.send_keys').length, 1);
});

test('stop: refused, nothing sent, when it is not working or a dialog is open', async (t) => {
  const h = await start(t, 'idle');
  let r = await h.request('POST', '/api/agents/w1-p2/stop', {});
  assert.equal(r.status, 409);
  assert.deepEqual(r.body, { error: 'not_working' });
  h.herdr.agents.splice(0, 1, agent('working', 4));
  h.herdr.screens['w1-p2'] = DIALOG;
  r = await h.request('POST', '/api/agents/w1-p2/stop', {});
  assert.equal(r.status, 409);
  assert.deepEqual(r.body, { error: 'dialog_open' });
  assert.equal(sent(h.herdr, 'agent.send_keys').length, 0);
  assert.equal((await h.request('POST', '/api/agents/w1-p9/stop', {})).status, 404);
});

test('prompt: refused while words are typed in the input box; a grey suggestion there is none', async (t) => {
  const h = await start(t, 'idle');
  h.herdr.ansiScreens['w1-p2'] = TYPED;
  let r = await h.request('POST', '/api/agents/w1-p2/prompt', { text: 'hello' });
  assert.equal(r.status, 409);
  assert.deepEqual(r.body, { error: 'input_busy' });
  assert.equal(h.herdr.calls.filter((x) => x.method === 'agent.prompt').length, 0);
  assert.equal(h.herdr.calls.filter((x) => x.method === 'pane.send_text').length, 0);
  h.herdr.ansiScreens['w1-p2'] = SUGGESTED;
  r = await h.request('POST', '/api/agents/w1-p2/prompt', { text: 'hello' });
  assert.equal(r.status, 200, r.text);
  assert.equal(h.herdr.calls.filter((x) => x.method === 'agent.prompt').length, 1);
  // No colours from herdr (an older one): sent as before.
  delete h.herdr.ansiScreens['w1-p2'];
  h.herdr.screens['w1-p2'] = screen('❯ looks typed');
  assert.equal((await h.request('POST', '/api/agents/w1-p2/prompt', { text: 'hello' })).status, 200);
});

test('input: the suggestion offered, typed words told', async (t) => {
  const h = await start(t, 'idle');
  assert.deepEqual((await h.request('GET', '/api/agents/w1-p2/input')).body, { supported: false });
  h.herdr.ansiScreens['w1-p2'] = SUGGESTED;
  assert.deepEqual((await h.request('GET', '/api/agents/w1-p2/input')).body, { supported: true, typed: false, suggestion: 'run the tests again' });
  h.herdr.ansiScreens['w1-p2'] = TYPED;
  assert.deepEqual((await h.request('GET', '/api/agents/w1-p2/input')).body, { supported: true, typed: true, suggestion: null });
});
