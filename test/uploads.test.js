'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const uploads = require('../lib/uploads');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-hub-up-test-'));

test('save keeps a matching image under a generated name', () => {
  const dir = tmp();
  const r = uploads.save('image/png', PNG, dir);
  assert.match(r.name, uploads.NAME);
  assert.equal(path.dirname(r.path), dir);
  assert.deepEqual(fs.readFileSync(r.path), PNG);
  assert.equal(uploads.find(r.name, dir).type, 'image/png');
  fs.rmSync(dir, { recursive: true });
});

test('save refuses other types, mismatched bytes and empty bodies', () => {
  const dir = tmp();
  assert.throws(() => uploads.save('image/gif', PNG, dir), { code: 'bad_image_type' });
  assert.throws(() => uploads.save('image/jpeg', PNG, dir), { code: 'bad_image_type' });
  assert.throws(() => uploads.save('image/jpeg; charset=x', Buffer.alloc(0), dir), { code: 'empty_image' });
  assert.equal(uploads.save('IMAGE/JPEG', JPG, dir).name.endsWith('.jpg'), true);
  fs.rmSync(dir, { recursive: true });
});

test('find only answers names save could have made', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'x');
  for (const n of ['secret.txt', '../secret.txt', '20261103-120000-abcdef01.jpg/../secret.txt', '20261103-120000-ABCDEF01.jpg', ''])
    assert.equal(uploads.find(n, dir), null, n);
  fs.rmSync(dir, { recursive: true });
});

test('sweep deletes only old uploads', () => {
  const dir = tmp();
  const old = uploads.save('image/png', PNG, dir);
  const fresh = uploads.save('image/jpeg', JPG, dir);
  fs.writeFileSync(path.join(dir, 'other.png'), 'x');
  const eightDays = Date.now() / 1000 - 8 * 24 * 3600;
  fs.utimesSync(old.path, eightDays, eightDays);
  fs.utimesSync(path.join(dir, 'other.png'), eightDays, eightDays);
  assert.equal(uploads.sweep(dir), 1);
  assert.equal(fs.existsSync(old.path), false);
  assert.equal(fs.existsSync(fresh.path), true);
  assert.equal(fs.existsSync(path.join(dir, 'other.png')), true);
  fs.rmSync(dir, { recursive: true });
});
