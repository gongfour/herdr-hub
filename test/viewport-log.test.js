'use strict';
// The phone's viewport snapshots (lib/viewport-log.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { viewportLog } = require('../lib/viewport-log');

test('one JSON line per entry; past 512 KB the file rolls over to .1', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-vplog-'));
  try {
    const append = viewportLog(path.join(dir, 'data'));
    append({ reason: 'focusin', vvHeight: 400 });
    append({ reason: 'resize' });
    const file = path.join(dir, 'data', 'viewport.log');
    assert.deepEqual(fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse), [{ reason: 'focusin', vvHeight: 400 }, { reason: 'resize' }]);
    fs.appendFileSync(file, 'x'.repeat(512 * 1024));
    append({ reason: 'after' });
    assert.ok(fs.existsSync(`${file}.1`));
    assert.equal(fs.readFileSync(file, 'utf8'), '{"reason":"after"}\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
