'use strict';
// A close hides its pane or workspace until it has landed (public/closing.js), and no longer:
// herdr gives the newest closed id out again after a restart, and that new one must show.
const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../public/closing.js');

const st = (panes, wss = []) => ({
  hostId: 'h',
  agents: panes.map(([pane, workspace]) => ({ pane, workspace })),
  terminals: [],
  workspaces: wss.map((workspace_id) => ({ workspace_id })),
});
const panes = (s) => s.agents.map((a) => a.pane);
const wss = (s) => s.workspaces.map((w) => w.workspace_id);

test('a closed pane is hidden at once and from states that still have it', () => {
  const c = create(15000);
  c.start('h', 'pane', 'w1:p2', 0);
  const s = st([['w1:p1', 'w1'], ['w1:p2', 'w1']]);
  assert.deepEqual(panes(c.filter(s, { now: 1 })), ['w1:p1']);
  assert.deepEqual(panes(c.filter(s, { now: 2 })), ['w1:p1'], 'not landed yet: still hidden');
});

test('once herdr said ok, a state without it ends the hiding: the same id again is new and shows', () => {
  const c = create(15000);
  const k = c.start('h', 'workspace', 'w5', 0);
  c.landed(k);
  // A state built before the close, arriving after the ok: still hidden.
  assert.deepEqual(wss(c.filter(st([['w5:p1', 'w5']], ['w4', 'w5']), { now: 10 })), ['w4']);
  assert.equal(c.size(), 1);
  // The first state without it: landed.
  assert.deepEqual(wss(c.filter(st([], ['w4']), { now: 20 })), ['w4']);
  assert.equal(c.size(), 0);
  // herdr restarted and gave w5 to a new workspace, well within 15 s: it shows.
  const s = c.filter(st([['w5:p1', 'w5']], ['w4', 'w5']), { now: 30 });
  assert.deepEqual(wss(s), ['w4', 'w5']);
  assert.deepEqual(panes(s), ['w5:p1']);
});

test('a state without it before the ok does not end the hiding (a stale one may still come)', () => {
  const c = create(15000);
  const k = c.start('h', 'pane', 'w1:p2', 0);
  c.filter(st([['w1:p1', 'w1']]), { now: 5 });
  assert.equal(c.size(), 1);
  assert.deepEqual(panes(c.filter(st([['w1:p2', 'w1']]), { now: 6 })), []);
  c.landed(k);
  assert.deepEqual(panes(c.filter(st([['w1:p2', 'w1']]), { now: 7 })), [], 'seen after the ok: still the old one');
});

test("the page's own state (already filtered) never ends another close's hiding", () => {
  const c = create(15000);
  const a = c.start('h', 'pane', 'w1:p2', 0);
  c.landed(a);
  const page = c.filter(st([['w1:p1', 'w1'], ['w1:p2', 'w1']]), { now: 1 });
  c.start('h', 'pane', 'w1:p1', 2);
  c.filter(page, { fresh: false, now: 3 });
  assert.equal(c.size(), 2);
  // A stale host state with w1:p2 still hides it.
  assert.deepEqual(panes(c.filter(st([['w1:p2', 'w1']]), { now: 4 })), []);
});

test('a refusal shows it again; the cap ends a close that never answers', () => {
  const c = create(15000);
  const k = c.start('h', 'pane', 'w1:p2', 0);
  c.drop(k);
  assert.deepEqual(panes(c.filter(st([['w1:p2', 'w1']]), { now: 1 })), ['w1:p2']);
  c.start('h', 'pane', 'w1:p3', 0);
  assert.deepEqual(panes(c.filter(st([['w1:p3', 'w1']]), { now: 15000 })), []);
  assert.deepEqual(panes(c.filter(st([['w1:p3', 'w1']]), { now: 15001 })), ['w1:p3']);
});

test("a closed workspace hides its panes; another host's same ids are not touched", () => {
  const c = create(15000);
  c.start('h', 'workspace', 'w2', 0);
  const s = c.filter({ ...st([['w2:p1', 'w2']], ['w2']), terminals: [{ pane: 'w2:p1', workspace: 'w2', host: 'peer' }] }, { now: 1 });
  assert.deepEqual(panes(s), []);
  assert.deepEqual(wss(s), []);
  assert.equal(s.terminals.length, 1);
});
