'use strict';
// The live stream's state as patches (lib/hub.js publish, /api/stream?delta=1): after the first
// whole state, each change goes as what changed only. A top-level field that changed is sent
// whole; the lists of items (hosts, agents, terminals, workspaces) go item by item, an item that
// is as it was standing as its key alone (`desktop|w1-p2`), so the list's order and what left are
// in it too. 150 agents with one changed: a few KB instead of ~50.
// Pure: loaded as a plain script in the page (window.StatePatch), required by the hub and tests.
(function (root) {
  const KEYS = {
    hosts: (h) => h.id,
    agents: (a) => `${a.host}|${a.pane}`,
    terminals: (t) => `${t.host}|${t.pane}`,
    workspaces: (w) => `${w.host}|${w.workspace_id}`,
  };
  const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
  const isItem = (x) => x && typeof x === 'object' && !Array.isArray(x);

  // A list as refs: an item unchanged from prev as its key, a changed or new one whole. null when
  // the list can't be said that way (an item without its key, or a key twice): sent whole then.
  function listDiff(prev, next, keyOf) {
    if (!Array.isArray(prev) || !Array.isArray(next)) return null;
    const was = new Map();
    for (const x of prev) if (isItem(x)) was.set(keyOf(x), JSON.stringify(x));
    const seen = new Set();
    const out = [];
    for (const x of next) {
      if (!isItem(x)) return null;
      const k = keyOf(x);
      if (typeof k !== 'string' || seen.has(k)) return null;
      seen.add(k);
      out.push(was.get(k) === JSON.stringify(x) ? k : x);
    }
    return out;
  }

  // -> { set, lists, del } from prev to next, or null when nothing changed.
  function diff(prev, next) {
    const set = {};
    const lists = {};
    const del = Object.keys(prev).filter((k) => !(k in next));
    let any = del.length > 0;
    for (const k of Object.keys(next)) {
      if (k in prev && same(prev[k], next[k])) continue;
      any = true;
      const refs = KEYS[k] && k in prev ? listDiff(prev[k], next[k], KEYS[k]) : null;
      if (refs) lists[k] = refs;
      else set[k] = next[k];
    }
    return any ? { set, lists, del } : null;
  }

  // prev with the patch applied: a new object; items kept from prev are prev's own. Throws when a
  // ref names no item prev has (the patch is for another state: start again from a whole one).
  function apply(prev, patch) {
    const out = { ...prev };
    for (const k of patch.del || []) delete out[k];
    Object.assign(out, patch.set || {});
    for (const [k, refs] of Object.entries(patch.lists || {})) {
      const keyOf = KEYS[k];
      if (!keyOf || !Array.isArray(prev[k])) throw new Error(`patch: no list ${k}`);
      const was = new Map(prev[k].map((x) => [keyOf(x), x]));
      out[k] = refs.map((r) => {
        if (typeof r !== 'string') return r;
        if (!was.has(r)) throw new Error(`patch: no ${k} ${r}`);
        return was.get(r);
      });
    }
    return out;
  }

  const api = { diff, apply, KEYS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StatePatch = api;
})(typeof self !== 'undefined' ? self : this);
