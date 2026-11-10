'use strict';
// A Claude agent's model, how full its context window is, and the plan's usage limits on this host
// (README 「모델·컨텍스트·사용량」). Two sources:
//   - the status line file lib/statusline.js writes per session, when Claude Code's statusLine runs
//     it: Claude Code's own numbers (model, context_window, rate_limits) — the only source of limits;
//   - the transcript's last reply (message.model, message.usage), always there: model and context
//     when there is no status line file, or it is older than the reply (the status line was taken out).
// Limits are the account's, so the host's are merged from every session's file (mergeLimits).

const path = require('path');
const fsq = require('./fsq');
const statusline = require('./statusline');

// 'claude-opus-5-5' -> 'Opus 5.5', 'claude-sonnet-4-20250514' -> 'Sonnet 4',
// 'claude-3-5-sonnet-20241022' -> 'Sonnet 3.5'; anything else as it is.
function modelName(id) {
  const s = String(id || '').replace(/\[1m\]$/i, '');
  let m = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/i.exec(s);
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}${m[3] ? `.${m[3]}` : ''}`;
  m = /^claude-(\d+)(?:-(\d))?-(opus|sonnet|haiku)(?:-\d{8})?$/i.exec(s);
  if (m) return `${m[3][0].toUpperCase()}${m[3].slice(1).toLowerCase()} ${m[1]}${m[2] ? `.${m[2]}` : ''}`;
  return s;
}

// The context window when nothing says otherwise: 1M for a [1m] id and the 5 family on (Claude
// Code 2.1.322 reports 1000000 for opus, sonnet and haiku 5.5, 200000 for opus 4.6), else 200k.
function defaultWindow(id) {
  const s = String(id || '');
  if (/\[1m\]$/i.test(s)) return 1e6;
  const m = /^claude-(?:opus|sonnet|haiku|fable)-(\d+)/i.exec(s);
  return m && Number(m[1]) >= 5 ? 1e6 : 2e5;
}

const inputTokens = (u) => ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'].reduce((n, k) => n + (Number(u && u[k]) || 0), 0);

// The end of a transcript -> { modelId, tokens, at } from the last reply of the main chat (not a
// subagent's, not Claude Code's own '<synthetic>' notes); tokens: null when /compact came after it
// (the next reply tells). The tokens are what the reply was sent with: input + cache writes + cache
// reads, as Claude Code counts context_window.used_percentage. null when there is no reply.
function fromTranscript(text) {
  const lines = String(text || '').split('\n');
  let compacted = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes('"assistant"') && !line.includes('compact_boundary')) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.isSidechain) continue;
    if (e.type === 'system' && e.subtype === 'compact_boundary') {
      if (!compacted) compacted = Date.parse(e.timestamp) || 0;
      continue;
    }
    const msg = e.type === 'assistant' && e.message;
    if (!msg || !msg.model || msg.model === '<synthetic>' || !msg.usage) continue;
    const at = Date.parse(e.timestamp) || 0;
    return { modelId: String(msg.model), tokens: compacted ? null : inputTokens(msg.usage), at: compacted || at };
  }
  return null;
}

// A status line file -> { modelId, model, tokens, window, pct, at }, or null.
function fromStatusline(d) {
  if (!d || typeof d !== 'object') return null;
  const cw = d.context_window && typeof d.context_window === 'object' ? d.context_window : {};
  const m = d.model && typeof d.model === 'object' ? d.model : {};
  const window = Number(cw.context_window_size) || null;
  const tokens = cw.current_usage && typeof cw.current_usage === 'object' ? inputTokens(cw.current_usage) : null;
  const pct = Number.isFinite(cw.used_percentage) ? cw.used_percentage : null;
  return { modelId: m.id ? String(m.id) : null, model: m.display_name ? String(m.display_name) : null, tokens, window, pct, at: Number(d.at) || 0 };
}

const WINDOWS = [['five_hour', 'five'], ['seven_day', 'week']];

// The plan's limits from many sessions' files -> { five: { pct, resetsAt }, week: …, at } or null.
// A session's numbers are those of its last reply, so an idle one's are old. Within a window the
// percentage only grows until it resets, and a newer window resets later: the latest reset wins,
// and the highest percentage for the same reset. A window already reset is left out (resetsAt in ms).
function mergeLimits(files, now = Date.now()) {
  const out = {};
  let at = 0;
  for (const d of files) {
    const rl = d && d.rate_limits;
    if (!rl || typeof rl !== 'object') continue;
    for (const [from, to] of WINDOWS) {
      const w = rl[from];
      if (!w || !Number.isFinite(w.used_percentage) || !Number.isFinite(w.resets_at)) continue;
      const resetsAt = w.resets_at * 1000;
      if (resetsAt <= now) continue;
      const pct = w.used_percentage;
      const had = out[to];
      if (!had || resetsAt > had.resetsAt + 60e3 || (Math.abs(resetsAt - had.resetsAt) <= 60e3 && pct > had.pct)) out[to] = { pct, resetsAt };
      at = Math.max(at, Number(d.at) || 0);
    }
  }
  return out.five || out.week ? { ...out, at } : null;
}

// One agent's usage from its transcript's last reply (t) and its status line file (s); limits: the
// host's. -> { model, modelId, tokens, window, pct, from, limits } or null.
function combine(t, s, limits = null) {
  const sl = fromStatusline(s);
  const useSl = sl && (sl.modelId || sl.window) && (!t || sl.at >= t.at - 5000);
  let u = null;
  if (useSl) {
    const window = sl.window || defaultWindow(sl.modelId);
    const pct = sl.pct != null ? sl.pct : sl.tokens != null ? (sl.tokens / window) * 100 : null;
    u = { modelId: sl.modelId, model: sl.model || modelName(sl.modelId), tokens: sl.tokens, window, pct, from: 'statusline' };
  } else if (t) {
    // The window the status line last gave for this model, when it did (a [1m] choice on an older model).
    const window = sl && sl.window && sl.modelId === t.modelId ? sl.window : defaultWindow(t.modelId);
    u = { modelId: t.modelId, model: modelName(t.modelId), tokens: t.tokens, window, pct: t.tokens != null ? (t.tokens / window) * 100 : null, from: 'transcript' };
  }
  if (u) {
    // A long-context choice the name does not show: 「Opus 4.6 1M」.
    if (u.window >= 1e6 && defaultWindow(u.modelId) < 1e6 && !/1M/i.test(u.model)) u.model += ' 1M';
    if (u.pct != null) u.pct = Math.round(u.pct * 10) / 10;
  }
  if (!u && !limits) return null;
  return { ...(u || {}), ...(limits ? { limits } : {}) };
}

const SESSION = /^[0-9a-f-]{8,64}$/i;
const LIMITS_EVERY_MS = 15e3;
const LIMITS_MAX_AGE_MS = 8 * 24 * 3600e3; // older files cannot hold a window not yet reset

// The status line files of one host, read through fsq (they are under ~/.claude) and kept while
// their mtime stays the same. One per hub (createServer), not module state.
function reader({ dir = statusline.dir(), now = () => Date.now() } = {}) {
  const files = new Map(); // file -> { mtimeMs, data }
  let limits = { at: -Infinity, value: null, pending: null };

  async function load(b, file, st) {
    const hit = files.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs) return hit.data;
    let data = null;
    try {
      data = JSON.parse(await fsq.readFile(b, file));
    } catch (err) {
      if (err.gaveUp) throw err;
    }
    files.delete(file);
    files.set(file, { mtimeMs: st.mtimeMs, data });
    if (files.size > 256) files.delete(files.keys().next().value);
    return data;
  }

  async function session(id, b) {
    if (!SESSION.test(String(id || ''))) return null;
    const file = path.join(dir, `${id}.json`);
    let st;
    try {
      st = await fsq.stat(b, file);
    } catch (err) {
      if (err.gaveUp) throw err;
      return null;
    }
    return load(b, file, st);
  }

  async function readLimits(b) {
    let names;
    try {
      names = (await fsq.readdir(b, dir)).filter((d) => d.isFile() && /\.json$/.test(d.name)).map((d) => d.name);
    } catch (err) {
      if (err.gaveUp) throw err;
      return null;
    }
    const datas = [];
    for (const name of names) {
      const file = path.join(dir, name);
      const st = await fsq.stat(b, file).catch((err) => (err.gaveUp ? Promise.reject(err) : null));
      if (!st || now() - st.mtimeMs > LIMITS_MAX_AGE_MS) continue;
      datas.push(await load(b, file, st));
    }
    return mergeLimits(datas, now());
  }

  // The host's limits, read again at most every 15 s; one read at a time. A read the budget cut
  // short keeps the last value.
  async function hostLimits(b) {
    if (now() - limits.at >= LIMITS_EVERY_MS && !limits.pending) {
      limits.pending = readLimits(b)
        .then((value) => (limits = { at: now(), value, pending: null }))
        .catch(() => (limits = { ...limits, pending: null }));
    }
    if (limits.pending) await limits.pending;
    const v = limits.value;
    // A window that reset since the read is left out now, not 15 s later.
    return v ? mergeLimits([{ rate_limits: { five_hour: v.five && { used_percentage: v.five.pct, resets_at: v.five.resetsAt / 1000 }, seven_day: v.week && { used_percentage: v.week.pct, resets_at: v.week.resetsAt / 1000 } }, at: v.at }], now()) : null;
  }

  return { session, hostLimits };
}

module.exports = { modelName, defaultWindow, fromTranscript, fromStatusline, mergeLimits, combine, reader };
