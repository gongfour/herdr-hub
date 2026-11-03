'use strict';
// Peers: other Herdr Hub instances a hub merges into its own view. Each peer is
// followed through its /api/stream (SSE); per-host requests are forwarded to it.
// A peer is often a laptop that sleeps, so every network step has a deadline and
// a lost stream only turns into "offline" after a short grace period.

const { EventEmitter } = require('events');
const http = require('http');
const https = require('https');

const ID = /^[a-z][a-z0-9-]{0,31}$/;
const CONNECT_MS = 10000; // until response headers arrive
const IDLE_MS = 50000; // peers send a ping event every 15 s
const GRACE_MS = 6000; // a dropped stream that comes back within this stays "online"
const MAX_BACKOFF_MS = 30000;

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
  constructor({ id, url }) {
    super();
    this.id = id;
    this.url = url;
    this.label = id;
    this.online = false;
    this.state = null; // the peer's last /api/state, its own items only
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
    return { id: this.id, label: this.label, local: false, online: this.online, herdr: this.online && this.state ? this.state.herdr : 'offline', error: this.online ? null : this.error, since: this.since };
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
    if (!online) this.state = null;
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
          buf += chunk;
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
    this.backoff = 1000;
    if (this.online) {
      clearTimeout(this.offlineTimer);
      this.offlineTimer = null;
      this.error = null;
      this.emit('change');
    } else this.setOnline(true);
  }

  // Forward one API request. Resolves { status, body, type, cache } with the peer's reply;
  // body is a Buffer, so images pass through unchanged.
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
      const o = this.open(method, pathAndQuery, { headers: { Accept: 'application/json', ...headers }, body: body && body.length ? body : null, agent: this.agent });
      req = o.req;
      const res = await o.response;
      const chunks = [];
      await new Promise((resolve, reject) => {
        res.on('data', (c) => chunks.push(c));
        res.on('end', resolve);
        res.on('error', reject);
        res.on('aborted', () => reject(Object.assign(new Error('aborted'), { code: 'ECONNRESET' })));
      });
      return { status: res.statusCode, body: Buffer.concat(chunks), type: res.headers['content-type'] || 'application/json; charset=utf-8', cache: res.headers['cache-control'] || null };
    } catch (err) {
      if (timedOut) throw Object.assign(new Error(`timed out after ${timeoutMs} ms`), { code: 'ETIMEDOUT', timeout: true });
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = { Peer, parsePeers, ID };
