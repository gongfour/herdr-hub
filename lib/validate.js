'use strict';
// What the API accepts from the page: key names, typed text, labels, folders, agent specs.
// Each check throws a 400 error whose code the page turns into Korean (ERROR_TEXT in core.js).

const fsq = require('./fsq');
const path = require('path');
const names = require('./names');

// Agent kinds herdr can launch (detect::interactive_agent_executable); the
// executable must still be on the host's PATH.
const KINDS = ['claude', 'codex', 'gemini', 'opencode', 'pi', 'copilot', 'cursor', 'amp', 'qwen'];
const KEYS = /^(esc|enter|tab|up|down|left|right|backspace|space|[0-9]|y|n|ctrl\+c|shift\+tab)$/;
const ARG = /^[A-Za-z0-9_@%+=:,./\\-]{1,200}$/;
const AGENT_NAME = /^[a-z][a-z0-9_-]{0,31}$/; // herdr's rule for agent names
// A shell pane also takes what full-screen programs (helix, vim, less) need: page and edit
// keys, F-keys, Ctrl/Alt chords and the word keys (Ctrl/Alt + ←/→, Alt + .).
const PANE_KEYS = /^(esc|enter|tab|up|down|left|right|backspace|delete|space|home|end|pageup|pagedown|insert|shift\+tab|f([1-9]|1[0-2])|(ctrl|alt)\+([a-z]|left|right)|alt\+\.|[0-9]|y|n)$/;

const validKeys = (keys, rule = KEYS) => Array.isArray(keys) && keys.length > 0 && keys.length <= 8 && keys.every((k) => typeof k === 'string' && rule.test(k));
// Text typed into a pane: one line, no control characters, 4000 characters at most.
const badText = (text) => typeof text !== 'string' || text.length > 4000 || /[\x00-\x1f\x7f]/.test(text);
const bad = (code) => Object.assign(new Error(code), { status: 400, code });

function cleanLabel(label, { required = false } = {}) {
  if (label == null || label === '') {
    if (required) throw bad('empty_label');
    return null;
  }
  if (typeof label !== 'string' || /[\x00-\x1f\x7f]/.test(label) || label.trim().length > 60) throw bad('bad_label');
  const t = label.trim();
  if (!t && required) throw bad('empty_label');
  return t || null;
}

// Folders must be absolute and exist on this host; trailing separators are dropped. The stat is
// asynchronous and bounded (lib/fsq.js): a folder that does not answer is cwd_unavailable.
async function cleanCwd(cwd, platform = process.platform) {
  if (typeof cwd !== 'string' || !cwd.trim() || cwd.length > 400 || /[\x00-\x1f]/.test(cwd)) throw bad('bad_cwd');
  const raw = cwd.trim();
  // On Windows a rootless "\foo" counts as absolute to node but depends on the current drive.
  if (!path.isAbsolute(raw) || (platform === 'win32' && !/^([A-Za-z]:[\\/]|\\\\)/.test(raw))) throw bad('cwd_not_absolute');
  const p = path.resolve(raw);
  let st;
  try {
    st = await fsq.stat(fsq.budget(3000), p);
  } catch (err) {
    if (err.gaveUp) throw bad('cwd_unavailable', 503);
    throw bad('cwd_not_found');
  }
  if (!st.isDirectory()) throw bad('cwd_not_directory');
  return p;
}

// nameFrom: what to name an agent that comes without a name (workspace label, folder).
// taken: the agent names already on this host.
function cleanAgentSpec(spec, nameFrom = [], taken = []) {
  if (!spec || typeof spec !== 'object') throw bad('bad_agent');
  if (!KINDS.includes(spec.kind)) throw bad('bad_kind');
  const args = spec.args == null ? [] : spec.args;
  if (!Array.isArray(args) || args.length > 16 || !args.every((a) => typeof a === 'string' && ARG.test(a))) throw bad('bad_args');
  let name = spec.name || '';
  if (name && (typeof name !== 'string' || !AGENT_NAME.test(name))) throw bad('bad_agent_name');
  // herdr requires a unique name: none given, the folder or workspace name, made unique.
  if (!name) name = names.defaultName(nameFrom, spec.kind, taken);
  return { kind: spec.kind, args, name };
}

module.exports = { KINDS, KEYS, PANE_KEYS, AGENT_NAME, validKeys, badText, bad, cleanLabel, cleanCwd, cleanAgentSpec };
