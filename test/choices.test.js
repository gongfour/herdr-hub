'use strict';
// npm test  (node --test test/*.test.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseChoices, choiceKeys } = require('../public/choices.js');

const labels = (c) => c.items.map((x) => x.label);

// Claude Code 2.1.316 folder trust prompt as herdr reads it (visible screen, ANSI stripped).
const TRUST = `
~\\src\\herdr-hub-test5
❯ if((Get-Command claude -ErrorAction SilentlyContinue).CommandType -eq 'ExternalScript'){& claude '--model' haiku}e
lse{Start-Process -FilePath claude -ArgumentList '--model haiku' -NoNewWindow -Wait}

────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 Accessing workspace:

 C:\\Users\\kangw\\src\\herdr-hub-test5

 Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source
 project, or work from your team). If not, take a moment to review what's in this folder first.

 Claude Code'll be able to read, edit, and execute files here.

 Security guide

 ❯ No, exit
   Yes, I trust this folder

 Enter to confirm · Esc to cancel`;

const BASH = `
● Bash(echo hi > note.txt)
  ⎿  Running…

────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 Bash command

   echo hi > note.txt
   Write "hi" to note.txt

 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don't ask again for echo commands in C:\\Users\\kangw\\src\\herdr-hub-test5
   3. No, and tell Claude what to do differently (esc)
`;

// Claude Code 2.1.316 Bash permission prompt (the command sits between dashed rules).
const BASH_NEW = `

❯ Run this exact shell command with the Bash tool and nothing else: echo hi > note.txt

  Ran 1 shell command

● I ran echo hi > note.txt with the Bash tool. It finished with no output, which is expected for a redirect. The
  file is note.txt in the working directory, C:\\Users\\kangw\\src\\herdr-hub-test5. I didn't check its contents.

✻ Sautéed for 4s · done 오전 10:17

❯ Run this exact shell command with the Bash tool and nothing else: echo hi > note2.txt

  Writing "hi" to note2.txt in the working directory
  ⎿  $ echo hi > note2.txt

────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 Bash command
 Tip: auto mode handles these prompts for you — choose "switch to auto mode" below
 Write "hi" to note2.txt in the working directory
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 echo hi > note2.txt
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and always allow access to C:\\Users\\kangw\\src\\herdr-hub-test5 from this project
   3. Yes, and switch to auto mode · auto mode handles these prompts for you
   4. No

 Esc to cancel · Tab to amend`;

test('trust prompt: a menu without numbers, picked with arrows', () => {
  const c = parseChoices(TRUST);
  assert.equal(c.numbered, false);
  assert.equal(c.question, 'Quick safety check: Is this a project you created or one you trust?');
  assert.deepEqual(c.context, ['Accessing workspace:', 'C:\\Users\\kangw\\src\\herdr-hub-test5']);
  assert.deepEqual(labels(c), ['No, exit', 'Yes, I trust this folder']);
  assert.equal(c.cursor, 1);
  assert.deepEqual(c.items.map((x) => x.negative), [true, false]);
  assert.deepEqual(choiceKeys(c, 2), ['down', 'enter']);
  assert.deepEqual(choiceKeys(c, 1), ['enter']);
});

test('bash permission prompt (2.1.316: dashed rules, a Tip line, plain "No")', () => {
  const c = parseChoices(BASH_NEW);
  assert.equal(c.numbered, true);
  assert.equal(c.question, 'Do you want to proceed?');
  assert.deepEqual(c.context, ['Bash command', 'Write "hi" to note2.txt in the working directory', 'echo hi > note2.txt']);
  assert.deepEqual(labels(c), [
    'Yes',
    'Yes, and always allow access to C:\\Users\\kangw\\src\\herdr-hub-test5 from this project',
    'Yes, and switch to auto mode · auto mode handles these prompts for you',
    'No',
  ]);
  assert.equal(c.cursor, 1);
  assert.deepEqual(c.items.map((x) => x.negative), [false, false, false, true]);
  assert.deepEqual(choiceKeys(c, 1), ['1']);
});

test('bash permission prompt (older layout)', () => {
  const c = parseChoices(BASH);
  assert.equal(c.numbered, true);
  assert.equal(c.question, 'Do you want to proceed?');
  assert.deepEqual(c.context, ['Bash command', 'echo hi > note.txt', 'Write "hi" to note.txt']);
  assert.deepEqual(labels(c), [
    'Yes',
    "Yes, and don't ask again for echo commands in C:\\Users\\kangw\\src\\herdr-hub-test5",
    'No, and tell Claude what to do differently (esc)',
  ]);
  assert.equal(c.cursor, 1);
  assert.deepEqual(c.items.map((x) => x.negative), [false, false, true]);
  assert.deepEqual(choiceKeys(c, 3), ['3']);
  assert.equal(choiceKeys(c, 4), null);
});

test('boxed prompt with wrapped options and a "›" cursor', () => {
  const c = parseChoices(`
╭──────────────────────────────────────────────────╮
│ Edit file                                        │
│   src/server.js                                  │
│                                                  │
│ Do you want to make this edit to server.js?      │
│   1. Yes                                         │
│ › 2. Yes, allow all edits during this session    │
│      (shift+tab)                                 │
│   3. No, and tell Claude what to do              │
│      differently (esc)                           │
╰──────────────────────────────────────────────────╯`);
  assert.equal(c.question, 'Do you want to make this edit to server.js?');
  assert.deepEqual(c.context, ['Edit file', 'src/server.js']);
  assert.deepEqual(labels(c), ['Yes', 'Yes, allow all edits during this session (shift+tab)', 'No, and tell Claude what to do differently (esc)']);
  assert.equal(c.cursor, 2);
  assert.deepEqual(c.items.map((x) => x.negative), [false, false, true]);
});

test('">" cursor and options separated by blank lines', () => {
  const c = parseChoices(` Allow this tool?\n\n > 1. Allow\n\n   2. Deny\n`);
  assert.deepEqual(labels(c), ['Allow', 'Deny']);
  assert.equal(c.cursor, 1);
  assert.deepEqual(c.items.map((x) => x.negative), [false, true]);
});

test('no list: nothing to parse', () => {
  assert.equal(parseChoices(''), null);
  assert.equal(parseChoices(null), null);
  assert.equal(parseChoices(`
● I need your input before I continue. Which database should I use?

────────────────────────────────────────
> 
────────────────────────────────────────
  ? for shortcuts`), null);
});

test('numbered lines higher up are noise; the menu at the bottom wins', () => {
  const c = parseChoices(`
● Plan:
  1. Read the config
  2. Patch the parser
  3. Run the tests

● Bash(npm test)

────────────────────────────────────────
 Bash command

   npm test

 Do you want to proceed?
 ❯ 1. Yes
   2. No, and tell Claude what to do differently (esc)
`);
  assert.deepEqual(labels(c), ['Yes', 'No, and tell Claude what to do differently (esc)']);
  assert.equal(c.question, 'Do you want to proceed?');
});

test('numbered lines with lots of output after them are not a prompt', () => {
  const lines = ['● Steps:', '  1. Read', '  2. Write', '  3. Test'];
  for (let i = 0; i < 10; i++) lines.push(`  output line ${i}`);
  assert.equal(parseChoices(lines.join('\n')), null);
});

test('a list that does not start at 1, or skips a number, is not a menu', () => {
  assert.equal(parseChoices(' Pick one?\n ❯ 2. A\n   3. B\n'), null);
  const c = parseChoices(' Pick one?\n ❯ 1. A\n   2. B\n   4. D\n');
  assert.deepEqual(labels(c), ['A', 'B']);
});

test('a menu without numbers whose cursor is far down walks with up/down', () => {
  const c = parseChoices(' Choose?\n   a\n   b\n ❯ c\n');
  assert.equal(c.cursor, 3);
  assert.deepEqual(choiceKeys(c, 1), ['up', 'up', 'enter']);
});

// Claude Code 2.1.317 AskUserQuestion (desktop, haiku): each option's description on its own lines.
const ASK = `
───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 ☐ Color

Which color do you like?

❯ 1. Red
     Choose red.
  2. Blue
     Choose blue.
  3. Green
     A long description that goes on for a while so that it wraps across more than one line on a narrow terminal
     window, to test wrapping.
  4. Type something.
───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  5. Chat about this

Enter to select · ↑/↓ to navigate · Esc to cancel`;

test('AskUserQuestion options split into name and description', () => {
  const c = parseChoices(ASK);
  assert.equal(c.question, 'Which color do you like?');
  assert.deepEqual(labels(c), ['Red', 'Blue', 'Green', 'Type something.']);
  assert.equal(c.items[0].desc, 'Choose red.');
  assert.equal(c.items[2].desc, 'A long description that goes on for a while so that it wraps across more than one line on a narrow terminal window, to test wrapping.');
  assert.equal(c.items[3].desc, undefined);
  assert.equal(c.cursor, 1);
});

test('a name that wraps at the screen edge stays one name', () => {
  const first = "   2. Yes, and don't ask again for commands like this one in the folder C:\\Users\\kangw\\src\\some-long-proj";
  const wide = 'x'.repeat(first.length); // the screen is as wide as the cut line
  const text = `${wide}\n Do you want to proceed?\n ❯ 1. Yes\n${first}\n      ect-name-here\n   3. No\n`;
  const c = parseChoices(text);
  assert.equal(c.items[1].label, "Yes, and don't ask again for commands like this one in the folder C:\\Users\\kangw\\src\\some-long-proj ect-name-here");
  assert.equal(c.items[1].desc, undefined);
});
