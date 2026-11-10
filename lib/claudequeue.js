'use strict';
// 대기 중 취소: taking one prompt back out of Claude Code's queue (prompts sent while it works wait
// there until a tool call or the turn ends) without stopping the turn. Claude Code 2.1.31x has no
// key for one queued prompt: ↑ on an empty input pulls them all back into the input, one per line
// (its message queue's popAll; picking one needs CLAUDE_CODE_KB_COHESION_FIXES, which nothing
// sets), Ctrl+U then clears the input (it kills a line's text, then the line break before it), and
// the ones kept are sent again, so they queue again in their order. Esc is never pressed: it is
// chat:cancel and stops the turn. Every queue change is a 'queue-operation' entry in the session's
// transcript (enqueue, dequeue, remove, popAll), so the queue is read from there, not guessed.

const sameText = (s) => String(s).replace(/\s+/g, ' ').trim();
const flat = (s) => String(s).replace(/\s+/g, '');

// The 'queue-operation' entries in a piece of transcript text, in order: [{ op, content }].
function queueOps(text) {
  const ops = [];
  for (const line of String(text).split('\n')) {
    if (!line.includes('"queue-operation"')) continue;
    try {
      const e = JSON.parse(line);
      if (e.type === 'queue-operation' && typeof e.operation === 'string') ops.push({ op: e.operation, content: typeof e.content === 'string' ? e.content : null });
    } catch {}
  }
  return ops;
}

// What is queued after these entries. A tail of the transcript may start after an enqueue; what
// it no longer has is not guessed at (a dequeue or remove of something unseen changes nothing).
function replay(ops, queue = []) {
  const q = [...queue];
  for (const { op, content } of ops) {
    if (op === 'enqueue' && content != null) q.push(content);
    else if (op === 'dequeue') q.shift();
    else if ((op === 'remove' || op === 'popAll') && content != null) {
      const i = q.indexOf(content);
      if (i >= 0) q.splice(i, 1);
    }
  }
  return q;
}

// Harness notes (a background task's notification, a reminder) also queue, but ↑ leaves them
// there: only what a person typed comes back into the input.
const typed = (c) => !/^\s*</.test(c);
// An image in a queued prompt is an attachment that sending the words again would lose.
const hasImage = (c) => /\[Image #\d+\]/.test(c);
// A bubble's words against a queued prompt: the photos' lines (an upload's path, or the
// "[Image #N]" Claude Code made of it) are not in the bubble.
const UPLOAD_LINE = /^\s*\S*[\\/](?:(?:herdr-hub|paddock)-)?uploads[\\/]\d{8}-\d{6}-[0-9a-f]{8}\.(?:jpg|png|webp)\s*$/; // data/uploads, or the temp folder before
function sameQueued(content, text) {
  const words = String(content)
    .replace(/\[Image #\d+\]/g, '')
    .split('\n')
    .filter((l) => !UPLOAD_LINE.test(l))
    .join('\n');
  return sameText(words) === sameText(text);
}

// The input box on a Claude Code screen: the lines between the last two rules, the first one
// after "❯". -> its text (lines joined by \n, the indent gone), or null when there is none.
const RULE = /^\s*─{4,}/;
function promptBox(screen) {
  const lines = String(screen || '').replace(/\s+$/, '').split('\n');
  for (let i = lines.length - 1; i > 0; i--) {
    if (!/^❯/.test(lines[i]) || !RULE.test(lines[i - 1])) continue;
    const box = [];
    for (let j = i; j < lines.length && !RULE.test(lines[j]); j++) box.push(j === i ? lines[j].replace(/^❯\s?/, '') : lines[j].replace(/^ {1,2}/, ''));
    return box.join('\n').replace(/\s+$/, '');
  }
  return null;
}
// An empty input shows a hint in it while something is queued ("Press up to edit queued
// messages"), or nothing.
const boxEmpty = (t) => t === '' || /^Press (up|↑) to /.test(t);
// The input holds exactly these prompts (one per line; a long one wraps).
const boxHolds = (t, list) => flat(t) === flat(list.join('\n'));

module.exports = { queueOps, replay, typed, hasImage, sameQueued, promptBox, boxEmpty, boxHolds, sameText };
