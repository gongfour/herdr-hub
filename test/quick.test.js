'use strict';
// Ctrl+N's quick start and the new chat that closes without asking (public/quick.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const Q = require('../public/quick.js');

function fakeStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  const s = { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  return () => s;
}

test('the remembered kind and options: Claude with none at first, then what was last started', () => {
  const st = fakeStorage();
  assert.deepEqual(Q.lastAgent(st), { kind: 'claude', args: [] });
  Q.rememberAgent(st, { kind: 'codex', args: ['--model', 'o4', ''], name: 'x' });
  assert.deepEqual(Q.lastAgent(st), { kind: 'codex', args: ['--model', 'o4'] });
  assert.equal(st().m.get('herdr-hub.lastAgent'), '{"kind":"codex","args":["--model","o4"]}'); // no name kept
  Q.rememberAgent(st, { kind: 'Bad Kind', args: [] }); // nonsense is not stored
  assert.equal(Q.lastAgent(st).kind, 'codex');
});

test('the remembered value read back safely: junk, a bad kind or bad args fall back', () => {
  assert.deepEqual(Q.lastAgent(fakeStorage({ 'herdr-hub.lastAgent': '{oops' })), { kind: 'claude', args: [] });
  assert.deepEqual(Q.lastAgent(fakeStorage({ 'herdr-hub.lastAgent': '{"kind":"rm -rf"}' })), { kind: 'claude', args: [] });
  assert.deepEqual(Q.lastAgent(fakeStorage({ 'herdr-hub.lastAgent': '{"kind":"gemini","args":[1,2]}' })), { kind: 'gemini', args: [] });
  const throwing = () => ({ getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } });
  assert.deepEqual(Q.lastAgent(throwing), { kind: 'claude', args: [] });
  Q.rememberAgent(throwing, { kind: 'codex' }); // private mode: no throw
});

test('specFor: the last kind where the host has it, else Claude, else its first; the server names it', () => {
  const last = { kind: 'codex', args: ['--full-auto'] };
  assert.deepEqual(Q.specFor(last, ['claude', 'codex']), { kind: 'codex', args: ['--full-auto'], name: '' });
  assert.deepEqual(Q.specFor(last, ['claude', 'gemini']), { kind: 'claude', args: [], name: '' });
  assert.deepEqual(Q.specFor(last, ['gemini']), { kind: 'gemini', args: [], name: '' });
  assert.deepEqual(Q.specFor(last, null), { kind: 'codex', args: ['--full-auto'], name: '' }); // host info unknown
});

test('started here, then used: a send of any kind to it marks it, a rename does not', () => {
  const st = fakeStorage();
  const key = 'mac|p7';
  assert.equal(Q.startedState(st, key), 0);
  Q.markUsed(st, key); // not started here: stays unknown
  assert.equal(Q.startedState(st, key), 0);
  Q.markStarted(st, key);
  assert.equal(Q.startedState(st, key), 1);
  Q.markUsed(st, key);
  assert.equal(Q.startedState(st, key), 2);
  Q.markStarted(st, 'mac|p8');
  assert.equal(Q.startedState(st, 'mac|p8'), 1);
  assert.equal(Q.startedState(st, key), 2);
});

test('usedBy: the agent a write goes to, on this host or a peer', () => {
  assert.equal(Q.usedBy('/agents/p7/prompt', 'mac'), 'mac|p7');
  assert.equal(Q.usedBy('/agents/p7/keys', 'mac'), 'mac|p7');
  assert.equal(Q.usedBy('/agents/p7/answer', 'mac'), 'mac|p7');
  assert.equal(Q.usedBy('/peers/desktop/agents/p%3A1/prompt', 'mac'), 'desktop|p:1');
  assert.equal(Q.usedBy('/agents/p7/rename', 'mac'), null);
  assert.equal(Q.usedBy('/panes/p7/close', 'mac'), null);
  assert.equal(Q.usedBy('/workspaces/w1/agents', 'mac'), null);
});

test('unused: only a chat started here, never used, with no user message and nothing waiting', () => {
  const none = [];
  const reply = [{ role: 'assistant', text: 'hi' }];
  const asked = [{ role: 'user', text: 'hello' }];
  assert.equal(Q.unused({ state: 1, messages: none }), true);
  assert.equal(Q.unused({ state: 1, messages: reply }), true);
  assert.equal(Q.unused({ state: 1, messages: asked }), false); // someone wrote to it (another device too)
  assert.equal(Q.unused({ state: 0, messages: none }), false); // not started here
  assert.equal(Q.unused({ state: 2, messages: none }), false); // sent to from here
  assert.equal(Q.unused({ state: 1, messages: none, pending: 1 }), false);
  assert.equal(Q.unused({ state: 1, messages: none, working: true }), false);
  assert.equal(Q.unused({ state: 1, messages: null }), false); // its chat not loaded: ask
  assert.equal(Q.unused({ state: 1, messages: null, noTranscript: true }), true); // a screen-only agent
  assert.equal(Q.unused({ state: 2, messages: null, noTranscript: true }), false);
});

test('Ctrl+N starts in the open pane\'s folder, else the last viewed in that workspace, else herdr picks', () => {
  const panes = [
    { href: '#/h/mac/agent/w1-p1', workspace: 'w1', cwd: '/a' },
    { href: '#/h/mac/term/w1-p2', workspace: 'w1', cwd: '/b' },
    { href: '#/h/mac/agent/w2-p1', workspace: 'w2', cwd: '/c' },
    { href: '#/h/mac/agent/w1-p3', workspace: 'w1', cwd: '' },
  ];
  const recent = ['#/h/mac/agent/w2-p1', '#/h/mac/agent/w1-p3', '#/h/mac/term/w1-p2', '#/h/mac/agent/w1-p1'];
  // What is open wins, in its own workspace.
  assert.equal(Q.startFolder({ open: { workspace: 'w1', cwd: '/here' }, ws: 'w1', panes, recent }), '/here');
  // Open elsewhere (another workspace) or without a folder: the last one viewed in ws that has one.
  assert.equal(Q.startFolder({ open: { workspace: 'w2', cwd: '/c' }, ws: 'w1', panes, recent }), '/b');
  assert.equal(Q.startFolder({ open: { workspace: 'w1', cwd: '' }, ws: 'w1', panes, recent }), '/b');
  assert.equal(Q.startFolder({ ws: 'w1', panes, recent: ['#/h/mac/agent/w1-p1'] }), '/a');
  // Nothing viewed there (or gone): herdr's active tab.
  assert.equal(Q.startFolder({ ws: 'w1', panes, recent: ['#/h/mac/agent/w2-p1', '#/h/mac/agent/gone'] }), '');
  assert.equal(Q.startFolder({ ws: 'w3', panes, recent }), '');
  assert.equal(Q.startFolder(), '');
  // The workspace's 기본 폴더: after what is open, before the last one viewed.
  assert.equal(Q.startFolder({ open: { workspace: 'w1', cwd: '/here' }, ws: 'w1', def: '/def', panes, recent }), '/here');
  assert.equal(Q.startFolder({ open: { workspace: 'w2', cwd: '/c' }, ws: 'w1', def: '/def', panes, recent }), '/def');
  assert.equal(Q.startFolder({ ws: 'w1', def: '/def', panes, recent }), '/def');
  assert.equal(Q.startFolder({ ws: 'w3', def: '/def' }), '/def');
});
