'use strict';
// Notification payloads, the stateSeq guard for answering from one, and muting.
// web-push is stubbed: nothing leaves this process.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const webpush = require('web-push');
const { parseChoices, actionChoices, shortLabel } = require('../public/choices.js');
const { buildPayload, checkAnswer, muted, parseMute } = require('../lib/notify');
const { Push } = require('../lib/push');

const BASH = `
● Bash(echo hi > note.txt)
  ⎿  Running…

────────────────────────────────────────────────
 Bash command

   echo hi > note.txt
   Write "hi" to note.txt

 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don't ask again for echo commands in /Users/kang/hub-inbox-s1
   3. No, and tell Claude what to do differently (esc)
`;

const ASK = `
────────────────────────────────────────────────
 ☐ Color

 Pick a colour?

 ❯ 1. Red
   2. Blue
   3. Type something.

 Enter to select · Esc to cancel
`;

const agent = { pane: 'w3:p1', agent: 'claude', name: 'hub-inbox-s1', title: 't', workspaceLabel: 'hub-inbox-s1', status: 'blocked', stateSeq: 42, cwd: '/Users/kang/hub-inbox-s1' };
const host = { id: 'server', label: 'server', multi: true };

test('blocked payload: question, options in short, two actions, tag and stateSeq', () => {
  const choices = parseChoices(BASH);
  const p = buildPayload('blocked', host, agent, { choices });
  assert.equal(p.title, 'hub-inbox-s1: 답 필요');
  assert.equal(p.body, 'Bash: echo hi > note.txt\n진행할까요? 1 Yes · 2 Always · 3 No');
  assert.deepEqual(p.actions, [
    { action: 'answer:1', title: 'Yes' },
    { action: 'answer:3', title: 'No' },
  ]);
  assert.deepEqual(p.answers, { 1: 'Yes', 3: 'No, and tell Claude what to do differently (esc)' });
  assert.equal(p.tag, 'server|w3:p1');
  assert.equal(p.renotify, true);
  assert.equal(p.stateSeq, 42);
  assert.equal(p.host, 'server');
  assert.equal(p.pane, 'w3:p1');
  assert.equal(p.url, '/#/h/server/agent/w3%3Ap1');
});

test('blocked payload: "Type something" is never an action; unknown screen keeps the old body', () => {
  const p = buildPayload('blocked', host, agent, { choices: parseChoices(ASK) });
  assert.equal(p.body, 'Color\nPick a colour? 1 Red · 2 Blue');
  assert.deepEqual(p.actions.map((a) => a.title), ['Red', 'Blue']);
  const q = buildPayload('blocked', { ...host, multi: false }, agent, { choices: null });
  assert.equal(q.body, 'claude · hub-inbox-s1');
  assert.equal(q.actions, undefined);
});

test('done payload: first line of the last reply, quiet replace', () => {
  const p = buildPayload('done', host, { ...agent, status: 'done' }, { lastReply: '테스트를 모두 통과했습니다.' });
  assert.equal(p.title, 'hub-inbox-s1: 완료');
  assert.equal(p.body, '테스트를 모두 통과했습니다.\nserver · hub-inbox-s1');
  assert.equal(p.renotify, false);
  assert.equal(p.actions, undefined);
  assert.ok(buildPayload('done', host, agent, { lastReply: 'x'.repeat(400) }).body.length <= 180);
});

test('action picks and short labels', () => {
  assert.deepEqual(actionChoices(parseChoices(BASH)).map((x) => x.n), [1, 3]);
  assert.equal(shortLabel('Yes, and always allow access to C:\\x from this project'), 'Always');
  assert.equal(shortLabel('No, exit'), 'No');
  assert.equal(shortLabel('Yes, I trust this folder'), 'Yes');
  assert.equal(shortLabel('A very long option label that goes on and on'), 'A very long option labe…');
});

test('checkAnswer: only the prompt the notification was for', () => {
  const choices = parseChoices(BASH);
  const ok = checkAnswer({ agent, stateSeq: 42, n: 1, label: 'Yes', choices });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.keys, ['1']);
  assert.deepEqual(checkAnswer({ agent, stateSeq: 41, n: 1, label: 'Yes', choices }), { status: 409, error: 'stale' });
  assert.deepEqual(checkAnswer({ agent: { ...agent, status: 'working' }, stateSeq: 42, n: 1, choices }), { status: 409, error: 'not_blocked' });
  assert.deepEqual(checkAnswer({ agent, stateSeq: 42, n: 1, label: 'Yes, please', choices }), { status: 409, error: 'stale' });
  assert.deepEqual(checkAnswer({ agent, stateSeq: 42, n: 7, choices }), { status: 409, error: 'no_choice' });
  assert.deepEqual(checkAnswer({ agent, stateSeq: 42, n: 1, choices: null }), { status: 409, error: 'no_choices' });
  assert.deepEqual(checkAnswer({ agent, stateSeq: null, n: 1, choices }), { status: 400, error: 'state_seq_required' });
  assert.deepEqual(checkAnswer({ agent, stateSeq: 42, n: 0, choices }), { status: 400, error: 'bad_choice' });
  assert.deepEqual(checkAnswer({ agent: null, stateSeq: 42, n: 1, choices }), { status: 404, error: 'agent_not_found' });
  assert.deepEqual(checkAnswer({ agent, stateSeq: 42, n: 3, label: 'Type something.', choices: parseChoices(ASK) }), { status: 409, error: 'needs_text' });
});

test('muted: by folder or workspace name prefix', () => {
  const m = parseMute(' hub-inbox-, tmp-x ');
  assert.deepEqual(m, ['hub-inbox-', 'tmp-x']);
  assert.equal(muted(agent, m), true);
  assert.equal(muted({ cwd: 'C:\\Users\\kangw\\hub-inbox-d1', workspaceLabel: 'other' }, m), true);
  assert.equal(muted({ cwd: '/Users/kang', workspaceLabel: 'hub-inbox-s2' }, m), true);
  assert.equal(muted({ cwd: '/Users/kang/Project/herdr-hub', workspaceLabel: 'w9', name: 'hub-inbox' }, m), false);
  assert.equal(muted(agent, []), false);
});

test('the payload goes through web push as JSON, actions included', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-hub-notify-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sent = [];
  t.mock.method(webpush, 'sendNotification', async (sub, body) => sent.push({ endpoint: sub.endpoint, body: JSON.parse(body) }));
  const push = new Push(dir, 'https://herdr-hub.invalid');
  push.add({ endpoint: 'https://push.invalid/phone', keys: { p256dh: 'x', auth: 'y' } });
  const payload = buildPayload('blocked', host, agent, { choices: parseChoices(BASH) });
  assert.deepEqual(await push.send(payload), { sent: 1, removed: 0 });
  assert.deepEqual(sent[0].body, payload);
  assert.equal(sent[0].body.actions.length, 2);
});

// Claude Code 2.1.317 on a 63-column pane (server): the Tip wraps onto a second line.
const BASH_WRAPPED_TIP = `
───────────────────────────────────────────────────────────────
 Bash command
 Tip: auto mode handles these prompts for you — choose "switch
 to auto mode" below
 Write "hi" into note.txt in the working directory
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 echo hi > note.txt
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and always allow access to /Users/kang/hub-inbox-s1
      from this project
   3. Yes, and switch to auto mode · auto mode handles these
      prompts for you
   4. No

 Esc to cancel · Tab to amend`;

test('blocked payload from a real 2.1.317 Bash prompt with a wrapped Tip', () => {
  const choices = parseChoices(BASH_WRAPPED_TIP);
  assert.deepEqual(choices.context, ['Bash command', 'Write "hi" into note.txt in the working directory', 'echo hi > note.txt']);
  const p = buildPayload('blocked', host, agent, { choices });
  assert.equal(p.body, 'Bash: echo hi > note.txt\n진행할까요? 1 Yes · 2 Always · 3 Auto mode · 4 No');
  assert.deepEqual(p.actions, [{ action: 'answer:1', title: 'Yes' }, { action: 'answer:4', title: 'No' }]);
});
