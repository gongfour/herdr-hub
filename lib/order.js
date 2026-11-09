'use strict';
// The order someone gave the hosts, the workspace cards and the rows in them (data/order.json),
// kept by the hub so every device shows the same order. Nothing stored: herdr's order, as before.
//   { hosts: [hostId…], workspaces: { host: [wsId…] }, panes: { host: { wsId: [paneId…] } } }
// A list names only what was reordered: an id that is gone is passed over (and dropped by prune
// once its host's list is known), one not named goes after the named ones in herdr's order.
// Pure, but for load (once, at start).

const fs = require('fs');

const MAX_IDS = 256; // per list
const MAX_KEYS = 64; // hosts in workspaces/panes, workspaces per host in panes
const ID_MAX = 128;

const empty = () => ({ hosts: [], workspaces: {}, panes: {} });
const fail = (code) => Object.assign(new Error(code), { status: 400, code });
const okId = (s) => typeof s === 'string' && s.length > 0 && s.length <= ID_MAX && !/[\u0000-\u001f\u007f]/.test(s);
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);

// A list as sent: ids, each once. Throws bad_order.
function cleanIds(raw) {
  if (!Array.isArray(raw) || raw.length > MAX_IDS || !raw.every(okId)) throw fail('bad_order');
  return [...new Set(raw)];
}
// The same, for a file: what is wrong is left out rather than refused.
const keepIds = (raw) => (Array.isArray(raw) ? [...new Set(raw.filter(okId))].slice(0, MAX_IDS) : []);

// What makes sense of a file someone may have edited by hand.
function clean(raw) {
  const out = empty();
  if (!isObj(raw)) return out;
  out.hosts = keepIds(raw.hosts);
  if (isObj(raw.workspaces))
    for (const [h, ids] of Object.entries(raw.workspaces).slice(0, MAX_KEYS)) if (okId(h) && keepIds(ids).length) out.workspaces[h] = keepIds(ids);
  if (isObj(raw.panes))
    for (const [h, m] of Object.entries(raw.panes).slice(0, MAX_KEYS)) {
      if (!okId(h) || !isObj(m)) continue;
      const ws = {};
      for (const [w, ids] of Object.entries(m).slice(0, MAX_KEYS)) if (okId(w) && keepIds(ids).length) ws[w] = keepIds(ids);
      if (Object.keys(ws).length) out.panes[h] = ws;
    }
  return out;
}

function load(file, log = () => {}) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') log(`order.json unreadable: ${err.message}`);
    return empty();
  }
  try {
    return clean(JSON.parse(text));
  } catch {
    log('order.json is not JSON; starting with herdr\'s order');
    return empty();
  }
}

// A new order with one list replaced (an empty list clears it). New objects; o is not changed.
function setHosts(o, ids) {
  return { ...o, hosts: cleanIds(ids) };
}
function setWorkspaces(o, host, ids) {
  if (!okId(host)) throw fail('bad_order');
  const list = cleanIds(ids);
  const workspaces = { ...o.workspaces };
  if (list.length) workspaces[host] = list;
  else delete workspaces[host];
  if (Object.keys(workspaces).length > MAX_KEYS) throw fail('bad_order');
  return { ...o, workspaces };
}
function setPanes(o, host, ws, ids) {
  if (!okId(host) || !okId(ws)) throw fail('bad_order');
  const list = cleanIds(ids);
  const m = { ...(o.panes[host] || {}) };
  if (list.length) m[ws] = list;
  else delete m[ws];
  const panes = { ...o.panes };
  if (Object.keys(m).length) panes[host] = m;
  else delete panes[host];
  if (Object.keys(m).length > MAX_KEYS || Object.keys(panes).length > MAX_KEYS) throw fail('bad_order');
  return { ...o, panes };
}

// Things in the order given: the ones named in ids first, in that order, then the rest as they
// came (a stable sort). idOf: a thing's id.
function sortBy(items, ids, idOf) {
  if (!ids || !ids.length) return items.slice();
  const at = new Map(ids.map((id, i) => [id, i]));
  const rank = (x) => (at.has(idOf(x)) ? at.get(idOf(x)) : ids.length);
  return items.map((x, i) => [x, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([x]) => x);
}

// Ids that are gone dropped, for the hosts whose lists are known now (online, herdr up).
// known: Map host -> { workspaces: Set, panes: Map(ws -> Set) }. Returns o itself when nothing went.
function prune(o, known) {
  let changed = false;
  const keep = (ids, set) => {
    const next = ids.filter((id) => set.has(id));
    if (next.length !== ids.length) changed = true;
    return next;
  };
  const workspaces = { ...o.workspaces };
  const panes = { ...o.panes };
  for (const [host, k] of known) {
    if (workspaces[host]) {
      workspaces[host] = keep(workspaces[host], k.workspaces);
      if (!workspaces[host].length) delete workspaces[host];
    }
    if (panes[host]) {
      const m = {};
      for (const [ws, ids] of Object.entries(panes[host])) {
        if (!k.workspaces.has(ws)) {
          changed = true;
          continue;
        }
        const left = keep(ids, k.panes.get(ws) || new Set());
        if (left.length) m[ws] = left;
      }
      if (Object.keys(m).length) panes[host] = m;
      else delete panes[host];
    }
  }
  return changed ? { ...o, workspaces, panes } : o;
}

module.exports = { empty, clean, load, cleanIds, setHosts, setWorkspaces, setPanes, sortBy, prune, MAX_IDS };
