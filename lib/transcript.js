'use strict';
// Claude Code transcripts: ~/.claude/projects/<cwd slug>/<session id>.jsonl.
// Only the tail is read; a long session's file runs to many megabytes.

const fs = require('fs');
const os = require('os');
const path = require('path');

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

function readTail(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const { size } = fs.fstatSync(fd);
    const start = Math.max(0, size - TAIL_BYTES);
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

function toolSummary(block) {
  const input = block.input || {};
  const pick = input.command || input.description || input.file_path || input.pattern || input.url || input.query || input.prompt || '';
  const one = String(pick).replace(/\s+/g, ' ').trim();
  return one.length > 140 ? one.slice(0, 137) + '…' : one;
}

function parse(text) {
  const messages = [];
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
      if ((!typed && !images) || NOT_TYPED.test(typed)) continue;
      const cleaned = cleanUserText(typed);
      if (!cleaned && !images) continue;
      current = null;
      if (/^\[Request interrupted by user[^\]]*\]$/.test(cleaned)) messages.push({ role: 'note', text: '중단됨', ts: e.timestamp });
      else {
        const msg = { role: 'user', text: cleaned, ts: e.timestamp, ...(images ? { images } : {}) };
        messages.push(msg);
        lastUser = { msg, promptId: e.promptId || null };
      }
    } else if (e.type === 'assistant' && Array.isArray(content)) {
      const mid = e.message.id || e.uuid;
      if (!current || current.mid !== mid) {
        current = { role: 'assistant', mid, text: '', tools: [], ts: e.timestamp };
        messages.push(current);
      }
      for (const b of content) {
        if (b.type === 'text' && b.text.trim()) current.text += (current.text ? '\n\n' : '') + b.text.trim();
        else if (b.type === 'tool_use') current.tools.push({ name: b.name, summary: toolSummary(b) });
      }
    }
  }
  return messages
    .filter((m) => m.role !== 'assistant' || m.text || m.tools.length)
    .map(({ mid, ...m }) => m);
}

function read(sessionId, limit = 120) {
  const file = locate(sessionId);
  if (!file) return { found: false, messages: [] };
  const { text, truncated, size } = readTail(file);
  const all = parse(text);
  return { found: true, truncated: truncated || all.length > limit, size, messages: all.slice(-limit) };
}

module.exports = { read, locate, parse };
