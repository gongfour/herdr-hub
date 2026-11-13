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

// ---- the input box read with its colours (herdr's ansi format)
// As plain text Claude Code's grey text in an empty input (the prompt it suggests next, its
// "Try …" tip, the queued-messages hint) reads the same as words typed there; only the colours
// tell them apart: Claude draws them dim (SGR 2), typed words not. A message sent from here on top
// of typed words would be appended to them and sent together.
const ESC_RE = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;
const stripAnsi = (s) => String(s || '').replace(ESC_RE, '').replace(/\r/g, '');
// Claude's IDE pill right after the ❯ ([⧉ 3 lines selected], [⧉ In src/x.ts]): in the theme's
// colour, not dim, and no input either.
const IDE_PILL = /^\s?\[⧉ [^\]\n]+\] ?/;
const TIP = /^Try "/;
// [text, dim, inverse] runs of an ANSI line. 38/48/58 colours are skipped whole (the 2 of
// 38;2;r;g;b is a colour mode, not dim).
function sgrRuns(line) {
  const runs = [];
  let dim = false;
  let inverse = false;
  let at = 0;
  const re = /\u001b(?:\[([0-?]*)[ -/]*([@-~])|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;
  for (const m of line.matchAll(re)) {
    if (m.index > at) runs.push([line.slice(at, m.index), dim, inverse]);
    at = m.index + m[0].length;
    if (m[2] !== 'm') continue;
    const codes = (m[1] || '0').split(/[;:]/).map((c) => Number(c || 0));
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 38 || c === 48 || c === 58) i += codes[i + 1] === 5 ? 2 : codes[i + 1] === 2 ? 4 : 0;
      else if (c === 0) dim = inverse = false;
      else if (c === 22) dim = false;
      else if (c === 2) dim = true;
      else if (c === 27) inverse = false;
      else if (c === 7) inverse = true;
    }
  }
  if (at < line.length) runs.push([line.slice(at), dim, inverse]);
  return runs;
}
// The input box of an ANSI screen -> { typed, grey } (typed: the words a person typed there, '' when
// none; grey: Claude's dim text there, its suggestion when not the tip or the queue hint, else null),
// or null when the screen shows no input box. A cursor Claude draws itself (inverse, on the first
// grey character) is neither.
function promptBoxAnsi(ansi) {
  const raw = String(ansi || '').replace(/\s+$/, '').split('\n').map((l) => l.replace(/\r$/, ''));
  const plain = raw.map(stripAnsi);
  for (let i = plain.length - 1; i > 0; i--) {
    if (!/^❯/.test(plain[i]) || !RULE.test(plain[i - 1])) continue;
    let typed = '';
    let grey = '';
    let cursor = ''; // the inverse character at the box's start: Claude's own cursor
    for (let j = i; j < plain.length && !RULE.test(plain[j]); j++) {
      let seen = j > i; // past the ❯ (on the first row)
      let pill = j === i ? [...(plain[j].replace(/^❯/, '').match(IDE_PILL) || [''])[0]].length : 0;
      for (const [run, dim, inverse] of sgrRuns(raw[j])) {
        for (const ch of run) {
          if (!seen) {
            seen = ch === '❯';
            continue;
          }
          if (pill > 0) {
            pill--;
            continue;
          }
          const blank = ch.trim() === '' || ch === '\u00a0';
          if (dim) grey += ch;
          else if (blank) {
            if (typed) typed += ' ';
            else if (grey) grey += ' ';
          } else if (inverse && !typed && !grey && !cursor) cursor = ch;
          else typed += ch;
        }
      }
      if (j > i && typed) typed += '\n';
    }
    // A cursor with nothing grey after it sits on a typed letter, else on the grey text's first.
    if (cursor && !grey.trim()) typed = cursor + typed;
    else if (cursor) grey = cursor + grey;
    typed = typed.trim();
    grey = grey.replace(/\s+/g, ' ').trim();
    return { typed, grey: !grey || TIP.test(grey) || boxEmpty(grey) ? null : grey };
  }
  return null;
}

module.exports = { queueOps, replay, typed, hasImage, sameQueued, promptBox, boxEmpty, boxHolds, sameText, stripAnsi, promptBoxAnsi };
