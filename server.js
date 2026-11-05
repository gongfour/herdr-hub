'use strict';
// Herdr Hub: serves the web app and a small JSON API over the local herdr server.
// Listens on loopback only; `tailscale serve` provides HTTPS and identity.

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const herdr = require('./lib/herdr');
const transcript = require('./lib/transcript');
const dirs = require('./lib/dirs');
const uploads = require('./lib/uploads');
const commands = require('./lib/commands');
const times = require('./lib/times');
const notifyLib = require('./lib/notify');
const { parseChoices, choicesSettled } = require('./public/choices');
const { Push } = require('./lib/push');
const { Peer, ID: HOST_ID_RULE } = require('./lib/peers');
const hoststore = require('./lib/hoststore');
const { indexPage, send, readJson, readRaw, serveStatic, takesGzip, parseHosts, hostAllowed, corsOrigin } = require('./lib/http');
const { KINDS, PANE_KEYS, AGENT_NAME, validKeys, badText, cleanLabel, cleanCwd, cleanAgentSpec: cleanSpec } = require('./lib/validate');
const { screenReader } = require('./lib/screen');
const { readBuild, describe, decorator } = require('./lib/build');

// The contract between this server and its pages, and between a hub and its peers. Bumped by
// hand when either changes (AGENTS.md); 설정 → 연결 shows a peer whose number differs from the hub's.
const API_VERSION = 1;

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC = path.join(__dirname, 'public');
const DATA = process.env.HERDR_HUB_DATA || path.join(__dirname, 'data');
const ALLOWED = (process.env.HERDR_HUB_ALLOWED_LOGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const ALLOW_LOCAL = process.env.HERDR_HUB_ALLOW_LOCAL === '1';
const HOSTNAME = process.env.HERDR_HUB_HOST_LABEL || os.hostname();
const HOST_ID = process.env.HERDR_HUB_HOST_ID || os.hostname().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^[^a-z]+/, '').slice(0, 32) || 'local';
const PUSH_ON = process.env.HERDR_HUB_PUSH !== '0';
// Folder or workspace name prefixes whose agents never notify (throwaway test workspaces).
const PUSH_MUTE = notifyLib.parseMute(process.env.HERDR_HUB_PUSH_MUTE);
const POLL_MS = 4000;
// The names this Herdr Hub answers to, as the Host header carries them (tailscale serve passes
// the browser's through: "desktop.example.ts.net", "server.example.ts.net:8443"). Unset: any
// *.ts.net name. Loopback only with HERDR_HUB_ALLOW_LOCAL. Anything else is a page whose own
// domain was pointed at 127.0.0.1 (DNS rebinding) and gets 403.
const HOSTS = parseHosts(process.env.HERDR_HUB_HOSTS);
const HOST_RULE = {
  allowed: [...HOSTS, ...(ALLOW_LOCAL ? [`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`] : [])],
  suffixes: HOSTS.length ? [] : ['.ts.net'],
};
// Pages of the other hosts that may read /api/version (CORS): https on this tailnet (the domain
// after the first name of HERDR_HUB_HOSTS, else any .ts.net), and loopback with ALLOW_LOCAL.
const CORS_RULE = {
  suffixes: HOSTS.length ? [...new Set(HOSTS.map((h) => h.replace(/:\d+$/, '').replace(/^[^.]+/, '')).filter((d) => d.includes('.')))] : ['.ts.net'],
  local: ALLOW_LOCAL,
};

if (!HOST_ID_RULE.test(HOST_ID) || HOST_ID === 'all') {
  console.error(`HERDR_HUB_HOST_ID must match ${HOST_ID_RULE} and not be "all".`);
  process.exit(2);
}

if (!ALLOWED.length && !ALLOW_LOCAL) {
  console.error('Set HERDR_HUB_ALLOWED_LOGINS (Tailscale logins) or HERDR_HUB_ALLOW_LOCAL=1.');
  process.exit(2);
}

// Only the hub sends notifications (HERDR_HUB_PUSH=0 on peers), so none arrive twice.
const push = PUSH_ON ? new Push(DATA, process.env.HERDR_HUB_VAPID_SUBJECT || 'https://herdr-hub.invalid') : null;

// The peers this Herdr Hub merges into its view: data/peers.json, edited in 설정 → 연결
// (lib/hoststore.js). HERDR_HUB_PEERS seeds the file the first time; then the file wins. A host
// with neither is a peer: its 연결 block is read-only.
const PEERS_FILE = path.join(DATA, 'peers.json');
// This hub's own addresses, which can't be added as a peer.
const SELF = {
  id: HOST_ID,
  urls: [...HOSTS.map((h) => `https://${h}`), ...(ALLOW_LOCAL ? [`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`] : [])].map((u) => {
    try {
      return hoststore.cleanUrl(u);
    } catch {
      return null;
    }
  }).filter(Boolean),
};
let peerStore;
try {
  peerStore = hoststore.load(PEERS_FILE, process.env.HERDR_HUB_PEERS, SELF, (m) => console.error(m));
} catch (err) {
  console.error(err.message);
  process.exit(2);
}
let peerList = peerStore.list;
const peers = new Map();

// The build this host runs (lib/build.js), written into the page it serves; the page compares it
// with what /api/version and the stream say to know a new build is out.
const BUILD = readBuild(__dirname);
const SITE = { decorate: decorator(BUILD, API_VERSION) };
function buildNow() {
  const page = indexPage(PUBLIC, SITE);
  return describe(BUILD, API_VERSION, page ? page.assets : '');
}

// Pane reads with herdr's fallbacks (lib/screen).
const readScreen = screenReader(herdr.call);

// ---------------------------------------------------------------- live state

const STATUS_RANK = { blocked: 0, done: 1, working: 2, idle: 3, unknown: 4 };
// local: this host's herdr. state: local merged with every online peer; what clients see.
let local = { herdr: 'connecting', error: null, agents: [], terminals: [], workspaces: [] };
let state = null;
const previous = new Map(); // host id -> Map(pane -> { status, completion }) from that host's last update
const clients = new Set();
let watchedPanes = '';
// workingSince / doneAt per agent (lib/times): this host's own, and every host's as merged.
const TIMES_FILE = path.join(DATA, 'times.json');
let { local: localTimes, merged: mergedTimes } = times.load(readJsonFile(TIMES_FILE), ['local', 'merged'], Date.now(), 6 * 3600e3);
let timesSaved = { body: '', at: 0 };
function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
// Written when a time changed (and hourly, so savedAt stays fresh), not on every refresh.
function saveTimes() {
  const body = JSON.stringify(times.dump({ local: localTimes, merged: mergedTimes }, 0).maps);
  if (body === timesSaved.body && Date.now() - timesSaved.at < 3600e3) return;
  timesSaved = { body, at: Date.now() };
  try {
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(TIMES_FILE + '.tmp', JSON.stringify(times.dump({ local: localTimes, merged: mergedTimes }, Date.now())));
    fs.renameSync(TIMES_FILE + '.tmp', TIMES_FILE);
  } catch (err) {
    console.error('times save failed:', err.message);
  }
}

// title: the pane's own name when one was given (herdr pane rename — what an agent calls its pane,
// the same name the shell rows show), else the title the agent writes into its terminal.
function shapeAgent(a, labels, paneLabels = new Map()) {
  const label = paneLabels.get(a.pane_id) || null;
  return {
    pane: a.pane_id,
    workspace: a.workspace_id,
    workspaceLabel: labels.get(a.workspace_id) || a.workspace_id,
    agent: a.agent,
    name: a.name || null,
    title: label || a.terminal_title_stripped || a.terminal_title || a.agent,
    label,
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
    const paneLabels = new Map(panes.panes.filter((p) => p.label).map((p) => [p.pane_id, p.label]));
    const list = agents.agents
      .map((a) => shapeAgent(a, labels, paneLabels))
      .sort((x, y) => (STATUS_RANK[x.status] ?? 9) - (STATUS_RANK[y.status] ?? 9) || y.stateSeq - x.stateSeq);
    const agentPanes = new Set(list.map((a) => a.pane));
    const terminals = panes.panes.filter((p) => !p.agent && !agentPanes.has(p.pane_id)).map((p) => shapeTerminal(p, labels));
    localTimes = times.track(localTimes, list, Date.now(), (a) => a.pane);
    for (const a of list) addGlance(a);
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

// The home screen's one-liners, from a small cached transcript tail: what a working agent ran
// last (lastTool) and the first line of a finished one's last reply (lastReply).
function addGlance(a) {
  const finished = a.status === 'done' || (a.status === 'idle' && a.doneAt);
  if (a.agent !== 'claude' || !a.session || !(finished || a.status === 'working')) return;
  let g = null;
  try {
    g = transcript.glance(a.session);
  } catch {
    /* an unreadable transcript only means no summary */
  }
  if (!g) return;
  if (a.status === 'working' && g.lastTool) a.lastTool = g.lastTool;
  if (finished && g.lastReply) a.lastReply = g.lastReply;
}

const tag = (id, label) => (x) => ({ ...x, host: id, hostLabel: label });

// Rebuild the merged state and send it to clients if anything but the timestamp changed.
function publish() {
  const hosts = [{ id: HOST_ID, label: HOSTNAME, local: true, online: true, herdr: local.herdr, error: local.error, since: null, api: API_VERSION, version: BUILD.version + (BUILD.dirty ? '+dirty' : '') }, ...[...peers.values()].map((p) => p.info())];
  const order = new Map(hosts.map((h, i) => [h.id, i]));
  const parts = [{ id: HOST_ID, label: HOSTNAME, s: local }, ...[...peers.values()].filter((p) => p.online && p.state).map((p) => ({ id: p.id, label: p.shown(), s: p.state }))];
  const all = (key) => parts.flatMap(({ id, label, s }) => (s[key] || []).map(tag(id, label)));
  const agents = all('agents').sort(
    (x, y) => (STATUS_RANK[x.status] ?? 9) - (STATUS_RANK[y.status] ?? 9) || order.get(x.host) - order.get(y.host) || y.stateSeq - x.stateSeq
  );
  // Peers on this version bring their own times; for an older peer the hub tracks them here.
  mergedTimes = times.track(mergedTimes, agents, Date.now(), (a) => `${a.host}|${a.pane}`);
  saveTimes();
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

// The question on a blocked agent's screen: read here for this host, from the peer otherwise.
async function blockedChoices(hostId, pane) {
  let text = '';
  if (hostId === HOST_ID) text = (await readScreen('agent.read', { target: pane }, 'visible', 30)).text;
  else {
    const peer = peers.get(hostId);
    if (!peer || !peer.online) return null;
    const r = await peer.request('GET', `/api/agents/${encodeURIComponent(pane)}/screen?source=visible&lines=30`, { timeoutMs: 5000 });
    if (r.status !== 200) return null;
    text = JSON.parse(r.body.toString('utf8')).text;
  }
  return parseChoices(String(text || '').replace(/\s+$/, ''));
}

async function notify(kind, hostId, hostLabel, a) {
  if (!push) return;
  if (notifyLib.muted(a, PUSH_MUTE)) return console.log(`${new Date().toISOString()} push ${kind} ${hostId} ${a.pane} muted`);
  let choices = null;
  if (kind === 'blocked') {
    // The prompt is drawn a moment after the status changes; a half-drawn read is repeated.
    for (let i = 0; i < 4 && !choicesSettled(choices); i++) {
      await new Promise((r) => setTimeout(r, i ? 1000 : 400));
      choices = (await blockedChoices(hostId, a.pane).catch(() => null)) || choices;
    }
  }
  const payload = notifyLib.buildPayload(kind, { id: hostId, label: hostLabel, multi: peers.size > 0 }, a, { choices, lastReply: a.lastReply || '' });
  const r = await push.send(payload);
  console.log(`${new Date().toISOString()} push ${kind} ${hostId} ${a.pane} sent=${r.sent}${payload.actions ? ` actions=${payload.actions.length}` : ''}`);
}

// Per host, so a peer that drops offline keeps its last statuses and a transition
// that happened while it slept is still noticed when it comes back.
function notifyTransitions(hostId, hostLabel, list) {
  const before = previous.get(hostId);
  if (before) {
    for (const a of list) {
      const kind = notifyLib.transitionKind(before.get(a.pane), a);
      if (kind) notify(kind, hostId, hostLabel, a).catch((err) => console.error('push error', err.message));
    }
  }
  previous.set(hostId, new Map(list.map((a) => [a.pane, { status: a.status, completion: a.completion }])));
}

// A peer joins: followed from now on. Leaves: its stream is closed and its items drop out.
function startPeer(p) {
  const peer = new Peer(p);
  peer.on('change', () => {
    if (peers.get(peer.id) !== peer) return; // removed or replaced meanwhile
    if (peer.online && peer.state) notifyTransitions(peer.id, peer.shown(), peer.state.agents);
    publish();
  });
  peers.set(peer.id, peer);
  peer.start();
  return peer;
}
function stopPeer(id) {
  const peer = peers.get(id);
  if (!peer) return;
  peers.delete(id);
  peer.stop();
  previous.delete(id);
}
for (const p of peerList) startPeer(p);

// 설정 → 연결 changes the list: saved first, then the connections follow, without a restart.
function setPeerList(next) {
  hoststore.save(PEERS_FILE, next);
  const before = new Map(peerList.map((p) => [p.id, p]));
  peerList = next;
  for (const [id, old] of before) {
    const now = next.find((p) => p.id === id);
    if (!now || now.url !== old.url) stopPeer(id);
  }
  for (const p of next) {
    const peer = peers.get(p.id);
    if (!peer) startPeer(p);
    else peer.name = p.label || '';
  }
  // The list's order, which the views follow (a changed address would otherwise go last).
  const order = next.map((p) => [p.id, peers.get(p.id)]);
  peers.clear();
  for (const [id, peer] of order) peers.set(id, peer);
  console.log(`${new Date().toISOString()} peers: ${next.map((p) => `${p.id}=${p.url}`).join(', ') || 'none'}`);
  publish();
}
const peerView = () => ({ manageable: peerStore.manageable, self: { id: HOST_ID, label: HOSTNAME }, max: hoststore.MAX_PEERS, peers: peerList.map((p) => ({ id: p.id, url: p.url, label: p.label || '' })) });

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

// A named event, not an SSE comment: the page can see it and tell a live stream from one that
// iOS left looking open after suspending the app.
setInterval(() => {
  for (const res of clients) res.write(`event: ping\ndata: ${Date.now()}\n\n`);
}, 15000);

// ---------------------------------------------------------------- http

function identity(req) {
  const login = req.headers['tailscale-user-login'];
  if (login) return ALLOWED.includes(login) ? login : null;
  return ALLOW_LOCAL ? 'local' : null;
}

const findAgent = (pane) => local.agents.find((a) => a.pane === pane);
const findTerminal = (pane) => local.terminals.find((t) => t.pane === pane);
const findWorkspace = (id) => local.workspaces.find((w) => w.workspace_id === id);
// An agent spec from the page, named after nameFrom when it comes without a name (lib/validate).
const cleanAgentSpec = (spec, nameFrom) => cleanSpec(spec, nameFrom, local.agents.map((a) => a.name).filter(Boolean));

// ---------------------------------------------------------------- management

// Keys herdr has no name for (0.9: "unsupported key"): their xterm sequences, typed as text.
const SEQ_KEYS = { pageup: '\x1b[5~', pagedown: '\x1b[6~', home: '\x1b[H', end: '\x1b[F', delete: '\x1b[3~', insert: '\x1b[2~' };
async function sendPaneKeys(pane, keys) {
  let run = [];
  const flush = async () => {
    if (run.length) await herdr.call('pane.send_keys', { pane_id: pane, keys: run });
    run = [];
  };
  for (const k of keys) {
    if (SEQ_KEYS[k]) {
      await flush();
      await herdr.call('pane.send_text', { pane_id: pane, text: SEQ_KEYS[k] });
    } else run.push(k);
  }
  await flush();
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

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1).map(decodeURIComponent); // drop "api"
  const method = req.method;

  // Mutations must carry a custom header: a cross-site form cannot set it.
  if (method !== 'GET' && req.headers['x-herdr-hub'] !== '1') return send(res, 403, { error: 'missing_header' });

  if (method === 'GET' && parts[0] === 'state') return send(res, 200, state);
  // The build this host serves: an installed app resumed from memory compares it with the one
  // it was served with and loads the new one (public/update.js).
  // Readable from the other hosts' pages too (CORS, this one path only): a page whose hub is down
  // asks the peers it remembers whether they answer (public/fallback.js). Build info only.
  if (method === 'GET' && parts[0] === 'version' && !parts[1]) {
    const origin = corsOrigin(req.headers.origin, CORS_RULE);
    return send(res, 200, buildNow(), origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {});
  }

  if (method === 'GET' && parts[0] === 'stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`event: version\ndata: ${JSON.stringify(buildNow())}\n\n`);
    res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (parts[0] === 'peers' && parts[1]) return proxy(req, res, url);

  // 설정 → 연결: the peer list (lib/hoststore.js). Changed only on a hub (manageable), by its own
  // page: the Host, login and X-Herdr-Hub checks have run; /api/peers/<id>/… never reaches here.
  if (parts[0] === 'hosts') return hostsApi(req, res, parts);

  if (method === 'GET' && parts[0] === 'host')
    return send(res, 200, { id: HOST_ID, label: HOSTNAME, herdr: local.herdr, api: API_VERSION, build: { version: BUILD.version, commit: BUILD.commit, time: BUILD.time, dirty: BUILD.dirty }, platform: process.platform, home: os.homedir(), kinds: KINDS, recentCwds: recentCwds(), places: dirs.places() });

  // Folder browser: subfolders of ?path= (home when empty), or the drive letters on Windows.
  if (method === 'GET' && parts[0] === 'dirs' && !parts[1]) {
    const p = url.searchParams.get('path') || '';
    if (url.searchParams.get('drives') === '1' || p === dirs.DRIVES) return send(res, 200, await dirs.drives());
    return send(res, 200, await dirs.list(p ? cleanCwd(p) : os.homedir()));
  }

  if (method === 'POST' && parts[0] === 'dirs' && !parts[1]) {
    const body = await readJson(req);
    const parent = cleanCwd(body.parent);
    return send(res, 200, { ok: true, path: dirs.create(parent, body.name) });
  }

  if (method === 'POST' && parts[0] === 'workspaces' && !parts[1]) {
    const body = await readJson(req);
    const cwd = cleanCwd(body.cwd);
    const label = cleanLabel(body.label);
    const spec = body.agent ? cleanAgentSpec(body.agent, [label, path.basename(cwd)]) : null;
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
      const spec = parts[2] === 'agents' ? cleanAgentSpec(body, [ws.label]) : null;
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
      return send(res, 200, await readScreen('pane.read', { pane_id: pane }, url.searchParams.get('source'), lines, url.searchParams.get('format')));
    }
    if (method === 'POST') {
      const body = await readJson(req);
      let result = { ok: true };
      // input: one command line, the text then Enter (empty text just presses Enter).
      // keys: optional text typed first without Enter, so "Get-Ch" + tab completes.
      if (parts[2] === 'input' || parts[2] === 'keys') {
        const { text = '' } = body;
        const keys = parts[2] === 'input' ? ['enter'] : body.keys;
        if (badText(text)) return send(res, 400, { error: 'bad_text' });
        // keys may be empty when there is text: raw mode typing one character at a time.
        const textOnly = parts[2] === 'keys' && text && Array.isArray(keys) && keys.length === 0;
        if (!textOnly && !validKeys(keys, PANE_KEYS)) return send(res, 400, { error: 'bad_keys' });
        if (text) await herdr.call('pane.send_text', { pane_id: pane, text });
        if (!textOnly) await sendPaneKeys(pane, keys);
        // 키 직접 입력 asks for the screen back ({ echo: { format } }): the echo arrives with the
        // reply instead of a second request (two hops when the pane is on a peer). Typing
        // changes no pane state, so the refresh below is skipped. lines: as many as the
        // page reads (200 for a page from before it said, 400 at most).
        if (parts[2] === 'keys' && body.echo && typeof body.echo === 'object') {
          await new Promise((r) => setTimeout(r, 40));
          const lines = Math.min(Math.floor(Number(body.echo.lines)) || 200, 400);
          const screen = await readScreen('pane.read', { pane_id: pane }, 'recent_unwrapped', lines, body.echo.format);
          return send(res, 200, { ok: true, screen });
        }
      } else if (parts[2] === 'rename') {
        await herdr.call('pane.rename', { pane_id: pane, label: cleanLabel(body.label) });
      } else if (parts[2] === 'split') {
        const direction = body.direction === 'right' ? 'right' : 'down';
        const r = await herdr.call('pane.split', { target_pane_id: pane, direction, focus: false });
        result = { ok: true, pane: r.pane.pane_id };
      } else if (parts[2] === 'agent') {
        await startAgent(pane, cleanAgentSpec(body, [term.workspaceLabel, path.basename(term.cwd || '')]));
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
      return send(res, 200, await readScreen('agent.read', { target: pane }, url.searchParams.get('source'), lines, url.searchParams.get('format')));
    }
    // What the composer offers after "/" and "@": Claude agents only, read on this host.
    if (method === 'GET' && (parts[2] === 'commands' || parts[2] === 'files') && !parts[3]) {
      if (agent.agent !== 'claude' || !agent.cwd) return send(res, 200, { supported: false, commands: [], files: [] });
      if (parts[2] === 'commands') return send(res, 200, { supported: true, cwd: agent.cwd, commands: commands.list(agent.cwd) });
      const q = (url.searchParams.get('q') || '').slice(0, 300);
      return send(res, 200, { supported: true, ...(await commands.files(agent.cwd, q)) });
    }
    if (method === 'GET' && parts[2] === 'transcript') {
      if (agent.agent !== 'claude' || !agent.session) return send(res, 200, { supported: false, messages: [] });
      const limit = Math.min(Number(url.searchParams.get('limit')) || 120, 500);
      const opts = { since: url.searchParams.get('since') || null, rev: url.searchParams.get('rev') || null };
      return send(res, 200, { supported: true, ...transcript.read(agent.session, limit, opts) });
    }
    if (method === 'POST' && parts[2] === 'prompt') {
      const { text } = await readJson(req);
      if (typeof text !== 'string' || !text.trim()) return send(res, 400, { error: 'empty_prompt' });
      await herdr.call('agent.prompt', { target: pane, text });
      refreshSoon();
      return send(res, 200, { ok: true });
    }
    if (method === 'POST' && parts[2] === 'keys') {
      // text: typed first without Enter, e.g. the answer after a "Type something" choice.
      const { keys, text = '' } = await readJson(req);
      if (!validKeys(keys)) return send(res, 400, { error: 'bad_keys' });
      if (badText(text)) return send(res, 400, { error: 'bad_text' });
      if (text) await herdr.call('pane.send_text', { pane_id: pane, text });
      await herdr.call('agent.send_keys', { target: pane, keys });
      refreshSoon();
      return send(res, 200, { ok: true });
    }
    // An answer from a notification button or a choice button in the app: sent only while the
    // agent is blocked on the same prompt (stateSeq, and the option's label when given) it was
    // shown for. own: the app's "Type something" pick.
    if (method === 'POST' && parts[2] === 'answer') {
      const body = await readJson(req);
      const r = await answerLocal(pane, body, { allowOwn: body.own === true });
      console.log(`${new Date().toISOString()} answer here ${pane} seq=${body.stateSeq} n=${body.n} -> ${r.status || 200}${r.error ? ` ${r.error}` : ''}`);
      return send(res, r.status || 200, answerBody(r));
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

  // Notification action: { host, pane, stateSeq, n, label? } -> that host's /agents/<pane>/answer.
  if (method === 'POST' && parts[0] === 'answer' && !parts[1]) {
    const body = await readJson(req, 16 * 1024);
    const host = body.host || HOST_ID;
    if (typeof body.pane !== 'string' || !body.pane) return send(res, 400, { error: 'pane_required' });
    const fwd = { stateSeq: body.stateSeq, n: body.n, label: body.label ?? null };
    let out;
    if (host === HOST_ID) {
      const r = await answerLocal(body.pane, fwd);
      out = { status: r.status || 200, body: answerBody(r) };
    } else {
      const peer = peers.get(host);
      if (!peer) return send(res, 404, { error: 'unknown_host' });
      if (!peer.online) return send(res, 503, { error: 'peer_offline' });
      const r = await peer.request('POST', `/api/agents/${encodeURIComponent(body.pane)}/answer`, { body: Buffer.from(JSON.stringify(fwd)), headers: { 'Content-Type': 'application/json', 'X-Herdr-Hub': '1' }, timeoutMs: 20000 });
      out = { status: r.status, body: r.body };
    }
    console.log(`${new Date().toISOString()} answer ${host} ${body.pane} seq=${body.stateSeq} n=${body.n} -> ${out.status}`);
    return send(res, out.status, out.body);
  }

  // Photos for the agent composer, kept on this host for the agent here to read.
  if (parts[0] === 'uploads') {
    if (method === 'POST' && !parts[1]) {
      const body = await readRaw(req, uploads.MAX_BYTES);
      return send(res, 200, uploads.save(req.headers['content-type'], body));
    }
    if (method === 'GET' && parts[1] && !parts[2]) {
      const f = uploads.find(parts[1]);
      if (!f) return send(res, 404, { error: 'not_found' });
      // Names are never reused, so the phone may keep a copy.
      return fs.readFile(f.file, (err, data) =>
        err ? send(res, 404, { error: 'not_found' }) : send(res, 200, data, { 'Content-Type': f.type, 'Cache-Control': 'private, max-age=604800, immutable', 'X-Content-Type-Options': 'nosniff' })
      );
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
    // 시험 알림: only to the device that asks (its subscription endpoint), never to all.
    if (method === 'POST' && parts[1] === 'test') {
      const { endpoint } = await readJson(req);
      if (typeof endpoint !== 'string' || !endpoint) return send(res, 400, { error: 'endpoint_required' });
      const r = await push.sendTo(endpoint, { title: 'Herdr Hub', body: `${HOSTNAME} 알림 시험 — 이 기기`, url: '/' });
      console.log(`${new Date().toISOString()} push test found=${r.found} sent=${r.sent}`);
      if (!r.found) return send(res, 404, { error: 'not_subscribed' });
      return send(res, 200, r);
    }
    if (method === 'POST' && parts[1] === 'status') {
      const { endpoint } = await readJson(req);
      return send(res, 200, { subscribed: typeof endpoint === 'string' && push.has(endpoint) });
    }
  }

  send(res, 404, { error: 'not_found' });
}

async function hostsApi(req, res, parts) {
  const method = req.method;
  if (method === 'GET' && !parts[1]) return send(res, 200, peerView());
  if (method !== 'POST') return send(res, 404, { error: 'not_found' });
  if (!peerStore.manageable) return send(res, 409, { error: 'not_hub' });
  const body = await readJson(req, 8 * 1024);
  // 연결 시험: whether a Herdr Hub answers at that address, and what it runs.
  if (parts[1] === 'test' && !parts[2]) {
    const r = await hoststore.probe(body.url, { selfId: HOST_ID, hubApi: API_VERSION });
    console.log(`${new Date().toISOString()} host test ${r.url} -> ${r.code}`);
    return send(res, 200, r);
  }
  if (!parts[1]) {
    const p = hoststore.cleanPeer(body, { self: SELF, list: peerList });
    setPeerList([...peerList, p]);
    return send(res, 200, { ok: true, peer: p, ...peerView() });
  }
  const cur = peerList.find((p) => p.id === parts[1]);
  if (!cur) return send(res, 404, { error: 'unknown_host' });
  let next;
  if (parts[2] === 'rename') {
    const label = hoststore.cleanName(body.label);
    next = peerList.map((p) => (p.id === cur.id ? (label ? { ...p, label } : { id: p.id, url: p.url }) : p));
  } else if (parts[2] === 'url') {
    const u = hoststore.cleanUrl(body.url);
    hoststore.checkUrl(u, { self: SELF, list: peerList, except: cur.id });
    next = peerList.map((p) => (p.id === cur.id ? { ...p, url: u } : p));
  } else if (parts[2] === 'remove') {
    next = peerList.filter((p) => p.id !== cur.id);
  } else return send(res, 404, { error: 'not_found' });
  setPeerList(next);
  return send(res, 200, { ok: true, ...peerView() });
}

// What an answer request gets back (here, or through the hub from a notification button).
const answerBody = (r) => (r.ok ? { ok: true, n: r.item.n, label: r.item.label } : { error: r.error });

// The guard runs on fresh state: herdr is asked again, and the screen read now. A second answer
// to the same prompt soon after (a double tap, or the app and a notification both) is refused:
// the first one's keys may not have moved the agent on yet.
const answered = new Map(); // pane -> { seq, at }
const ANSWER_HOLD_MS = 5000;
async function answerLocal(pane, body, { allowOwn = false } = {}) {
  await refresh();
  const agent = findAgent(pane);
  const stateSeq = Number.isInteger(body.stateSeq) ? body.stateSeq : null;
  const n = Number(body.n);
  const label = typeof body.label === 'string' ? body.label : null;
  const held = () => {
    const last = answered.get(pane);
    return Boolean(last && last.seq === stateSeq && Date.now() - last.at < ANSWER_HOLD_MS);
  };
  if (held()) return { status: 409, error: 'answered' };
  let choices = null;
  if (agent && agent.status === 'blocked' && agent.stateSeq === stateSeq)
    choices = parseChoices(String((await readScreen('agent.read', { target: pane }, 'visible', 30)).text || '').replace(/\s+$/, ''));
  const r = notifyLib.checkAnswer({ agent, stateSeq, n, label, choices, allowOwn });
  if (!r.ok) return r;
  // Checked again after the reads above, and claimed before the keys go: a request that arrived
  // meanwhile is refused.
  if (held()) return { status: 409, error: 'answered' };
  const claim = { seq: stateSeq, at: Date.now() };
  answered.set(pane, claim);
  try {
    await herdr.call('agent.send_keys', { target: pane, keys: r.keys });
  } catch (err) {
    if (answered.get(pane) === claim) answered.delete(pane);
    throw err;
  }
  refreshSoon();
  return r;
}

// /api/peers/<host>/<rest> -> <peer>/api/<rest>. Only per-host endpoints; the stream,
// state and push stay with the hub. The X-Herdr-Hub check has already run above.
const PROXIED = new Set(['host', 'dirs', 'agents', 'panes', 'workspaces', 'uploads']);

async function proxy(req, res, url) {
  const raw = url.pathname.split('/').filter(Boolean); // api, peers, <host>, ...rest (still encoded)
  const peer = peers.get(decodeURIComponent(raw[2]));
  if (!peer) return send(res, 404, { error: 'unknown_host' });
  if (!PROXIED.has(raw[3])) return send(res, 404, { error: 'not_found' });
  if (!peer.online) return send(res, 503, { error: 'peer_offline', message: `${peer.shown()} 오프라인` });
  // Photo uploads are raw image bytes; everything else is JSON. Bodies stay Buffers both ways.
  const body = req.method === 'GET' ? null : await readRaw(req, raw[3] === 'uploads' ? uploads.MAX_BYTES : undefined);
  const headers = req.method === 'GET' ? {} : { 'Content-Type': req.headers['content-type'] || 'application/json', 'X-Herdr-Hub': '1' };
  let r;
  try {
    r = await peer.request(req.method, `/api/${raw.slice(3).join('/')}${url.search}`, { body, headers, timeoutMs: req.method === 'GET' ? 15000 : 60000 });
  } catch (err) {
    const timeout = Boolean(err.timeout);
    console.error(`${new Date().toISOString()} proxy ${req.method} ${peer.id} ${raw.slice(3).join('/')}: ${err.code || err.message}`);
    return send(res, timeout ? 504 : 502, { error: timeout ? 'peer_timeout' : 'peer_unreachable', message: `${peer.shown()}: ${err.code || err.message}` });
  }
  const out = { 'Content-Type': r.type, ...(r.cache ? { 'Cache-Control': r.cache } : {}) };
  // Came gzipped and the browser takes gzip: passed on as it is; otherwise send() decides.
  if (r.encoded && r.encoded.encoding === 'gzip' && takesGzip(req.headers['accept-encoding']))
    return send(res, r.status, r.encoded.bytes, { ...out, 'Content-Encoding': 'gzip' });
  send(res, r.status, r.body, out);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://herdr-hub.local');
  if (!hostAllowed(req.headers.host, HOST_RULE)) return send(res, 403, { error: 'bad_host' });
  if (!identity(req)) return send(res, 403, { error: 'forbidden' }, { 'Content-Type': 'text/plain; charset=utf-8' });
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(PUBLIC, req, res, url, SITE);
    else send(res, 405, { error: 'method_not_allowed' });
  } catch (err) {
    const status = err.status || (err instanceof herdr.HerdrError ? 502 : 500);
    if (!res.headersSent) send(res, status, { error: err.code || 'error', message: err.message });
    else res.end();
  }
});

// Old photos go at start and once a day.
uploads.sweep();
setInterval(() => uploads.sweep(), 24 * 3600 * 1000).unref();

server.listen(PORT, HOST, () => {
  console.log(`herdr-hub on http://${HOST}:${PORT} (herdr socket ${herdr.defaultSocketPath()})`);
  console.log(ALLOWED.length ? `allowed tailscale logins: ${ALLOWED.join(', ')}` : 'local access only');
  console.log(`hosts: ${[...HOST_RULE.allowed, ...HOST_RULE.suffixes.map((x) => `*${x}`)].join(', ')}`);
  console.log(`build ${BUILD.version}${BUILD.dirty ? '+dirty' : ''} ${BUILD.commit} (${BUILD.from}); API ${API_VERSION}`);
  console.log(`host ${HOST_ID} (${HOSTNAME}); push ${push ? 'on' : 'off'}${PUSH_MUTE.length ? ` (muted: ${PUSH_MUTE.join(', ')})` : ''}; peers (${peerStore.from}${peerStore.manageable ? '' : ', not a hub'}): ${[...peers.values()].map((p) => `${p.id}=${p.url}`).join(', ') || 'none'}`);
});

for (const sig of ['SIGINT', 'SIGTERM'])
  process.on(sig, () => {
    stream.stop();
    for (const p of peers.values()) p.stop();
    process.exit(0);
  });
