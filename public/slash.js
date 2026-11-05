'use strict';
// The / list's order (composer.js). A query of two or more letters: prefix matches first (of the
// whole name or of a part after ":"), then substring ones, each in the host's order. An empty or
// one-letter query (on a phone, what is on screen after typing "/"): the commands this device sent
// lately come first, then a few that are used all the time, then the rest as above.
(function (root) {
  const COMMON = ['compact', 'clear', 'model', 'resume', 'review'];
  const RECENT_MAX = 8;

  const prefix = (name, ql) => name.toLowerCase().split(':').some((part, i, all) => all.slice(i).join(':').startsWith(ql));

  function filter(list, q) {
    const ql = String(q || '').toLowerCase();
    if (!ql) return list;
    const a = list.filter((c) => prefix(c.name, ql));
    const b = list.filter((c) => !prefix(c.name, ql) && c.name.toLowerCase().includes(ql));
    return [...a, ...b];
  }

  // recent: names, newest first (note()).
  function rank(list, q, recent = []) {
    const out = filter(list, q);
    const ql = String(q || '').toLowerCase();
    if (ql.length > 1) return out;
    const fits = (c) => !ql || prefix(c.name, ql);
    const byName = new Map(out.filter(fits).map((c) => [c.name, c]));
    const first = [];
    for (const n of [...recent, ...COMMON]) {
      const c = byName.get(n);
      if (c && !first.includes(c)) first.push(c);
    }
    return [...first, ...out.filter((c) => !first.includes(c))];
  }

  // The name a sent message used ("/model sonnet" -> "model"), or null.
  function used(text) {
    const m = /^\/([^\s/]+)/.exec(String(text || '').trim());
    return m ? m[1] : null;
  }

  function note(recent, name) {
    if (!name) return recent;
    return [name, ...(Array.isArray(recent) ? recent : []).filter((n) => n !== name && typeof n === 'string')].slice(0, RECENT_MAX);
  }

  const api = { COMMON, RECENT_MAX, filter, rank, used, note };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Slash = api;
})(typeof self !== 'undefined' ? self : this);
