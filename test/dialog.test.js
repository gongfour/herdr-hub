'use strict';
// Claude Code's select dialogs, which herdr reports as idle (or working): the real screen of
// 「Teach auto mode about your environment?」 (test/fixtures/dialog, a MacBook pane read
// 2026-11-09). The hub shows such an agent as 답 필요 with the dialog's options, and a message
// sent from the composer is refused (dialog_open) without typing anything into the dialog.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const c = require('../public/choices.js');
const { hubInProcess, until } = require('./fixtures/hub');

const DIALOG = fs.readFileSync(path.join(__dirname, 'fixtures', 'dialog', 'auto-mode-env.txt'), 'utf8');
const IDLE = '● Done.\n\n────────────────────────────────────────\n❯ \n────────────────────────────────────────\n  ? for shortcuts';

test('heldPrompt: a select dialog with its key hint is held, its options read with their values', () => {
  const ch = c.heldPrompt(DIALOG);
  assert.ok(ch);
  assert.equal(ch.dialog, true);
  assert.equal(ch.question, 'Teach auto mode about your environment?');
  assert.deepEqual(ch.items.map((x) => x.label), ['How you use Claude here · Mixed', 'Also scan shell history · false', 'Also scan your other repos · false', 'Continue']);
  assert.equal(ch.cursor, 2);
  assert.equal(ch.numbered, false);
  // Picked: the arrows to that row, then Enter.
  assert.deepEqual(c.choiceKeys(ch, 4), ['down', 'down', 'enter']);
  assert.deepEqual(c.choiceKeys(ch, 1), ['up', 'enter']);
  assert.ok(c.choicesSettled(ch));
  // The prompts held before are not dialogs.
  assert.equal(c.heldPrompt(fs.readFileSync(path.join(__dirname, 'fixtures', 'ask', 'plan.txt'), 'utf8')).dialog, undefined);
});

test('heldPrompt: ❯ in ordinary output is no dialog', () => {
  // An idle Claude: the empty input line.
  assert.equal(c.heldPrompt(IDLE), null);
  assert.equal(c.heldPrompt('❯ '), null);
  // A reply's own menu-like lines, no hint under them.
  assert.equal(c.heldPrompt('● Options:\n  ❯ Alpha\n    Beta\n    Gamma\n\n● Pick one.'), null);
  // The same menu with the input box under it (the hint quoted in a reply, the prompt below).
  assert.equal(c.heldPrompt(`${DIALOG}\n\n${IDLE}`), null);
  // A hint without a cursor menu above it.
  assert.equal(c.heldPrompt('● Press Enter to continue · Esc to cancel'), null);
  // Hint not the last line: something else was drawn after it.
  assert.equal(c.heldPrompt(`${DIALOG}\n● and then more output`), null);
});

const agent = (status, seq) => ({ pane_id: 'w1-p2', workspace_id: 'w1', agent: 'claude', agent_status: status, state_change_seq: seq, terminal_title: 'claude' });
const sent = (herdr, method) => herdr.calls.filter((x) => x.method === method && (x.params.target === 'w1-p2' || x.params.pane_id === 'w1-p2'));
const statusOf = async (h) => ((await h.request('GET', '/api/state')).body.agents.find((a) => a.pane === 'w1-p2') || {}).status;

test('hub: an idle agent showing a dialog is 답 필요; a prompt is refused and nothing typed; an answer goes and the hold ends', async (t) => {
  let clock = 1e12;
  const h = await hubInProcess(t, { id: 'dlg', agents: [agent('idle', 4)], now: () => clock });
  const { herdr } = h;
  // Idle with the empty prompt: idle, and a prompt goes to herdr.
  herdr.screens['w1-p2'] = IDLE;
  await until(async () => (await statusOf(h)) === 'idle', 'idle');
  assert.equal((await h.request('POST', '/api/agents/w1-p2/prompt', { text: 'hi' })).status, 200);
  assert.equal(sent(herdr, 'agent.prompt').length, 1);

  // The dialog opens; herdr's state doesn't change. A prompt now reads the screen and is refused.
  herdr.screens['w1-p2'] = DIALOG;
  const r = await h.request('POST', '/api/agents/w1-p2/prompt', { text: 'hello' });
  assert.equal(r.status, 409);
  assert.deepEqual(r.body, { error: 'dialog_open' });
  assert.equal(sent(herdr, 'agent.prompt').length, 1);
  assert.equal(sent(herdr, 'agent.send_keys').length, 0);
  assert.equal(sent(herdr, 'pane.send_text').length, 0);
  // ... and the agent is 답 필요 from the next refresh, at herdr's own stateSeq.
  await until(async () => (await statusOf(h)) === 'blocked', 'held blocked');
  const a = (await h.request('GET', '/api/state')).body.agents.find((x) => x.pane === 'w1-p2');
  assert.equal(a.stateSeq, 4);
  // Still refused while held.
  assert.deepEqual((await h.request('POST', '/api/agents/w1-p2/prompt', { text: 'hello' })).body, { error: 'dialog_open' });
  assert.equal(sent(herdr, 'agent.prompt').length, 1);

  // An answer drawn for it goes: the arrows to Continue, Enter.
  const ans = await h.request('POST', '/api/agents/w1-p2/answer', { stateSeq: 4, n: 4, label: 'Continue' });
  assert.equal(ans.status, 200, ans.text);
  assert.deepEqual(sent(herdr, 'agent.send_keys').map((x) => x.params.keys), [['down', 'down', 'enter']]);
  // The dialog gone (still idle at 4): the hold ends at the next read, and prompts go again.
  herdr.screens['w1-p2'] = IDLE;
  herdr.event();
  await until(async () => (await statusOf(h)) === 'idle', 'hold ended');
  assert.equal((await h.request('POST', '/api/agents/w1-p2/prompt', { text: 'again' })).status, 200);
  assert.equal(sent(herdr, 'agent.prompt').length, 2);
});

test('hub: a dialog that opens while idle is found by the periodic read; one closed in the terminal lets go', async (t) => {
  let clock = 1e12;
  const h = await hubInProcess(t, { id: 'dlg2', agents: [agent('idle', 4)], now: () => clock });
  const { herdr } = h;
  herdr.screens['w1-p2'] = IDLE;
  await until(async () => (await statusOf(h)) === 'idle', 'idle');
  herdr.screens['w1-p2'] = DIALOG;
  // Not read again before its time.
  herdr.event();
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await statusOf(h), 'idle');
  clock += 15e3;
  herdr.event();
  await until(async () => (await statusOf(h)) === 'blocked', 'found on the clock');
  // Esc in the terminal: herdr still says idle at 4; the held dialog is read again within 2 s.
  herdr.screens['w1-p2'] = IDLE;
  clock += 2e3;
  herdr.event();
  await until(async () => (await statusOf(h)) === 'idle', 'let go');
});

test('hub: a working agent with a dialog is refused a prompt and shown as 답 필요', async (t) => {
  const h = await hubInProcess(t, { id: 'dlg3', agents: [agent('working', 9)] });
  h.herdr.screens['w1-p2'] = DIALOG;
  // The first refresh may have read the empty screen; the hint of a prompt reads it now.
  await h.request('POST', '/api/agents/w1-p2/prompt', { text: 'x' });
  await until(async () => (await statusOf(h)) === 'blocked', 'working with a dialog');
  assert.equal(sent(h.herdr, 'agent.prompt').length, 0);
});
