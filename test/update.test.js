'use strict';
// A new deploy reaching an installed app (public/update.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseBuild, buildOf, differs, when, buildLabel, shortLabel, apiNote, safeToReload, mayTry, RETRY_MS } = require('../public/update.js');

const b523 = { version: '1.0.523', commit: 'ae7dc0a', sha: 'ae7dc0a'.padEnd(40, '0'), time: '2026-11-05T00:58:00+09:00', dirty: false, api: 1, id: 'aaaaaaaaaaaa' };
const b524 = { ...b523, version: '1.0.524', commit: 'bb12345', time: '2026-11-05T01:30:00+09:00', id: 'bbbbbbbbbbbb' };

test('the build is read from the meta the server writes, escaped', () => {
  const content = JSON.stringify(b523).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const html = `<head><meta charset="utf-8"><meta name="herdr-hub-build" content="${content}"></head><script src="/app.js?v=1a2b3c4d" defer></script>`;
  assert.deepEqual(buildOf(html), b523);
  assert.deepEqual(parseBuild(JSON.stringify(b523)), b523);
  assert.equal(buildOf('<script src="/app.js?v=115" defer></script>'), null); // a page from before 1.0
  assert.equal(buildOf(''), null);
  assert.equal(buildOf(null), null);
  assert.equal(parseBuild('{"version":"1.0.1"}'), null); // no id: can't be compared
  assert.equal(parseBuild('nope'), null);
  // The repo's index.html has no numbers to maintain any more.
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8'), /\?v=/);
});

test('differs: another build, not a newer one; nothing when either side is unknown', () => {
  assert.equal(differs(b523, b524), true);
  assert.equal(differs(b524, b523), true); // a rollback is a new build too
  assert.equal(differs(b523, { ...b523 }), false);
  assert.equal(differs(null, b524), false);
  assert.equal(differs(b523, null), false);
  assert.equal(differs(b523, { v: '200' }), false); // a server from before 1.0 says only { v }
});

test('the readable names: 설정 → 정보 and the banner', () => {
  const t = new Date(b523.time);
  const p = (n) => String(n).padStart(2, '0');
  const local = `${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`;
  assert.equal(when(b523.time), local);
  assert.equal(buildLabel(b523), `1.0.523 · ${local} · ae7dc0a`);
  assert.equal(buildLabel({ ...b523, dirty: true }), `1.0.523+dirty · ${local} · ae7dc0a`);
  assert.equal(buildLabel({ version: 'dev', id: 'x' }), 'dev');
  assert.equal(buildLabel(null), '');
  assert.match(shortLabel(b524), /^1\.0\.524 \(\d\d-\d\d \d\d:\d\d\)$/);
  assert.equal(shortLabel({ version: 'dev', id: 'x' }), 'dev');
  assert.equal(when(''), '');
  assert.equal(when('nope'), '');
});

test('apiNote: a peer on another API version than the hub', () => {
  const hub = { id: 'desktop', local: true, online: true, api: 3 };
  assert.equal(apiNote({ id: 'server', online: true, api: 2 }, hub), 'API 2 (허브는 3)');
  assert.equal(apiNote({ id: 'server', online: true, api: 0 }, hub), 'API 없음 (허브는 3)'); // a peer before 1.0
  assert.equal(apiNote({ id: 'server', online: true, api: 3 }, hub), '');
  assert.equal(apiNote({ id: 'server', online: false, api: null }, hub), ''); // offline: unknown
  assert.equal(apiNote(hub, hub), '');
  assert.equal(apiNote({ id: 'server', online: true, api: 2 }, undefined), ''); // no hub entry
  assert.equal(apiNote({ id: 'server', online: true, api: 2 }, { local: true }), ''); // a hub before 1.0
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

test('the loop guard: a build tried a moment ago is not tried again', () => {
  const now = 1_000_000_000;
  assert.equal(mayTry(null, 'bbbb', now), true);
  assert.equal(mayTry({ v: 'bbbb', t: now - 1000 }, 'bbbb', now), false);
  assert.equal(mayTry({ v: 'bbbb', t: now - RETRY_MS - 1 }, 'bbbb', now), true);
  assert.equal(mayTry({ v: 'aaaa', t: now - 1000 }, 'bbbb', now), true); // another one since
  assert.equal(mayTry({ v: 'bbbb' }, 'bbbb', now), true); // no time: as never tried
});
