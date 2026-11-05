'use strict';
// lib/router.js: the API's route table.
const test = require('node:test');
const assert = require('node:assert/strict');
const { route, matchRoute, dispatch, NEXT } = require('../lib/router');

test('patterns: literals, :params, a last * for any rest; method or *', () => {
  const r = route('POST', 'agents/:pane/answer/*', () => {});
  assert.deepEqual(matchRoute(r, 'POST', ['agents', 'w1-p2', 'answer']), { pane: 'w1-p2' });
  assert.deepEqual(matchRoute(r, 'POST', ['agents', 'w1-p2', 'answer', 'x', 'y']), { pane: 'w1-p2' });
  assert.equal(matchRoute(r, 'GET', ['agents', 'w1-p2', 'answer']), null);
  assert.equal(matchRoute(r, 'POST', ['agents', 'w1-p2']), null);
  assert.equal(matchRoute(r, 'POST', ['agent', 'w1-p2', 'answer']), null);
  const exact = route('GET', 'version', () => {});
  assert.deepEqual(matchRoute(exact, 'GET', ['version']), {});
  assert.equal(matchRoute(exact, 'GET', ['version', 'x']), null);
  const any = route('*', 'push/*', () => {});
  assert.deepEqual(matchRoute(any, 'DELETE', ['push']), {});
  assert.equal(matchRoute(any, 'GET', []), null);
});

test('dispatch: the first row that answers; NEXT goes on with what the row put on m', async () => {
  const seen = [];
  const rows = [
    route('*', 'a/:id/*', (req, res, m) => {
      seen.push('guard');
      if (m.params.id === 'stop') return 'stopped';
      m.found = m.params.id;
      return NEXT;
    }),
    route('GET', 'a/:id/x', (req, res, m) => seen.push(`x ${m.found}`)),
    route('GET', 'a/:id/*', () => seen.push('rest')),
  ];
  const run = (method, parts) => dispatch(rows, null, null, { method, parts, params: {} });
  assert.equal(await run('GET', ['a', '1', 'x']), true);
  assert.equal(await run('GET', ['a', 'stop', 'x']), true);
  assert.equal(await run('GET', ['a', '2', 'y']), true);
  assert.equal(await run('POST', ['a', '3', 'x']), false);
  assert.equal(await run('GET', ['b']), false);
  assert.deepEqual(seen, ['guard', 'x 1', 'guard', 'guard', 'rest', 'guard']);
});
