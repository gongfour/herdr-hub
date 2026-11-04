'use strict';
// The build name (lib/build.js): build.json, git, "dev"; and the page that carries it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { readBuild, majorMinor, legacyNumber, describe, decorator } = require('../lib/build');
const { buildOf } = require('../public/update.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-hub-build-'));
const sha = 'ae7dc0a'.padEnd(40, '1');

test('majorMinor', () => {
  assert.equal(majorMinor('1.0.0'), '1.0');
  assert.equal(majorMinor('2.13.4'), '2.13');
  assert.equal(majorMinor(''), '0.0');
});

test('build.json, as deploy.sh writes it, wins; junk in it is dropped', () => {
  const dir = tmp();
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), '{"version":"1.0.0"}');
    fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({ version: '1.0.523', commit: 'ae7dc0a', sha, time: '2026-11-05T00:58:00+09:00', dirty: true, extra: '<x>' }));
    assert.deepEqual(readBuild(dir), { version: '1.0.523', commit: 'ae7dc0a', sha, time: '2026-11-05T00:58:00+09:00', dirty: true, from: 'build.json' });
    fs.writeFileSync(path.join(dir, 'build.json'), '{"version":"<script>"}');
    assert.equal(readBuild(dir).version, 'dev'); // not a build, no git here
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('no build.json: the same from git, dirty when anything is uncommitted; no git: dev', () => {
  const dir = tmp();
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), '{"version":"1.0.0"}');
    assert.deepEqual(readBuild(dir), { version: 'dev', commit: '', sha: '', time: '', dirty: false, from: 'none' });
    const git = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { stdio: 'ignore' });
    git('init', '-q');
    git('add', '.');
    git('commit', '-qm', 'one');
    git('commit', '-q', '--allow-empty', '-m', 'two');
    const b = readBuild(dir);
    assert.equal(b.version, '1.0.2');
    assert.match(b.commit, /^[0-9a-f]{7}$/);
    assert.equal(b.sha.slice(0, 7), b.commit);
    assert.ok(!Number.isNaN(Date.parse(b.time)));
    assert.equal(b.dirty, false);
    assert.equal(b.from, 'git');
    fs.writeFileSync(path.join(dir, 'new.js'), '');
    assert.equal(readBuild(dir).dirty, true); // untracked ships too
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the page carries the build; an app from before 1.0 still sees a bigger number', () => {
  const build = { version: '1.0.523', commit: 'ae7dc0a', sha, time: '2026-11-05T00:58:00+09:00', dirty: false };
  const html = '<!doctype html><head><title>x</title></head><body><script src="/app.js?v=1a2b3c4d" defer></script></body>';
  const page = decorator(build, 1)(html, 'abcdef012345');
  const seen = buildOf(page);
  const said = describe(build, 1, 'abcdef012345');
  assert.deepEqual(seen, { version: '1.0.523', commit: 'ae7dc0a', sha, time: build.time, dirty: false, api: 1, id: said.id });
  assert.match(said.id, /^[0-9a-f]{12}$/);
  assert.equal(said.v, '523');
  // The id changes with the assets and with dirt, not with the API version alone being read.
  assert.notEqual(describe(build, 1, 'other').id, said.id);
  assert.notEqual(describe({ ...build, dirty: true }, 1, 'abcdef012345').id, said.id);
  // public/update.js's versionOf up to ?v=115, verbatim: what the devices run today.
  const oldVersionOf = (h) => (/<script[^>]*\ssrc="[^"]*\/app\.js\?(?:[^"]*&)?v=(\d+)/.exec(String(h || '')) || [])[1] || '';
  assert.equal(oldVersionOf(page), '523');
  assert.ok(Number(oldVersionOf(page)) > 115);
  // dev: no number to offer, and no comment.
  assert.equal(legacyNumber({ version: 'dev' }), '');
  assert.doesNotMatch(decorator({ version: 'dev', commit: '', sha: '', time: '', dirty: false }, 1)(html, 'x'), /apps before 1\.0/);
});
