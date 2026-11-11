'use strict';
// When each agent started working and when it last finished, as the hub saw it. herdr does not
// say, so the hub keeps it from the transitions it sees: then "작업 중 · 12분" and
// "완료 · 3분 전" are known the moment the app opens. An agent already working when the hub
// first sees it has an unknown start (null), never a made-up one. The maps are saved to a file
// (dump/load) so a restart or deploy does not forget them.

// A turn runs from working to idle or done; a question on the way (blocked) is still inside it,
// so working <-> blocked keeps the start. It finishes when the agent goes from working to idle or
// done. Straight from a question to idle or done is a refusal (No, Esc): Claude Code stops the
// turn there without a reply, and herdr calls even that done, so it is not a finish.
const IN_TURN = new Set(['working', 'blocked']);
const FINISHED = new Set(['idle', 'done']);
// Its subagents still running (a.subagents, lib/subagents.js): the turn goes on while the agent
// itself waits for them (herdr: idle or done), so the clock keeps its start and nothing finished.
const turnStatus = (a) => (FINISHED.has(a.status) && Array.isArray(a.subagents) && a.subagents.length ? 'working' : a.status);

// prev: Map key -> { status, workingSince, doneAt }. agents: [{ status, workingSince?, doneAt? }].
// keyOf(agent) -> key. Values an agent already carries (a peer that tracks its own) are kept.
// Returns the next map; sets workingSince and doneAt on each agent.
function track(prev, agents, now, keyOf) {
  const next = new Map();
  for (const a of agents) {
    const k = keyOf(a);
    const p = prev.get(k);
    const status = turnStatus(a);
    let workingSince = null;
    let doneAt = p ? p.doneAt : null;
    if (IN_TURN.has(status)) workingSince = p ? (IN_TURN.has(p.status) ? p.workingSince : now) : null;
    else if (p && p.status === 'working' && FINISHED.has(status)) doneAt = now;
    if (a.workingSince !== undefined) workingSince = a.workingSince; // the peer knows better
    if (a.doneAt !== undefined) doneAt = a.doneAt;
    a.workingSince = workingSince;
    a.doneAt = doneAt;
    next.set(k, { status, workingSince, doneAt });
  }
  return next;
}

// For the file: { savedAt, maps: { name: [[key, entry], ...] } }.
function dump(maps, now) {
  return { savedAt: now, maps: Object.fromEntries(Object.entries(maps).map(([name, m]) => [name, [...m]])) };
}

// Back from the file; empty maps when it is missing, unreadable or older than maxAgeMs (by then a
// pane id may belong to another agent).
function load(data, names, now, maxAgeMs) {
  const fresh = data && typeof data.savedAt === 'number' && now - data.savedAt <= maxAgeMs && data.maps;
  return Object.fromEntries(names.map((n) => [n, new Map(fresh && Array.isArray(data.maps[n]) ? data.maps[n] : [])]));
}

module.exports = { track, dump, load, turnStatus };
