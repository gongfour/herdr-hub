'use strict';
// When each agent started working and when it last finished, as the hub saw it. herdr does not
// say, so the hub keeps it (in memory) from the transitions it sees: then "작업 중 · 12분" and
// "완료 · 3분 전" are known the moment the app opens. An agent already working when the hub
// first sees it has an unknown start (null), never a made-up one.

// prev: Map key -> { status, workingSince, doneAt }. agents: [{ status, workingSince?, doneAt? }].
// keyOf(agent) -> key. Values an agent already carries (a peer that tracks its own) are kept.
// Returns the next map; sets workingSince and doneAt on each agent.
function track(prev, agents, now, keyOf) {
  const next = new Map();
  for (const a of agents) {
    const k = keyOf(a);
    const p = prev.get(k);
    let workingSince = null;
    let doneAt = p ? p.doneAt : null;
    if (a.status === 'working') workingSince = p ? (p.status === 'working' ? p.workingSince : now) : null;
    else if (p && p.status === 'working') doneAt = now;
    if (a.workingSince !== undefined) workingSince = a.workingSince; // the peer knows better
    if (a.doneAt !== undefined) doneAt = a.doneAt;
    a.workingSince = workingSince;
    a.doneAt = doneAt;
    next.set(k, { status: a.status, workingSince, doneAt });
  }
  return next;
}

module.exports = { track };
