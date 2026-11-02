'use strict';
// Paddock: serves the web app and a small JSON API over the local herdr server.
// Listens on loopback only; `tailscale serve` provides HTTPS and identity.

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const herdr = require('./lib/herdr');
const transcript = require('./lib/transcript');
const { Push } = require('./lib/push');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC = path.join(__dirname, 'public');
const DATA = process.env.PADDOCK_DATA || path.join(__dirname, 'data');
const ALLOWED = (process.env.PADDOCK_ALLOWED_LOGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const ALLOW_LOCAL = process.env.PADDOCK_ALLOW_LOCAL === '1';
const HOSTNAME = process.env.PADDOCK_HOST_LABEL || os.hostname();
const POLL_MS = 4000;

if (!ALLOWED.length && !ALLOW_LOCAL) {
  console.error('Set PADDOCK_ALLOWED_LOGINS (Tailscale logins) or PADDOCK_ALLOW_LOCAL=1.');
  process.exit(2);
}

const push = new Push(DATA, process.env.PADDOCK_VAPID_SUBJECT || 'https://paddock.invalid');

// ---------------------------------------------------------------- live state

const STATUS_RANK = { blocked: 0, done: 1, working: 2, idle: 3, unknown: 4 };
let state = { host: HOSTNAME, herdr: 'connecting', agents: [], terminals: [], workspaces: [], updatedAt: null };
let previous = null; // pane_id -> { status, completion } from the last refresh
const clients = new Set();
let watchedPanes = '';

function shapeAgent(a, labels) {
  return {
    pane: a.pane_id,
    workspace: a.workspace_id,
    workspaceLabel: labels.get(a.workspace_id) || a.workspace_id,
    agent: a.agent,
    name: a.name || null,
    title: a.terminal_title_stripped || a.terminal_title || a.agent,
    status: a.agent_status,
    cwd: a.foreground_cwd || a.cwd || '',
    session: a.agent_session && a.agent_session.kind === 'id' ? a.agent_session.value : null,
    completion: a.completion_seq || 0,
    stateSeq: a.state_change_seq || 0,
    model: a.tokens && a.tokens.model ? a.tokens.model : null,
  };
}

// A plain shell pane: anything pane.list reports that agent.list does not.
function shapeTerminal(p, labels) {
  return {
    pane: p.pane_id,
    workspace: p.workspace_id,
    workspaceLabel: labels.get(p.workspace_id) || p.workspace_id,
    tab: p.tab_id,
    label: p.label || null,
    title: p.terminal_title_stripped || p.terminal_title || '셸',
    cwd: p.foreground_cwd || p.cwd || '',
  };
}

async function refresh() {
  try {
    const [agents, workspaces, panes] = await Promise.all([herdr.call('agent.list'), herdr.call('workspace.list'), herdr.call('pane.list')]);
    const labels = new Map(workspaces.workspaces.map((w) => [w.workspace_id, w.label]));
    const list = agents.agents
      .map((a) => shapeAgent(a, labels))
      .sort((x, y) => (STATUS_RANK[x.status] ?? 9) - (STATUS_RANK[y.status] ?? 9) || y.stateSeq - x.stateSeq);
    const agentPanes = new Set(list.map((a) => a.pane));
    const terminals = panes.panes.filter((p) => !p.agent && !agentPanes.has(p.pane_id)).map((p) => shapeTerminal(p, labels));
    notifyTransitions(list);
    const next = { host: HOSTNAME, herdr: 'up', agents: list, terminals, workspaces: workspaces.workspaces, updatedAt: Date.now() };
    const changed = JSON.stringify({ ...next, updatedAt: 0 }) !== JSON.stringify({ ...state, updatedAt: 0 });
    state = next;
    if (changed) broadcast('state', state);
    watchStatuses(list);
  } catch (err) {
    if (state.herdr !== 'down') {
      state = { ...state, herdr: 'down', error: err.message };
      broadcast('state', state);
    }
  }
}

function notifyTransitions(list) {
  const now = new Map(list.map((a) => [a.pane, a]));
  if (previous) {
    for (const a of list) {
      const before = previous.get(a.pane);
      if (!before) continue;
      const label = a.name || a.title;
      if (a.status === 'blocked' && before.status !== 'blocked') {
        push.send({ title: `${label}: 응답 필요`, body: `${a.agent} · ${a.workspaceLabel}`, url: `/#/agent/${encodeURIComponent(a.pane)}`, tag: a.pane }).catch(() => {});
      } else if (a.completion > before.completion && a.status !== 'working') {
        push.send({ title: `${label}: 완료`, body: `${a.agent} · ${a.workspaceLabel}`, url: `/#/agent/${encodeURIComponent(a.pane)}`, tag: a.pane }).catch(() => {});
      }
    }
  }
  previous = new Map([...now].map(([k, a]) => [k, { status: a.status, completion: a.completion }]));
}

let refreshTimer = null;
const refreshSoon = () => {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 120);
};

// Topology events, plus one agent_status_changed subscription per agent pane
// (herdr requires a pane_id for those). Polling covers anything missed.
const TOPOLOGY = ['workspace.created', 'workspace.updated', 'workspace.closed', 'workspace.renamed', 'tab.created', 'tab.closed', 'pane.created', 'pane.closed', 'pane.updated', 'pane.exited', 'pane.agent_detected'];
const subscriptionsFor = (panes) => [...TOPOLOGY.map((type) => ({ type })), ...panes.map((pane_id) => ({ type: 'pane.agent_status_changed', pane_id }))];

const stream = herdr.subscribe(subscriptionsFor([]), refreshSoon, {
  onState: (s) => s === 'live' && refreshSoon(),
});

function watchStatuses(list) {
  const panes = list.map((a) => a.pane).sort();
  const key = panes.join(',');
  if (key === watchedPanes) return;
  watchedPanes = key;
  stream.restart(subscriptionsFor(panes));
}

setInterval(refresh, POLL_MS);
refresh();

function broadcast(event, data) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(frame);
}

setInterval(() => {
  for (const res of clients) res.write(': ping\n\n');
}, 20000);

// ---------------------------------------------------------------- http

function identity(req) {
  const login = req.headers['tailscale-user-login'];
  if (login) return ALLOWED.includes(login) ? login : null;
  return ALLOW_LOCAL ? 'local' : null;
}

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}

function readJson(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(Object.assign(new Error('invalid JSON'), { status: 400 }));
      }
    });
  });
}

const findAgent = (pane) => state.agents.find((a) => a.pane === pane);
const findTerminal = (pane) => state.terminals.find((t) => t.pane === pane);
const findWorkspace = (id) => state.workspaces.find((w) => w.workspace_id === id);

// ---------------------------------------------------------------- management

// Agent kinds herdr can launch (detect::interactive_agent_executable); the
// executable must still be on the host's PATH.
const KINDS = ['claude', 'codex', 'gemini', 'opencode', 'pi', 'copilot', 'cursor', 'amp', 'qwen'];
const KEYS = /^(esc|enter|tab|up|down|left|right|backspace|space|[0-9]|y|n|ctrl\+c|shift\+tab)$/;
const ARG = /^[A-Za-z0-9_@%+=:,./\\-]{1,200}$/;
const AGENT_NAME = /^[a-z][a-z0-9_-]{0,31}$/; // herdr's rule for agent names
const validKeys = (keys) => Array.isArray(keys) && keys.length > 0 && keys.length <= 8 && keys.every((k) => typeof k === 'string' && KEYS.test(k));
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

// Folders must be absolute and exist on this host; trailing separators are dropped.
function cleanCwd(cwd) {
  if (typeof cwd !== 'string' || !cwd.trim() || cwd.length > 400 || /[\x00-\x1f]/.test(cwd)) throw bad('bad_cwd');
  const raw = cwd.trim();
  // On Windows a rootless "\foo" counts as absolute to node but depends on the current drive.
  if (!path.isAbsolute(raw) || (process.platform === 'win32' && !/^([A-Za-z]:[\\/]|\\\\)/.test(raw))) throw bad('cwd_not_absolute');
  const p = path.resolve(raw);
  let st;
  try {
    st = fs.statSync(p);
  } catch {
    throw bad('cwd_not_found');
  }
  if (!st.isDirectory()) throw bad('cwd_not_directory');
  return p;
}

function cleanAgentSpec(spec) {
  if (!spec || typeof spec !== 'object') throw bad('bad_agent');
  if (!KINDS.includes(spec.kind)) throw bad('bad_kind');
  const args = spec.args == null ? [] : spec.args;
  if (!Array.isArray(args) || args.length > 16 || !args.every((a) => typeof a === 'string' && ARG.test(a))) throw bad('bad_args');
  let name = spec.name || '';
  if (name && (typeof name !== 'string' || !AGENT_NAME.test(name))) throw bad('bad_agent_name');
  // herdr requires a unique name; make one up when none is given.
  if (!name) name = `${spec.kind}-${Date.now().toString(36).slice(-5)}`;
  return { kind: spec.kind, args, name };
}

// Folders seen in existing agents and panes, most common first.
function recentCwds() {
  const counts = new Map();
  for (const x of [...state.agents, ...state.terminals]) {
    if (!x.cwd) continue;
    const p = x.cwd.replace(/[\\/]+$/, '') || x.cwd;
    counts.set(p, (counts.get(p) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([p]) => p).slice(0, 12);
}

// A fresh pane's shell may not be ready yet; agent.start then says busy/unavailable.
async function startAgent(pane, spec) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await herdr.call('agent.start', { name: spec.name, kind: spec.kind, pane_id: pane, args: spec.args, timeout_ms: 30000 }, { timeoutMs: 20000 });
    } catch (err) {
      if (attempt >= 8 || !['agent_pane_busy', 'agent_pane_unavailable'].includes(err.code)) throw err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 404, { error: 'not_found' });
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, { error: 'not_found' });
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // Small files on a private network: always revalidate so a deploy shows up at once.
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  });
}

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1).map(decodeURIComponent); // drop "api"
  const method = req.method;

  // Mutations must carry a custom header: a cross-site form cannot set it.
  if (method !== 'GET' && req.headers['x-paddock'] !== '1') return send(res, 403, { error: 'missing_header' });

  if (method === 'GET' && parts[0] === 'state') return send(res, 200, state);

  if (method === 'GET' && parts[0] === 'stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (method === 'GET' && parts[0] === 'host') return send(res, 200, { kinds: KINDS, recentCwds: recentCwds() });

  if (method === 'POST' && parts[0] === 'workspaces' && !parts[1]) {
    const body = await readJson(req);
    const cwd = cleanCwd(body.cwd);
    const label = cleanLabel(body.label);
    const spec = body.agent ? cleanAgentSpec(body.agent) : null;
    const r = await herdr.call('workspace.create', { cwd, label: label || path.basename(cwd) || cwd, focus: false });
    const pane = r.root_pane.pane_id;
    let agentError = null;
    if (spec) await startAgent(pane, spec).catch((err) => (agentError = err.message));
    await refresh();
    return send(res, 200, { ok: true, workspace: r.workspace.workspace_id, pane, agent: spec && !agentError, agentError });
  }

  if (parts[0] === 'workspaces' && parts[1] && method === 'POST') {
    const ws = findWorkspace(parts[1]);
    if (!ws) return send(res, 404, { error: 'workspace_not_found' });
    const body = await readJson(req);
    if (parts[2] === 'rename') {
      await herdr.call('workspace.rename', { workspace_id: ws.workspace_id, label: cleanLabel(body.label, { required: true }) });
    } else if (parts[2] === 'close') {
      await herdr.call('workspace.close', { workspace_id: ws.workspace_id });
    } else if (parts[2] === 'tabs' || parts[2] === 'agents') {
      // New tab, optionally with an agent started in its root pane.
      const spec = parts[2] === 'agents' ? cleanAgentSpec(body) : null;
      const r = await herdr.call('tab.create', { workspace_id: ws.workspace_id, label: cleanLabel(body.label), focus: false });
      const pane = r.root_pane.pane_id;
      if (spec) await startAgent(pane, spec);
      await refresh();
      return send(res, 200, { ok: true, pane });
    } else return send(res, 404, { error: 'not_found' });
    await refresh();
    return send(res, 200, { ok: true });
  }

  // Plain shell panes. Close works on any pane, agent or not.
  if (parts[0] === 'panes' && parts[1]) {
    const pane = parts[1];
    const term = findTerminal(pane);
    if (!term && !(parts[2] === 'close' && findAgent(pane))) return send(res, 404, { error: 'pane_not_found' });

    if (method === 'GET' && parts[2] === 'screen') {
      const lines = Math.min(Number(url.searchParams.get('lines')) || 120, 400);
      const r = await herdr.call('pane.read', { pane_id: pane, source: 'recent', lines, strip_ansi: true });
      return send(res, 200, { text: r.read.text, truncated: r.read.truncated });
    }
    if (method === 'POST') {
      const body = await readJson(req);
      let result = { ok: true };
      // input: one command line, the text then Enter (empty text just presses Enter).
      // keys: optional text typed first without Enter, so "Get-Ch" + tab completes.
      if (parts[2] === 'input' || parts[2] === 'keys') {
        const { text = '' } = body;
        const keys = parts[2] === 'input' ? ['enter'] : body.keys;
        if (typeof text !== 'string' || text.length > 4000 || /[\x00-\x1f\x7f]/.test(text)) return send(res, 400, { error: 'bad_text' });
        if (!validKeys(keys)) return send(res, 400, { error: 'bad_keys' });
        if (text) await herdr.call('pane.send_text', { pane_id: pane, text });
        await herdr.call('pane.send_keys', { pane_id: pane, keys });
      } else if (parts[2] === 'rename') {
        await herdr.call('pane.rename', { pane_id: pane, label: cleanLabel(body.label) });
      } else if (parts[2] === 'split') {
        const direction = body.direction === 'right' ? 'right' : 'down';
        const r = await herdr.call('pane.split', { target_pane_id: pane, direction, focus: false });
        result = { ok: true, pane: r.pane.pane_id };
      } else if (parts[2] === 'agent') {
        await startAgent(pane, cleanAgentSpec(body));
      } else if (parts[2] === 'close') {
        await herdr.call('pane.close', { pane_id: pane });
      } else return send(res, 404, { error: 'not_found' });
      await refresh();
      return send(res, 200, result);
    }
  }

  if (parts[0] === 'agents' && parts[1]) {
    const pane = parts[1];
    const agent = findAgent(pane);
    if (!agent) return send(res, 404, { error: 'agent_not_found' });

    if (method === 'GET' && parts[2] === 'screen') {
      const lines = Math.min(Number(url.searchParams.get('lines')) || 80, 400);
      const source = url.searchParams.get('source') === 'visible' ? 'visible' : 'recent';
      const r = await herdr.call('agent.read', { target: pane, source, lines, strip_ansi: true });
      return send(res, 200, { text: r.read.text, truncated: r.read.truncated });
    }
    if (method === 'GET' && parts[2] === 'transcript') {
      if (agent.agent !== 'claude' || !agent.session) return send(res, 200, { supported: false, messages: [] });
      const limit = Math.min(Number(url.searchParams.get('limit')) || 120, 500);
      return send(res, 200, { supported: true, ...transcript.read(agent.session, limit) });
    }
    if (method === 'POST' && parts[2] === 'prompt') {
      const { text } = await readJson(req);
      if (typeof text !== 'string' || !text.trim()) return send(res, 400, { error: 'empty_prompt' });
      await herdr.call('agent.prompt', { target: pane, text });
      refreshSoon();
      return send(res, 200, { ok: true });
    }
    if (method === 'POST' && parts[2] === 'keys') {
      const { keys } = await readJson(req);
      if (!validKeys(keys)) return send(res, 400, { error: 'bad_keys' });
      await herdr.call('agent.send_keys', { target: pane, keys });
      refreshSoon();
      return send(res, 200, { ok: true });
    }
    if (method === 'POST' && parts[2] === 'rename') {
      // Empty clears the name; herdr allows only lowercase names.
      const { name } = await readJson(req);
      if (name && (typeof name !== 'string' || !AGENT_NAME.test(name))) return send(res, 400, { error: 'bad_agent_name' });
      await herdr.call('agent.rename', { target: pane, name: name || null });
      await refresh();
      return send(res, 200, { ok: true });
    }
  }

  if (parts[0] === 'push') {
    if (method === 'GET' && parts[1] === 'key') return send(res, 200, { publicKey: push.publicKey });
    if (method === 'POST' && parts[1] === 'subscribe') {
      push.add(await readJson(req));
      return send(res, 200, { ok: true });
    }
    if (method === 'POST' && parts[1] === 'unsubscribe') {
      const { endpoint } = await readJson(req);
      push.remove(endpoint);
      return send(res, 200, { ok: true });
    }
    if (method === 'POST' && parts[1] === 'test') {
      return send(res, 200, await push.send({ title: 'Paddock', body: `${HOSTNAME} 알림 시험`, url: '/' }));
    }
  }

  send(res, 404, { error: 'not_found' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://paddock.local');
  if (!identity(req)) return send(res, 403, { error: 'forbidden' }, { 'Content-Type': 'text/plain; charset=utf-8' });
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else if (req.method === 'GET') serveStatic(req, res, url.pathname);
    else send(res, 405, { error: 'method_not_allowed' });
  } catch (err) {
    const status = err.status || (err instanceof herdr.HerdrError ? 502 : 500);
    if (!res.headersSent) send(res, status, { error: err.code || 'error', message: err.message });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`paddock on http://${HOST}:${PORT} (herdr socket ${herdr.defaultSocketPath()})`);
  console.log(ALLOWED.length ? `allowed tailscale logins: ${ALLOWED.join(', ')}` : 'local access only');
});

process.on('SIGINT', () => {
  stream.stop();
  process.exit(0);
});
