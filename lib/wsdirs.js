'use strict';
// Each workspace's default folder (기본 폴더): where Ctrl+N, 새 셸 열기 and the start form open a
// new tab when nothing open says where. herdr has none (a workspace has no folder; a new tab
// without cwd opens in the folder of its active tab), so this host's Hub keeps them, in
// data/wsdirs.json as { [workspace_id]: { cwd, label } }.
//
// herdr keeps a workspace's id across its restarts but gives a closed one's id to a new workspace
// after one (w3 closed, herdr restarted, the next workspace is w3 again). So an entry lives only
// while its workspace does: gone from herdr's list → dropped; and the label is kept with it, so
// one seen for the first time in this process (the Hub was down meanwhile) under another label is
// taken for a new workspace and dropped too. A rename the Hub sees (the id in its last list) just
// moves the label along. Pure: the server does the reading and writing.

function clean(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, e] of Object.entries(raw)) {
    if (e && typeof e.cwd === 'string' && e.cwd && typeof e.label === 'string') out[id] = { cwd: e.cwd, label: e.label };
  }
  return out;
}

// entries against herdr's workspace list now; seen: the ids in the previous list this process
// read (null before the first). Returns { entries, changed }.
function reconcile(entries, workspaces, seen) {
  const now = new Map((workspaces || []).map((w) => [w.workspace_id, w.label]));
  const out = {};
  let changed = false;
  for (const [id, e] of Object.entries(entries)) {
    if (!now.has(id)) {
      changed = true;
      continue;
    }
    const label = now.get(id);
    if (label === e.label) out[id] = e;
    else if (seen && seen.has(id)) {
      out[id] = { cwd: e.cwd, label };
      changed = true;
    } else changed = true;
  }
  return { entries: changed ? out : entries, changed };
}

function set(entries, id, cwd, label) {
  const out = { ...entries };
  if (cwd) out[id] = { cwd, label };
  else delete out[id];
  return out;
}

const get = (entries, id) => (entries[id] ? entries[id].cwd : null);

module.exports = { clean, reconcile, set, get };
