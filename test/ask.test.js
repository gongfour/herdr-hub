'use strict';
// Every question screen Claude Code 2.1.318 showed (test/fixtures/ask, read with herdr agent read
// --source visible): AskUserQuestion with one question, several, multiSelect, previews, its
// review screen; the plan approval; a file permission prompt.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const c = require('../public/choices.js');

const screen = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', 'ask', `${name}.txt`), 'utf8');
const parse = (name) => c.parseChoices(screen(name));
const labels = (ch) => ch.items.map((x) => x.label);
const quick = (ch) => c.quickChoices(ch).map((x) => x.n);

test('one question: a digit picks; the tab bar is its header, not context', () => {
  const ch = parse('one');
  assert.equal(ch.question, '어떤 색이 좋아요?');
  assert.deepEqual(labels(ch), ['빨강', '파랑', 'Type something.', 'Chat about this']);
  assert.equal(ch.items[0].desc, '따뜻한 색');
  assert.deepEqual(ch.ask, { tabs: [{ label: '색', done: false }], steps: false, review: false });
  assert.deepEqual(ch.context, []);
  assert.deepEqual(c.choiceKeys(ch, 2), ['2']);
  assert.equal(ch.multi, undefined);
  assert.equal(c.nextKeys(ch), null);
  // One tap answers it; "Chat about this" is not a quick answer.
  assert.deepEqual(quick(ch), [1, 2]);
  assert.deepEqual(c.typedChoice(ch), { item: ch.items[2], how: 'own', after: ['enter'] });
  assert.deepEqual(c.promptParts(ch), { kind: '질문', intent: '', body: '', question: '어떤 색이 좋아요?' });
});

test('several questions: each screen its own step; no quick answers until the review', () => {
  const q1 = parse('two-q1');
  const q2 = parse('two-q2');
  assert.deepEqual(q1.ask.tabs, [{ label: '색', done: false }, { label: '크기', done: false }]);
  assert.deepEqual(q2.ask.tabs, [{ label: '색', done: true }, { label: '크기', done: false }]);
  assert.equal(q1.ask.steps, true);
  assert.equal(q2.question, '어떤 크기요?');
  assert.deepEqual(c.choiceKeys(q2, 1), ['1']);
  // herdr's state stays the same through the questions: the screen tells them apart.
  assert.notEqual(c.choicesSig(q1), c.choicesSig(q2));
  assert.deepEqual(quick(q1), []);
  const review = parse('two-review');
  assert.equal(review.ask.review, true);
  assert.deepEqual(labels(review), ['Submit answers', 'Cancel']);
  assert.deepEqual(review.context, ['Review your answers', '● 어떤 색이 좋아요?', '→ 파랑', '● 어떤 크기요?', '→ 작게']);
  assert.deepEqual(quick(review), [1, 2]);
  assert.equal(c.promptParts(review).question, '이대로 답을 보낼까요?');
});

test('multiSelect: boxes, a digit ticks, 「다음」 walks to Submit', () => {
  const ch = parse('multi');
  assert.equal(ch.multi, true);
  assert.deepEqual(labels(ch), ['사과', '배', '포도', 'Type something', 'Chat about this']);
  assert.deepEqual(ch.items.slice(0, 4).map((x) => x.checked), [false, false, false, false]);
  // "Submit" under the options is not the last option's description.
  assert.equal(ch.items[3].desc, undefined);
  assert.deepEqual(ch.next, { label: 'Submit', cursor: false });
  assert.deepEqual(c.choiceKeys(ch, 1), ['1']);
  assert.deepEqual(c.nextKeys(ch), ['down', 'down', 'down', 'down', 'enter']);
  assert.deepEqual(quick(ch), []);
  // Its own words: walk to the row (a digit would tick it empty), type, step off with ↑.
  assert.deepEqual(c.choiceKeys(ch, 4), ['down', 'down', 'down']);
  assert.deepEqual(c.typedChoice(ch).after, ['up']);

  const ticked = parse('multi-toggled');
  assert.deepEqual(ticked.items.slice(0, 3).map((x) => x.checked), [true, false, true]);
  assert.notEqual(c.choicesSig(ch), c.choicesSig(ticked));
  // The labels match across a tick: an answer drawn before it is still the same option.
  assert.deepEqual(labels(ticked), labels(ch));

  const onSubmit = parse('multi-cursor-submit');
  assert.equal(onSubmit.cursor, null);
  assert.deepEqual(onSubmit.next, { label: 'Submit', cursor: true });
  assert.deepEqual(c.nextKeys(onSubmit), ['enter']);
  assert.deepEqual(c.choiceKeys(onSubmit, 4), ['up']);

  const typed = parse('multi-own-typed');
  assert.deepEqual(labels(typed).slice(0, 3), ['사과', '배', '귤']);
  assert.equal(typed.items[2].checked, true);
  assert.deepEqual(c.nextKeys(typed), ['down', 'enter']);

  const review = parse('multi-review');
  assert.equal(review.ask.review, true);
  assert.deepEqual(review.context.slice(1), ['● 어떤 과일을 살까요?', '→ 사과, 포도']);
});

test('multiSelect then another question: its row says Next', () => {
  const ch = parse('mix-multi-next');
  assert.deepEqual(ch.next, { label: 'Next', cursor: false });
  assert.deepEqual(ch.ask.tabs.map((t) => t.label), ['과일', '크기']);
  assert.deepEqual(c.nextKeys(ch), ['down', 'down', 'down', 'enter']);
});

test('previews: the box beside the options is not their name; a digit moves, Enter picks', () => {
  for (const name of ['preview', 'preview-moved']) {
    const ch = parse(name);
    assert.equal(ch.preview, true);
    assert.deepEqual(labels(ch), ['가로', '세로']);
    assert.deepEqual(c.choiceKeys(ch, 2), ['2', 'enter']);
    assert.deepEqual(quick(ch), [1, 2]);
  }
  assert.equal(parse('preview-moved').cursor, 2);
});

test('plan approval: in Korean, and "Tell Claude what to change" takes the words', () => {
  const ch = parse('plan');
  assert.deepEqual(labels(ch), ['Yes, and use auto mode', 'Yes, manually approve edits', 'Tell Claude what to change']);
  assert.deepEqual(c.promptParts(ch), { kind: '계획', intent: '', body: '', question: '계획대로 진행할까요?' });
  const t = c.typedChoice(ch);
  assert.equal(t.item.n, 3);
  assert.deepEqual(t.after, ['enter']);
  assert.deepEqual(quick(ch), [1, 2]);
  assert.deepEqual(c.choiceKeys(ch, 3), ['3']);
});

test('file permission prompt still reads as before', () => {
  const ch = parse('create-file');
  assert.deepEqual(labels(ch), ['Yes', 'Yes, and switch to accept edits (auto-approve file edits and common file commands) for this session (shift+tab)', 'No']);
  assert.equal(ch.ask, undefined);
  assert.deepEqual(c.promptParts(ch), { kind: '파일 만들기', intent: 'hi.txt', body: '1 hi', question: 'hi.txt — 만들까요?' });
  assert.deepEqual(quick(ch), [1, 2, 3]);
});

test('heldPrompt: the prompts herdr may take for the input box, and nothing else', () => {
  for (const name of ['plan', 'two-review', 'multi-review', 'one', 'multi']) assert.ok(c.heldPrompt(screen(name)), name);
  // A permission prompt is herdr's to see; a reply's own list above the input box is no prompt.
  assert.equal(c.heldPrompt(screen('create-file')), null);
  assert.equal(c.heldPrompt('● 두 가지:\n  1. 빨강\n  2. 파랑\n\n────────\n❯ \n────────\n  ? for shortcuts'), null);
  assert.equal(c.heldPrompt(`${screen('plan')}\n────────\n❯\n────────`), null);
});
