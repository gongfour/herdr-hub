'use strict';
// The app's routes (public/route.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('../public/route.js');

test('lists: 작업공간 by default (the old /spaces too), 설정', () => {
  assert.deepEqual(parse('/'), { name: 'list', host: null });
  assert.deepEqual(parse(''), { name: 'list', host: null });
  assert.deepEqual(parse('/spaces'), { name: 'list', host: null });
  assert.deepEqual(parse('/nonsense'), { name: 'list', host: null });
  assert.deepEqual(parse('/settings'), { name: 'settings', host: null });
  assert.deepEqual(parse('/keys'), { name: 'keys', host: null });
});

test('an agent, with its host and the old /screen and /chat tails', () => {
  assert.deepEqual(parse('/h/server/agent/w1%3Ap2'), { name: 'agent', host: 'server', pane: 'w1:p2', sub: null });
  assert.deepEqual(parse('/agent/w1%3Ap2/screen'), { name: 'agent', host: null, pane: 'w1:p2', sub: 'screen' });
  assert.deepEqual(parse('/h/desktop/agent/w1%3Ap2/chat'), { name: 'agent', host: 'desktop', pane: 'w1:p2', sub: 'chat' });
  // Anything else after the pane is not an agent route.
  assert.equal(parse('/agent/w1%3Ap2/other').name, 'list');
});

test('shells, workspaces and the forms', () => {
  assert.deepEqual(parse('/h/server/term/w1%3Ap3'), { name: 'term', host: 'server', pane: 'w1:p3' });
  assert.deepEqual(parse('/h/my%20host/ws/w1'), { name: 'ws', host: 'my host', id: 'w1' });
  assert.deepEqual(parse('/new'), { name: 'form', host: null, mode: 'new' });
  assert.deepEqual(parse('/h/server/new'), { name: 'form', host: 'server', mode: 'new' });
  assert.deepEqual(parse('/h/server/start/ws/w1'), { name: 'form', host: 'server', mode: 'ws', target: 'w1' });
  assert.deepEqual(parse('/start/pane/w1%3Ap4'), { name: 'form', host: null, mode: 'pane', target: 'w1:p4' });
});

test('a host alone is that host\'s 작업공간', () => {
  assert.deepEqual(parse('/h/server'), { name: 'list', host: 'server' });
  assert.deepEqual(parse('/h/server/spaces'), { name: 'list', host: 'server' });
});
