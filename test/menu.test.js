'use strict';
// A slash command's menu (/model, /theme, /privacy-settings …): Claude Code draws it in place of
// the input box, under a rule of ▔, and herdr reports the agent idle. Real screens of Claude Code
// 2.1.322 (test/fixtures/menu, read through a 100×40 terminal 2026-11-10; only the panel kept).
// The hub holds such an agent as 답 필요 with the menu (a.menu: no notification), reads the screen
// right after a slash command goes from here, and /model's 「s to use this session only」 is
// offered as 이 세션만 beside the rows.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const c = require('../public/choices.js');
const notify = require('../lib/notify');
const { hubInProcess, until } = require('./fixtures/hub');

const screen = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', 'menu', `${name}.txt`), 'utf8');
const IDLE = '● Done.\n\n────────────────────────────────────────\n❯ \n────────────────────────────────────────\n  ? for shortcuts';

test('menus: /model is held as a menu, its rows read, 이 세션만 its own key', () => {
  const ch = c.heldPrompt(screen('model'));
  assert.ok(ch);
  assert.equal(ch.dialog, true);
  assert.equal(ch.menu, true);
  assert.deepEqual(ch.panel, { title: 'Select model', hint: 'Enter to set as default · s to use this session only · Esc to cancel' });
  assert.deepEqual(ch.items.map((x) => x.label), ['Default (recommended)', 'Opus 5.5 ✔', 'Fable 5.2', 'Sonnet 5.5', 'Haiku 5.5']);
  assert.deepEqual(ch.items.map((x) => x.desc), ['Opus 5.5 · Best for everyday, complex tasks', 'For complex work and everyday tasks', 'For your toughest challenges', 'Most efficient for simpler tasks', 'Fastest for quick answers']);
  assert.equal(ch.cursor, 2);
  // A digit picks and saves as the default (checked: 「Set model to Opus 5.5 and saved as your
  // default for new sessions」); 이 세션만 walks there and presses s (「… for this session only」).
  assert.deepEqual(c.choiceKeys(ch, 4), ['4']);
  assert.deepEqual(ch.alt, { key: 's', label: '이 세션만' });
  assert.deepEqual(c.choiceKeys(ch, 4, true), ['down', 'down', 's']);
  assert.deepEqual(c.choiceKeys(ch, 1, true), ['up', 's']);
  assert.deepEqual(c.choiceKeys(ch, 2, true), ['s']);
});

test('menus: lists without numbers, a ✔ on the current one; menus with no list at all', () => {
  const theme = c.heldPrompt(screen('theme'));
  assert.equal(theme.menu, true);
  assert.equal(theme.panel.title, 'Theme');
  assert.equal(theme.items.length, 8);
  assert.equal(theme.items[1].label, 'Dark mode ✔');
  assert.equal(theme.cursor, 2);
  assert.deepEqual(c.choiceKeys(theme, 3), ['down', 'enter']);
  assert.equal(theme.alt, undefined); // no 「s to …」: nothing but Enter
  assert.equal(c.choiceKeys(theme, 3, true), null);

  const exp = c.heldPrompt(screen('export'));
  assert.deepEqual(exp.items.map((x) => [x.label, x.desc]), [['Copy to clipboard', 'Copy the conversation to your system clipboard'], ['Save to file', 'Save the conversation to a file in the current directory']]);
  assert.equal(exp.panel.hint, 'Esc to cancel');

  // /privacy-settings: a toggle, no list. Held all the same, the panel for the page to show.
  const priv = c.heldPrompt(screen('privacy-settings'));
  assert.equal(priv.menu, true);
  assert.equal(priv.items.length, 0);
  assert.equal(priv.question, 'Data privacy');
  const p = c.screenPanel(screen('privacy-settings'));
  assert.equal(p.title, 'Data privacy');
  assert.equal(p.hint, 'Enter/Tab/Space to toggle · Esc to cancel');
  assert.equal(p.body[p.body.length - 1].trim(), p.hint);
  // What the page shows between them: neither the title nor the hint again.
  assert.equal(p.main[0].trim(), 'Review and manage your privacy settings at https://claude.ai/settings/data-privacy-controls');
  assert.equal(p.main[p.main.length - 1].trim().replace(/\s+/g, ' '), 'Help improve our AI models false');

  assert.equal(c.heldPrompt(screen('tasks')).panel.title, 'Background');
});

test('menus: a list in the conversation above a panel is not its menu; the input box is no panel', () => {
  const above = '● Pick one:\n  1. Alpha\n  2. Beta\n\n';
  const priv = above + screen('privacy-settings');
  assert.equal(c.parseChoices(priv), null);
  assert.equal(c.heldPrompt(priv).items.length, 0);
  assert.deepEqual(c.parseChoices(above + screen('model')).items.length, 5);
  // Idle: ─ rules around an empty input line. Not a panel, even under an earlier ▔ rule.
  assert.equal(c.heldPrompt(IDLE), null);
  assert.equal(c.screenPanel(IDLE), null);
  assert.equal(c.heldPrompt(`${screen('model')}\n\n${IDLE}`), null);
  // Permission prompts and the plan approval keep their own shape (not menus).
  const plan = c.heldPrompt(fs.readFileSync(path.join(__dirname, 'fixtures', 'ask', 'plan.txt'), 'utf8'));
  assert.equal(plan.menu, undefined);
});

test('menus: a held menu never notifies', () => {
  assert.equal(notify.transitionKind({ status: 'idle' }, { status: 'blocked', menu: true }), null);
  assert.equal(notify.transitionKind({ status: 'idle' }, { status: 'blocked' }), 'blocked');
});

const agent = (status, seq) => ({ pane_id: 'w1-p2', workspace_id: 'w1', agent: 'claude', agent_status: status, state_change_seq: seq, terminal_title: 'claude' });
const sent = (herdr, method) => herdr.calls.filter((x) => x.method === method && (x.params.target === 'w1-p2' || x.params.pane_id === 'w1-p2'));
const agentOf = async (h) => (await h.request('GET', '/api/state')).body.agents.find((a) => a.pane === 'w1-p2') || {};

test('hub: /model sent from here shows its menu within a second, not on the 15 s clock; 이 세션만 goes as s', async (t) => {
  const clock = 1e12; // the clock stands still: only the reads after the command can find it
  const h = await hubInProcess(t, { id: 'menu1', agents: [agent('idle', 4)], now: () => clock });
  const { herdr } = h;
  herdr.screens['w1-p2'] = IDLE;
  await until(async () => (await agentOf(h)).status === 'idle', 'idle');
  // A plain message: no extra reads.
  assert.equal((await h.request('POST', '/api/agents/w1-p2/prompt', { text: 'hi' })).status, 200);
  const reads = () => sent(herdr, 'agent.read').length;
  let before = reads();
  await new Promise((r) => setTimeout(r, 900));
  assert.equal(reads(), before);

  // /model: Claude Code draws the menu a moment later; herdr stays idle at 4.
  assert.equal((await h.request('POST', '/api/agents/w1-p2/prompt', { text: '/model' })).status, 200);
  herdr.screens['w1-p2'] = screen('model');
  before = Date.now();
  await until(async () => (await agentOf(h)).status === 'blocked', 'menu held');
  assert.ok(Date.now() - before < 3000);
  const a = await agentOf(h);
  assert.equal(a.menu, true);
  assert.equal(a.stateSeq, 4);
  // While it is open a message is refused, nothing typed into it.
  assert.deepEqual((await h.request('POST', '/api/agents/w1-p2/prompt', { text: 'hello' })).body, { error: 'dialog_open' });
  assert.equal(sent(herdr, 'agent.prompt').length, 2);

  // 이 세션만 on Sonnet: the arrows from the cursor, then s. Refused for a menu without that key.
  const ans = await h.request('POST', '/api/agents/w1-p2/answer', { stateSeq: 4, n: 4, label: 'Sonnet 5.5', alt: true });
  assert.equal(ans.status, 200, ans.text);
  assert.deepEqual(sent(herdr, 'agent.send_keys').map((x) => x.params.keys), [['down', 'down', 's']]);
  herdr.screens['w1-p2'] = IDLE;
  herdr.event();
  await until(async () => (await agentOf(h)).status === 'idle', 'menu closed');
  assert.equal((await agentOf(h)).menu, undefined);
});

test('hub: an alt answer to a menu without its own key sends nothing', async (t) => {
  const h = await hubInProcess(t, { id: 'menu2', agents: [agent('idle', 4)] });
  const { herdr } = h;
  herdr.screens['w1-p2'] = IDLE;
  await until(async () => (await agentOf(h)).status === 'idle', 'idle');
  assert.equal((await h.request('POST', '/api/agents/w1-p2/prompt', { text: '/theme' })).status, 200);
  herdr.screens['w1-p2'] = screen('theme');
  await until(async () => (await agentOf(h)).status === 'blocked', 'menu held');
  const r = await h.request('POST', '/api/agents/w1-p2/answer', { stateSeq: 4, n: 3, label: 'Light mode', alt: true });
  assert.equal(r.status, 409);
  assert.deepEqual(r.body, { error: 'no_keys' });
  assert.equal(sent(herdr, 'agent.send_keys').length, 0);
});
