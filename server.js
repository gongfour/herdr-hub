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
let state = { host: HOSTNAME, herdr: 'connecting', agents: [], workspaces: [], updatedAt: null };
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

async function refresh() {
  try {
    const [agents, workspaces] = await Promise.all([herdr.call('agent.list'), herdr.call('workspace.list')]);
    const labels = new Map(workspaces.workspaces.map((w) => [w.workspace_id, w.label]));
    const list = agents.agents
      .map((a) => shapeAgent(a, labels))
      .sort((x, y) => (STATUS_RANK[x.status] ?? 9) - (STATUS_RANK[y.status] ?? 9) || y.stateSeq - x.stateSeq);
    notifyTransitions(list);
    const next = { host: HOSTNAME, herdr: 'up', agents: list, workspaces: workspaces.workspaces, updatedAt: Date.now() };
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
const TOPOLOGY = ['workspace.created', 'workspace.updated', 'workspace.closed', 'workspace.renamed', 'pane.created', 'pane.closed', 'pane.updated', 'pane.exited', 'pane.agent_detected'];
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
      const allowed = /^(esc|enter|tab|up|down|left|right|backspace|space|[0-9]|y|n|ctrl\+c|shift\+tab)$/;
      if (!Array.isArray(keys) || !keys.length || keys.length > 8 || !keys.every((k) => allowed.test(k))) return send(res, 400, { error: 'bad_keys' });
      await herdr.call('agent.send_keys', { target: pane, keys });
      refreshSoon();
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
