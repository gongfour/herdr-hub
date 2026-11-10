'use strict';
// lib/askhold.js on its own: a fake screen and clock, refreshes that overlap.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { askHold, ASK_RECHECK_MS, HELD_RECHECK_MS } = require('../lib/askhold');

const DIALOG = fs.readFileSync(path.join(__dirname, 'fixtures', 'dialog', 'auto-mode-env.txt'), 'utf8');
const MENU = fs.readFileSync(path.join(__dirname, 'fixtures', 'menu', 'model.txt'), 'utf8');
const IDLE = '● Done.\n\n────────────────────────────────────────\n❯ \n────────────────────────────────────────\n  ? for shortcuts';
const agent = (status, seq) => ({ pane: 'p1', agent: 'claude', status, stateSeq: seq });

// A screen the test sets; each read can be held back (resolved by the test) to make it late.
function fakeScreen() {
  const s = { text: IDLE, reads: 0, gates: [] };
  s.readScreen = () => {
    s.reads++;
    const text = s.text;
    if (!s.gates.length) return Promise.resolve({ text });
    const gate = s.gates.shift();
    return gate.then(() => ({ text }));
  };
  s.later = () => {
    let open;
    s.gates.push(new Promise((r) => (open = r)));
    return () => open();
  };
  return s;
}

test('a dialog on an idle agent is held as blocked; gone from the screen, the hold goes', async () => {
  let t = 1e12;
  const s = fakeScreen();
  const asks = askHold({ readScreen: s.readScreen, now: () => t });
  s.text = DIALOG;
  const a = agent('idle', 4);
  await asks.hold(a);
  assert.equal(a.status, 'blocked');
  assert.deepEqual(asks.held.get('p1'), { seq: 4, from: null, dialog: true, menu: false });
  // Held for a dialog: read again every HELD_RECHECK_MS, not before.
  s.text = IDLE;
  const b = agent('idle', 4);
  await asks.hold(b);
  assert.equal(b.status, 'blocked');
  t += HELD_RECHECK_MS;
  const c = agent('idle', 4);
  await asks.hold(c);
  assert.equal(c.status, 'idle');
  assert.equal(asks.held.has('p1'), false);
});

test('a slash command menu is held with menu: true; only claude agents are read', async () => {
  const s = fakeScreen();
  const asks = askHold({ readScreen: s.readScreen });
  s.text = MENU;
  const a = agent('idle', 9);
  await asks.hold(a);
  assert.equal(a.status, 'blocked');
  assert.equal(a.menu, true);
  const other = { pane: 'p2', agent: 'codex', status: 'idle', stateSeq: 1 };
  const before = s.reads;
  await asks.hold(other);
  assert.equal(s.reads, before);
  assert.equal(other.status, 'idle');
});

test('overlap: an older state neither ends a newer hold nor sets one for itself', async () => {
  let t = 1e12;
  const s = fakeScreen();
  let was = null;
  const asks = askHold({ readScreen: s.readScreen, now: () => t, wasOf: () => was });
  s.text = IDLE;
  await asks.hold(agent('idle', 4)); // seen, nothing held
  was = { seq: 4 };
  // The newer refresh (seq 5) holds the dialog.
  s.text = DIALOG;
  const newer = agent('idle', 5);
  await asks.hold(newer);
  assert.equal(newer.status, 'blocked');
  was = { seq: 5 };
  // The late one comes with seq 4: the hold stays at 5, and its own read (it reads the dialog
  // too) doesn't put one at 4 over it.
  await asks.hold(agent('idle', 4));
  assert.equal(asks.held.get('p1').seq, 5);
  const next = agent('idle', 5);
  await asks.hold(next);
  assert.equal(next.status, 'blocked');
});

test('overlap: a read still on its way for an older state is followed by this state\'s read', async () => {
  const t = 1e12;
  const s = fakeScreen();
  let was = null;
  const asks = askHold({ readScreen: s.readScreen, now: () => t, wasOf: () => was });
  // seq 4's read hangs.
  const open = s.later();
  const first = asks.hold(agent('idle', 4));
  was = { seq: 4 };
  // seq 5 (a change herdr reports): its read follows the hanging one instead of waiting 15 s.
  s.text = DIALOG;
  const a = agent('done', 5);
  const second = asks.hold(a);
  open();
  await Promise.all([first, second]);
  assert.equal(s.reads, 2);
  assert.equal(a.status, 'blocked');
  assert.equal(asks.held.get('p1').seq, 5);
  assert.equal(asks.held.get('p1').from, 4);
});

test('the clock: an unheld agent is read every ASK_RECHECK_MS; recheck reads at the next refresh', async () => {
  let t = 1e12;
  const s = fakeScreen();
  const asks = askHold({ readScreen: s.readScreen, now: () => t });
  await asks.hold(agent('idle', 4));
  await asks.hold(agent('idle', 4));
  assert.equal(s.reads, 1);
  t += ASK_RECHECK_MS;
  await asks.hold(agent('idle', 4));
  assert.equal(s.reads, 2);
  asks.recheck('p1');
  await asks.hold(agent('idle', 4));
  assert.equal(s.reads, 3);
});

test('prune drops gone panes; watchMenu reads again while a menu draws; close stops it', async () => {
  const s = fakeScreen();
  let refreshes = 0;
  const asks = askHold({ readScreen: s.readScreen, refresh: () => refreshes++ });
  s.text = DIALOG;
  await asks.hold(agent('idle', 4));
  asks.prune(new Set(['other']));
  assert.equal(asks.held.size, 0);
  asks.watchMenu('p1');
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(refreshes, 1); // the 0.6 s read
  asks.close();
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal(refreshes, 1); // the 1.5 s one never came
});
