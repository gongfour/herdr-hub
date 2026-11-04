'use strict';
// Chats kept per agent (host|pane), so opening one shows its conversation at once and only what
// changed since is fetched (agent.js). Two places:
//   memory: the merged transcript, mode and activity of the last dozen agents, while the page lives.
//   the device (localStorage): the latest messages of the last ten opened agents, for an app
//   that was closed or that iOS dropped in the background; shown at once, then fetched again.
// Each copy carries the agent's session: a pane that now runs another conversation never shows it.
// Pure: loaded as a plain script in the page (window.ChatKeep), required by the tests.
(function (root) {
  // Least recently used first out. get() counts as a use.
  class Lru {
    constructor(max) {
      this.max = max;
      this.map = new Map();
    }
    get(k) {
      const v = this.map.get(k);
      if (v === undefined) return undefined;
      this.map.delete(k);
      this.map.set(k, v);
      return v;
    }
    peek(k) {
      return this.map.get(k);
    }
    has(k) {
      return this.map.has(k);
    }
    set(k, v) {
      this.map.delete(k);
      this.map.set(k, v);
      while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
      return this;
    }
    delete(k) {
      return this.map.delete(k);
    }
    keys() {
      return [...this.map.keys()];
    }
  }

  const STORE_MESSAGES = 30;
  const ENTRY_CHARS = 40000; // one agent's copy, as JSON
  const STORE_AGENTS = 10;
  const STORE_CHARS = 300000; // all of them: about 600 KB of the browser's 5 MB, as it counts UTF-16

  // A transcript -> what goes on the device: its latest messages, oldest dropped until it fits.
  // Messages carry no image data (the server only counts pasted images), so nothing large is
  // stored but text; a single message too large on its own is not stored at all.
  function entryFor(t, { session, mode = null, at = 0 } = {}, max = STORE_MESSAGES, chars = ENTRY_CHARS) {
    if (!t || !t.supported || !t.found || !session || !Array.isArray(t.messages)) return null;
    let messages = t.messages.slice(-max);
    const base = { v: 1, session, rev: t.rev || null, mode, at };
    let size = JSON.stringify({ ...base, messages }).length;
    while (messages.length && size > chars) {
      size -= JSON.stringify(messages[0]).length + 1;
      messages = messages.slice(1);
    }
    return messages.length ? { ...base, messages } : null;
  }

  // A stored entry -> a transcript to show while the real one is fetched. partial: it holds only
  // the latest messages, so the next read is the full window, not just what changed.
  function restore(e) {
    if (!e || e.v !== 1 || !Array.isArray(e.messages) || !e.messages.length) return null;
    return { supported: true, found: true, rev: e.rev, truncated: true, messages: e.messages, partial: true };
  }

  // The newest `agents` entries, then oldest out until all of it fits in `chars`.
  function prune(store, agents = STORE_AGENTS, chars = STORE_CHARS) {
    const list = Object.entries(store || {})
      .filter(([, e]) => e && typeof e === 'object')
      .sort((x, y) => (y[1].at || 0) - (x[1].at || 0))
      .slice(0, agents);
    while (list.length && JSON.stringify(Object.fromEntries(list)).length > chars) list.pop();
    return Object.fromEntries(list);
  }

  // Keys whose agent is gone: its host reports (online, herdr up) and lists no agent at that key
  // with that session. Hosts that are offline or not yet heard from keep theirs.
  function gone(keys, state, keyOf, sessionOf) {
    const hosts = new Set(((state && state.hosts) || []).filter((h) => h.online && h.herdr === 'up').map((h) => h.id));
    const live = new Map(((state && state.agents) || []).map((a) => [keyOf(a), a.session]));
    return keys.filter((k) => {
      const host = k.slice(0, k.indexOf('|'));
      return hosts.has(host) && (!live.has(k) || (sessionOf(k) != null && live.get(k) !== sessionOf(k)));
    });
  }

  const api = { Lru, entryFor, restore, prune, gone, STORE_MESSAGES };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChatKeep = api;
})(typeof self !== 'undefined' ? self : this);
