'use strict';
// Answers to a blocked agent's prompt through the real server (fake herdr): POST
// /api/agents/<pane>/answer (the app's choice buttons) and POST /api/answer (a notification's
// buttons). A wrong answer here presses keys in a prompt the person did not see, so every refusal
// is checked to press nothing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startHub, until, sleep } = require('./fixtures/hub');
const { parseChoices, choiceKeys } = require('../public/choices');

const ASK = path.join(__dirname, 'fixtures', 'ask');
const BASH = `
● Bash(echo hi > note.txt)
  ⎿  Running…

────────────────────────────────────────────────────────────────────────────────
 Bash command

   echo hi > note.txt
   Write "hi" to note.txt

 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don't ask again for echo commands in /tmp/x
   3. No, and tell Claude what to do differently (esc)
`;
const ONE = fs.readFileSync(path.join(ASK, 'one.txt'), 'utf8'); // AskUserQuestion, 3. Type something.
const PLAN = fs.readFileSync(path.join(ASK, 'plan.txt'), 'utf8');

const agent = (pane, status, seq, kind = 'claude') => ({ pane_id: pane, workspace_id: 'w1', agent: kind, agent_status: status, state_change_seq: seq, terminal_title: kind });
const keysSent = (herdr, pane) => herdr.calls.filter((c) => c.method === 'agent.send_keys' && c.params.target === pane).map((c) => c.params.keys);
const keysFor = (screen, n) => choiceKeys(parseChoices(screen.replace(/\s+$/, '')), n);

test('answer: refusals press nothing; one of two at once goes; a second within 5 s is refused', async (t) => {
  const hub = await startHub(t, { id: 'ans', agents: [agent('w1-p2', 'blocked', 5), agent('w1-p3', 'working', 2), agent('w1-p4', 'blocked', 3, 'codex')] });
  const { herdr } = hub;
  herdr.screens['w1-p2'] = BASH;
  const post = (pane, body, h) => hub.request('POST', `/api/agents/${pane}/answer`, body, h);

  assert.deepEqual((await post('w1-p2', { stateSeq: 5, n: 1 }, { 'X-Herdr-Hub': null })).body, { error: 'missing_header' });
  const refused = [
    [{ stateSeq: 4, n: 1 }, 409, 'stale'],
    [{ stateSeq: 6, n: 1 }, 409, 'stale'],
    [{ n: 1 }, 400, 'state_seq_required'],
    [{ stateSeq: '5', n: 1 }, 400, 'state_seq_required'],
    [{ stateSeq: 5, n: 0 }, 400, 'bad_choice'],
    [{ stateSeq: 5, n: 'x' }, 400, 'bad_choice'],
    [{ stateSeq: 5, n: 7 }, 409, 'no_choice'],
    [{ stateSeq: 5, n: 1, label: 'No' }, 409, 'stale'],
  ];
  for (const [body, status, error] of refused) {
    const r = await post('w1-p2', body);
    assert.equal(r.status, status, JSON.stringify(body));
    assert.deepEqual(r.body, { error }, JSON.stringify(body));
  }
  assert.deepEqual((await post('w1-p3', { stateSeq: 2, n: 1 })).body, { error: 'not_blocked' });
  assert.equal((await post('nope', { stateSeq: 1, n: 1 })).status, 404);
  // A blocked agent whose screen has no prompt herdr can read.
  assert.deepEqual((await post('w1-p4', { stateSeq: 3, n: 1 })).body, { error: 'no_choices' });
  assert.deepEqual(keysSent(herdr, 'w1-p2'), []);
  assert.deepEqual(keysSent(herdr, 'w1-p4'), []);

  // A double tap (or the app and a notification together): one goes, the other is refused —
  // also while the first one's keys are still on their way to herdr (held 300 ms).
  herdr.hold['agent.send_keys'] = 300;
  const first = post('w1-p2', { stateSeq: 5, n: 1, label: 'Yes' });
  await until(() => herdr.calls.some((c) => c.method === 'agent.send_keys'), 'first keys sent');
  const [a, b] = await Promise.all([first, post('w1-p2', { stateSeq: 5, n: 1 })]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.deepEqual((a.status === 200 ? a : b).body, { ok: true, n: 1, label: 'Yes' });
  assert.deepEqual((a.status === 200 ? b : a).body, { error: 'answered' });
  assert.deepEqual(keysSent(herdr, 'w1-p2'), [keysFor(BASH, 1)]);
  // Another option of the same screen soon after: refused too (the first keys may still be on the way).
  assert.deepEqual((await post('w1-p2', { stateSeq: 5, n: 2 })).body, { error: 'answered' });
  // The notification's button, the same prompt: refused as well.
  assert.deepEqual((await hub.request('POST', '/api/answer', { pane: 'w1-p2', stateSeq: 5, n: 2 })).body, { error: 'answered' });
  assert.equal(keysSent(herdr, 'w1-p2').length, 1);

  // The agent moved on to a new prompt (herdr's state changed): that one takes its own answer.
  herdr.agents[0].state_change_seq = 6;
  const c = await post('w1-p2', { stateSeq: 6, n: 2 });
  assert.equal(c.status, 200, c.text);
  assert.deepEqual(keysSent(herdr, 'w1-p2'), [keysFor(BASH, 1), keysFor(BASH, 2)]);
});

test('answer: the same prompt takes an answer again once 5 s have passed', { timeout: 20000 }, async (t) => {
  const hub = await startHub(t, { id: 'ans5', agents: [agent('w1-p2', 'blocked', 5)] });
  hub.herdr.screens['w1-p2'] = BASH;
  assert.equal((await hub.request('POST', '/api/agents/w1-p2/answer', { stateSeq: 5, n: 1 })).status, 200);
  assert.equal((await hub.request('POST', '/api/agents/w1-p2/answer', { stateSeq: 5, n: 1 })).status, 409);
  await sleep(5100);
  assert.equal((await hub.request('POST', '/api/agents/w1-p2/answer', { stateSeq: 5, n: 1 })).status, 200);
  assert.equal(keysSent(hub.herdr, 'w1-p2').length, 2);
});

test('answer: "Type something" needs own:true (the app), never from a notification; a failed send frees the claim', async (t) => {
  const hub = await startHub(t, { id: 'ansown', agents: [agent('w1-p2', 'blocked', 9)] });
  const { herdr } = hub;
  herdr.screens['w1-p2'] = ONE;
  assert.deepEqual((await hub.request('POST', '/api/agents/w1-p2/answer', { stateSeq: 9, n: 3 })).body, { error: 'needs_text' });
  assert.deepEqual((await hub.request('POST', '/api/answer', { pane: 'w1-p2', stateSeq: 9, n: 3, own: true })).body, { error: 'needs_text' });
  assert.deepEqual(keysSent(herdr, 'w1-p2'), []);

  // herdr refuses the keys: the answer fails with herdr's error and the next one may go.
  herdr.fail['agent.send_keys'] = { code: 'agent_not_found', message: 'gone' };
  const f = await hub.request('POST', '/api/agents/w1-p2/answer', { stateSeq: 9, n: 1 });
  assert.equal(f.status, 502);
  assert.equal(f.body.error, 'agent_not_found');
  delete herdr.fail['agent.send_keys'];
  const ok = await hub.request('POST', '/api/agents/w1-p2/answer', { stateSeq: 9, n: 3, own: true });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.n, 3);
  assert.deepEqual(keysSent(herdr, 'w1-p2').at(-1), keysFor(ONE, 3));
});

test('answer: a plan prompt herdr turned idle stays blocked, and an answer drawn for the blocked state goes', async (t) => {
  const hub = await startHub(t, { id: 'ansheld', agents: [agent('w1-p2', 'blocked', 7)] });
  const { herdr } = hub;
  herdr.screens['w1-p2'] = PLAN;
  const host = 'ansheld';
  // Seen blocked at 7 first; then herdr says idle at 8 with the prompt still on screen.
  await until(async () => (await hub.request('GET', '/api/state')).body.agents.some((a) => a.pane === 'w1-p2' && a.stateSeq === 7), 'seen at 7');
  herdr.agents[0].agent_status = 'idle';
  herdr.agents[0].state_change_seq = 8;
  herdr.event();
  const a = await until(async () => (await hub.request('GET', '/api/state')).body.agents.find((x) => x.host === host && x.pane === 'w1-p2' && x.stateSeq === 8), 'seen at 8');
  assert.equal(a.status, 'blocked');
  const r = await hub.request('POST', '/api/agents/w1-p2/answer', { stateSeq: 7, n: 2 });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(keysSent(herdr, 'w1-p2'), [keysFor(PLAN, 2)]);
  // An idle agent with no such prompt is not held: the answer is refused.
  herdr.screens['w1-p2'] = '❯ \n';
  herdr.agents[0].state_change_seq = 9;
  herdr.event();
  await until(async () => (await hub.request('GET', '/api/state')).body.agents.find((x) => x.pane === 'w1-p2' && x.stateSeq === 9), 'seen at 9');
  assert.deepEqual((await hub.request('POST', '/api/agents/w1-p2/answer', { stateSeq: 9, n: 1 })).body, { error: 'not_blocked' });
  assert.equal(keysSent(herdr, 'w1-p2').length, 1);
});

test('POST /api/answer (a notification button): this host by default; its checks', async (t) => {
  const hub = await startHub(t, { id: 'notif', agents: [agent('w1-p2', 'blocked', 5)] });
  hub.herdr.screens['w1-p2'] = BASH;
  assert.deepEqual((await hub.request('POST', '/api/answer', { stateSeq: 5, n: 1 })).body, { error: 'pane_required' });
  assert.deepEqual((await hub.request('POST', '/api/answer', { pane: '', stateSeq: 5, n: 1 })).body, { error: 'pane_required' });
  const u = await hub.request('POST', '/api/answer', { host: 'other', pane: 'w1-p2', stateSeq: 5, n: 1 });
  assert.equal(u.status, 404);
  assert.deepEqual(u.body, { error: 'unknown_host' });
  assert.deepEqual((await hub.request('POST', '/api/answer', { pane: 'w1-p2', stateSeq: 5, n: 1 }, { 'X-Herdr-Hub': null })).body, { error: 'missing_header' });
  assert.deepEqual(keysSent(hub.herdr, 'w1-p2'), []);
  const r = await hub.request('POST', '/api/answer', { host: 'notif', pane: 'w1-p2', stateSeq: 5, n: 2, label: "Yes, and don't ask again for echo commands in /tmp/x" });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body, { ok: true, n: 2, label: "Yes, and don't ask again for echo commands in /tmp/x" });
  assert.deepEqual(keysSent(hub.herdr, 'w1-p2'), [keysFor(BASH, 2)]);
});
