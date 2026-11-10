'use strict';
// Peers: other Herdr Hub instances a hub merges into its own view. Each peer is
// followed through its /api/stream (SSE); per-host requests are forwarded to it.
// A peer is often a laptop that sleeps, so every network step has a deadline and
// a lost stream only turns into "offline" after a short grace period. An offline peer keeps its
// last state as a ghost: listed greyed "as of" when it was last heard (staleView), not acted on,
// until its stream brings the live one back. Ghosts outlive a hub restart (dumpGhosts/loadGhosts).

const { EventEmitter } = require('events');
const http = require('http');
const https = require('https');
const zlib = require('zlib');

const ID = /^[a-z][a-z0-9-]{0,31}$/;
const CONNECT_MS = 10000; // until response headers arrive
const IDLE_MS = 50000; // peers send a ping event every 15 s
const GRACE_MS = 6000; // a dropped stream that comes back within this stays "online"
const MAX_BACKOFF_MS = 30000;
// What a peer may send: a reply as it comes over the wire, the same decoded (gzip, br, deflate),
// and one event of its stream. The largest real ones are a photo (10 MB) and a chat window (a
// few MB); past these the reply is refused and the stream reconnects, so a broken or hostile peer
// can't fill the hub's memory or hold its thread (decoding is async and stops at the limit).
const MAX_REPLY_BYTES = 32 << 20;
const MAX_DECODED_BYTES = 64 << 20;
const MAX_FRAME_BYTES = 16 << 20;
const tooBig = (what) => Object.assign(new Error(`${what} too large`), { code: 'ETOOBIG' });

// "server=https://server.example.ts.net:8443,other=https://…"
function parsePeers(spec) {
  const out = [];
  for (const item of String(spec || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const eq = item.indexOf('=');
    const id = item.slice(0, eq).trim();
    const url = item.slice(eq + 1).trim().replace(/\/+$/, '');
    if (eq < 1 || !ID.test(id) || !/^https?:\/\/[^/]+$/.test(url)) throw new Error(`bad HERDR_HUB_PEERS entry: ${item}`);
    out.push({ id, url });
  }
  return out;
}

class Peer extends EventEmitter {
  constructor({ id, url, label = '' }) {
    super();
    this.id = id;
    this.url = url;
    this.label = id; // what the peer calls itself (its stream's hostLabel)
    this.name = label || ''; // what the hub's list calls it (설정 → 연결 이름 바꾸기); wins when set
    this.online = false;
    this.state = null; // the peer's last /api/state, its own items only; kept while offline
    this.stateAt = null; // when the stream last said it (a state or a ping): an offline peer's items are "as of" this
    this.build = null; // { api, version } from the stream's first message
    this.error = 'connecting';
    this.since = Date.now(); // last online/offline transition
    this.stopped = false;
    this.backoff = 1000;
    this.conn = null; // token of the current stream attempt
    this.req = null;
    this.retry = null;
    const Agent = /^https:/.test(url) ? https.Agent : http.Agent;
    this.agent = new Agent({ keepAlive: true, maxSockets: 8, keepAliveMsecs: 15000 });
    this.offlineTimer = null;
  }

  info() {
    // api/version: what the peer's stream said it runs (0 and '' from a peer before 1.0).
    const b = this.online ? this.build : null;
    return { id: this.id, label: this.shown(), url: this.url, local: false, online: this.online, herdr: this.online && this.state ? this.state.herdr : 'offline', error: this.online ? null : this.error, since: this.since, api: b ? b.api : null, version: b ? b.version : null, staleAt: this.online || !this.state ? null : this.stateAt };
  }

  // What the hub's merged view lists of this peer: its live state, or offline its last one as a
  // ghost (staleView), or nothing when it has never been heard.
  view() {
    if (!this.state) return null;
    return this.online ? this.state : staleView(this.state, this.stateAt);
  }

  // A ghost from before a restart (loadGhosts): shown until the stream brings the live state.
  restore(g) {
    if (this.state || !g || !g.state) return;
    this.state = g.state;
    this.stateAt = g.at;
    this.since = g.at; // offline from about then, as far as this hub knows
    if (g.label) this.label = g.label;
  }

  // The name everyone sees: the hub's own for it, else the peer's.
  shown() {
    return this.name || this.label;
  }

  start() {
    this.connect();
    return this;
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retry);
    clearTimeout(this.offlineTimer);
    if (this.req) this.req.destroy();
    this.agent.destroy();
  }

  setOnline(online, error = null) {
    clearTimeout(this.offlineTimer);
    this.offlineTimer = null;
    this.error = error;
    if (online === this.online) return;
    this.online = online;
    this.since = Date.now();
    console.log(`${new Date().toISOString()} peer ${this.id} ${online ? 'online' : `offline (${error})`}`);
    this.emit('change');
  }

  // One request on Node's http(s) module. The stream gets its own connection (agent: false)
  // and requests use a separate keep-alive pool, so a long-lived stream can never hold
  // up a forwarded request. Returns the request and a promise of its response (body unread).
  open(method, pathAndQuery, { headers = {}, body = null, agent }) {
    const u = new URL(pathAndQuery, this.url);
    const mod = u.protocol === 'https:' ? https : http;
    let req;
    const response = new Promise((resolve, reject) => {
      req = mod.request(u, { method, headers: body ? { ...headers, 'Content-Length': body.length } : headers, agent }, resolve);
      req.on('error', reject);
    });
    req.end(body || undefined);
    return { req, response };
  }

  async connect() {
    if (this.stopped) return;
    const token = {};
    this.conn = token;
    let req = null;
    let res = null;
    let watchdog = null;
    let reason = 'stream ended';
    const fail = (why) => {
      reason = why;
      if (req) req.destroy(new Error(why));
    };
    const kick = (ms) => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => fail(ms === CONNECT_MS ? 'connect timeout' : 'stream idle'), ms);
    };
    try {
      kick(CONNECT_MS);
      const o = this.open('GET', '/api/stream', { headers: { Accept: 'text/event-stream' }, agent: false });
      req = o.req;
      this.req = req;
      res = await o.response;
      if (res.statusCode !== 200) {
        res.resume();
        throw new Error(`HTTP ${res.statusCode}`);
      }
      kick(IDLE_MS);
      res.setEncoding('utf8');
      let buf = '';
      await new Promise((resolve, reject) => {
        res.on('data', (chunk) => {
          kick(IDLE_MS);
          if (this.online && this.state) this.stateAt = Date.now(); // heard (a ping too): still so as of now
          buf += chunk;
          if (buf.length > MAX_FRAME_BYTES) return reject(tooBig('stream event'));
          let end;
          while ((end = buf.indexOf('\n\n')) >= 0) {
            this.frame(buf.slice(0, end));
            buf = buf.slice(end + 2);
          }
        });
        res.on('end', resolve);
        res.on('close', resolve);
        res.on('error', reject);
        req.on('error', reject);
      });
    } catch (err) {
      if (reason === 'stream ended') reason = err.code || err.message;
    } finally {
      clearTimeout(watchdog);
      if (req) req.destroy();
    }
    if (this.stopped || this.conn !== token) return;
    this.conn = null;
    this.req = null;
    this.error = reason;
    let wait = this.backoff;
    if (this.online) {
      // Stay "online" through a quick reconnect; go offline if it does not come back.
      if (!this.offlineTimer) this.offlineTimer = setTimeout(() => this.setOnline(false, this.error), GRACE_MS);
      wait = 1000;
    } else this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    this.retry = setTimeout(() => this.connect(), wait);
  }

  frame(text) {
    let event = 'message';
    let data = '';
    for (const line of text.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (event === 'version' && data) return this.version(data);
    if (event !== 'state' || !data) return;
    let s;
    try {
      s = JSON.parse(data);
    } catch {
      return;
    }
    // Only the peer's own items: a misconfigured peer that is itself a hub must not loop.
    const own = (x) => !s.hostId || !x.host || x.host === s.hostId;
    this.label = s.hostLabel || s.host || this.id;
    this.state = {
      herdr: s.herdr,
      agents: (s.agents || []).filter(own),
      terminals: (s.terminals || []).filter(own),
      workspaces: (s.workspaces || []).filter(own),
    };
    this.stateAt = Date.now();
    this.backoff = 1000;
    if (this.online) {
      clearTimeout(this.offlineTimer);
      this.offlineTimer = null;
      this.error = null;
      this.emit('change');
    } else this.setOnline(true);
  }

  // The stream's first message: the peer's build and API version (a peer before 1.0 sends only
  // { v }: API 0). Comes before the state, so the hub's view picks it up with that.
  version(data) {
    let d;
    try {
      d = JSON.parse(data);
    } catch {
      return;
    }
    this.build = { api: Number.isInteger(d.api) ? d.api : 0, version: typeof d.version === 'string' ? d.version + (d.dirty ? '+dirty' : '') : '' };
    if (this.online) this.emit('change');
  }

  // Forward one API request. Resolves { status, body, type, cache, encoded } with the peer's reply;
  // body is a Buffer, so images pass through unchanged. The peer is asked for gzip (a transcript
  // crosses Tailscale at a fifth of its size); body is always the decoded bytes, and encoded is
  // { encoding: 'gzip', bytes } as it came, for passing on to a browser that takes gzip too.
  // A GET is retried once when a reused keep-alive socket turns out to be dead.
  async request(method, pathAndQuery, opts = {}) {
    try {
      return await this.requestOnce(method, pathAndQuery, opts);
    } catch (err) {
      if (method !== 'GET' || err.timeout || !['ECONNRESET', 'EPIPE'].includes(err.code)) throw err;
      return this.requestOnce(method, pathAndQuery, opts);
    }
  }

  async requestOnce(method, pathAndQuery, { body = null, headers = {}, timeoutMs = 60000 } = {}) {
    let req = null;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (req) req.destroy(new Error('timeout'));
    }, timeoutMs);
    try {
      const o = this.open(method, pathAndQuery, { headers: { Accept: 'application/json', 'Accept-Encoding': 'gzip', ...headers }, body: body && body.length ? body : null, agent: this.agent });
      req = o.req;
      const res = await o.response;
      const chunks = [];
      let size = 0;
      await new Promise((resolve, reject) => {
        res.on('data', (c) => {
          size += c.length;
          if (size > MAX_REPLY_BYTES) {
            reject(tooBig('reply'));
            req.destroy();
            return;
          }
          chunks.push(c);
        });
        res.on('end', resolve);
        res.on('error', reject);
        res.on('aborted', () => reject(Object.assign(new Error('aborted'), { code: 'ECONNRESET' })));
      });
      const raw = Buffer.concat(chunks);
      const { body: decoded, encoded } = await decodeBody(raw, res.headers['content-encoding']);
      return { status: res.statusCode, body: decoded, encoded, type: res.headers['content-type'] || 'application/json; charset=utf-8', cache: res.headers['cache-control'] || null };
    } catch (err) {
      if (timedOut) throw Object.assign(new Error(`timed out after ${timeoutMs} ms`), { code: 'ETIMEDOUT', timeout: true });
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

// A reply body as the peer sent it -> its plain bytes, and the gzip form kept when it came so.
// Whatever the peer chose (an older peer sends identity; br or deflate are decoded too); an
// encoding it can't read is an error, not bytes passed on mislabelled.
// Async (off the main thread) and bounded: a small reply that unpacks past MAX_DECODED_BYTES (a
// gzip bomb) is an error, not a full memory.
const unpack = (fn, raw, max) =>
  new Promise((resolve, reject) =>
    fn(raw, { maxOutputLength: max }, (err, out) => (err ? reject(err.code === 'ERR_BUFFER_TOO_LARGE' || /too large|maxOutputLength/i.test(err.message) ? tooBig('decoded reply') : err) : resolve(out)))
  );
async function decodeBody(raw, contentEncoding, max = MAX_DECODED_BYTES) {
  const enc = String(contentEncoding || '').trim().toLowerCase();
  if (!enc || enc === 'identity') return { body: raw, encoded: null };
  if (enc === 'gzip' || enc === 'x-gzip') return { body: await unpack(zlib.gunzip, raw, max), encoded: { encoding: 'gzip', bytes: raw } };
  if (enc === 'br') return { body: await unpack(zlib.brotliDecompress, raw, max), encoded: null };
  if (enc === 'deflate') return { body: await unpack(zlib.inflate, raw, max), encoded: null };
  throw Object.assign(new Error(`unknown content-encoding ${enc}`), { code: 'EBADENCODING' });
}

// An offline peer's last state as the hub lists it: every item carries stale (when it was last
// heard), and an agent's status is 'stale' with the last one it had in lastStatus. Nothing counts,
// sorts or notifies a stale agent as working or waiting (답 필요 counts, the badge, unread, the
// answer path all look for the live statuses), and its row is drawn greyed (list.js).
function staleView(s, at) {
  const mark = (x) => ({ ...x, stale: at });
  return {
    herdr: s.herdr,
    agents: (s.agents || []).map((a) => ({ ...a, status: 'stale', lastStatus: a.status, stale: at })),
    terminals: (s.terminals || []).map(mark),
    workspaces: (s.workspaces || []).map(mark),
  };
}

// The ghosts in data/ (lib/hub.js): each peer's last state, so a hub restarted while a peer sleeps
// (a deploy) still lists what was there. Older than maxAgeMs, or of a peer no longer listed, they go.
const GHOST_MAX_MS = 3 * 86400e3;
function dumpGhosts(peers) {
  const out = {};
  for (const p of peers) if (p.state && p.stateAt) out[p.id] = { at: p.stateAt, label: p.label, url: p.url, state: p.state };
  return out;
}
function loadGhosts(data, peers, now, maxAgeMs = GHOST_MAX_MS) {
  if (!data || typeof data !== 'object') return 0;
  let n = 0;
  for (const p of peers) {
    const g = data[p.id];
    if (!g || g.url !== p.url || typeof g.at !== 'number' || now - g.at > maxAgeMs || !g.state || !Array.isArray(g.state.agents)) continue;
    p.restore(g);
    n++;
  }
  return n;
}

module.exports = { Peer, parsePeers, decodeBody, staleView, dumpGhosts, loadGhosts, ID, MAX_REPLY_BYTES, MAX_FRAME_BYTES };
