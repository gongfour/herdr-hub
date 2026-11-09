'use strict';
// Folders someone took out of 최근 폴더 (the ✕ on a recent row of the start / new workspace form).
// 최근 폴더 is no history: it is the folders of this host's current agents and shells (hub.js
// recentCwds), so "delete" means hiding one. The host that owns the folders keeps the list, in
// data/hidden-cwds.json as [path…] (oldest first, at most MAX), so every device agrees.
// A hidden folder still works when typed or browsed to; starting a tab or workspace there takes
// it off the list. Pure: the server does the reading and writing.

const MAX = 200;
const PATH_MAX = 4096;

// The same folder however it was written: no trailing separator (a root stays itself), and on
// Windows the case and the separator do not matter.
function norm(p) {
  return p.replace(/[\\/]+$/, '') || p;
}
function key(p, platform = process.platform) {
  const n = norm(p);
  return platform === 'win32' ? n.replace(/\//g, '\\').toLowerCase() : n;
}

const okPath = (p) => typeof p === 'string' && p.length > 0 && p.length <= PATH_MAX && !/[\x00-\x1f\x7f]/.test(p);

// What makes sense of a file someone may have edited by hand: paths, each folder once, the newest MAX.
function clean(raw, platform) {
  if (!Array.isArray(raw)) return [];
  const out = new Map();
  for (const p of raw) {
    if (!okPath(p)) continue;
    const k = key(p, platform);
    out.delete(k);
    out.set(k, norm(p));
  }
  return [...out.values()].slice(-MAX);
}

const has = (list, p, platform) => list.some((x) => key(x, platform) === key(p, platform));

// A new list with p last (the oldest dropped past MAX). Throws bad_cwd for what is not a path.
function hide(list, p, platform) {
  if (!okPath(p)) throw Object.assign(new Error('bad_cwd'), { status: 400, code: 'bad_cwd' });
  return clean([...list, p], platform);
}
function show(list, p, platform) {
  if (typeof p !== 'string') return list;
  const k = key(p, platform);
  return list.filter((x) => key(x, platform) !== k);
}

// paths without the hidden ones.
function without(paths, list, platform) {
  if (!list.length) return paths;
  const hidden = new Set(list.map((x) => key(x, platform)));
  return paths.filter((p) => !hidden.has(key(p, platform)));
}

module.exports = { MAX, norm, key, clean, has, hide, show, without };
