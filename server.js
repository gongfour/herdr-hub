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
const { Peer, parsePeers, ID: HOST_ID_RULE } = require('./lib/peers');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC = path.join(__dirname, 'public');
const DATA = process.env.PADDOCK_DATA || path.join(__dirname, 'data');
const ALLOWED = (process.env.PADDOCK_ALLOWED_LOGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const ALLOW_LOCAL = process.env.PADDOCK_ALLOW_LOCAL === '1';
const HOSTNAME = process.env.PADDOCK_HOST_LABEL || os.hostname();
const HOST_ID = process.env.PADDOCK_HOST_ID || os.hostname().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^[^a-z]+/, '').slice(0, 32) || 'local';
const PUSH_ON = process.env.PADDOCK_PUSH !== '0';
const POLL_MS = 4000;

if (!HOST_ID_RULE.test(HOST_ID) || HOST_ID === 'all') {
  console.error(`PADDOCK_HOST_ID must match ${HOST_ID_RULE} and not be "all".`);
  process.exit(2);
}

if (!ALLOWED.length && !ALLOW_LOCAL) {
  console.error('Set PADDOCK_ALLOWED_LOGINS (Tailscale logins) or PADDOCK_ALLOW_LOCAL=1.');
  process.exit(2);
}

// Only the hub sends notifications (PADDOCK_PUSH=0 on peers), so none arrive twice.
const push = PUSH_ON ? new Push(DATA, process.env.PADDOCK_VAPID_SUBJECT || 'https://paddock.invalid') : null;

// PADDOCK_PEERS makes this Paddock a hub over the listed peers.
const peers = new Map(parsePeers(process.env.PADDOCK_PEERS).map((p) => [p.id, new Peer(p)]));
if (peers.has(HOST_ID)) {
  console.error('PADDOCK_PEERS must not list this host itself.');
  process.exit(2);
}

// ---------------------------------------------------------------- live state

const STATUS_RANK = { blocked: 0, done: 1, working: 2, idle: 3, unknown: 4 };
// local: this host's herdr. state: local merged with every online peer; what clients see.
let local = { herdr: 'connecting', error: null, agents: [], terminals: [], workspaces: [] };
let state = null;
const previous = new Map(); // host id -> Map(pane -> { status, completion }) from that host's last update
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
    // herdr 0.9.3 has no completion_seq; notifyTransitions then watches for working -> done.
    completion: a.completion_seq ?? null,
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
    notifyTransitions(HOST_ID, HOSTNAME, list);
    local = { herdr: 'up', error: null, agents: list, terminals, workspaces: workspaces.workspaces };
    publish();
    watchStatuses(list);
  } catch (err) {
    if (local.herdr !== 'down') {
      local = { ...local, herdr: 'down', error: err.message };
      publish();
    }
  }
}

const tag = (id, label) => (x) => ({ ...x, host: id, hostLabel: label });

// Rebuild the merged state and send it to clients if anything but the timestamp changed.
function publish() {
  const hosts = [{ id: HOST_ID, label: HOSTNAME, local: true, online: true, herdr: local.herdr, error: local.error, since: null }, ...[...peers.values()].map((p) => p.info())];
  const order = new Map(hosts.map((h, i) => [h.id, i]));
  const parts = [{ id: HOST_ID, label: HOSTNAME, s: local }, ...[...peers.values()].filter((p) => p.online && p.state).map((p) => ({ id: p.id, label: p.label, s: p.state }))];
  const all = (key) => parts.flatMap(({ id, label, s }) => (s[key] || []).map(tag(id, label)));
  const agents = all('agents').sort(
    (x, y) => (STATUS_RANK[x.status] ?? 9) - (STATUS_RANK[y.status] ?? 9) || order.get(x.host) - order.get(y.host) || y.stateSeq - x.stateSeq
  );
  const next = {
    host: HOSTNAME, // kept for older clients
    hostId: HOST_ID,
    hostLabel: HOSTNAME,
    herdr: local.herdr,
    error: local.error,
    hosts,
    agents,
    terminals: all('terminals'),
    workspaces: all('workspaces'),
    updatedAt: Date.now(),
  };
  const changed = !state || JSON.stringify({ ...next, updatedAt: 0 }) !== JSON.stringify({ ...state, updatedAt: 0 });
  state = next;
  if (changed) broadcast('state', state);
}

function notify(kind, hostId, hostLabel, a) {
  if (!push) return;
  const label = a.name || a.title;
  const where = peers.size ? `${hostLabel} · ${a.workspaceLabel}` : a.workspaceLabel;
  const payload = {
    title: `${label}: ${kind === 'blocked' ? '응답 필요' : '완료'}`,
    body: `${a.agent} · ${where}`,
    url: `/#/h/${hostId}/agent/${encodeURIComponent(a.pane)}`,
    tag: `${hostId}:${a.pane}`,
  };
  push
    .send(payload)
    .then((r) => console.log(`${new Date().toISOString()} push ${kind} ${hostId} ${a.pane} sent=${r.sent}`))
    .catch((err) => console.error('push error', err.message));
}

// Per host, so a peer that drops offline keeps its last statuses and a transition
// that happened while it slept is still noticed when it comes back.
function notifyTransitions(hostId, hostLabel, list) {
  const before = previous.get(hostId);
  if (before) {
    for (const a of list) {
      const b = before.get(a.pane);
      if (!b) continue;
      if (a.status === 'blocked' && b.status !== 'blocked') notify('blocked', hostId, hostLabel, a);
      else if (a.completion != null && b.completion != null ? a.completion > b.completion && a.status !== 'working' : a.status === 'done' && b.status === 'working')
        notify('done', hostId, hostLabel, a);
    }
  }
  previous.set(hostId, new Map(list.map((a) => [a.pane, { status: a.status, completion: a.completion }])));
}

for (const peer of peers.values()) {
  peer.on('change', () => {
    if (peer.online && peer.state) notifyTransitions(peer.id, peer.label, peer.state.agents);
    publish();
  });
  peer.start();
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

publish();
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

const findAgent = (pane) => local.agents.find((a) => a.pane === pane);
const findTerminal = (pane) => local.terminals.find((t) => t.pane === pane);
const findWorkspace = (id) => local.workspaces.find((w) => w.workspace_id === id);

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
  for (const x of [...local.agents, ...local.terminals]) {
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

  if (parts[0] === 'peers' && parts[1]) return proxy(req, res, url);

  if (method === 'GET' && parts[0] === 'host')
    return send(res, 200, { id: HOST_ID, label: HOSTNAME, platform: process.platform, home: os.homedir(), kinds: KINDS, recentCwds: recentCwds() });

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
    if (!push) return send(res, method === 'GET' ? 200 : 409, { error: 'push_disabled', disabled: true });
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
      const r = await push.send({ title: 'Paddock', body: `${HOSTNAME} 알림 시험`, url: '/' });
      console.log(`${new Date().toISOString()} push test sent=${r.sent}`);
      return send(res, 200, r);
    }
  }

  send(res, 404, { error: 'not_found' });
}

// /api/peers/<host>/<rest> -> <peer>/api/<rest>. Only per-host endpoints; the stream,
// state and push stay with the hub. The X-Paddock check has already run above.
const PROXIED = new Set(['host', 'agents', 'panes', 'workspaces']);

async function proxy(req, res, url) {
  const raw = url.pathname.split('/').filter(Boolean); // api, peers, <host>, ...rest (still encoded)
  const peer = peers.get(decodeURIComponent(raw[2]));
  if (!peer) return send(res, 404, { error: 'unknown_host' });
  if (!PROXIED.has(raw[3])) return send(res, 404, { error: 'not_found' });
  if (!peer.online) return send(res, 503, { error: 'peer_offline', message: `${peer.label} 오프라인` });
  const body = req.method === 'GET' ? null : await readRaw(req);
  const headers = req.method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Paddock': '1' };
  let r;
  try {
    r = await peer.request(req.method, `/api/${raw.slice(3).join('/')}${url.search}`, { body, headers, timeoutMs: req.method === 'GET' ? 15000 : 60000 });
  } catch (err) {
    const timeout = Boolean(err.timeout);
    console.error(`${new Date().toISOString()} proxy ${req.method} ${peer.id} ${raw.slice(3).join('/')}: ${err.code || err.message}`);
    return send(res, timeout ? 504 : 502, { error: timeout ? 'peer_timeout' : 'peer_unreachable', message: `${peer.label}: ${err.code || err.message}` });
  }
  send(res, r.status, r.body, { 'Content-Type': r.type });
}

function readRaw(req, limit = 256 * 1024) {
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
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
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
  console.log(`host ${HOST_ID} (${HOSTNAME}); push ${push ? 'on' : 'off'}; peers: ${[...peers.values()].map((p) => `${p.id}=${p.url}`).join(', ') || 'none'}`);
});

for (const sig of ['SIGINT', 'SIGTERM'])
  process.on(sig, () => {
    stream.stop();
    for (const p of peers.values()) p.stop();
    process.exit(0);
  });
