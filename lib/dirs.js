'use strict';
// Folder browsing for the new-workspace form: list subfolders, shortcut folders,
// Windows drive letters, and create one folder. Paths are checked by the caller
// (server.js cleanCwd) before they get here.

const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX = 500;
const WIN = process.platform === 'win32';
// The parent of a Windows drive root: GET /api/dirs?path=::drives lists the drives.
const DRIVES = '::drives';

// Folders nobody starts a workspace in. Names starting with "." or "$" are hidden too.
const HIDDEN = new Set(
  [
    'node_modules', 'AppData', 'System Volume Information', 'Recovery', 'Config.Msi', 'MSOCache', 'ProgramData', 'PerfLogs',
    'Documents and Settings', 'Application Data', 'Local Settings', 'My Documents', 'NetHood', 'PrintHood', 'Recent',
    'SendTo', 'Start Menu', 'Templates', 'Cookies', 'My Music', 'My Pictures', 'My Videos', '__pycache__',
  ].map((s) => s.toLowerCase())
);
const hidden = (name) => name.startsWith('.') || name.startsWith('$') || HIDDEN.has(name.toLowerCase());

const bad = (code, status = 400) => Object.assign(new Error(code), { status, code });
const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });

const isRoot = (p) => path.parse(p).root === p;
function parentOf(p) {
  if (!isRoot(p)) return path.dirname(p);
  return WIN ? DRIVES : null;
}

// Each step of the path with the folder it opens: C:\ › Users › kang.
function crumbs(p) {
  const { root } = path.parse(p);
  const out = [{ name: WIN ? root.replace(/\\$/, '') || root : root, path: root }];
  let cur = root;
  for (const part of p.slice(root.length).split(path.sep).filter(Boolean)) {
    cur = path.join(cur, part);
    out.push({ name: part, path: cur });
  }
  return out;
}

// A link counts when it leads to a folder that can be opened. That also hides the
// legacy profile junctions on Windows ("Application Data", localized "시작 메뉴"),
// which deny listing. A link into an automount (macOS /home) can hang for a long
// time, so each probe has a deadline and a link that missed it is not probed again.
const SLOW = new Set();
const LINK_MS = 1000;
const within = (promise, ms, fallback) => Promise.race([promise, new Promise((r) => setTimeout(() => r(fallback), ms))]);

async function isDir(full, dirent) {
  if (dirent.isDirectory()) return true;
  if (!dirent.isSymbolicLink() || SLOW.has(full)) return false;
  const probe = (async () => {
    try {
      if (!(await fs.promises.stat(full)).isDirectory()) return false;
      await (await fs.promises.opendir(full)).close();
      return true;
    } catch {
      return false;
    }
  })();
  const r = await within(probe, LINK_MS, 'slow');
  if (r === 'slow') SLOW.add(full);
  return r === true;
}

// Subfolders of an existing absolute folder. A folder that cannot be read is not an
// error: it comes back empty with denied set, so the client can still go up.
async function list(dir) {
  const base = { path: dir, parent: parentOf(dir), sep: path.sep, crumbs: crumbs(dir), dirs: [] };
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (['EACCES', 'EPERM', 'EBUSY', 'ENOTDIR', 'EINVAL'].includes(err.code)) return { ...base, denied: true };
    throw err;
  }
  const shown = entries.filter((e) => !hidden(e.name));
  const ok = await Promise.all(shown.map((e) => isDir(path.join(dir, e.name), e)));
  const names = shown.filter((_, i) => ok[i]).map((e) => e.name);
  names.sort(byName);
  return { ...base, dirs: names.slice(0, MAX), truncated: names.length > MAX };
}

// Drive letters that answer within a moment (a dead network drive must not hang the list).
async function drives() {
  const letters = [];
  if (WIN) {
    const probe = (d) => within(fs.promises.stat(d).then((s) => s.isDirectory(), () => false), 1500, false);
    const all = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => `${l}:\\`);
    const ok = await Promise.all(all.map(probe));
    letters.push(...all.filter((_, i) => ok[i]));
  }
  return { path: DRIVES, parent: null, sep: path.sep, crumbs: [], drives: true, dirs: letters };
}

// Shortcut folders that exist on this host: home, its usual project folders, D:\ on Windows.
function places(home = os.homedir()) {
  const out = [{ name: '홈', path: home }];
  const want = ['project', 'projects', 'src', 'repos', 'code', 'desktop', 'documents'];
  let entries = [];
  try {
    entries = fs.readdirSync(home, { withFileTypes: true });
  } catch {
    /* an unreadable home still gets the home shortcut */
  }
  const found = entries.filter((e) => e.isDirectory() && want.includes(e.name.toLowerCase()));
  found.sort((a, b) => want.indexOf(a.name.toLowerCase()) - want.indexOf(b.name.toLowerCase()));
  for (const e of found) out.push({ name: e.name, path: path.join(home, e.name) });
  if (WIN) {
    for (const d of ['C:\\', 'D:\\']) {
      try {
        if (fs.statSync(d).isDirectory()) out.push({ name: d.slice(0, 2), path: d });
      } catch {
        /* no such drive */
      }
    }
  }
  return out;
}

// One plain folder name, valid on every platform Paddock runs on.
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
function cleanName(name) {
  if (typeof name !== 'string' || !name || name.length > 100) throw bad('bad_dir_name');
  if (name === '.' || name === '..' || name !== name.trim() || /[\x00-\x1f\x7f<>:"/\\|?*]/.test(name) || /[. ]$/.test(name) || RESERVED.test(name))
    throw bad('bad_dir_name');
  return name;
}

function create(parent, name) {
  const full = path.join(parent, cleanName(name));
  try {
    fs.mkdirSync(full);
  } catch (err) {
    if (err.code === 'EEXIST') throw bad('dir_exists', 409);
    if (['EACCES', 'EPERM', 'EROFS'].includes(err.code)) throw bad('dir_forbidden', 403);
    throw err;
  }
  return full;
}

module.exports = { list, drives, places, create, cleanName, crumbs, DRIVES };
