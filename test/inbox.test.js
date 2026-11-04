'use strict';
// Unread finishes and the one-line summaries (public/inbox.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { firstLine, glance, unread, seenKey } = require('../public/inbox.js');

test('firstLine: the first readable line of a markdown reply', () => {
  assert.equal(firstLine('\n\n## 결과\n\n본문'), '결과');
  assert.equal(firstLine('**Done.** Tests pass (`npm test`).\nmore'), 'Done. Tests pass (npm test).');
  assert.equal(firstLine('```js\nconst x = 1;\n```\nAfter'), 'const x = 1;');
  assert.equal(firstLine('---\n- [x] item one\n- two'), 'item one');
  assert.equal(firstLine('> quoted [link](https://x.invalid) text'), 'quoted link text');
  assert.equal(firstLine('| a | b |\n|---|---|\n| 1 | 2 |'), 'a · b');
  assert.equal(firstLine('_emphasis_ and snake_case_name'), 'emphasis and snake_case_name');
  assert.equal(firstLine(''), '');
  assert.equal(firstLine(null), '');
  const long = firstLine('가'.repeat(300));
  assert.equal(long.length, 120);
  assert.ok(long.endsWith('…'));
});

test('glance: last reply, and the last tool of the current turn only', () => {
  const msgs = [
    { role: 'user', text: 'first' },
    { role: 'assistant', text: 'Old reply', tools: [{ name: 'Read', summary: 'a.txt' }] },
    { role: 'user', text: 'second' },
    { role: 'assistant', text: '', tools: [{ name: 'Bash', summary: 'npm test' }] },
  ];
  assert.deepEqual(glance(msgs), { lastReply: 'Old reply', lastTool: 'Bash: npm test' });
  // A finished turn: its reply is the summary.
  msgs.push({ role: 'assistant', text: '# 끝\n모두 통과', tools: [] });
  assert.deepEqual(glance(msgs), { lastReply: '끝', lastTool: 'Bash: npm test' });
  // A new prompt with no tool yet: no tool from the turn before.
  msgs.push({ role: 'user', text: 'third' });
  assert.equal(glance(msgs).lastTool, '');
  assert.deepEqual(glance([]), { lastReply: '', lastTool: '' });
  assert.equal(glance([{ role: 'assistant', text: '', tools: [{ name: 'TodoWrite', summary: '' }] }]).lastTool, 'TodoWrite');
});

test('unread: stopped recently (or herdr says done) and this finish not opened', () => {
  const now = 10_000_000;
  const A = (pane, status, extra = {}) => ({ host: 'desktop', pane, status, ...extra });
  const agents = [
    A('p1', 'idle'), // never finished while the hub watched
    A('p2', 'working', { workingSince: now - 60_000, doneAt: now - 120_000 }),
    A('p3', 'blocked', { doneAt: now - 120_000 }),
    A('p4', 'done', { doneAt: now - 180_000 }),
    A('p5', 'idle', { doneAt: now - 60_000 }),
    A('p6', 'idle', { doneAt: now - 13 * 3600_000 }), // too old
    A('p7', 'done', { doneAt: null }), // herdr says done, the hub restarted since
    A('p8', 'idle', { doneAt: now - 30_000 }),
  ];
  const seen = new Set([seenKey(agents[4])]); // p5 was opened after it finished
  const ids = agents.filter((a) => unread(a, { now, isSeen: (k) => seen.has(k) })).map((a) => a.pane);
  assert.deepEqual(ids, ['p4', 'p7', 'p8']);
  // A new finish of the same pane is new again.
  assert.notEqual(seenKey({ ...agents[4], doneAt: now }), seenKey(agents[4]));
  assert.equal(unread({ ...agents[4], doneAt: now }, { now, isSeen: (k) => seen.has(k) }), true);
  assert.equal(seenKey(agents[6]), 'desktop|p7|done');
  assert.equal(unread(null), false);
});
