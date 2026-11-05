'use strict';
// A Herdr Hub: the web app and a small JSON API over the local herdr server, merged with its
// peers' (lib/peers.js). createServer() builds one — its state, the refresh from herdr, the
// notifications, the peers, the HTTP server and the live channel — from what it is given, so a
// test can run one in its own process with a fake herdr. server.js is the process around it.
//
// The API's routes are in lib/routes/ (index.js: the table); this file keeps the state they read
// and the actions they share, on the context object `hub` passed to each of them.

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const realHerdr = require('./herdr');
const transcript = require('./transcript');
const times = require('./times');
const notifyLib = require('./notify');
const { parseChoices, choicesSettled, heldPrompt } = require('../public/choices');
const { Push } = require('./push');
const { Peer, ID: HOST_ID_RULE, dumpGhosts, loadGhosts } = require('./peers');
const hoststore = require('./hoststore');
const { indexPage, send, serveStatic, parseHosts, hostAllowed } = require('./http');
const { cleanAgentSpec: cleanSpec } = require('./validate');
const { screenReader } = require('./screen');
const { readBuild, describe, decorator } = require('./build');
const watchdog = require('./watchdog');
const fsq = require('./fsq');
const wsdirs = require('./wsdirs');
const { paneIO } = require('./paneio');
const { idleFromEnv, IDLE_POLL_MS } = require('./live');
const { api } = require('./routes');
const { liveUpgrade } = require('./routes/live');

// The contract between this server and its pages, and between a hub and its peers. Bumped by
// hand when either changes (AGENTS.md); 설정 → 연결 shows a peer whose number differs from the hub's.
// 2: the shell's live channel (GET /api/panes/<id>/live as a WebSocket; lib/live.js). A page only
// opens it on a host that says 2 or more, and keeps the HTTP path for the others.
const API_VERSION = 2;
const LIVE_API = 2;

const ROOT = path.join(__dirname, '..');
const POLL_MS = 4000;
const STATUS_RANK = { blocked: 0, done: 1, working: 2, idle: 3, unknown: 4 };
const TOPOLOGY = ['workspace.created', 'workspace.updated', 'workspace.closed', 'workspace.renamed', 'tab.created', 'tab.closed', 'pane.created', 'pane.closed', 'pane.updated', 'pane.exited', 'pane.agent_detected'];
// A request slower than SLOW_REQUEST_MS gets a log line (method and path only: no query, no body).
// The event stream stays open by design.
const SLOW_REQUEST_MS = 3000;
const LONG = /^\/api\/stream$/;

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
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

// The configuration a hub runs with, from its environment. Throws (with the message server.js
// prints before exiting 2) when it cannot run.
function config(env, port) {
  const ALLOWED = (env.HERDR_HUB_ALLOWED_LOGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ALLOW_LOCAL = env.HERDR_HUB_ALLOW_LOCAL === '1';
  const HOST_ID = env.HERDR_HUB_HOST_ID || os.hostname().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^[^a-z]+/, '').slice(0, 32) || 'local';
  if (!HOST_ID_RULE.test(HOST_ID) || HOST_ID === 'all') throw new Error(`HERDR_HUB_HOST_ID must match ${HOST_ID_RULE} and not be "all".`);
  if (!ALLOWED.length && !ALLOW_LOCAL) throw new Error('Set HERDR_HUB_ALLOWED_LOGINS (Tailscale logins) or HERDR_HUB_ALLOW_LOCAL=1.');
  // The names this Herdr Hub answers to, as the Host header carries them (tailscale serve passes
  // the browser's through: "desktop.example.ts.net", "server.example.ts.net:8443"). Unset: any
  // *.ts.net name. Loopback only with HERDR_HUB_ALLOW_LOCAL. Anything else is a page whose own
  // domain was pointed at 127.0.0.1 (DNS rebinding) and gets 403.
  const HOSTS = parseHosts(env.HERDR_HUB_HOSTS);
  return {
    PORT: port,
    ALLOWED,
    ALLOW_LOCAL,
    HOST_ID,
    HOSTNAME: env.HERDR_HUB_HOST_LABEL || os.hostname(),
    PUSH_ON: env.HERDR_HUB_PUSH !== '0',
    // Folder or workspace name prefixes whose agents never notify (throwaway test workspaces).
    PUSH_MUTE: notifyLib.parseMute(env.HERDR_HUB_PUSH_MUTE),
    HOSTS,
    HOST_RULE: {
      allowed: [...HOSTS, ...(ALLOW_LOCAL ? [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`] : [])],
      suffixes: HOSTS.length ? [] : ['.ts.net'],
    },
    // Pages of the other hosts that may read /api/version (CORS): https on this tailnet (the domain
    // after the first name of HERDR_HUB_HOSTS, else any .ts.net), and loopback with ALLOW_LOCAL.
    CORS_RULE: {
      suffixes: HOSTS.length ? [...new Set(HOSTS.map((h) => h.replace(/:\d+$/, '').replace(/^[^.]+/, '')).filter((d) => d.includes('.')))] : ['.ts.net'],
      local: ALLOW_LOCAL,
    },
    // This hub's own addresses, which can't be added as a peer.
    SELF: {
      id: HOST_ID,
      urls: [...HOSTS.map((h) => `https://${h}`), ...(ALLOW_LOCAL ? [`http://127.0.0.1:${port}`, `http://localhost:${port}`] : [])].map((u) => {
        try {
          return hoststore.cleanUrl(u);
        } catch {
          return null;
        }
      }).filter(Boolean),
    },
  };
}

// opts: herdr (lib/herdr's shape: call, subscribe, direct, helperOn, HerdrError, defaultSocketPath),
// env (process.env), dataDir (HERDR_HUB_DATA, else data/), port (PORT, else 8787: the Host rule
// and the hub's own addresses), peers (a peer list instead of data/peers.json and
// HERDR_HUB_PEERS), now (the clock of the times kept: answers, workingSince/doneAt, ghosts),
// root (where public/ and build.json are). Returns { server, hub, listen, close }.
function createServer({ herdr = realHerdr, env = process.env, dataDir, port, peers: peerSeed, now = Date.now, root = ROOT } = {}) {
  const PORT = Number(port || env.PORT || 8787);
  const C = config(env, PORT);
  const { HOST_ID, HOSTNAME } = C;
  const PUBLIC = path.join(root, 'public');
  const DATA = dataDir || env.HERDR_HUB_DATA || path.join(root, 'data');

  // Only the hub sends notifications (HERDR_HUB_PUSH=0 on peers), so none arrive twice.
  const push = C.PUSH_ON ? new Push(DATA, env.HERDR_HUB_VAPID_SUBJECT || 'https://herdr-hub.invalid') : null;

  // The peers this Herdr Hub merges into its view: data/peers.json, edited in 설정 → 연결
  // (lib/hoststore.js). HERDR_HUB_PEERS seeds the file the first time; then the file wins. A host
  // with neither is a peer: its 연결 block is read-only.
  const PEERS_FILE = path.join(DATA, 'peers.json');
  const peerStore = peerSeed
    ? { list: peerSeed, manageable: true, from: 'given' }
    : hoststore.load(PEERS_FILE, env.HERDR_HUB_PEERS, C.SELF, (m) => console.error(m));
  let peerList = peerStore.list;
  const peers = new Map();

  // The build this host runs (lib/build.js), written into the page it serves; the page compares it
  // with what /api/version and the stream say to know a new build is out.
  const BUILD = readBuild(root);
  const SITE = { decorate: decorator(BUILD, API_VERSION) };
  function buildNow() {
    const page = indexPage(PUBLIC, SITE);
    return describe(BUILD, API_VERSION, page ? page.assets : '');
  }

  // Pane reads with herdr's fallbacks (lib/screen).
  const readScreen = screenReader(herdr.call);
  const io = paneIO({ herdr, readScreen, env });
  // The live channel's read pace while nothing moves (lib/live: the Mac's herdr needs the quick one).
  const LIVE_IDLE_MS = idleFromEnv(env.HERDR_HUB_LIVE_IDLE_MS, herdr.helperOn() ? IDLE_POLL_MS : undefined);

  // ---------------------------------------------------------------- live state

  // local: this host's herdr. state: local merged with every online peer; what clients see.
  let local = { herdr: 'connecting', error: null, agents: [], terminals: [], workspaces: [] };
  let state = null;
  const previous = new Map(); // host id -> Map(pane -> { status, completion }) from that host's last update
  const clients = new Set();
  let watchedPanes = '';
  const timers = [];
  // workingSince / doneAt per agent (lib/times): this host's own, and every host's as merged.
  const TIMES_FILE = path.join(DATA, 'times.json');
  let { local: localTimes, merged: mergedTimes } = times.load(readJsonFile(TIMES_FILE), ['local', 'merged'], now(), 6 * 3600e3);
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
  // A workspace's 기본 폴더 set (null clears it); the promise is the file written.
  function setWsDir(id, cwd, label) {
    wsDirs = wsdirs.set(wsDirs, id, cwd, label);
    return saveWsDirs();
  }
  // Written when a time changed (and hourly, so savedAt stays fresh), not on every refresh.
  // Asynchronous (it runs on refresh's path) and one write at a time: the newest dump, taken when
  // that write starts, goes to a temp file then is renamed over the old one.
  let timesWrite = Promise.resolve();
  function saveTimes() {
    const body = JSON.stringify(times.dump({ local: localTimes, merged: mergedTimes }, 0).maps);
    if (body === timesSaved.body && now() - timesSaved.at < 3600e3) return timesWrite;
    timesSaved = { body, at: now() };
    timesWrite = timesWrite.then(async () => {
      try {
        await fs.promises.mkdir(DATA, { recursive: true });
        await fs.promises.writeFile(TIMES_FILE + '.tmp', JSON.stringify(times.dump({ local: localTimes, merged: mergedTimes }, now())));
        await fs.promises.rename(TIMES_FILE + '.tmp', TIMES_FILE);
      } catch (err) {
        console.error('times save failed:', err.message);
      }
    });
    return timesWrite;
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
      // The times this read makes (put on the agents now: addGlance reads doneAt), kept only if
      // this refresh is applied: an older one that ends late would otherwise set them back to what
      // it read, and the next refresh would see working -> idle again (a second 완료).
      const nextTimes = times.track(localTimes, list, now(), (a) => a.pane);
      const b = fsq.budget(2000);
      await Promise.all([...list.map((a) => addGlance(a, b)), ...list.map((a) => holdAsk(a))]);
      if (seq < appliedSeq) return;
      appliedSeq = seq;
      localTimes = nextTimes;
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
  // prompt: answerLocal (lib/routes/agents.js) takes it.
  const askHeld = new Map(); // pane -> { seq, from }: herdr's idle/done stateSeq, the blocked one before
  const askChecked = new Map(); // pane -> { seq, read } the screen read for that change
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
    // An offline peer is listed as its ghost (lib/peers.js staleView), until its stream is back.
    const parts = [{ id: HOST_ID, label: HOSTNAME, s: local }, ...[...peers.values()].map((p) => ({ id: p.id, label: p.shown(), s: p.view() })).filter((x) => x.s)];
    const all = (key) => parts.flatMap(({ id, label, s }) => (s[key] || []).map(tag(id, label)));
    const agents = all('agents').sort(
      (x, y) => (STATUS_RANK[x.status] ?? 9) - (STATUS_RANK[y.status] ?? 9) || order.get(x.host) - order.get(y.host) || y.stateSeq - x.stateSeq
    );
    // Peers on this version bring their own times; for an older peer the hub tracks them here. A
    // ghost's are kept as they were: it is not a transition, and they go on when it comes back.
    const key = (a) => `${a.host}|${a.pane}`;
    const before = mergedTimes;
    mergedTimes = times.track(before, agents.filter((a) => !a.stale), now(), key);
    for (const a of agents) if (a.stale && before.has(key(a))) mergedTimes.set(key(a), before.get(key(a)));
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
      updatedAt: now(),
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
    if (notifyLib.muted(a, C.PUSH_MUTE)) return console.log(`${new Date().toISOString()} push ${kind} ${hostId} ${a.pane} muted`);
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

  // A peer agent's last full chat window (a transcript GET without since/rev), kept as it passed by,
  // so that peer's ghost (offline) still opens to its last chat on a device that had no copy of
  // its own (lib/routes/peers.js).
  const lastChats = new Map(); // peer|pane -> { body, type }

  // A peer joins: followed from now on. Leaves: its stream is closed and its items drop out.
  function startPeer(p) {
    const peer = new Peer(p);
    peer.on('change', () => {
      if (peers.get(peer.id) !== peer) return; // removed or replaced meanwhile
      if (peer.online && peer.state) notifyTransitions(peer.id, peer.shown(), peer.state.agents);
      publish();
      saveGhostsSoon();
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
    for (const k of [...lastChats.keys()]) if (k.startsWith(`${id}|`)) lastChats.delete(k);
  }
  for (const p of peerList) startPeer(p);

  // The peers' last states (lib/peers.js dumpGhosts), so a hub restarted while a peer sleeps (a
  // deploy at night) still lists that peer's agents greyed. Written at most every 30 s, off the
  // request path; read once at start.
  const GHOSTS_FILE = path.join(DATA, 'peer-ghosts.json');
  loadGhosts(readJsonFile(GHOSTS_FILE), [...peers.values()], now());
  let ghostTimer = null;
  function saveGhostsSoon() {
    if (ghostTimer) return;
    ghostTimer = setTimeout(async () => {
      ghostTimer = null;
      try {
        await fs.promises.mkdir(DATA, { recursive: true });
        await fs.promises.writeFile(GHOSTS_FILE + '.tmp', JSON.stringify(dumpGhosts([...peers.values()])));
        await fs.promises.rename(GHOSTS_FILE + '.tmp', GHOSTS_FILE);
      } catch (err) {
        console.error('peer ghosts save failed:', err.message);
      }
    }, 30e3);
    ghostTimer.unref();
  }

  // 설정 → 연결 changes the list: saved first, then the connections follow, without a restart.
  function setPeerList(next) {
    hoststore.save(PEERS_FILE, next);
    const before = new Map(peerList.map((p) => [p.id, p]));
    peerList = next;
    for (const [id, old] of before) {
      const cur = next.find((p) => p.id === id);
      if (!cur || cur.url !== old.url) stopPeer(id);
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
  // A typed command may start an agent or change the folder: one refresh after the last Enter
  // (herdr's own events cover most of it; this is for what they do not).
  let keysRefreshTimer = null;
  const refreshAfterKeys = () => {
    clearTimeout(keysRefreshTimer);
    keysRefreshTimer = setTimeout(refresh, 500);
  };

  // Topology events, plus one agent_status_changed subscription per agent pane
  // (herdr requires a pane_id for those). Polling covers anything missed.
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

  function broadcast(event, data) {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(frame);
  }

  // ---------------------------------------------------------------- shared by the routes

  function identity(req) {
    const login = req.headers['tailscale-user-login'];
    if (login) return C.ALLOWED.includes(login) ? login : null;
    return C.ALLOW_LOCAL ? 'local' : null;
  }

  const findAgent = (pane) => local.agents.find((a) => a.pane === pane);
  const findTerminal = (pane) => local.terminals.find((t) => t.pane === pane);
  const findWorkspace = (id) => local.workspaces.find((w) => w.workspace_id === id);
  // An agent spec from the page, named after nameFrom when it comes without a name (lib/validate).
  const cleanAgentSpec = (spec, nameFrom) => cleanSpec(spec, nameFrom, local.agents.map((a) => a.name).filter(Boolean));

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

  // What the routes (lib/routes/*) read and call. The state that changes is read through getters.
  const hub = {
    API_VERSION,
    LIVE_API,
    HOST_ID,
    HOSTNAME,
    BUILD,
    config: C,
    env,
    herdr,
    push,
    peers,
    peerStore,
    clients,
    askHeld,
    lastChats,
    io,
    now,
    get local() {
      return local;
    },
    get state() {
      return state;
    },
    get peerList() {
      return peerList;
    },
    LIVE_IDLE_MS,
    buildNow,
    readScreen,
    refresh,
    refreshSoon,
    refreshAfterKeys,
    findAgent,
    findTerminal,
    findWorkspace,
    cleanAgentSpec,
    recentCwds,
    startAgent,
    setWsDir,
    setPeerList,
    peerView,
    decodePart,
  };

  function timeRequest(req, res, url) {
    const started = Date.now();
    watchdog.request(`${req.method} ${url.pathname}`);
    res.on('close', () => {
      const ms = Date.now() - started;
      if (ms > SLOW_REQUEST_MS && !LONG.test(url.pathname)) console.error(`${new Date().toISOString()} slow request ${req.method} ${url.pathname} ${ms}ms -> ${res.statusCode}`);
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = requestUrl(req.url);
    if (!url) return send(res, 400, { error: 'bad_url' });
    timeRequest(req, res, url);
    if (!hostAllowed(req.headers.host, C.HOST_RULE)) return send(res, 403, { error: 'bad_host' });
    if (!identity(req)) return send(res, 403, { error: 'forbidden' }, { 'Content-Type': 'text/plain; charset=utf-8' });
    try {
      if (url.pathname.startsWith('/api/')) await api(hub, req, res, url);
      else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(PUBLIC, req, res, url, SITE);
      else send(res, 405, { error: 'method_not_allowed' });
    } catch (err) {
      const status = err.status || (err instanceof herdr.HerdrError ? 502 : 500);
      if (!res.headersSent) send(res, status, { error: err.code || 'error', message: err.message });
      else res.end();
    }
  });

  // The shell's live channel (lib/routes/live.js): the same Host and login checks as a request.
  const live = liveUpgrade(hub, { requestUrl, hostAllowed: (h) => hostAllowed(h, C.HOST_RULE), identity });
  server.on('upgrade', live.upgrade);

  publish();
  timers.push(setInterval(refresh, POLL_MS));
  refresh();
  // A named event, not an SSE comment: the page can see it and tell a live stream from one that
  // iOS left looking open after suspending the app.
  timers.push(
    setInterval(() => {
      for (const res of clients) res.write(`event: ping\ndata: ${now()}\n\n`);
    }, 15000)
  );

  // Everything this hub started, stopped (a test's end; the process exits otherwise).
  function close() {
    for (const t of timers) clearInterval(t);
    clearTimeout(refreshTimer);
    clearTimeout(keysRefreshTimer);
    clearTimeout(ghostTimer);
    io.herdrAwake.stop();
    stream.stop();
    for (const p of peers.values()) p.stop();
    for (const res of clients) res.end();
    live.closeAll();
    return new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
  }
  // Stops what follows herdr and the peers, leaving the server (the process's SIGINT/SIGTERM).
  function stopFollowing() {
    stream.stop();
    for (const p of peers.values()) p.stop();
  }

  const listen = (host = env.HOST || '127.0.0.1', cb) => server.listen(PORT, host, cb);
  return { server, hub, listen, close, stopFollowing, port: PORT, config: C, peerStore, BUILD };
}

module.exports = { createServer, API_VERSION, LIVE_API, requestUrl, decodePart };
