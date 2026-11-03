'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dirs = require('../lib/dirs');

test('cleanName accepts plain names', () => {
  for (const n of ['herdr-hub-try-1', '새 폴더', 'a.b', 'x'.repeat(100)]) assert.equal(dirs.cleanName(n), n);
});

test('cleanName rejects separators, dots, control and Windows-forbidden names', () => {
  for (const n of ['', '.', '..', 'a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a|b', 'tab\tx', ' lead', 'trail ', 'dot.', 'CON', 'nul.txt', 'x'.repeat(101), 5, null])
    assert.throws(() => dirs.cleanName(n), { code: 'bad_dir_name' }, String(n));
});

test('list returns sorted visible subfolders; create refuses an existing name', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-hub-dirs-'));
  try {
    for (const n of ['beta', 'Alpha', '.git', 'node_modules', 'gamma10', 'gamma9']) fs.mkdirSync(path.join(root, n));
    fs.writeFileSync(path.join(root, 'file.txt'), '');
    const r = await dirs.list(root);
    assert.deepEqual(r.dirs, ['Alpha', 'beta', 'gamma9', 'gamma10']);
    assert.equal(r.parent, path.dirname(root));
    assert.equal(r.crumbs.at(-1).path, root);
    assert.equal(dirs.create(root, 'new'), path.join(root, 'new'));
    assert.throws(() => dirs.create(root, 'new'), { code: 'dir_exists', status: 409 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('places starts with home', () => {
  const p = dirs.places();
  assert.equal(p[0].path, os.homedir());
});
