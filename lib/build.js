'use strict';
// The build this host runs, by a readable name: deploy.sh stamps build.json into what it ships
// ({ version, commit, sha, time, dirty }); a checkout without one derives the same from git;
// anything else is "dev". version = package.json's major.minor (by hand, for big reworks) and
// the commit count as the patch: 1.0.523.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// "1.0.0" -> "1.0"
const majorMinor = (v) => (/^(\d+)\.(\d+)/.exec(String(v || '')) || [null, '0', '0']).slice(1, 3).join('.');

// The build from git in dir (null when git or the repo isn't there). dirty: anything not
// committed, untracked files too (deploy ships them).
function fromGit(dir, base) {
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
  try {
    const count = git('rev-list', '--count', 'HEAD');
    const [sha, time] = git('log', '-1', '--format=%H %cI').split(' ');
    const dirty = git('status', '--porcelain', '--untracked-files=normal') !== '';
    return { version: `${base}.${count}`, commit: sha.slice(0, 7), sha, time, dirty };
  } catch {
    return null;
  }
}

// The cleaned fields of a build.json (anything unexpected dropped).
function clean(b) {
  if (!b || typeof b !== 'object' || !/^\d+\.\d+\.\d+$/.test(String(b.version || ''))) return null;
  const hex = (s, n) => (new RegExp(`^[0-9a-f]{${n}}$`).test(String(s || '')) ? String(s) : '');
  const sha = hex(b.sha, 40);
  return { version: String(b.version), commit: hex(b.commit, 7) || sha.slice(0, 7), sha, time: Number.isNaN(Date.parse(b.time)) ? '' : String(b.time), dirty: Boolean(b.dirty) };
}

function readBuild(dir) {
  let base = '0.0';
  try {
    base = majorMinor(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version);
  } catch {}
  try {
    const b = clean(JSON.parse(fs.readFileSync(path.join(dir, 'build.json'), 'utf8')));
    if (b) return { ...b, from: 'build.json' };
  } catch {}
  const g = fromGit(dir, base);
  if (g) return { ...g, from: 'git' };
  return { version: 'dev', commit: '', sha: '', time: '', dirty: false, from: 'none' };
}

// What apps from before 1.0 understand: they compare a number (index.html's app.js ?v=, up to
// 115) and reload for a bigger one. The commit count is that number from now on; '' for "dev".
const legacyNumber = (b) => (/^\d+\.\d+\.(\d+)$/.exec(b.version) || [])[1] || '';

// What a page and the server say about the build: its readable name, the API version, and an id
// made of the build and every asset hash (lib/http.js indexPage's assets), so a dirty deploy on
// the same commit is another build too. v: the number apps before 1.0 compare.
function describe(build, api, assets) {
  const id = crypto.createHash('sha1').update(`${build.version}|${build.sha}|${build.dirty}|${assets}`).digest('hex').slice(0, 12);
  return { v: legacyNumber(build), version: build.version, commit: build.commit, sha: build.sha, time: build.time, dirty: build.dirty, api, id };
}

// index.html's decorate (lib/http.js): the build as a <meta> the page reads (public/update.js),
// and for an app from before 1.0, which reads the first app.js ?v= in the page as its version
// number, that number in a comment.
const attr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function decorator(build, api) {
  return (html, assets) => {
    const { v, ...b } = describe(build, api, assets);
    const legacy = v ? `\n  <!-- for apps before 1.0: <script src="/app.js?v=${v}"> -->` : '';
    return html.replace('</head>', `  <meta name="herdr-hub-build" content="${attr(JSON.stringify(b))}">${legacy}\n</head>`);
  };
}

module.exports = { readBuild, majorMinor, legacyNumber, clean, describe, decorator };
