'use strict';
// The home screen as an inbox: what needs me (답 필요), what just finished (방금 끝남), what is
// running (작업 중) and the rest (조용함). Also the one-line summaries the hub sends along:
// the first line of an agent's last reply and the last tool it ran.
// Pure: loaded as a plain script in the page (window.Inbox), required by the server and tests.
(function (root) {
  const SUMMARY_MAX = 120;
  const TOOL_MAX = 80;
  // 방금 끝남 keeps an agent this long after it finished, until it is opened.
  const RECENT_MS = 12 * 3600 * 1000;

  const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

  // Markdown line -> plain words: no heading/quote/list markers, emphasis, code ticks or link
  // targets. A table row reads as its cells.
  function plain(line) {
    let s = String(line).trim();
    if (/^\|.*\|$/.test(s)) s = s.slice(1, -1).split('|').map((c) => c.trim()).filter(Boolean).join(' · ');
    return s
      .replace(/^(?:#{1,6}\s+|>\s*)+/, '')
      .replace(/^(?:[-*+•]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      .replace(/(^|[^\w*])[*_]([^*_\s][^*_]*?)[*_](?=[^\w*]|$)/g, '$1$2')
      .replace(/`+([^`]*)`+/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // The first line worth reading of a reply: skips blank lines, code fences, rules and table
  // separators. '' when there is none.
  function firstLine(text) {
    for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
      const t = raw.trim();
      if (!t || /^(```|~~~)/.test(t) || /^([-*_=]\s*){3,}$/.test(t) || /^\|?(\s*:?-{2,}:?\s*\|)+\s*(:?-{2,}:?\s*)?\|?$/.test(t)) continue;
      const p = plain(t);
      if (p) return clip(p, SUMMARY_MAX);
    }
    return '';
  }

  // From parsed transcript messages: lastReply (first line of the last reply with text) and
  // lastTool ("Bash: npm test", the last tool of the current turn, i.e. after the last prompt).
  function glance(messages) {
    const out = { lastReply: '', lastTool: '' };
    const msgs = Array.isArray(messages) ? messages : [];
    for (let i = msgs.length - 1; i >= 0 && !out.lastReply; i--) if (msgs[i].role === 'assistant' && msgs[i].text) out.lastReply = firstLine(msgs[i].text);
    for (let i = msgs.length - 1; i >= 0 && msgs[i].role !== 'user'; i--) {
      const tools = msgs[i].role === 'assistant' && msgs[i].tools;
      if (tools && tools.length) {
        const t = tools[tools.length - 1];
        out.lastTool = clip(t.summary ? `${t.name}: ${t.summary}` : String(t.name || ''), TOOL_MAX);
        break;
      }
    }
    return out;
  }

  // What marks a finish as read on this device: the same finish (doneAt) of the same pane.
  // An agent herdr calls done whose finish time the hub doesn't know (it restarted) uses "done".
  const seenKey = (a) => `${a.host || ''}|${a.pane}|${a.doneAt || 'done'}`;

  // agents: the hub's state.agents (shells are not agents, so never here).
  // isSeen(key) -> boolean. Returns { blocked, done, working, idle }, each in display order.
  function bucket(agents, { now = Date.now(), isSeen = () => false, recentMs = RECENT_MS } = {}) {
    const out = { blocked: [], done: [], working: [], idle: [] };
    for (const a of agents || []) {
      if (a.status === 'blocked') out.blocked.push(a);
      else if (a.status === 'working') out.working.push(a);
      else {
        const fresh = a.doneAt ? now - a.doneAt <= recentMs : a.status === 'done';
        (fresh && !isSeen(seenKey(a)) ? out.done : out.idle).push(a);
      }
    }
    const asc = (k) => (x, y) => (x[k] == null) - (y[k] == null) || (x[k] || 0) - (y[k] || 0);
    out.done.sort((x, y) => (x.doneAt == null) - (y.doneAt == null) || (y.doneAt || 0) - (x.doneAt || 0));
    out.working.sort(asc('workingSince')); // the longest-running first
    return out;
  }

  const api = { firstLine, glance, bucket, seenKey, RECENT_MS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Inbox = api;
})(typeof self !== 'undefined' ? self : this);
