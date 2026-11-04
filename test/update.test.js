'use strict';
// A new deploy reaching an installed app (public/update.js, lib/http.js appVersion).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { versionOf, newer, safeToReload, mayTry, RETRY_MS } = require('../public/update.js');
const { appVersion } = require('../lib/http');

test('the version is the ?v= of app.js, not of the icons or other files', () => {
  const html = '<link rel="icon" href="/icon.svg?v=2"><link rel="stylesheet" href="/style.css?v=97"><script src="/core.js?v=97" defer></script><script src="/app.js?v=98" defer></script>';
  assert.equal(versionOf(html), '98');
  assert.equal(versionOf('<script defer src="/app.js?x=1&v=120"></script>'), '120');
  assert.equal(versionOf('<script src="/myapp.js?v=5"></script>'), '');
  assert.equal(versionOf(''), '');
  assert.equal(versionOf(null), '');
  // The real index.html has one.
  assert.match(versionOf(fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8')), /^\d+$/);
});

test('newer: numbers, and nothing when either side is unknown', () => {
  assert.equal(newer('98', '99'), true);
  assert.equal(newer('99', '100'), true); // not a string compare
  assert.equal(newer('99', '99'), false);
  assert.equal(newer('100', '99'), false); // a host still on the old version
  assert.equal(newer('', '99'), false);
  assert.equal(newer('98', ''), false);
  assert.equal(newer('98', undefined), false);
});

test('safe to reload: only coming back (or hidden), with nothing open, typed or on its way', () => {
  const idle = { returning: true, layer: false, typing: false, composer: false, sending: false, answering: false };
  assert.equal(safeToReload(idle), true);
  assert.equal(safeToReload({ ...idle, returning: false }), false); // on screen, being looked at
  assert.equal(safeToReload({ ...idle, layer: true }), false); // a sheet, menu or the switcher
  assert.equal(safeToReload({ ...idle, typing: true }), false); // a form field
  assert.equal(safeToReload({ ...idle, composer: true }), false); // unsent words or photos
  assert.equal(safeToReload({ ...idle, sending: true }), false);
  assert.equal(safeToReload({ ...idle, answering: true }), false); // a question waiting for words
});

test('the loop guard: a version tried a moment ago is not tried again', () => {
  const now = 1_000_000_000;
  assert.equal(mayTry(null, '99', now), true);
  assert.equal(mayTry({ v: '99', t: now - 1000 }, '99', now), false);
  assert.equal(mayTry({ v: '99', t: now - RETRY_MS - 1 }, '99', now), true);
  assert.equal(mayTry({ v: '98', t: now - 1000 }, '99', now), true); // a newer one since
  assert.equal(mayTry({ v: '99' }, '99', now), true); // no time: as never tried
});

test('appVersion reads index.html and again when it changes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-hub-ver-'));
  try {
    assert.equal(appVersion(dir), ''); // no index.html
    const file = path.join(dir, 'index.html');
    fs.writeFileSync(file, '<script src="/app.js?v=7" defer></script>');
    assert.equal(appVersion(dir), '7');
    fs.writeFileSync(file, '<script src="/app.js?v=12" defer></script><!-- longer -->');
    assert.equal(appVersion(dir), '12');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
