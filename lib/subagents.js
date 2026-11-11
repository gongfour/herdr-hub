'use strict';
// Claude Code's subagents (the Agent tool) of a session, from the files it keeps beside the
// session's transcript (Claude Code 2.1.3xx):
//   <projects>/<slug>/<session>.jsonl                           the session (lib/transcript.js)
//   <projects>/<slug>/<session>/subagents/agent-<id>.meta.json  { agentType, description, toolUseId,
//                                                                 spawnDepth, parentAgentId?, finished? }
//   <projects>/<slug>/<session>/subagents/agent-<id>.jsonl      its own transcript (isSidechain)
// A subagent runs in the background: the agent that started it may end its turn (herdr: idle or
// done) while it works on, and takes its report up when it stops (a task notification).
// It is running while its meta has no `finished`, no notification in the session came after its
// last write, and it wrote within STALE_MS (one killed with its session never says it stopped).
// A layout this does not know (an older Claude Code, a changed one) only means no subagents.
//
// reader({ now }) -> { running(sessionFile, notified, b), log(sessionFile, id, notified, b) }: per
// hub (lib/hub.js), its caches inside. Every read goes through lib/fsq.js on the caller's budget b.

const path = require('path');
const fsq = require('./fsq');
const Inbox = require('../public/inbox');
const transcript = require('./transcript');

const STALE_MS = 20 * 60e3;
const RECHECK_MS = 60e3; // a stopped one without `finished` (stale, notified): looked at again this often
const NOTE_SLACK_MS = 3000; // its last lines are written just before its notification
const MAX_SHOWN = 20;
const TAIL_BYTES = 64 * 1024; // its last tool, for the list
const LOG_BYTES = 512 * 1024; // its tool lines and report, opened in the chat
const LOG_TOOLS = 80;
const META = /^agent-([A-Za-z0-9_-]{1,64})\.meta\.json$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const str = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');

// Where a session's subagents are: next to its transcript, in a folder named after it.
const dirOf = (sessionFile) => path.join(path.dirname(sessionFile), path.basename(sessionFile, '.jsonl'), 'subagents');

function shapeMeta(m) {
  const o = m && typeof m === 'object' && !Array.isArray(m) ? m : {};
  return {
    type: str(o.agentType, 60) || 'general-purpose',
    desc: str(o.description, 160),
    depth: Number.isInteger(o.spawnDepth) && o.spawnDepth > 0 ? o.spawnDepth : 1,
    finished: o.finished === true,
  };
}

function reader({ now = Date.now } = {}) {
  const dirs = new Map(); // subagents folder -> { mtime, ids: Map(id -> entry), last: [] }
  const tails = new Map(); // a subagent's transcript -> { rev, tool }

  async function readMeta(b, file) {
    try {
      return shapeMeta(JSON.parse(await fsq.readFile(b, file)));
    } catch (err) {
      if (err.gaveUp) throw err;
      return null; // being written, or not JSON: as if it were not there yet
    }
  }

  // The folder's subagents, its meta read again only when it changed.
  async function entries(dir, b) {
    let st;
    try {
      st = await fsq.stat(b, dir);
    } catch (err) {
      if (err.gaveUp) throw err;
      dirs.delete(dir);
      return null;
    }
    let d = dirs.get(dir);
    if (!d || d.mtime !== st.mtimeMs) {
      const ids = new Map();
      for (const f of await fsq.readdir(b, dir)) {
        const m = META.exec(f.name);
        if (m) ids.set(m[1], (d && d.ids.get(m[1])) || { id: m[1], meta: null, metaMtime: -1, checkedAt: 0 });
      }
      d = { mtime: st.mtimeMs, ids, last: d ? d.last : [] };
      dirs.set(dir, d);
      if (dirs.size > 64) dirs.delete(dirs.keys().next().value);
    }
    return d;
  }

  // Its last tool ("Edit: keymap.js · public"), from the tail of its transcript, while it changes.
  async function lastTool(file, st, b) {
    const rev = `${st.size}:${Math.round(st.mtimeMs)}`;
    const hit = tails.get(file);
    if (hit && hit.rev === rev) return hit.tool;
    const { text } = await transcript.readTail(file, TAIL_BYTES, b);
    const tool = Inbox.glance(transcript.parseSide(text)).lastTool || '';
    tails.delete(file);
    tails.set(file, { rev, tool });
    if (tails.size > 128) tails.delete(tails.keys().next().value);
    return tool;
  }

  // One subagent now: { ...meta, running, since, at, file } (its transcript's stat), or null.
  async function look(dir, e, notified, b) {
    const base = path.join(dir, `agent-${e.id}`);
    let mst;
    try {
      mst = await fsq.stat(b, `${base}.meta.json`);
    } catch (err) {
      if (err.gaveUp) throw err;
      return null;
    }
    if (mst.mtimeMs !== e.metaMtime || !e.meta) {
      e.meta = await readMeta(b, `${base}.meta.json`);
      e.metaMtime = mst.mtimeMs;
      // When it started: the meta is written once as it starts (birthtime, where the system keeps one).
      e.since = Math.round(mst.birthtimeMs > 0 ? mst.birthtimeMs : mst.mtimeMs);
    }
    if (!e.meta) return null;
    if (e.meta.finished) return { ...e.meta, running: false, since: e.since };
    let st;
    try {
      st = await fsq.stat(b, `${base}.jsonl`);
    } catch (err) {
      if (err.gaveUp) throw err;
      return { ...e.meta, running: false };
    }
    const at = Math.round(st.mtimeMs);
    const stopped = (notified[e.id] || 0) + NOTE_SLACK_MS >= at || now() - at > STALE_MS;
    return { ...e.meta, running: !stopped, since: e.since, at, file: `${base}.jsonl`, st };
  }

  // The subagents of a session that are running now, oldest first:
  // [{ id, type, desc, depth, since, tool }]. notified: transcript.glance's { taskId: ms }.
  // A read the budget cut short gives the last answer for that session.
  async function running(sessionFile, notified = {}, b = fsq.budget()) {
    const dir = dirOf(sessionFile);
    let d = null;
    try {
      d = await entries(dir, b);
      if (!d) return [];
      const out = [];
      const t = now();
      for (const e of d.ids.values()) {
        // Finished for good, or stopped a while ago: not looked at on every refresh.
        if (e.meta && e.meta.finished) continue;
        if (e.quietUntil && t < e.quietUntil) continue;
        const s = await look(dir, e, notified, b);
        if (!s) continue;
        if (!s.running) {
          e.quietUntil = s.finished ? 0 : t + RECHECK_MS;
          continue;
        }
        e.quietUntil = 0;
        const tool = await lastTool(s.file, s.st, b).catch((err) => {
          if (err.gaveUp) throw err;
          return '';
        });
        out.push({ id: e.id, type: s.type, desc: s.desc, ...(s.depth > 1 ? { depth: s.depth } : {}), since: s.since, ...(tool ? { tool } : {}) });
      }
      out.sort((x, y) => x.since - y.since || (x.id < y.id ? -1 : 1));
      d.last = out.slice(0, MAX_SHOWN);
      return d.last;
    } catch (err) {
      if (!err.gaveUp) throw err;
      const kept = dirs.get(dir);
      return kept ? kept.last : [];
    }
  }

  // One subagent's work, for its tool line opened in the chat: { found, id, type, desc, running,
  // since, tools: [{ name, summary, error?, state? }] (the last LOG_TOOLS), more (tools before
  // those, in the part read), cut (its transcript is longer than the part read), report (what it
  // handed back, else its last words) }. { found: false } for an id it doesn't have.
  async function log(sessionFile, id, notified = {}, b = fsq.budget()) {
    if (!ID.test(String(id))) return { found: false };
    const dir = dirOf(sessionFile);
    const e = { id, meta: null, metaMtime: -1 };
    const s = await look(dir, e, notified, b);
    if (!s) return { found: false };
    const file = path.join(dir, `agent-${id}.jsonl`);
    let text = '';
    let cut = false;
    try {
      const r = await transcript.readTail(file, LOG_BYTES, b);
      text = r.text;
      cut = r.truncated;
    } catch (err) {
      if (err.gaveUp) throw err;
    }
    const msgs = transcript.parseSide(text);
    const tools = [];
    let report = '';
    let words = '';
    for (const m of msgs) {
      if (m.role !== 'assistant') continue;
      if (m.text) words = m.text;
      for (const t of m.tools || []) {
        if (t.report) {
          report = t.report;
          continue;
        }
        const x = { name: t.name, summary: t.summary };
        if (t.error) x.error = true;
        if (t.state) x.state = t.state;
        tools.push(x);
      }
    }
    const shown = tools.slice(-LOG_TOOLS);
    return {
      found: true,
      id,
      type: s.type,
      desc: s.desc,
      running: s.running,
      ...(s.since ? { since: s.since } : {}),
      tools: shown,
      more: tools.length - shown.length,
      cut,
      report: report || words,
    };
  }

  return { running, log };
}

module.exports = { reader, dirOf, STALE_MS };
