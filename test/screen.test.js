'use strict';
// Pane reads and their fallbacks (lib/screen.js), against a stubbed herdr.
const test = require('node:test');
const assert = require('node:assert/strict');
const { screenReader } = require('../lib/screen');

const herr = (code, message = code) => Object.assign(new Error(message), { code });
function stub(fail) {
  const calls = [];
  const call = async (method, params) => {
    calls.push(params);
    const err = fail(params);
    if (err) throw err;
    return { read: { text: 'hi', truncated: false, format: params.format === 'ansi' ? 'ansi' : 'text' } };
  };
  return { call, calls };
}

test('reads what was asked, plain or coloured', async () => {
  const h = stub(() => null);
  const read = screenReader(h.call, () => {});
  assert.deepEqual(await read('pane.read', { pane_id: 'w1:p1' }, 'recent_unwrapped', 200, 'ansi'), { text: 'hi', truncated: false, source: 'recent_unwrapped', format: 'ansi' });
  assert.deepEqual(h.calls[0], { pane_id: 'w1:p1', source: 'recent_unwrapped', lines: 200, format: 'ansi', strip_ansi: false });
  assert.equal((await read('agent.read', { target: 'w1:p1' }, 'nonsense', 30)).source, 'recent');
  assert.equal(h.calls[1].strip_ansi, true);
});

test('a working agent is read on its visible screen', async () => {
  const h = stub((p) => (p.source !== 'visible' ? herr('agent_not_idle') : null));
  const r = await screenReader(h.call, () => {})('agent.read', { target: 'w1:p1' }, 'recent', 80);
  assert.equal(r.source, 'visible');
});

test('no ansi or recent_unwrapped on this herdr: plain recent, remembered', async () => {
  const h = stub((p) => (p.format === 'ansi' ? herr('invalid_request', 'unknown field format') : p.source === 'recent_unwrapped' ? herr('invalid_request', 'bad source') : null));
  const logs = [];
  const read = screenReader(h.call, (l) => logs.push(l));
  assert.deepEqual(await read('pane.read', { pane_id: 'w1:p1' }, 'recent_unwrapped', 200, 'ansi'), { text: 'hi', truncated: false, source: 'recent', format: 'text' });
  assert.equal(logs.length, 2);
  const before = h.calls.length;
  await read('pane.read', { pane_id: 'w1:p1' }, 'recent_unwrapped', 200, 'ansi');
  assert.equal(h.calls.length, before + 1); // straight to what works
});

test('a pane that is gone is an error, not a fallback', async () => {
  const h = stub(() => herr('pane_not_found'));
  await assert.rejects(screenReader(h.call, () => {})('pane.read', { pane_id: 'w9:p9' }, 'recent_unwrapped', 200), { code: 'pane_not_found' });
  assert.equal(h.calls.length, 1);
});
