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
  assert.deepEqual(parse('/h/server/dir/ws/w%3A1'), { name: 'form', host: 'server', mode: 'dir', target: 'w:1' });
  assert.deepEqual(parse('/start/pane/w1%3Ap4'), { name: 'form', host: null, mode: 'pane', target: 'w1:p4' });
});

test('a host alone is that host\'s 작업공간', () => {
  assert.deepEqual(parse('/h/server'), { name: 'list', host: 'server' });
  assert.deepEqual(parse('/h/server/spaces'), { name: 'list', host: 'server' });
});

test('저장소: the list, a graph, a commit or worktree, a file in it', () => {
  const p = parse;
  assert.deepEqual(p('/repos'), { name: 'repos', host: null });
  assert.deepEqual(p('/h/desktop/repos'), { name: 'repos', host: 'desktop' });
  assert.deepEqual(p('/h/desktop/repo/0123456789ab'), { name: 'repo', host: 'desktop', id: '0123456789ab', c: null, w: null, f: null });
  assert.deepEqual(p('/h/d/repo/0123456789ab/c/abc1234'), { name: 'repo', host: 'd', id: '0123456789ab', c: 'abc1234', w: null, f: null });
  // A path is one encoded segment (its slashes too).
  assert.deepEqual(p(`/h/d/repo/0123456789ab/c/abc1234/f/${encodeURIComponent('lib/a b.js')}`).f, 'lib/a b.js');
  assert.deepEqual(p('/h/d/repo/0123456789ab/w/1a2b3c4d/f/x.txt'), { name: 'repo', host: 'd', id: '0123456789ab', c: null, w: '1a2b3c4d', f: 'x.txt' });
  // A file needs a commit or a worktree.
  assert.equal(p('/h/d/repo/0123456789ab/f/x.txt').name, 'list');
});
