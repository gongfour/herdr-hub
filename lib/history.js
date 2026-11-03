'use strict';
// A shell pane's command history, for the shell view's grey suggestion (the way fish or
// zsh-autosuggestions offer the latest matching command). The shell running in the pane picks
// the history file; each format is read into one command per entry, newest first, without
// repeats. Multi-line entries are left out: the command line is one line.
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_ITEMS = 2000;
const MAX_LEN = 300;
const SHELLS = new Set(['nu', 'pwsh', 'powershell', 'zsh', 'bash', 'fish']);

// "-nu", "/bin/zsh", "pwsh.exe" -> "nu", "zsh", "pwsh"; null for anything not a known shell.
function shellName(name) {
  const s = path.basename(String(name || '').replace(/\\/g, '/')).replace(/^-/, '').replace(/\.exe$/i, '').toLowerCase();
  return SHELLS.has(s) ? s : null;
}

// Where each shell keeps its history, most likely first.
function files(shell, { home = os.homedir(), env = process.env, platform = process.platform } = {}) {
  const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const config = env.XDG_CONFIG_HOME || path.join(home, '.config');
  switch (shell) {
    case 'nu':
      return [platform === 'darwin' && path.join(home, 'Library', 'Application Support', 'nushell', 'history.txt'), path.join(config, 'nushell', 'history.txt'), path.join(appData, 'nushell', 'history.txt')].filter(Boolean);
    case 'pwsh':
    case 'powershell':
      return [path.join(appData, 'Microsoft', 'Windows', 'PowerShell', 'PSReadLine', 'ConsoleHost_history.txt'), path.join(home, '.local', 'share', 'powershell', 'PSReadLine', 'ConsoleHost_history.txt')];
    case 'zsh':
      return [path.join(home, '.zsh_history')];
    case 'bash':
      return [path.join(home, '.bash_history')];
    case 'fish':
      return [path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'fish', 'fish_history')];
  }
  return [];
}

// File text -> commands, oldest first, as the shell wrote them (multi-line ones as null).
function entries(shell, text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  if (shell === 'nu') for (const l of lines) out.push(l.includes('<\\n>') ? null : l);
  else if (shell === 'fish') {
    for (const l of lines) {
      const m = l.match(/^- cmd: (.*)$/);
      if (m) out.push(/\\n/.test(m[1]) ? null : m[1].replace(/\\\\/g, '\\'));
    }
  } else {
    // pwsh ends a continued line with a backtick, zsh and bash with a backslash.
    const cont = shell === 'pwsh' || shell === 'powershell' ? /`$/ : /\\$/;
    let multi = false;
    for (let l of lines) {
      if (shell === 'bash' && /^#\d+$/.test(l)) continue; // HISTTIMEFORMAT stamps
      if (shell === 'zsh') l = l.replace(/^: \d+:\d+;/, '');
      const more = cont.test(l);
      if (!multi && !more) out.push(l);
      else if (multi && !more) out.push(null);
      multi = more;
    }
  }
  return out;
}

// What herdr itself types into a PowerShell pane to start an agent (agent.start), not the user.
const HERDR_LAUNCH = /^if\(\(Get-Command \S+ -ErrorAction SilentlyContinue\)\.CommandType -eq 'ExternalScript'\)/;

// Commands newest first, each once, without blank, multi-line or overlong ones.
function newestFirst(list) {
  const seen = new Set();
  const out = [];
  for (let i = list.length - 1; i >= 0 && out.length < MAX_ITEMS; i--) {
    const c = list[i];
    if (c == null) continue;
    const t = c.trim();
    if (!t || t.length > MAX_LEN || seen.has(t) || HERDR_LAUNCH.test(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

const cache = new Map(); // file -> { mtimeMs, size, items }

// The history of shell on this host: { shell, file, items } (items empty when none is found).
function read(shell, opts) {
  for (const file of files(shell, opts)) {
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      continue;
    }
    const c = cache.get(file);
    if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) return { shell, file, items: c.items };
    const items = newestFirst(entries(shell, fs.readFileSync(file, 'utf8')));
    cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, items });
    return { shell, file, items };
  }
  return { shell, file: null, items: [] };
}

module.exports = { shellName, files, entries, newestFirst, read };
