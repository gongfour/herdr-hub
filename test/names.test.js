'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { slug, sanitize, unique, defaultName, RULE } = require('../lib/names');

test('folder and workspace names become herdr agent names', () => {
  assert.equal(slug('hub-pol-d1'), 'hub-pol-d1');
  assert.equal(slug('Hub Pol D1'), 'hub-pol-d1');
  assert.equal(slug('café_2'), 'cafe_2');
  assert.equal(slug('12-test'), 'test');
  assert.equal(slug('--a--b--'), 'a-b');
  assert.equal(slug('my.project (old)'), 'my-project-old');
  assert.equal(slug('프로젝트'), '');
  assert.equal(slug(''), '');
  assert.equal(slug(null), '');
  const long = slug('a'.repeat(40));
  assert.equal(long.length, 32);
  assert.ok(RULE.test(long));
  // Cut at 32 must not leave a trailing dash.
  assert.ok(RULE.test(slug(`${'a'.repeat(31)}-b`)) && !slug(`${'a'.repeat(31)}-b`).endsWith('-'));
});

test('sanitize falls back when nothing usable is left', () => {
  assert.equal(sanitize('프로젝트', 'claude'), 'claude');
  assert.equal(sanitize('', ''), 'agent');
  assert.equal(sanitize('Docs'), 'docs');
});

test('unique adds -2, -3 and stays within 32 characters', () => {
  assert.equal(unique('docs', []), 'docs');
  assert.equal(unique('docs', ['docs']), 'docs-2');
  assert.equal(unique('docs', ['docs', 'docs-2']), 'docs-3');
  const base = 'a'.repeat(32);
  const n = unique(base, [base]);
  assert.equal(n.length, 32);
  assert.ok(n.endsWith('-2') && RULE.test(n));
});

test('defaultName takes the first usable source', () => {
  assert.equal(defaultName(['한글 폴더', 'hub-pol-d1'], 'claude', []), 'hub-pol-d1');
  assert.equal(defaultName(['한글'], 'claude', ['claude']), 'claude-2');
  assert.equal(defaultName(['Hub Pol'], 'claude', ['hub-pol']), 'hub-pol-2');
});
