'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parse, windowOf, parsed } = require('../lib/transcript');

const line = (o) => JSON.stringify(o);
// Claude Code 2.1.317 after a prompt "이 이미지에 뭐가 보여?\n<upload path>" (base64 shortened).
const jsonl = [
  line({ type: 'user', promptId: 'p1', timestamp: 't1', message: { role: 'user', content: [{ type: 'text', text: '[Image #1]이 이미지에 뭐가 보여?' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0K' } }] } }),
  line({ type: 'user', promptId: 'p1', isMeta: true, message: { role: 'user', content: [{ type: 'text', text: '[Image: source: C:\\Users\\k\\AppData\\Local\\Temp\\herdr-hub-uploads\\20261103-115548-fabc3788.png]' }] } }),
  line({ type: 'assistant', message: { id: 'a1', content: [{ type: 'text', text: 'PADDOCK 42' }] } }),
  line({ type: 'user', promptId: 'p3', message: { role: 'user', content: [{ type: 'text', text: '[Image #2] [Image #3]둘 다' }, { type: 'image', source: {} }, { type: 'image', source: {} }] } }),
  line({ type: 'user', promptId: 'p3', isMeta: true, message: { role: 'user', content: [{ type: 'text', text: '[Image: source: /tmp/herdr-hub-uploads/20261103-115729-aeda50ca.png]' }, { type: 'text', text: '[Image: source: /tmp/herdr-hub-uploads/20261103-115729-e83689a9.jpg]' }] } }),
  line({ type: 'user', promptId: 'p2', message: { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'x' } }] } }),
  line({ type: 'user', promptId: 'p2', isMeta: true, message: { role: 'user', content: [{ type: 'text', text: '[Image: source: /Users/k/Desktop/shot.png]' }] } }),
  line({ type: 'user', isMeta: true, message: { role: 'user', content: 'Caveat: meta' } }),
].join('\n');

test('inline images are counted, never passed on, and their uploads named', () => {
  const m = parse(jsonl);
  assert.equal(m.length, 4);
  assert.deepEqual(m[2].uploads, ['20261103-115729-aeda50ca.png', '20261103-115729-e83689a9.jpg']);
  assert.deepEqual({ ...m[0], id: undefined }, { id: undefined, role: 'user', text: '[Image #1]이 이미지에 뭐가 보여?', ts: 't1', images: 1, uploads: ['20261103-115548-fabc3788.png'] });
  assert.equal(m[1].text, 'PADDOCK 42');
  // An image that is not a Herdr Hub upload: counted only.
  assert.deepEqual({ images: m[3].images, uploads: m[3].uploads, text: m[3].text }, { images: 1, uploads: undefined, text: '' });
  assert.ok(!JSON.stringify(m).includes('iVBOR'));
});

test('tool results attach to their tool; AskUserQuestion keeps the answer', () => {
  const lines = [
    line({ type: 'user', message: { role: 'user', content: '색 골라' } }),
    line({ type: 'assistant', message: { id: 'a2', content: [{ type: 'tool_use', id: 'tu1', name: 'AskUserQuestion', input: { questions: [{ question: 'Pick a color?', options: [] }] } }] } }),
    line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'User has answered your questions: "Pick a color?"="Red". You can now continue with the user\'s answers in mind.' }] } }),
    line({ type: 'assistant', message: { id: 'a3', content: [{ type: 'tool_use', id: 'tu2', name: 'Bash', input: { command: 'ls' } }] } }),
    line({ type: 'user', toolUseResult: { stdout: 'x' }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu2', is_error: true, content: [{ type: 'text', text: 'x'.repeat(2500) }] }] } }),
    line({ type: 'assistant', message: { id: 'a4', content: [{ type: 'tool_use', id: 'tu3', name: 'AskUserQuestion', input: { questions: [{ question: 'Size?' }] } }] } }),
    line({ type: 'user', toolUseResult: { answers: { 'Size?': 'Large' } }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu3', content: 'whatever' }] } }),
  ].join('\n');
  const m = parse(lines);
  assert.equal(m.length, 4); // the prompt and three assistant turns; tool results are not messages
  const ask = m[1].tools[0];
  assert.equal(ask.summary, 'Pick a color?');
  assert.deepEqual(ask.answers, [{ q: 'Pick a color?', a: 'Red' }]);
  const bash = m[2].tools[0];
  assert.equal(bash.result.length, 2000);
  assert.equal(bash.cut, true);
  assert.equal(bash.error, true);
  assert.deepEqual(m[3].tools[0].answers, [{ q: 'Size?', a: 'Large' }]);
});

test('the parse is cached by size and mtime; since and rev send only what changed', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-hub-tr-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 's.jsonl');
  const u = (id, text) => line({ type: 'user', uuid: id, message: { role: 'user', content: text } });
  const a = (id, text) => line({ type: 'assistant', uuid: `x${id}`, message: { id, content: [{ type: 'text', text }] } });
  fs.writeFileSync(file, [u('u1', 'hi'), a('m1', 'hello')].join('\n') + '\n');
  const p1 = await parsed(file);
  assert.equal(await parsed(file), p1); // same size and mtime: the same parse, not read again
  assert.deepEqual(p1.messages.map((m) => m.id), ['u1', 'm1']);
  assert.deepEqual(windowOf(p1, 10, { rev: p1.rev }), { found: true, rev: p1.rev, truncated: false, size: p1.size, unchanged: true, messages: [] });

  // The reply grows (same message id) and a new prompt follows.
  fs.appendFileSync(file, [a('m1', 'more'), u('u2', 'again')].join('\n') + '\n');
  const later = Date.now() / 1000 + 5;
  fs.utimesSync(file, later, later);
  const p2 = await parsed(file);
  assert.notEqual(p2, p1);
  const w = windowOf(p2, 10, { since: 'm1', rev: p1.rev });
  assert.equal(w.since, 'm1');
  assert.deepEqual(w.messages.map((m) => [m.id, m.text]), [['m1', 'hello\n\nmore'], ['u2', 'again']]);
  // An id that is gone: the whole window again.
  const r = windowOf(p2, 10, { since: 'nope' });
  assert.equal(r.reset, true);
  assert.equal(r.messages.length, 3);
});

test('a prompt typed while the agent was busy (a queued_command attachment) is a user message', () => {
  const m = parse(
    [
      line({ type: 'user', uuid: 'u1', message: { role: 'user', content: '먼저' } }),
      line({ type: 'attachment', uuid: 'q1', timestamp: 't2', attachment: { type: 'queued_command', prompt: '그리고 이것도', commandMode: 'prompt', origin: { kind: 'human' } } }),
      line({ type: 'attachment', uuid: 'q2', attachment: { type: 'queued_command', prompt: '<task-notification>x</task-notification>', commandMode: 'task-notification', origin: { kind: 'task-notification' } } }),
      line({ type: 'attachment', uuid: 'q3', attachment: { type: 'queued_command', prompt: '<agent-message from="a">x</agent-message>', isMeta: true, origin: { kind: 'peer' } } }),
      line({ type: 'attachment', uuid: 'q4', attachment: { type: 'todo', content: [] } }),
    ].join('\n'),
  );
  assert.deepEqual(m.map((x) => [x.role, x.text, x.id]), [['user', '먼저', 'u1'], ['user', '그리고 이것도', 'q1']]);
});

test('bash mode: the "!" line and its output', () => {
  const { parse } = require('../lib/transcript');
  const L = (uuid, content) => JSON.stringify({ type: 'user', uuid, message: { role: 'user', content } });
  const msgs = parse(
    [
      L('a', '<bash-input> ls -la</bash-input>'),
      L('b', '<bash-stdout>one\n\u001b[31mtwo\u001b[0m\n</bash-stdout><bash-stderr>warn\n</bash-stderr>'),
      L('c', [{ type: 'text', text: '<bash-input>true</bash-input>\n' }]),
      L('d', '<bash-stdout></bash-stdout><bash-stderr></bash-stderr>'),
    ].join('\n')
  );
  assert.deepEqual(
    msgs.map(({ ts, ...m }) => m),
    [
      { role: 'user', text: '! ls -la', bash: true, id: 'a' },
      { role: 'shell', text: 'one\ntwo', err: 'warn', id: 'b' },
      { role: 'user', text: '! true', bash: true, id: 'c' },
      { role: 'shell', text: '', id: 'd' },
    ]
  );
});

test('lastCwd: the folder of the last entry that has one, a cut first line skipped', () => {
  const { lastCwd } = require('../lib/transcript');
  const lines = [
    '"cwd":"/cut", "half a line',
    JSON.stringify({ type: 'user', cwd: '/a' }),
    JSON.stringify({ type: 'assistant', cwd: '/b' }),
    JSON.stringify({ type: 'assistant', cwd: '/side', isSidechain: true }),
    JSON.stringify({ type: 'summary' }),
  ];
  assert.equal(lastCwd(lines.join('\n')), '/b');
  assert.equal(lastCwd(''), '');
  assert.equal(lastCwd(lines[0]), '');
});

test('ExitPlanMode keeps its plan, to read before the approval prompt is answered', () => {
  const m = parse([
    line({ type: 'assistant', message: { id: 'a1', content: [{ type: 'tool_use', id: 'tp', name: 'ExitPlanMode', input: { plan: '# Plan\n\n1. Create hi.txt\n' } }] } }),
    line({ type: 'assistant', message: { id: 'a2', content: [{ type: 'tool_use', id: 'tb', name: 'Bash', input: { command: 'ls' } }] } }),
  ].join('\n'));
  assert.equal(m[0].tools[0].plan, '# Plan\n\n1. Create hi.txt');
  assert.equal(m[1].tools[0].plan, undefined);
});
