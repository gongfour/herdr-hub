#!/usr/bin/env node
'use strict';
// Claude Code's status line command, for Herdr Hub: Claude Code runs it after each reply (and on
// /compact, a mode change, a rate-limit reset) with the session's JSON on stdin — model, context
// window, and for claude.ai subscribers the plan's rate limits (code.claude.com/docs/en/statusline).
// It keeps the parts the Hub shows in <claude config dir>/herdr-hub/statusline/<session id>.json
// (written whole: tmp + rename) and prints nothing, so Claude Code's screen gets no extra row.
// Set up in ~/.claude/settings.json (README 「모델·컨텍스트·사용량」):
//   "statusLine": { "type": "command", "command": "node \"<hub dir>/lib/statusline.js\"" }
// It never fails the status line: any error ends quietly with nothing written.

const fs = require('fs');
const os = require('os');
const path = require('path');

const KEEP = ['session_id', 'model', 'context_window', 'rate_limits', 'exceeds_200k_tokens', 'version'];

function dir(env = process.env) {
  return path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'herdr-hub', 'statusline');
}

// The JSON Claude Code sent -> what is written, or null (not a session's).
function keep(input, at = Date.now()) {
  if (!input || typeof input !== 'object' || !/^[0-9a-f-]{8,64}$/i.test(String(input.session_id || ''))) return null;
  const out = { at };
  for (const k of KEEP) if (input[k] !== undefined) out[k] = input[k];
  return out;
}

function write(input, env = process.env, at = Date.now()) {
  const data = keep(input, at);
  if (!data) return null;
  const d = dir(env);
  fs.mkdirSync(d, { recursive: true });
  const file = path.join(d, `${data.session_id}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
  return file;
}

if (require.main === module) {
  let text = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => (text += c));
  process.stdin.on('end', () => {
    try {
      write(JSON.parse(text));
    } catch {
      /* the status line stays empty either way */
    }
  });
}

module.exports = { dir, keep, write };
