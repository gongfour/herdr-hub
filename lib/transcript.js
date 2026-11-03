'use strict';
// Claude Code transcripts: ~/.claude/projects/<cwd slug>/<session id>.jsonl.
// Only the tail is read; a long session's file runs to many megabytes.

const fs = require('fs');
const os = require('os');
const path = require('path');
const Inbox = require('../public/inbox');
const { toolSummary, toolCommand } = require('./tools');

const TAIL_BYTES = 3 * 1024 * 1024;
// Claude Code turns an image path in a prompt into "[Image #N]" plus an inline image, and
// records where it came from in a meta entry next to it. Herdr Hub's own uploads are named so.
const IMAGE_SOURCE = /^\[Image: source: (.+)\]$/;
const UPLOAD_NAME = /(?:^|[\\/])(?:herdr-hub|paddock)-uploads[\\/](\d{8}-\d{6}-[0-9a-f]{8}\.(?:jpg|png|webp))$/;
const located = new Map();

function projectsDir() {
  const base = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(base, 'projects');
}

function locate(sessionId) {
  if (!/^[0-9a-f-]{8,64}$/i.test(sessionId)) return null;
  const cached = located.get(sessionId);
  if (cached && fs.existsSync(cached)) return cached;
  const root = projectsDir();
  let dirs = [];
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return null;
  }
  for (const d of dirs) {
    const file = path.join(root, d.name, `${sessionId}.jsonl`);
    if (fs.existsSync(file)) {
      located.set(sessionId, file);
      return file;
    }
  }
  return null;
}

function readTail(file, bytes = TAIL_BYTES) {
  const fd = fs.openSync(file, 'r');
  try {
    const { size } = fs.fstatSync(fd);
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    let text = buf.toString('utf8');
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    return { text, truncated: start > 0, size };
  } finally {
    fs.closeSync(fd);
  }
}

// Harness text that arrives as a "user" entry but was not typed by a person.
const NOT_TYPED = /^\s*<(command-|local-command|system-reminder|task-notification|bash-|user-prompt-submit-hook)|^Caveat: |^This session is being continued from a previous conversation/;

function cleanUserText(text) {
  return text
    .replace(/<\/?pasted_content[^>]*>/g, '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .trim();
}

// A tool's output, for tapping a tool line open: text only, cut short.
const RESULT_MAX = 2000;
function resultText(content) {
  const t = typeof content === 'string' ? content : Array.isArray(content) ? content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n') : '';
  const s = String(t || '').replace(/\r/g, '').replace(/\s+$/, '');
  return s.length > RESULT_MAX ? { text: s.slice(0, RESULT_MAX), cut: true } : { text: s, cut: false };
}

// AskUserQuestion's answers: from the structured result when there is one, else from its text
// ('User has answered your questions: "Pick one?"="Red". You can now continue …').
function askAnswers(e, text) {
  const r = e.toolUseResult;
  if (r && r.answers && typeof r.answers === 'object' && !Array.isArray(r.answers)) {
    const out = Object.entries(r.answers).map(([q, a]) => ({ q, a: String(a) }));
    if (out.length) return out;
  }
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"="((?:[^"\\]|\\.)*)"/g;
  for (let m; (m = re.exec(text)); ) out.push({ q: m[1], a: m[2] });
  return out;
}

// "<bash-input>ls</bash-input>" -> the user's "! ls" line; "<bash-stdout>…</bash-stdout>
// <bash-stderr>…</bash-stderr>" -> a shell output block (colour codes dropped, cut long).
const SHELL_MAX = 8000;
const ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g;
function bashEntry(typed) {
  const t = String(typed || '');
  const input = /^\s*<bash-input>([\s\S]*?)<\/bash-input>\s*$/.exec(t);
  if (input) return { role: 'user', text: `! ${input[1].trim()}`, bash: true };
  if (!/^\s*<bash-std(out|err)>/.test(t)) return null;
  const part = (tag) => {
    const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(t);
    return m ? m[1].replace(ANSI, '').replace(/\r/g, '').replace(/\s+$/, '') : '';
  };
  const cut = (x) => (x.length > SHELL_MAX ? `${x.slice(0, SHELL_MAX)}\n…` : x);
  const out = { role: 'shell', text: cut(part('bash-stdout')) };
  const err = cut(part('bash-stderr'));
  if (err) out.err = err;
  return out;
}

function parse(text) {
  const messages = [];
  const tools = new Map(); // tool_use id -> the tool entry, for its result
  let current = null; // assistant message being assembled across lines with the same id
  let lastUser = null; // { msg, promptId } for the image source entries that follow it
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.isSidechain || e.isCompactSummary || !e.message) continue;
    const content = e.message.content;
    if (e.isMeta) {
      // "[Image: source: <path>]", one text block per image: the uploads behind the inline
      // images of the prompt just before, shown by name.
      if (!lastUser || (e.promptId && lastUser.promptId && e.promptId !== lastUser.promptId)) continue;
      const blocks = typeof content === 'string' ? [content] : Array.isArray(content) ? content.filter((b) => b.type === 'text').map((b) => b.text) : [];
      for (const text of blocks) {
        const src = IMAGE_SOURCE.exec(String(text).trim());
        const up = src && UPLOAD_NAME.exec(src[1].trim());
        if (up) (lastUser.msg.uploads ||= []).push(up[1]);
      }
      continue;
    }
    if (e.type === 'user' && Array.isArray(content) && content.some((b) => b && b.type === 'tool_result')) {
      for (const b of content) {
        const t = b && b.type === 'tool_result' && tools.get(b.tool_use_id);
        if (!t) continue;
        const r = resultText(b.content);
        if (r.text) t.result = r.text;
        if (r.cut) t.cut = true;
        if (b.is_error) t.error = true;
        if (t.name === 'AskUserQuestion') {
          const answers = askAnswers(e, r.text);
          if (answers.length) t.answers = answers;
        }
      }
      continue;
    }
    if (e.type === 'user') {
      let typed = '';
      // Images pasted into the prompt are stored inline as base64: only count them, the
      // phone gets a chip per image instead of megabytes. (Tool results never count.)
      let images = 0;
      if (typeof content === 'string') typed = content;
      else if (Array.isArray(content)) {
        typed = content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
        images = content.filter((b) => b.type === 'image').length;
      }
      // Bash mode ("!cmd" typed at the prompt): the command, then its output in an entry of its own.
      const bash = bashEntry(typed);
      if (bash) {
        current = null;
        messages.push({ ...bash, ts: e.timestamp, id: e.uuid });
        continue;
      }
      if ((!typed && !images) || NOT_TYPED.test(typed)) continue;
      const cleaned = cleanUserText(typed);
      if (!cleaned && !images) continue;
      current = null;
      if (/^\[Request interrupted by user[^\]]*\]$/.test(cleaned)) messages.push({ role: 'note', text: '중단됨', ts: e.timestamp, id: e.uuid });
      else {
        const msg = { role: 'user', text: cleaned, ts: e.timestamp, id: e.uuid, ...(images ? { images } : {}) };
        messages.push(msg);
        lastUser = { msg, promptId: e.promptId || null };
      }
    } else if (e.type === 'assistant' && Array.isArray(content)) {
      const mid = e.message.id || e.uuid;
      if (!current || current.mid !== mid) {
        current = { role: 'assistant', mid, id: mid, text: '', tools: [], ts: e.timestamp };
        messages.push(current);
      }
      for (const b of content) {
        if (b.type === 'text' && b.text.trim()) current.text += (current.text ? '\n\n' : '') + b.text.trim();
        else if (b.type === 'tool_use') {
          const t = { name: b.name, summary: toolSummary(b) };
          // The full command, shown when the line is opened, unless the line already is it.
          const cmd = toolCommand(b);
          if (cmd && cmd !== t.summary) t.cmd = cmd;
          if (b.id) tools.set(b.id, t);
          current.tools.push(t);
        }
      }
    }
  }
  // Every message has an id (the entry's uuid or the reply's message id) for ?since=.
  return messages
    .filter((m) => m.role !== 'assistant' || m.text || m.tools.length)
    .map(({ mid, ...m }, i) => ({ ...m, id: m.id || `i${i}` }));
}

// Parsed transcripts by file, reused while the file's size and mtime stay the same: an idle
// agent's chat is polled every few seconds and its 3 MB tail need not be read again each time.
const CACHE_MAX = 24;
const cache = new Map(); // file -> { rev, truncated, size, messages }
function parsed(file) {
  const st = fs.statSync(file);
  const rev = `${st.size}:${Math.round(st.mtimeMs)}`;
  const hit = cache.get(file);
  if (hit && hit.rev === rev) return hit;
  const { text, truncated, size } = readTail(file);
  const entry = { rev, truncated, size, messages: parse(text) };
  cache.delete(file);
  cache.set(file, entry);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return entry;
}

// The last `limit` messages. rev: the client's copy is of this version -> { unchanged }.
// since: an id the client has -> that message (it may have grown) and everything after it;
// an id no longer in view -> the full window again (reset).
function read(sessionId, limit = 120, { since = null, rev = null } = {}) {
  const file = locate(sessionId);
  if (!file) return { found: false, messages: [] };
  return windowOf(parsed(file), limit, { since, rev });
}

function windowOf(p, limit, { since = null, rev = null } = {}) {
  const all = p.messages;
  const base = { found: true, rev: p.rev, truncated: p.truncated || all.length > limit, size: p.size };
  if (rev && rev === p.rev) return { ...base, unchanged: true, messages: [] };
  if (since) {
    const i = all.findIndex((m) => m.id === since);
    if (i >= 0 && all.length - i <= limit) return { ...base, since, messages: all.slice(i) };
  }
  return { ...base, reset: Boolean(since), messages: all.slice(-limit) };
}

// For the home screen and notifications: the first line of the last reply and the last tool,
// from a small tail (256 KB) re-read only when the file changed.
const GLANCE_BYTES = 256 * 1024;
const glances = new Map(); // file -> { rev, value }
function glance(sessionId) {
  const file = locate(sessionId);
  if (!file) return null;
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return null;
  }
  const rev = `${st.size}:${Math.round(st.mtimeMs)}`;
  const hit = glances.get(file);
  if (hit && hit.rev === rev) return hit.value;
  const value = Inbox.glance(parse(readTail(file, GLANCE_BYTES).text));
  glances.delete(file);
  glances.set(file, { rev, value });
  if (glances.size > 64) glances.delete(glances.keys().next().value);
  return value;
}

module.exports = { read, locate, parse, windowOf, parsed, bashEntry, glance };
