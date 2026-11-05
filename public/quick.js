'use strict';
// Ctrl+N's quick start and the new chat that ends without asking (app.js KEY_ACTIONS.newAgent,
// actions.js closePane). Pure: loaded as a plain script in the page (window.Quick), required by
// the tests; the storage is passed in.
//
// The kind and options last used to start an agent on this device: not a setting (설정 has no
// row for it, prefs.js), just what the last start was, so the next Ctrl+N starts the same.
// Kept in localStorage under herdr-hub.lastAgent as { kind, args }.
//
// The agents started from this tab, and whether anything was sent to them from here, in its
// sessionStorage under herdr-hub.started ({ 'host|pane': 1 started, 2 used }), so a reload (a new
// version) keeps it. A close asks nothing only for one started here and never used (unused).
(function (root) {
  const LAST_KEY = 'herdr-hub.lastAgent';
  const STARTED_KEY = 'herdr-hub.started';
  const DEFAULT = { kind: 'claude', args: [] };
  const KIND = /^[a-z][a-z0-9_-]{0,31}$/;

  const read = (st, key) => {
    try {
      return JSON.parse(st().getItem(key));
    } catch {
      return null;
    }
  };
  const write = (st, key, v) => {
    try {
      if (v == null) st().removeItem(key);
      else st().setItem(key, JSON.stringify(v));
    } catch {
      /* private mode: remembered until reload */
    }
  };

  // What was stored, or the default (Claude, no options) when nothing or nonsense is there.
  function lastAgent(st) {
    const v = read(st, LAST_KEY);
    if (!v || typeof v.kind !== 'string' || !KIND.test(v.kind)) return { ...DEFAULT, args: [] };
    const args = Array.isArray(v.args) && v.args.length <= 16 && v.args.every((a) => typeof a === 'string' && a && a.length <= 200) ? v.args : [];
    return { kind: v.kind, args };
  }
  function rememberAgent(st, { kind, args } = {}) {
    if (typeof kind !== 'string' || !KIND.test(kind)) return;
    write(st, LAST_KEY, { kind, args: Array.isArray(args) ? args.filter((a) => typeof a === 'string' && a) : [] });
  }

  // The spec to start with on a host that allows kinds: the last one if the host has that kind
  // (its options with it), else Claude, else the host's first kind, with no options.
  function specFor(last, kinds) {
    const list = Array.isArray(kinds) && kinds.length ? kinds : null;
    if (!list || list.includes(last.kind)) return { kind: last.kind, args: last.args, name: '' };
    return { kind: list.includes('claude') ? 'claude' : list[0], args: [], name: '' };
  }

  // ---- where Ctrl+N starts
  // A herdr workspace has no folder: a new tab opens where it is told (cwd), else in the folder of
  // the workspace's active tab in herdr — whichever that happens to be. So Ctrl+N says where: the
  // folder of the agent or shell that is open (open: { workspace, cwd }), else the workspace's
  // 기본 폴더 (def, lib/wsdirs on its host), else that of the one in workspace ws viewed last in
  // this Hub (recent: hrefs, most recent first, as 빠른 이동 keeps them; panes: { href,
  // workspace, cwd } of that host), else '' (herdr picks).
  function startFolder({ open = null, ws, def = '', panes = [], recent = [] } = {}) {
    if (open && open.workspace === ws && open.cwd) return open.cwd;
    if (def) return def;
    const mine = new Map(panes.filter((p) => p && p.workspace === ws && p.cwd).map((p) => [p.href, p.cwd]));
    for (const href of recent) if (mine.has(href)) return mine.get(href);
    return '';
  }

  // ---- started here, used or not
  const startedAll = (st) => {
    const v = read(st, STARTED_KEY);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  };
  function markStarted(st, key) {
    write(st, STARTED_KEY, { ...startedAll(st), [key]: 1 });
  }
  function markUsed(st, key) {
    const all = startedAll(st);
    if (all[key] !== 1) return;
    write(st, STARTED_KEY, { ...all, [key]: 2 });
  }
  const startedState = (st, key) => startedAll(st)[key] || 0;

  // The agent a write (api path) sends something to, as 'host|pane', or null: a prompt, keys, an
  // answer, a mode change. Not a rename. localId: the host a path without /peers/ is on.
  function usedBy(path, localId) {
    const m = /^(?:\/peers\/([^/]+))?\/agents\/([^/?]+)\/([a-z]+)/.exec(String(path || ''));
    if (!m || m[3] === 'rename' || m[3] === 'screen') return null;
    return `${m[1] ? decodeURIComponent(m[1]) : localId}|${decodeURIComponent(m[2])}`;
  }

  // Whether a close may skip its sheet: started here (state 1, never used from here), and nothing
  // in it from anyone: no user message in its transcript, nothing waiting to be taken. messages:
  // the transcript's messages, or null when none is loaded (then a Claude chat asks; an agent
  // with no transcript at all, noTranscript, goes by this tab alone). working: it is busy.
  function unused({ state, messages, pending = 0, noTranscript = false, working = false }) {
    if (state !== 1 || pending > 0 || working) return false;
    if (noTranscript) return true;
    if (!Array.isArray(messages)) return false;
    return !messages.some((m) => m && m.role === 'user');
  }

  const api = { LAST_KEY, STARTED_KEY, lastAgent, rememberAgent, specFor, startFolder, markStarted, markUsed, startedState, usedBy, unused };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    const local = () => root.localStorage;
    const session = () => root.sessionStorage;
    root.Quick = {
      ...api,
      last: () => lastAgent(local),
      remember: (spec) => rememberAgent(local, spec),
      started: (key) => markStarted(session, key),
      used: (key) => markUsed(session, key),
      stateOf: (key) => startedState(session, key),
    };
  }
})(typeof self !== 'undefined' ? self : this);
