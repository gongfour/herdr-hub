'use strict';
// npm test  (node --test test/*.test.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseActivity, formatElapsed, elapsedSeconds } = require('../public/activity.js');

const RULE = '─'.repeat(120);
const FOOTER = `${RULE}\n❯\n${RULE}\n  ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt\n`;

// Claude Code 2.1.x on macOS (herdr agent read --source visible), a shell command running.
const RUNNING = `
⏺ I need to read app.js fully.

  Read 1 file, listed 1 directory, ran 3 shell commands

⏺ Reading the code is done. Next I'll collect real Claude spinner lines from live screens (read-only) to build the
  parser.

⏺ Running S=/private/tmp/claude-501/-Users-alex-Project-pad…
  ⎿  $ S=/private/tmp/claude-501/scratchpad; mkdir -p
     $S/samples; (for i in $(seq 1 90); do herdr agent read w9:p5 --source visible --lines 40 > $S/samples/mac-$i.txt
     2>&1; sleep 2; done) >/dev/null 2>&1 &
     echo started

· Clauding… (40s · ↓ 2.1k tokens · thought for 1s)

${FOOTER}`;

// Same session a little later: only prose above, thinking.
const THINKING = `
⏺ Reading the code is done. Next I'll collect real Claude spinner lines from live screens (read-only) to build the
  parser.

✳ Clauding… (1m 13s · ↓ 2.7k tokens · thinking more)

${FOOTER}`;

// Claude Code 2.1.317 on Windows (desktop, haiku), the Read tool running: ● bullets, a Tip under
// the spinner.
const WINDOWS = `● done

✻ Churned for 46s · done 오후 1:44

❯ Use the Bash tool to run: sleep 15 . Then read the file named nothing.txt with the Read tool (it may not exist). Then reply done.

● Reading nothing.txt · 3s
  ⎿  nothing.txt (3s)
     (ctrl+b to run in background)

✻ Wibbling… (5s · ↓ 94 tokens)
  ⎿  Tip: You have 5 plugins you haven't used lately. Disable them with /plugin to free up context and speed up startup.

───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
❯
───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

  ⏵⏵ auto mode on (shift+tab to cycle)
`;

// Claude Code 2.1.317 on macOS (server, haiku): the Bash tool running, a Tip under the spinner.
const MAC_TIP = ` ▐▛███▛█   Claude Code v2.1.317
▝▜██████▀  Haiku 5.5 · Claude Ultra
 ▝▝   ▝▝   ~/herdr-hub-co-server

❯ Use the Bash tool to run the command: sleep 20 . When it
  finishes, run sleep 20 again as a second separate Bash
  call. Then reply with just the word done.

  Ran 2 shell commands

⏺ done

✻ Brewed for 47s · done 1:46 PM

❯ Use the Bash tool to run: sleep 15 . Then read the file
  named nothing.txt with the Read tool (it may not exist).
  Then reply done.

  Sleeping for 15 seconds
  ⎿  $ sleep 15

✽ Envisioning… (19s · ↓ 82 tokens)
  ⎿  Tip: You can control how big a workflow is just by
     prompting. Ask for a small workflow, cap it with "use
     at most 5 agents", or set a default with Dynamic
     workflow size in /config.

────────────────────────────────────────────────────────────
❯
────────────────────────────────────────────────────────────
  ⏵⏵ auto mode on (shift+tab to cycle) · esc to interrupt
`;

test('real Windows screen: ● tool bullet without its timer, Tip lines below the spinner', () => {
  const a = parseActivity(WINDOWS);
  assert.equal(a.word, 'Wibbling…');
  assert.equal(a.seconds, 5);
  assert.equal(a.tokens, '↓ 94 tokens');
  assert.equal(a.tool, 'Reading nothing.txt');
});

test('real macOS screen: the running tool caught with its bullet blinked off, a Tip below', () => {
  const a = parseActivity(MAC_TIP);
  assert.equal(a.word, 'Envisioning…');
  assert.equal(a.seconds, 19);
  assert.equal(a.tool, 'Sleeping for 15 seconds');
  // Collapsed groups ("Ran 2 shell commands") and prose continuations are not tools.
  assert.equal(parseActivity(`  Ran 2 shell commands\n\n⏺ I'll look at it.\n  It is short.\n\n✻ Brewing… (2s)\n${FOOTER}`).tool, null);
});

test('a finished turn ("Brewed for 22s") is not activity', () => {
  assert.equal(parseActivity(`⏺ done\n\n✻ Brewed for 22s · done 1:47 PM\n${FOOTER}`), null);
});

test('reads the spinner line with elapsed time, tokens and the running tool', () => {
  const a = parseActivity(RUNNING);
  assert.equal(a.word, 'Clauding…');
  assert.equal(a.elapsed, '40s');
  assert.equal(a.seconds, 40);
  assert.equal(a.tokens, '↓ 2.1k tokens');
  assert.equal(a.detail, 'thought for 1s');
  assert.equal(a.tool, 'Running S=/private/tmp/claude-501/-Users-alex-Project-pad…');
});

test('minutes and seconds; prose bullets are not tools', () => {
  const a = parseActivity(THINKING);
  assert.equal(a.word, 'Clauding…');
  assert.equal(a.seconds, 73);
  assert.equal(a.detail, 'thinking more');
  assert.equal(a.tool, null);
});

test('every spinner frame glyph', () => {
  for (const g of ['·', '✢', '✳', '✶', '✻', '✽', '*']) {
    const a = parseActivity(`${g} Clauding… (1m 1s · ↓ 2.7k tokens · thinking)\n\n${FOOTER}`);
    assert.ok(a, g);
    assert.equal(a.seconds, 61, g);
  }
});

test('the examples from the brief', () => {
  const a = parseActivity(`✻ Flowing… (1m 17s · ↓ 5.1k tokens)\n${FOOTER}`);
  assert.deepEqual([a.word, a.elapsed, a.seconds, a.tokens, a.detail], ['Flowing…', '1m 17s', 77, '↓ 5.1k tokens', null]);
  const b = parseActivity(`· Thinking…\n${FOOTER}`);
  assert.deepEqual([b.word, b.elapsed, b.seconds], ['Thinking…', null, null]);
});

test('older layout with "esc to interrupt" in the brackets, and hours', () => {
  const a = parseActivity(`✶ Pondering… (1h 2m 3s · ↑ 812 tokens · esc to interrupt)\n${FOOTER}`);
  assert.equal(a.seconds, 3723);
  assert.equal(a.tokens, '↑ 812 tokens');
  assert.equal(a.detail, null);
});

test('a todo activeForm as the spinner text', () => {
  const a = parseActivity(`✻ Writing the activity parser… (2m 5s · ↓ 9.3k tokens)\n${FOOTER}`);
  assert.equal(a.word, 'Writing the activity parser…');
  assert.equal(a.seconds, 125);
});

test('classic tool call blocks', () => {
  const screen = `⏺ Bash(npm test)
  ⎿  Running…

⏺ Update(public/app.js)
  ⎿  Updated public/app.js with 3 additions

✽ Brewing… (12s · ↓ 300 tokens)
${FOOTER}`;
  assert.equal(parseActivity(screen).tool, 'Update: public/app.js');
  const mcp = parseActivity(`⏺ zenmon - list_topics (MCP)(filter: "x")\n  ⎿  …\n\n✻ Brewing… (3s)\n${FOOTER}`);
  assert.equal(mcp.tool, 'zenmon - list_topics (MCP)(filter: "x")');
});

test('Windows screens with CRLF', () => {
  const a = parseActivity(`⏺ Bash(dir)\r\n  ⎿  Running…\r\n\r\n* Clauding… (5s · ↓ 10 tokens)\r\n${FOOTER.replace(/\n/g, '\r\n')}`);
  assert.equal(a.seconds, 5);
  assert.equal(a.tool, 'Bash: dir');
});

test('nothing to read: idle screens, prose ending in an ellipsis, empty input', () => {
  assert.equal(parseActivity(`⏺ Done. The tests pass.\n\n${FOOTER}`), null);
  assert.equal(parseActivity(`· and then it went on and on and on for a while…\n${FOOTER}`), null);
  assert.equal(parseActivity('$ ls\nREADME.md\n$ '), null);
  assert.equal(parseActivity(''), null);
  assert.equal(parseActivity(null), null);
  // A spinner far above the bottom (scrolled transcript) is not the current one.
  assert.equal(parseActivity(`✻ Clauding… (3s)\n${'line\n'.repeat(40)}`), null);
});

test('formatElapsed writes time like Claude Code', () => {
  assert.equal(formatElapsed(0), '0s');
  assert.equal(formatElapsed(59), '59s');
  assert.equal(formatElapsed(77), '1m 17s');
  assert.equal(formatElapsed(3723), '1h 2m');
  assert.equal(formatElapsed(-5), '0s');
  assert.equal(elapsedSeconds('1m 17s'), 77);
  assert.equal(elapsedSeconds('thinking'), null);
});
