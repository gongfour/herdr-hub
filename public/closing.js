'use strict';
// What a close just sent hides (actions.js closeNow): a closed pane or workspace drops out of the
// page at once and out of every state that arrives meanwhile, until the close has landed. Landed
// = herdr said ok AND a state arrived since without it (a state built before the close can still
// come after the ok). From then on the key is forgotten, so an id that shows up again is a new
// pane or workspace and shows: herdr counts ids up while it runs (w5 closed → the next is w6,
// pane p2 closed → the next is p3) but after a restart starts again at the highest one it has,
// so the newest closed id comes back. A refusal forgets the key at once (the item comes back);
// `ms` is the cap when neither arrives.
// Pure: loaded as a plain script in the page (window.Closing), required by the tests.
(function (root) {
  function create(ms = 15000) {
    const keys = new Map(); // `${host}|pane|${id}` or `${host}|workspace|${id}` → { until, ok }

    const keyOf = (host, kind, id) => `${host || ''}|${kind}|${id}`;

    // fresh: s came from the host (not the page's own state, already filtered), so what it lacks
    // has really gone.
    function filter(s, { fresh = true, now = Date.now() } = {}) {
      for (const [k, e] of keys) if (e.until < now) keys.delete(k);
      if (!keys.size || !s) return s;
      const hostOf = (x) => x.host || s.hostId || '';
      const seen = new Set();
      const gone = (x, kind, id) => {
        const k = keyOf(hostOf(x), kind, id);
        if (!keys.has(k)) return false;
        seen.add(k);
        return true;
      };
      const keep = (x) => {
        const pane = gone(x, 'pane', x.pane);
        const ws = gone(x, 'workspace', x.workspace); // both asked: each counts as seen
        return !pane && !ws;
      };
      const out = {
        ...s,
        agents: (s.agents || []).filter(keep),
        terminals: (s.terminals || []).filter(keep),
        workspaces: (s.workspaces || []).filter((w) => !gone(w, 'workspace', w.workspace_id)),
      };
      if (fresh) for (const [k, e] of keys) if (e.ok && !seen.has(k)) keys.delete(k);
      return out;
    }

    return {
      // A close sent: hide it from now on.
      start(host, kind, id, now = Date.now()) {
        const k = keyOf(host, kind, id);
        keys.set(k, { until: now + ms, ok: false });
        return k;
      },
      // herdr said ok: the next state without it ends the hiding.
      landed(k) {
        const e = keys.get(k);
        if (e) e.ok = true;
      },
      // Refused: show it again.
      drop(k) {
        keys.delete(k);
      },
      filter,
      size: () => keys.size,
    };
  }

  const api = { create };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Closing = api;
})(typeof self !== 'undefined' ? self : this);
