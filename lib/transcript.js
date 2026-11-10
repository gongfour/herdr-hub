'use strict';
// Claude Code transcripts: ~/.claude/projects/<cwd slug>/<session id>.jsonl.
// Only the tail is read for the chat window; a long session's file runs to many megabytes, and
// older pages are read backwards from there a chunk at a time (pageBefore).

const fsq = require('./fsq');
const os = require('os');
const path = require('path');
const Inbox = require('../public/inbox');
const { toolSummary, toolCommand } = require('./tools');
const { queueOps: queueOpsOf } = require('./claudequeue');
const { fromTranscript } = require('./usage');

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

// Every read here is asynchronous and within the request's time budget b (lib/fsq.js): a call
// that gives up rejects, and the request answers with an error instead of waiting.
async function locate(sessionId, b = fsq.budget()) {
  if (!/^[0-9a-f-]{8,64}$/i.test(sessionId)) return null;
  const cached = located.get(sessionId);
  if (cached && (await fsq.exists(b, cached))) return cached;
  const root = projectsDir();
  let dirs = [];
  try {
    dirs = (await fsq.readdir(b, root)).filter((d) => d.isDirectory());
  } catch (err) {
    if (err.gaveUp) throw err;
    return null;
  }
  for (const d of dirs) {
    const file = path.join(root, d.name, `${sessionId}.jsonl`);
    if (await fsq.exists(b, file)) {
      located.set(sessionId, file);
      return file;
    }
  }
  return null;
}

async function readTail(file, bytes = TAIL_BYTES, b = fsq.budget()) {
  const { buf, start, size } = await fsq.readPart(b, file, bytes, { from: 'end' });
  let text = buf.toString('utf8');
  if (start > 0) text = text.slice(text.indexOf('\n') + 1);
  return { text, truncated: start > 0, size };
}

// Harness text that arrives as a "user" entry but was not typed by a person.
const NOT_TYPED = /^\s*<(command-|local-command|system-reminder|task-notification|bash-|user-prompt-submit-hook)|^Caveat: |^This session is being continued from a previous conversation/;

// A slash command run at the prompt (/clear, /model opus, a skill) is logged as a user entry
// '<command-name>/clear</command-name><command-message>…<command-args>…</command-args>': not
// chat, but the sign that a command sent from here arrived. -> '/clear' or '/model opus', or null.
function commandEntry(typed) {
  const t = String(typed || '');
  const name = /<command-name>\s*([^<]*?)\s*<\/command-name>/.exec(t);
  if (!name || !name[1]) return null;
  const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(t);
  const a = args ? args[1].trim() : '';
  const n = name[1].startsWith('/') ? name[1] : `/${name[1]}`;
  return a ? `${n} ${a}` : n;
}

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

// A tool_result onto its tool entry t (from the user entry e that carried it).
function applyResult(t, b, e) {
  const r = resultText(b.content);
  if (r.text) t.result = r.text;
  if (r.cut) t.cut = true;
  if (b.is_error) t.error = true;
  if (t.name === 'AskUserQuestion') {
    const answers = askAnswers(e, r.text);
    if (answers.length) t.answers = answers;
  }
}

// One run of whole lines -> { messages (assistant ones still carry mid), tools (tool_use id ->
// its entry), orphans (results whose tool_use is in an earlier run: { b, e }) }.
function parseChunk(text) {
  const messages = [];
  const tools = new Map(); // tool_use id -> the tool entry, for its result
  const orphans = [];
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
    // A prompt typed while the agent was busy reaches it mid-turn, logged as an attachment and
    // not as a user entry: read it as one. (Task notifications and agents' messages come the
    // same way, but nobody typed them.)
    const a = e.attachment;
    if (e.type === 'attachment' && a && a.type === 'queued_command' && a.commandMode === 'prompt' && (!a.origin || a.origin.kind === 'human') && a.prompt) {
      e = { ...e, type: 'user', message: { role: 'user', content: a.prompt } };
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
        if (!b || b.type !== 'tool_result') continue;
        const t = tools.get(b.tool_use_id);
        if (t) applyResult(t, b, e);
        else if (b.tool_use_id) orphans.push({ b, e });
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
      const cmd = commandEntry(typed);
      if (cmd) {
        current = null;
        messages.push({ role: 'cmd', text: cmd, ts: e.timestamp, id: e.uuid });
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
          // The plan waiting for approval (its prompt on the screen shows only the question).
          const plan = b.name === 'ExitPlanMode' && b.input && typeof b.input.plan === 'string' ? b.input.plan.trim() : '';
          if (plan) t.plan = plan.length > 8000 ? `${plan.slice(0, 8000)}…` : plan;
          if (b.id) tools.set(b.id, t);
          current.tools.push(t);
        }
      }
    }
  }
  return { messages, tools, orphans };
}

// Every message has an id (the entry's uuid or the reply's message id) for ?since= and ?before=.
// Slash commands ('cmd') are never shown: they leave the messages here and go on the side
// (commandsOf), so no list, count or page of messages ever has them.
const shown = (messages) => messages.filter((m) => m.role !== 'cmd' && (m.role !== 'assistant' || m.text || m.tools.length));
const strip = (messages, tag = '') => messages.map(({ mid, ...m }, i) => ({ ...m, id: m.id || `i${tag}${i}` }));

// The slash commands among raw messages, each with the id of the shown message before it
// (after: null at the top): { text, id, after }. The client clears the bubble of a command it
// sent once one with its text comes after the message it was sent after (ChatKeep.cmdSeen).
const COMMANDS_MAX = 20;
function commandsOf(raw, vis, messages) {
  const idOf = new Map(vis.map((m, i) => [m, messages[i].id]));
  const out = [];
  let after = null;
  raw.forEach((m, i) => {
    if (idOf.has(m)) after = idOf.get(m);
    else if (m.role === 'cmd') out.push({ text: m.text, id: m.id || `c${i}`, after });
  });
  return out.slice(-COMMANDS_MAX);
}

// -> { messages, commands }
function parseAll(text) {
  const raw = parseChunk(text).messages;
  const vis = shown(raw);
  const messages = strip(vis);
  return { messages, commands: commandsOf(raw, vis, messages) };
}

function parse(text) {
  return parseAll(text).messages;
}

// Parsed transcripts by file, reused while the file's size and mtime stay the same: an idle
// agent's chat is polled every few seconds and its 3 MB tail need not be read again each time.
const CACHE_MAX = 24;
const cache = new Map(); // file -> { rev, truncated, size, messages, commands }
async function parsed(file, b = fsq.budget()) {
  const st = await fsq.stat(b, file);
  const rev = `${st.size}:${Math.round(st.mtimeMs)}`;
  const hit = cache.get(file);
  if (hit && hit.rev === rev) return hit;
  const { text, truncated, size } = await readTail(file, TAIL_BYTES, b);
  const entry = { rev, truncated, size, ...parseAll(text) };
  cache.delete(file);
  cache.set(file, entry);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return entry;
}

// The last `limit` messages. rev: the client's copy is of this version -> { unchanged }.
// since: an id the client has -> that message (it may have grown) and everything after it;
// an id no longer in view -> the full window again (reset).
// before: the page of `limit` older messages before that id (pageBefore).
async function read(sessionId, limit = 120, { since = null, rev = null, before = null } = {}) {
  const b = fsq.budget();
  const file = await locate(sessionId, b);
  if (!file) return { found: false, messages: [] };
  if (before) return pageBefore(file, before, limit, b);
  return windowOf(await parsed(file, b), limit, { since, rev });
}

function windowOf(p, limit, { since = null, rev = null } = {}) {
  const all = p.messages;
  let base = { found: true, rev: p.rev, truncated: p.truncated || all.length > limit, size: p.size };
  if (rev && rev === p.rev) return { ...base, unchanged: true, messages: [] };
  // The slash commands, on the side of the messages (commandsOf); a host before them sends none.
  base = { ...base, commands: p.commands || [] };
  if (since) {
    const i = all.findIndex((m) => m.id === since);
    if (i >= 0 && all.length - i <= limit) return { ...base, since, messages: all.slice(i) };
  }
  return { ...base, reset: Boolean(since), messages: all.slice(-limit) };
}

// ---- older pages (?before=<id>): the chat further back than the tail window
// A file's history: the parsed run of whole lines [start, end) of the file, grown backwards a
// CHUNK at a time as pages before it are asked for and forwards as the file grows (Claude Code
// only appends), so a page is a slice of it and no read covers the whole of a big file.
let CHUNK = 2 * 1024 * 1024;
const PAGE_READS = 4; // chunks read for one request at most; the page says more when it stopped
const HISTORY_MAX = 3;
const histories = new Map(); // file -> { size, start, end, messages, tools, orphans }
const NL = 10;

function parseRun(buf, at) {
  const r = parseChunk(buf.toString('utf8'));
  const messages = shown(r.messages);
  messages.forEach((m, i) => {
    if (!m.id) m.id = `i${at}-${i}`;
  });
  return { messages, tools: r.tools, orphans: r.orphans };
}

// older then newer, both runs of messages from consecutive bytes of the file.
function join(older, newer) {
  const orphans = older.orphans.slice();
  for (const o of newer.orphans) {
    const t = older.tools.get(o.b.tool_use_id);
    if (t) applyResult(t, o.b, o.e);
    else orphans.push(o);
  }
  const messages = older.messages.slice();
  const first = newer.messages[0];
  const last = messages[messages.length - 1];
  // One reply whose lines the cut fell between: one message, with the newer one's id.
  if (first && last && first.role === 'assistant' && last.role === 'assistant' && first.mid && first.mid === last.mid) {
    messages.pop();
    first.text = [last.text, first.text].filter(Boolean).join('\n\n');
    first.tools = last.tools.concat(first.tools);
    first.ts = last.ts || first.ts;
  }
  return { messages: messages.concat(newer.messages), tools: new Map([...older.tools, ...newer.tools]), orphans };
}

async function backwards(file, h, b) {
  const from = Math.max(0, h.start - CHUNK);
  const { buf } = await fsq.readPart(b, file, h.start - from, { at: from });
  // The first line is cut unless the run starts the file: it belongs to the chunk before.
  // A line longer than a chunk (an inline image): skipped, its cut head fails to parse later.
  const nl = from > 0 ? buf.indexOf(NL) : -1;
  if (from > 0 && nl < 0) return { ...h, start: from };
  const at = from > 0 ? from + nl + 1 : 0;
  const run = parseRun(buf.subarray(at - from), at);
  return { ...h, ...join(run, h), start: at };
}

async function forwards(file, h, size, b) {
  const { buf } = await fsq.readPart(b, file, size - h.end, { at: h.end });
  const nl = buf.lastIndexOf(NL); // a line still being written waits for the next read
  if (nl < 0) return { ...h, size };
  const run = parseRun(buf.subarray(0, nl + 1), h.end);
  return { ...h, ...join(h, run), end: h.end + nl + 1, size };
}

async function history(file, b) {
  const st = await fsq.stat(b, file);
  const h = histories.get(file);
  if (h && st.size >= h.end) return st.size > h.end ? forwards(file, h, st.size, b) : h;
  // A new one: the last chunk, from its first whole line to its last (one still being written
  // waits for the next read).
  const { buf, start } = await fsq.readPart(b, file, CHUNK, { from: 'end' });
  const nl = buf.lastIndexOf(NL);
  const head = start > 0 ? buf.indexOf(NL) + 1 : 0;
  if (nl < 0 || head > nl) return { size: st.size, start: start + Math.max(0, nl + 1), end: start + Math.max(0, nl + 1), messages: [], tools: new Map(), orphans: [] };
  const run = parseRun(buf.subarray(head, nl + 1), start + head);
  return { size: st.size, start: start + head, end: start + nl + 1, ...run };
}

const locks = new Map(); // file -> the page request in progress (one at a time per file)
// The `limit` messages before the message `before` (an id the client has, its oldest).
//   { found, before, messages, more }: more = there is more before these.
//   An id not found in the whole file: { missing: true, messages: [] }; one not reached yet after
//   PAGE_READS chunks: { messages: [], more: true } (asked again, the search goes on from there).
async function pageBefore(file, before, limit, b = fsq.budget()) {
  const prev = locks.get(file) || Promise.resolve();
  const mine = prev.catch(() => {}).then(async () => {
    let h = await history(file, b);
    let i = h.messages.findIndex((m) => m.id === before);
    // The first message of a history that does not start the file may be a reply cut in two by
    // the chunk boundary: it is given out only once the chunk before it is read.
    for (let reads = 0; h.start > 0 && reads < PAGE_READS && (i < 0 || i < limit + 1); reads++) {
      const n = h.messages.length;
      h = await backwards(file, h, b);
      i = i < 0 ? h.messages.findIndex((m) => m.id === before) : i + (h.messages.length - n);
    }
    histories.delete(file);
    histories.set(file, h);
    if (histories.size > HISTORY_MAX) histories.delete(histories.keys().next().value);
    const base = { found: true, before };
    if (i < 0) return h.start > 0 ? { ...base, messages: [], more: true } : { ...base, messages: [], more: false, missing: true };
    const from = Math.max(h.start > 0 ? 1 : 0, i - limit);
    if (from >= i) return { ...base, messages: [], more: true };
    return { ...base, messages: strip(h.messages.slice(from, i)), more: from > 0 || h.start > 0 };
  });
  locks.set(file, mine);
  try {
    return await mine;
  } finally {
    if (locks.get(file) === mine) locks.delete(file);
  }
}

// The folder the session works in now: the cwd Claude Code writes on each entry, which follows
// its cd — the pane's folder (herdr's cwd) stays where claude was started. '' when none.
function lastCwd(text) {
  const lines = String(text || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"cwd"')) continue;
    let e;
    try {
      e = JSON.parse(lines[i]);
    } catch {
      continue; // the cut first line of a tail
    }
    if (!e.isSidechain && typeof e.cwd === 'string' && e.cwd) return e.cwd;
  }
  return '';
}

// For the home screen and notifications: the first line of the last reply and the last tool,
// where it works (cwd) and its last reply's model and context (turn, lib/usage.js), from a small tail (256 KB) re-read only when the file changed.
const GLANCE_BYTES = 256 * 1024;
const glances = new Map(); // file -> { rev, value }
async function glance(sessionId, b = fsq.budget()) {
  const file = await locate(sessionId, b);
  if (!file) return null;
  let st;
  try {
    st = await fsq.stat(b, file);
  } catch {
    return null;
  }
  const rev = `${st.size}:${Math.round(st.mtimeMs)}`;
  const hit = glances.get(file);
  if (hit && hit.rev === rev) return hit.value;
  const text = (await readTail(file, GLANCE_BYTES, b)).text;
  const value = { ...Inbox.glance(parse(text)), cwd: lastCwd(text), turn: fromTranscript(text) };
  glances.delete(file);
  glances.set(file, { rev, value });
  if (glances.size > 64) glances.delete(glances.keys().next().value);
  return value;
}

// Claude Code's queue entries (lib/claudequeue.js) in the transcript: the last TAIL_BYTES, or what
// was written from the byte `at` on. -> { ops, end } (end: where the last whole line ends, for the
// next read), or null without a transcript.
async function queueOps(sessionId, { at = null } = {}, b = fsq.budget()) {
  const file = await locate(sessionId, b);
  if (!file) return null;
  const { buf, start } = at == null ? await fsq.readPart(b, file, TAIL_BYTES, { from: 'end' }) : await fsq.readPart(b, file, TAIL_BYTES, { at });
  const whole = buf.lastIndexOf(10) + 1; // a line still being written is read next time
  let text = buf.subarray(0, whole).toString('utf8');
  if (at == null && start > 0) text = text.slice(text.indexOf('\n') + 1);
  return { ops: queueOpsOf(text), end: start + whole };
}

module.exports = { queueOps, read, locate, parse, windowOf, parsed, pageBefore, _setChunk: (n) => ((CHUNK = n), histories.clear()), bashEntry, glance, lastCwd };
