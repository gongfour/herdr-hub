'use strict';
// Herdr Hub: serves the web app and a small JSON API over the local herdr server.
// Listens on loopback only; `tailscale serve` provides HTTPS and identity.

// Filesystem calls on request paths are asynchronous (lib/fsq.js) and each may hold a libuv pool
// thread while a guarded or dead folder keeps it waiting; 16 threads, not 4, so a few stuck ones
// leave room for the rest. Read when the pool first starts; the launchers set it too.
process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '16';

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
const { parseChoices, choicesSettled, choicesSig, heldPrompt } = require('./public/choices');
const { Push } = require('./lib/push');
const { Peer, ID: HOST_ID_RULE } = require('./lib/peers');
const hoststore = require('./lib/hoststore');
const { indexPage, send, readJson, readRaw, serveStatic, takesGzip, parseHosts, hostAllowed, corsOrigin } = require('./lib/http');
const { KINDS, PANE_KEYS, AGENT_NAME, validKeys, badText, cleanLines, cleanLabel, cleanCwd, cleanAgentSpec: cleanSpec } = require('./lib/validate');
const { screenReader } = require('./lib/screen');
const echo = require('./lib/echo');
const { readBuild, describe, decorator } = require('./lib/build');
const watchdog = require('./lib/watchdog');
const fsq = require('./lib/fsq');
const awake = require('./lib/awake');
const ws = require('./lib/ws');
const { liveSession, resumeBook, hedge, idleFromEnv, IDLE_POLL_MS } = require('./lib/live');
// Keys a dropped channel left: what each page's keys reached on each pane (lib/live resume).
const liveBook = resumeBook();
const wsdirs = require('./lib/wsdirs');
// The live channel's read pace while nothing moves (lib/live: the Mac's herdr needs the quick one).
const LIVE_IDLE_MS = idleFromEnv(process.env.HERDR_HUB_LIVE_IDLE_MS, herdr.helperOn() ? IDLE_POLL_MS : undefined);

// The contract between this server and its pages, and between a hub and its peers. Bumped by
// hand when either changes (AGENTS.md); 설정 → 연결 shows a peer whose number differs from the hub's.
// 2: the shell's live channel (GET /api/panes/<id>/live as a WebSocket; lib/live.js). A page only
// opens it on a host that says 2 or more, and keeps the HTTP path for the others.
const API_VERSION = 2;
const LIVE_API = 2;

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
// Each workspace's default folder (lib/wsdirs): kept while its workspace is, written when changed.
const WSDIRS_FILE = path.join(DATA, 'wsdirs.json');
let wsDirs = wsdirs.clean(readJsonFile(WSDIRS_FILE));
let wsSeen = null; // the workspace ids in the last list read
let wsDirsWrite = Promise.resolve();
let wsDirsGen = 0; // bumped on every set: a list read before it may not know that workspace yet
function saveWsDirs() {
  wsDirsGen++;
  const body = JSON.stringify(wsDirs);
  wsDirsWrite = wsDirsWrite.then(async () => {
    try {
      await fs.promises.mkdir(DATA, { recursive: true });
      await fs.promises.writeFile(WSDIRS_FILE + '.tmp', body);
      await fs.promises.rename(WSDIRS_FILE + '.tmp', WSDIRS_FILE);
    } catch (err) {
      console.error('wsdirs save failed:', err.message);
    }
  });
  return wsDirsWrite;
}
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

// Refreshes may overlap (the poll, events, after a change); one that ends after a newer one has
// been applied is dropped.
let refreshSeq = 0;
let appliedSeq = 0;
async function refresh() {
  const seq = ++refreshSeq;
  const gen = wsDirsGen;
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
    const b = fsq.budget(2000);
    await Promise.all([...list.map((a) => addGlance(a, b)), ...list.map((a) => holdAsk(a))]);
    if (seq < appliedSeq) return;
    appliedSeq = seq;
    notifyTransitions(HOST_ID, HOSTNAME, list);
    // Not against a list read before the last set (a workspace created meanwhile): the next one.
    const r = gen === wsDirsGen ? wsdirs.reconcile(wsDirs, workspaces.workspaces, wsSeen) : { changed: false };
    wsSeen = new Set(workspaces.workspaces.map((w) => w.workspace_id));
    if (r.changed) {
      wsDirs = r.entries;
      saveWsDirs();
    }
    // defaultCwd: its 기본 폴더, when one is set (only added: an older page or hub ignores it).
    const wsList = workspaces.workspaces.map((w) => {
      const d = wsdirs.get(wsDirs, w.workspace_id);
      return d ? { ...w, defaultCwd: d } : w;
    });
    local = { herdr: 'up', error: null, agents: list, terminals, workspaces: wsList };
    publish();
    watchStatuses(list);
  } catch (err) {
    if (local.herdr !== 'down') {
      local = { ...local, herdr: 'down', error: err.message };
      publish();
    }
  }
}

// herdr (its Claude manifest of 2026.10.11) reads two of Claude's prompts as its input box once
// the session has a name (the name sits in the rule under them): AskUserQuestion's last screen
// (「Review your answers … ❯ 1. Submit answers」) and the plan approval (「Would you like to
// proceed? ❯ 1. Yes, and use auto mode」). The agent turns idle while it still waits for an
// answer. When a Claude agent turns idle or done, its screen is read once; if one of those
// prompts is on it (choices.js heldPrompt), it stays blocked here until herdr's state changes
// again (the answer sent, or Esc).
// An answer drawn for the blocked state just before (its stateSeq is `from`) is for the same
// prompt: answerLocal takes it.
const askHeld = new Map(); // pane -> { seq, from }: herdr's idle/done stateSeq, the blocked one before
const heldSeq = (pane) => (askHeld.get(pane) || {}).seq;
async function holdAsk(a) {
  const held = askHeld.get(a.pane);
  if (held && held.seq !== a.stateSeq) askHeld.delete(a.pane);
  if (a.agent !== 'claude' || (a.status !== 'idle' && a.status !== 'done')) return;
  if (heldSeq(a.pane) === a.stateSeq) return void (a.status = 'blocked');
  // One read per change; a refresh running meanwhile waits for that read.
  let check = askChecked.get(a.pane);
  if (!check || check.seq !== a.stateSeq) {
    const was = (previous.get(HOST_ID) || new Map()).get(a.pane);
    if (!was || was.seq === a.stateSeq) return; // seen at this state already (or the hub just started)
    const pane = a.pane;
    const seq = a.stateSeq;
    const from = was.seq;
    check = {
      seq,
      read: readScreen('agent.read', { target: pane }, 'visible', 30)
        .then((r) => {
          if (heldPrompt(String(r.text || '').replace(/\s+$/, ''))) askHeld.set(pane, { seq, from });
        })
        .catch(() => {}), // unread: herdr's status stands
    };
    askChecked.set(pane, check);
    if (askChecked.size > 256) askChecked.delete(askChecked.keys().next().value);
  }
  await check.read;
  if (heldSeq(a.pane) === a.stateSeq) a.status = 'blocked';
}
const askChecked = new Map(); // pane -> { seq, read } the screen read for that change

// The home screen's one-liners, from a small cached transcript tail: what a working agent ran
// last (lastTool) and the first line of a finished one's last reply (lastReply). And where a
// Claude agent works: the folder its transcript says (it follows a cd; herdr only knows the
// folder claude was started in), when that folder is still there — a removed worktree falls
// back to the pane's. paneCwd: herdr's, kept when they differ.
async function addGlance(a, b) {
  const finished = a.status === 'done' || (a.status === 'idle' && a.doneAt);
  if (a.agent !== 'claude' || !a.session) return;
  let g = null;
  try {
    g = await transcript.glance(a.session, b);
  } catch {
    /* an unreadable transcript only means no summary */
  }
  if (!g) return;
  if (a.status === 'working' && g.lastTool) a.lastTool = g.lastTool;
  if (finished && g.lastReply) a.lastReply = g.lastReply;
  if (g.cwd && g.cwd !== a.cwd && (await dirThere(g.cwd, b))) {
    a.paneCwd = a.cwd;
    a.cwd = g.cwd;
  }
}
// Whether a folder is there, asked at most every 30 s per folder (a refresh runs every 4 s); an
// answer the budget cut short isn't kept.
const dirsThere = new Map(); // path -> { ok, at }
async function dirThere(p, b) {
  const hit = dirsThere.get(p);
  if (hit && Date.now() - hit.at < 30e3) return hit.ok;
  const ok = await fsq.isDir(b, p);
  if (!ok && b.partial) return false;
  dirsThere.delete(p);
  dirsThere.set(p, { ok, at: Date.now() });
  if (dirsThere.size > 128) dirsThere.delete(dirsThere.keys().next().value);
  return ok;
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
  previous.set(hostId, new Map(list.map((a) => [a.pane, { status: a.status, completion: a.completion, seq: a.stateSeq }])));
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
// Text, then keys: one herdr call (pane.send_input) when every key has a herdr name, else as above.
let sendInputOk = true;
// herdr on the Mac holds ~half of the key calls that go the Node way ~105 ms, but almost never one
// that comes 3 ms after another call (measured: 13–15/30 → 2–3/30; one sent at the same moment is
// always held). So on a host whose herdr is kept awake (HERDR_HUB_AWAKE_MS, off on desktop) a ping
// goes first — unless the connect helper carries the calls (lib/herdr), which herdr never holds.
const PRIME_MS = 3;
// herdr may hold this call: it goes the Node way (lib/herdr: the connect helper is off, or not up).
// The workarounds below (the ping before a key, keep-awake, hedged reads) are for that case only.
const herdrHolds = () => !herdr.direct();
const maybeHedge = (fn) => (herdrHolds() ? hedge(fn) : fn());
async function primeHerdr() {
  if (!herdrHolds() || !(awake.intervalFromEnv(process.env.HERDR_HUB_AWAKE_MS) > 0)) return;
  herdr.call('ping', {}, { timeoutMs: 2000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, PRIME_MS));
}
// herdr's pane.wait_for_output for the echo (lib/echo): true when the pattern is on screen. It
// ends here at ms whatever herdr does: herdr 0.9.3 answers a 40 ms timeout after ~105–210 ms.
// hedged: sent again when herdr holds it (lib/live hedge), as the live channel does.
function waitOutput(pane, lines, pattern, ms, { hedged = false, info = null } = {}) {
  const call = () => herdr.call('pane.wait_for_output', { pane_id: pane, source: 'recent_unwrapped', lines, match: { type: 'regex', value: pattern }, timeout_ms: ms });
  let timer;
  return Promise.race([
    (hedged ? maybeHedge(call) : call()).then(
      () => true,
      (err) => {
        if (info) info.werr = err.code;
        return false;
      }
    ),
    new Promise((r) => (timer = setTimeout(() => r(false), ms))),
  ]).finally(() => clearTimeout(timer));
}

// info (optional): the live channel's trace of this call (lib/live), the ping's wait in ms.
async function sendPaneInput(pane, text, keys, info) {
  const t0 = performance.now();
  await primeHerdr();
  if (info) info.prime = performance.now() - t0;
  if (text && keys.length && sendInputOk && !keys.some((k) => SEQ_KEYS[k])) {
    try {
      return await herdr.call('pane.send_input', { pane_id: pane, text, keys });
    } catch (err) {
      if (!(err.code === 'invalid_request' && /unknown variant/.test(err.message))) throw err;
      sendInputOk = false; // a herdr without it: two calls from now on
    }
  }
  if (text) await herdr.call('pane.send_text', { pane_id: pane, text });
  if (keys.length) await sendPaneKeys(pane, keys);
}

// herdr kept awake while a shell here is in use (lib/awake): keys and the shell view's reads touch it.
// Requests proxied from the hub land here too, so each host keeps its own herdr awake.
const herdrAwake = awake.keepAwake({ ping: () => herdr.call('ping', {}, { timeoutMs: 2000 }), intervalMs: awake.intervalFromEnv(process.env.HERDR_HUB_AWAKE_MS) });
const touchAwake = () => herdrHolds() && herdrAwake.touch();

// The last screen read per shell pane (lib/echo): what a key's echo is compared against.
const paneScreens = echo.lastScreens();
async function readPane(pane, source, lines, format) {
  const screen = await readScreen('pane.read', { pane_id: pane }, source, lines, format);
  paneScreens.set(pane, { source, format, lines }, screen);
  return screen;
}
// A typed command may start an agent or change the folder: one refresh after the last Enter
// (herdr's own events cover most of it; this is for what they do not).
let keysRefreshTimer = null;
const refreshAfterKeys = () => {
  clearTimeout(keysRefreshTimer);
  keysRefreshTimer = setTimeout(refresh, 500);
};

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
  const parts = url.pathname.split('/').filter(Boolean).slice(1).map(decodePart); // drop "api"
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
    return send(res, 200, { id: HOST_ID, label: HOSTNAME, herdr: local.herdr, api: API_VERSION, build: { version: BUILD.version, commit: BUILD.commit, time: BUILD.time, dirty: BUILD.dirty }, platform: process.platform, home: os.homedir(), kinds: KINDS, recentCwds: recentCwds(), places: await dirs.places() });

  // Folder browser: subfolders of ?path= (home when empty), or the drive letters on Windows.
  if (method === 'GET' && parts[0] === 'dirs' && !parts[1]) {
    const p = url.searchParams.get('path') || '';
    if (url.searchParams.get('drives') === '1' || p === dirs.DRIVES) return send(res, 200, await dirs.drives());
    return send(res, 200, await dirs.list(p ? await cleanCwd(p) : os.homedir()));
  }

  if (method === 'POST' && parts[0] === 'dirs' && !parts[1]) {
    const body = await readJson(req);
    const parent = await cleanCwd(body.parent);
    return send(res, 200, { ok: true, path: await dirs.create(parent, body.name) });
  }

  if (method === 'POST' && parts[0] === 'workspaces' && !parts[1]) {
    const body = await readJson(req);
    const cwd = await cleanCwd(body.cwd);
    const label = cleanLabel(body.label);
    const spec = body.agent ? cleanAgentSpec(body.agent, [label, path.basename(cwd)]) : null;
    const wsLabel = label || path.basename(cwd) || cwd;
    const r = await herdr.call('workspace.create', { cwd, label: wsLabel, focus: false });
    const pane = r.root_pane.pane_id;
    // Its folder becomes its 기본 폴더: where its next tabs open too, until changed.
    wsDirs = wsdirs.set(wsDirs, r.workspace.workspace_id, cwd, r.workspace.label || wsLabel);
    saveWsDirs();
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
    } else if (parts[2] === 'dir') {
      // Its 기본 폴더 (lib/wsdirs): { cwd } sets it (the same rules as a new workspace's folder),
      // empty or null clears it.
      const cwd = body.cwd == null || body.cwd === '' ? null : await cleanCwd(body.cwd);
      wsDirs = wsdirs.set(wsDirs, ws.workspace_id, cwd, ws.label);
      await saveWsDirs();
    } else if (parts[2] === 'tabs' || parts[2] === 'agents') {
      // New tab, optionally with an agent started in its root pane. cwd (optional, the same rules
      // as a new workspace): where the tab opens. Without it herdr opens it in the folder of the
      // workspace's active tab — a herdr workspace has no folder of its own.
      const cwd = body.cwd == null || body.cwd === '' ? null : await cleanCwd(body.cwd);
      const spec = parts[2] === 'agents' ? cleanAgentSpec(body, [ws.label, cwd && path.basename(cwd)]) : null;
      const params = { workspace_id: ws.workspace_id, label: cleanLabel(body.label), focus: false };
      if (cwd) params.cwd = cwd;
      const r = await herdr.call('tab.create', params);
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
      touchAwake();
      const lines = cleanLines(url.searchParams.get('lines'), 120);
      return send(res, 200, await readPane(pane, url.searchParams.get('source'), lines, url.searchParams.get('format')));
    }
    if (method === 'POST') {
      const body = await readJson(req);
      let result = { ok: true };
      // input: one command line, the text then Enter (empty text just presses Enter).
      // keys: optional text typed first without Enter, so "Get-Ch" + tab completes.
      if (parts[2] === 'input' || parts[2] === 'keys') {
        touchAwake();
        const { text = '' } = body;
        const keys = parts[2] === 'input' ? ['enter'] : body.keys;
        if (badText(text)) return send(res, 400, { error: 'bad_text' });
        // keys may be empty when there is text: raw mode typing one character at a time.
        const textOnly = parts[2] === 'keys' && text && Array.isArray(keys) && keys.length === 0;
        if (!textOnly && !validKeys(keys, PANE_KEYS)) return send(res, 400, { error: 'bad_keys' });
        await sendPaneInput(pane, text, textOnly ? [] : keys);
        if (parts[2] === 'keys') {
          // Typing changes no state the views show: no refresh or broadcast per key (the
          // regular one and herdr's events cover the rest), one shortly after an Enter.
          if (!textOnly && keys.includes('enter')) refreshAfterKeys();
          // 키 직접 입력 asks for the screen back ({ echo: { format } }): the echo arrives with
          // the reply instead of a second request (two hops when the pane is on a peer), as
          // soon as it is on screen (lib/echo). lines: as many as the page reads (200 for a
          // page from before it said, 400 at most).
          if (!body.echo || typeof body.echo !== 'object') return send(res, 200, result);
          const lines = cleanLines(body.echo.lines, 200);
          const shape = { source: 'recent_unwrapped', format: body.echo.format, lines };
          const { screen } = await echo.waitEcho(
            {
              waitFor: (pattern, ms) => waitOutput(pane, lines, pattern, ms),
              read: () => readPane(pane, shape.source, lines, shape.format),
              sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
              now: () => performance.now(),
            },
            { text: textOnly || !keys.length ? text : '', before: paneScreens.get(pane, shape) }
          );
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
        paneScreens.drop(pane);
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
      const lines = cleanLines(url.searchParams.get('lines'), 80);
      return send(res, 200, await readScreen('agent.read', { target: pane }, url.searchParams.get('source'), lines, url.searchParams.get('format')));
    }
    // What the composer offers after "/" and "@": Claude agents only, read on this host.
    if (method === 'GET' && (parts[2] === 'commands' || parts[2] === 'files') && !parts[3]) {
      if (agent.agent !== 'claude' || !agent.cwd) return send(res, 200, { supported: false, commands: [], files: [] });
      if (parts[2] === 'commands') {
        const r = await commands.list(agent.cwd);
        return send(res, 200, { supported: true, cwd: agent.cwd, commands: r.commands, ...(r.partial ? { partial: true } : {}) });
      }
      const q = (url.searchParams.get('q') || '').slice(0, 300);
      return send(res, 200, { supported: true, ...(await commands.files(agent.cwd, q)) });
    }
    if (method === 'GET' && parts[2] === 'transcript') {
      if (agent.agent !== 'claude' || !agent.session) return send(res, 200, { supported: false, messages: [] });
      const limit = Math.min(Number(url.searchParams.get('limit')) || 120, 500);
      const opts = { since: url.searchParams.get('since') || null, rev: url.searchParams.get('rev') || null };
      return send(res, 200, { supported: true, ...(await transcript.read(agent.session, limit, opts)) });
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
    // 지금 보내기: Claude Code's chat:sendNow on what it holds queued (prompts sent while it
    // works). Ctrl+X Ctrl+S, not Ctrl+Enter, which a terminal without extended keys turns into
    // a plain Enter. With nothing queued Claude Code leaves the turn alone (2.1.318). Only while
    // it works: once it is idle the queue has gone out already.
    if (method === 'POST' && parts[2] === 'sendnow') {
      if (agent.agent !== 'claude') return send(res, 400, { error: 'not_claude' });
      if (agent.status !== 'working') return send(res, 200, { ok: true, sent: false });
      await herdr.call('agent.send_keys', { target: pane, keys: ['ctrl+x', 'ctrl+s'] });
      refreshSoon();
      return send(res, 200, { ok: true, sent: true });
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
      return send(res, 200, await uploads.save(req.headers['content-type'], body));
    }
    if (method === 'GET' && parts[1] && !parts[2]) {
      const f = await uploads.find(parts[1]);
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
// the first one's keys may not have moved the agent on yet. "The same prompt" is the same screen
// of it (choicesSig): AskUserQuestion takes its questions one after another, and a multiSelect
// its boxes, all while herdr's state stays the same; each new screen takes its own answer.
const answered = new Map(); // pane -> { seq, sig, at }
const ANSWER_HOLD_MS = 5000;
async function answerLocal(pane, body, { allowOwn = false } = {}) {
  await refresh();
  const agent = findAgent(pane);
  let stateSeq = Number.isInteger(body.stateSeq) ? body.stateSeq : null;
  // Drawn just before herdr misread the prompt's last screen as idle (holdAsk): the same prompt.
  const ah = askHeld.get(pane);
  if (agent && ah && agent.stateSeq === ah.seq && stateSeq === ah.from) stateSeq = ah.seq;
  const n = Number(body.n);
  const label = typeof body.label === 'string' ? body.label : null;
  let choices = null;
  if (agent && agent.status === 'blocked' && agent.stateSeq === stateSeq)
    choices = parseChoices(String((await readScreen('agent.read', { target: pane }, 'visible', 30)).text || '').replace(/\s+$/, ''));
  const sig = choicesSig(choices);
  const held = () => {
    const last = answered.get(pane);
    return Boolean(last && last.seq === stateSeq && last.sig === sig && Date.now() - last.at < ANSWER_HOLD_MS);
  };
  if (held()) return { status: 409, error: 'answered' };
  const r = notifyLib.checkAnswer({ agent, stateSeq, n, label, choices, allowOwn });
  if (!r.ok) return r;
  // Checked again after the reads above, and claimed before the keys go: a request that arrived
  // meanwhile is refused.
  if (held()) return { status: 409, error: 'answered' };
  const claim = { seq: stateSeq, sig, at: Date.now() };
  answered.set(pane, claim);
  // Nothing to press: the cursor is on that row already (a multiSelect's "Type something").
  if (!r.keys.length) return r;
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
  const peer = peers.get(decodePart(raw[2]));
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

// A request slower than SLOW_REQUEST_MS gets a log line (method and path only: no query, no body).
// The event stream stays open by design.
const SLOW_REQUEST_MS = 3000;
const LONG = /^\/api\/stream$/;
function timeRequest(req, res, url) {
  const started = Date.now();
  watchdog.request(`${req.method} ${url.pathname}`);
  res.on('close', () => {
    const ms = Date.now() - started;
    if (ms > SLOW_REQUEST_MS && !LONG.test(url.pathname)) console.error(`${new Date().toISOString()} slow request ${req.method} ${url.pathname} ${ms}ms -> ${res.statusCode}`);
  });
}

// A request line new URL() refuses (`GET //a:99999/x`) or a path with a broken %-escape is a 400,
// not a throw: on the request path it would take the whole process (every device's connection) down.
function requestUrl(raw) {
  try {
    return new URL(raw, 'http://herdr-hub.local');
  } catch {
    return null;
  }
}
function decodePart(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    throw Object.assign(new Error('bad path'), { status: 400, code: 'bad_path' });
  }
}

const server = http.createServer(async (req, res) => {
  const url = requestUrl(req.url);
  if (!url) return send(res, 400, { error: 'bad_url' });
  timeRequest(req, res, url);
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

// ---------------------------------------------------------------- the shell's live channel
// A WebSocket per open shell view (lib/ws.js, lib/live.js): keys up as they are typed, the screen
// down when it changes. On a hub, /api/peers/<host>/panes/<id>/live is piped to that peer's
// /api/panes/<id>/live. The same checks as a request (Host, login), and the Origin: a WebSocket
// is not held back by CORS, so a browser's must be this page's own; the hub's leg has none and
// sends X-Herdr-Hub instead (a browser cannot set that on a WebSocket).
const LIVE = /^\/api\/panes\/([^/]+)\/live$/;
const PEER_LIVE = /^\/api\/peers\/([^/]+)\/panes\/([^/]+)\/live$/;
function liveOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return req.headers['x-herdr-hub'] === '1';
  const host = req.headers.host || '';
  return origin === `https://${host}` || (ALLOW_LOCAL && origin === `http://${host}`);
}
const liveShape = (url) => ({ lines: cleanLines(url.searchParams.get('lines'), 200), format: url.searchParams.get('format') === 'ansi' ? 'ansi' : 'text' });
const liveConns = new Set();
// Each end of a channel is pinged; one that answers nothing for LIVE_DEAD_MS is closed (lib/ws keepalive).
const LIVE_PING_MS = Number(process.env.HERDR_HUB_LIVE_PING_MS) || 15000;
const LIVE_DEAD_MS = LIVE_PING_MS * 3;

function liveLocal(req, socket, head, pane, url) {
  if (!findTerminal(pane)) return ws.refuse(socket, 404, 'pane_not_found');
  const conn = ws.accept(req, socket, head);
  if (!conn) return;
  conn.keepalive(LIVE_PING_MS, LIVE_DEAD_MS);
  liveConns.add(conn);
  const io = {
    // Reads and the echo wait are sent again when herdr holds them (lib/live hedge); keys never.
    read: (shape) => maybeHedge(() => readPane(pane, 'recent_unwrapped', shape.lines, shape.format)),
    input: async (text, keys, info) => {
      await sendPaneInput(pane, text, keys, info);
      if (keys.includes('enter')) refreshAfterKeys();
    },
    echo: async ({ text, before }, shape, info = {}) => {
      const r = await echo.waitEcho(
          {
            waitFor: (pattern, ms) => waitOutput(pane, shape.lines, pattern, ms, { hedged: true, info }),
            read: () => maybeHedge(() => readPane(pane, 'recent_unwrapped', shape.lines, shape.format)),
            sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
            now: () => performance.now(),
          },
          { text, before }
        );
      info.how = r.how;
      info.reads = r.reads;
      return r.screen;
    },
    touch: () => touchAwake(),
    now: () => performance.now(),
    setTimeout: (f, ms) => setTimeout(f, ms),
    clearTimeout: (t) => clearTimeout(t),
    buffered: () => conn.buffered,
  };
  // The pane went away (lib/live says 'gone'): the channel goes with it.
  const send = (m) => {
    conn.send(JSON.stringify(m));
    if (m.t === 'gone') conn.close(1000, 'gone');
  };
  const session = liveSession({ io, send, pane, shape: liveShape(url), api: API_VERSION, book: liveBook, idlePollMs: LIVE_IDLE_MS });
  conn.on('message', (text) => {
    let m;
    try {
      m = JSON.parse(text);
    } catch {
      return;
    }
    if (m && m.t === 'k') {
      // The same checks as POST /keys: text alone, or keys herdr knows (with text before them).
      const x = typeof m.x === 'string' ? m.x : '';
      const y = Array.isArray(m.y) ? m.y : [];
      const bad = badText(x) ? 'bad_text' : y.length ? (validKeys(y, PANE_KEYS) ? null : 'bad_keys') : x ? null : 'bad_keys';
      if (bad) return conn.send(JSON.stringify({ t: 'kerr', from: m.s, to: m.s, error: bad, message: bad }));
      m = { t: 'k', s: m.s, x, y, ...(m.tr ? { tr: 1 } : {}) };
    }
    session.message(m);
  });
  conn.on('close', () => {
    liveConns.delete(conn);
    session.stop();
  });
}

// The hub's leg: the peer's channel first (so a peer that cannot, or a pane that is gone, is a
// plain HTTP answer the page falls back on), then the page's, then each message through as it is.
async function livePeer(req, socket, head, hostId, encodedPane, url) {
  const peer = peers.get(hostId);
  if (!peer) return ws.refuse(socket, 404, 'unknown_host');
  if (!peer.online) return ws.refuse(socket, 503, 'peer_offline', `${peer.shown()} 오프라인`);
  if (!peer.build || !(peer.build.api >= LIVE_API)) return ws.refuse(socket, 501, 'peer_no_live');
  let up;
  try {
    up = await ws.connect(new URL(`/api/panes/${encodedPane}/live${url.search}`, peer.url).href, { headers: { 'X-Herdr-Hub': '1' } });
  } catch (err) {
    if (err.status) return ws.refuse(socket, err.status, err.code || 'peer_error');
    console.error(`${new Date().toISOString()} live ${peer.id}: ${err.code || err.message}`);
    return ws.refuse(socket, err.timeout ? 504 : 502, err.timeout ? 'peer_timeout' : 'peer_unreachable');
  }
  if (socket.destroyed) return up.close(1001);
  const down = ws.accept(req, socket, head);
  if (!down) return up.close(1001);
  up.keepalive(LIVE_PING_MS, LIVE_DEAD_MS);
  down.keepalive(LIVE_PING_MS, LIVE_DEAD_MS);
  liveConns.add(down);
  // A traced key (lib/live tr): the hub adds how long the peer took from where it stands (hub.rt,
  // from passing the key on to its group's trace coming back). Untraced messages pass untouched.
  const tracedAt = new Map();
  up.on('message', (t) => {
    if (tracedAt.size && t.startsWith('{"t":"tr"')) {
      try {
        const m = JSON.parse(t);
        const at = tracedAt.get(m.from);
        for (const s of tracedAt.keys()) if (s <= m.to) tracedAt.delete(s);
        if (at != null) t = JSON.stringify({ ...m, hub: Math.round((performance.now() - at) * 10) / 10 });
      } catch {}
    }
    down.send(t);
    ws.holdWhileFull(up, down); // a slow page: the peer's reads wait, so the peer skips screens
  });
  down.on('message', (t) => {
    if (t.includes('"tr":1') && tracedAt.size < 256) {
      const s = /"s":(\d+)/.exec(t);
      if (s) tracedAt.set(Number(s[1]), performance.now());
    }
    up.send(t);
  });
  up.on('close', (code) => down.close(code === 1006 || code === 1005 ? 1011 : code, 'peer'));
  down.on('close', () => {
    liveConns.delete(down);
    up.close(1000);
  });
}

server.on('upgrade', (req, socket, head) => {
  socket.on('error', () => {});
  const url = requestUrl(req.url);
  if (!url) return ws.refuse(socket, 400, 'bad_url');
  if (!hostAllowed(req.headers.host, HOST_RULE)) return ws.refuse(socket, 403, 'bad_host');
  if (!identity(req)) return ws.refuse(socket, 403, 'forbidden');
  if (!liveOrigin(req)) return ws.refuse(socket, 403, 'bad_origin');
  if (!ws.upgradeKey(req)) return ws.refuse(socket, 400, 'not_websocket');
  let m;
  try {
    if ((m = LIVE.exec(url.pathname))) return liveLocal(req, socket, head, decodePart(m[1]), url);
    if ((m = PEER_LIVE.exec(url.pathname))) return livePeer(req, socket, head, decodePart(m[1]), m[2], url).catch(() => ws.refuse(socket, 500, 'error'));
  } catch (err) {
    if (err.status === 400) return ws.refuse(socket, 400, 'bad_path');
    throw err;
  }
  ws.refuse(socket, 404, 'not_found');
});

// Old photos go at start and once a day.
uploads.sweep();
setInterval(() => uploads.sweep(), 24 * 3600 * 1000).unref();

// A main thread that stops running JavaScript (a synchronous call that never returns) cannot
// answer anything, and the supervisor (launchd KeepAlive, run.cmd's loop) only restarts a process
// that exited: the watchdog thread kills it then (lib/watchdog.js).
watchdog.start({ ms: process.env.HERDR_HUB_WATCHDOG_MS == null ? undefined : Number(process.env.HERDR_HUB_WATCHDOG_MS) });

server.listen(PORT, HOST, () => {
  console.log(`herdr-hub on http://${HOST}:${PORT} (herdr socket ${herdr.defaultSocketPath()})`);
  console.log(ALLOWED.length ? `allowed tailscale logins: ${ALLOWED.join(', ')}` : 'local access only');
  console.log(`hosts: ${[...HOST_RULE.allowed, ...HOST_RULE.suffixes.map((x) => `*${x}`)].join(', ')}`);
  console.log(`build ${BUILD.version}${BUILD.dirty ? '+dirty' : ''} ${BUILD.commit} (${BUILD.from}); API ${API_VERSION}`);
  console.log(`host ${HOST_ID} (${HOSTNAME}); push ${push ? 'on' : 'off'}${PUSH_MUTE.length ? ` (muted: ${PUSH_MUTE.join(', ')})` : ''}; peers (${peerStore.from}${peerStore.manageable ? '' : ', not a hub'}): ${[...peers.values()].map((p) => `${p.id}=${p.url}`).join(', ') || 'none'}`);
});

// A promise nobody awaited that fails (a stray async callback): logged with its stack and the hub
// keeps serving: the request it came from, if any, has already been answered or timed out, and no
// state is left half-written by a rejection. A thrown exception is different: it can stop a
// function midway through changing state, so it is logged and the process exits (code 1) for
// launchd / run.cmd's loop to start it again, as Node would have done, only now with a time stamp.
process.on('unhandledRejection', (err) => {
  console.error(`${new Date().toISOString()} unhandled rejection:`, err && err.stack ? err.stack : err);
});
process.on('uncaughtException', (err) => {
  console.error(`${new Date().toISOString()} uncaught exception, exiting:`, err && err.stack ? err.stack : err);
  process.exit(1);
});

for (const sig of ['SIGINT', 'SIGTERM'])
  process.on(sig, () => {
    stream.stop();
    for (const p of peers.values()) p.stop();
    process.exit(0);
  });
