'use strict';
// The hub's peer list, kept as data (data/peers.json: [{ id, url, label? }]) and edited from
// 설정 → 연결. HERDR_HUB_PEERS only seeds it the first time; after that the file wins. Plus the
// 연결 시험 that asks an address whether a Herdr Hub answers there, and what it says.
//
// Adding a peer makes the hub fetch an address someone typed, so: http(s) origins only (no path,
// query or login), no redirect is ever followed, short deadlines, a small reply cap. The hub
// itself is reachable from the tailnet only (tailscale serve), as everything else here.

const fs = require('fs');
const http = require('http');
const https = require('https');
const { ID, parsePeers } = require('./peers');

const LABEL_MAX = 40;
const MAX_PEERS = 16;

const fail = (code, message) => Object.assign(new Error(message || code), { status: 400, code });

// An address as typed -> its origin ("https://server.example.ts.net:8443"), or throws bad_url.
// A missing scheme means https (tailscale serve); a trailing slash is dropped; anything after the
// origin (a path, ?query, #hash), a login, or another scheme is refused.
function cleanUrl(input) {
  let s = typeof input === 'string' ? input.trim() : '';
  if (!s || s.length > 300 || /[\s\u0000-\u001f]/.test(s)) throw fail('bad_url');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  let u;
  try {
    u = new URL(s);
  } catch {
    throw fail('bad_url');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw fail('bad_url');
  if (u.username || u.password || u.search || u.hash || (u.pathname && u.pathname !== '/')) throw fail('bad_url');
  if (!u.hostname) throw fail('bad_url');
  return u.origin;
}

// A name to show, or '' for none (the peer's own name is used then).
function cleanName(input) {
  if (input == null || input === '') return '';
  if (typeof input !== 'string') throw fail('bad_label');
  const s = input.trim();
  if (s.length > LABEL_MAX || /[\u0000-\u001f\u007f<>]/.test(s)) throw fail('bad_label');
  return s;
}

// One entry to add: { id, url, label } checked against this hub and the list it joins.
function cleanPeer(body, { self, list }) {
  const b = body && typeof body === 'object' ? body : {};
  const id = typeof b.id === 'string' ? b.id.trim() : '';
  if (!ID.test(id) || id === 'all') throw fail('bad_host_id');
  if (id === self.id) throw fail('host_is_self');
  if (list.some((p) => p.id === id)) throw fail('host_id_taken');
  const url = cleanUrl(b.url);
  checkUrl(url, { self, list });
  if (list.length >= MAX_PEERS) throw fail('too_many_hosts');
  const label = cleanName(b.label);
  return label ? { id, url, label } : { id, url };
}

// An address already in the list, or this hub's own, can't be added again.
function checkUrl(url, { self, list, except = null }) {
  if ((self.urls || []).includes(url)) throw fail('host_is_self');
  if (list.some((p) => p.url === url && p.id !== except)) throw fail('host_url_taken');
}

// Keeps what makes sense of a file someone may have edited by hand; drops the rest (said in the log).
function sanitize(raw, self, log = () => {}) {
  const out = [];
  if (!Array.isArray(raw)) {
    if (raw != null) log('peers.json is not a list; starting empty');
    return out;
  }
  for (const item of raw) {
    try {
      out.push(cleanPeer(item, { self, list: out }));
    } catch (err) {
      log(`peers.json: skipped ${JSON.stringify(item)} (${err.code || err.message})`);
    }
  }
  return out;
}

// The list at start. The file when there is one; else the env var's peers, written to the file
// (the env var is a seed). manageable: this host is a hub, so 설정 → 연결 may change the list —
// it has a file or a seed. A peer (neither) shows the block read-only.
function load(file, envSpec, self, log = () => {}) {
  let text = null;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') log(`peers.json unreadable: ${err.message}`);
  }
  if (text != null) {
    let raw = null;
    try {
      raw = JSON.parse(text);
    } catch {
      log('peers.json is not JSON; starting empty (the file is kept as peers.json.bad)');
      try {
        fs.copyFileSync(file, `${file}.bad`);
      } catch {}
    }
    return { list: sanitize(raw, self, log), manageable: true, from: 'file' };
  }
  const seed = String(envSpec || '').trim();
  if (!seed) return { list: [], manageable: false, from: 'none' };
  const list = sanitize(parsePeers(seed), self, log);
  save(file, list);
  return { list, manageable: true, from: 'env' };
}

// Atomic: a crash halfway leaves the old file, never half of a new one.
function save(file, list) {
  const tmp = `${file}.tmp`;
  fs.mkdirSync(require('path').dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

// ---------------------------------------------------------------- 연결 시험

const TEST_MS = 5000;
const TEST_CAP = 64 * 1024;

// One GET with a deadline, no redirects (Node's http never follows them), a capped body.
// Resolves { status, type, location, body } or { error: code }.
function fetchOnce(origin, path, { timeoutMs = TEST_MS, headers = {} } = {}) {
  return new Promise((resolve) => {
    const u = new URL(path, origin);
    const mod = u.protocol === 'https:' ? https : http;
    let done = false;
    const end = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(v);
    };
    let req;
    const timer = setTimeout(() => {
      end({ error: 'ETIMEDOUT' });
      if (req) req.destroy();
    }, timeoutMs);
    try {
      req = mod.request(u, { method: 'GET', agent: false, headers: { Accept: 'application/json', ...headers } }, (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size > TEST_CAP) {
            res.destroy();
            return end({ status: res.statusCode, type: res.headers['content-type'] || '', location: res.headers.location || null, body: null, tooBig: true });
          }
          chunks.push(c);
        });
        res.on('end', () => end({ status: res.statusCode, type: res.headers['content-type'] || '', location: res.headers.location || null, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', (err) => end({ error: err.code || err.message }));
      });
      req.on('error', (err) => end({ error: err.code || err.message }));
      req.end();
    } catch (err) {
      end({ error: err.code || err.message });
    }
  });
}

const parse = (r) => {
  if (!r || !r.body || !/json/i.test(r.type || '')) return null;
  try {
    return JSON.parse(r.body);
  } catch {
    return null;
  }
};

const TLS = /^(ERR_TLS|ERR_SSL|CERT_|UNABLE_TO_|DEPTH_ZERO|SELF_SIGNED|EPROTO$|ERR_OSSL)/;

// What the two replies say (pure: the tests feed it made-up replies). version: /api/version's,
// host: /api/host's. -> { ok, code, ... } with code one of: ok, timeout, tls, dns, refused,
// unreachable, redirect, bad_host (403 Host not allowed there), forbidden (403 this login),
// http (another status), not_hub, self.
function classify(version, host, { selfId, hubApi } = {}) {
  const r = version || {};
  if (r.error) {
    const c = String(r.error);
    if (c === 'ETIMEDOUT' || c === 'ESOCKETTIMEDOUT') return { ok: false, code: 'timeout' };
    if (c === 'ENOTFOUND' || c === 'EAI_AGAIN' || c === 'EAI_NONAME') return { ok: false, code: 'dns' };
    if (c === 'ECONNREFUSED') return { ok: false, code: 'refused' };
    if (TLS.test(c)) return { ok: false, code: 'tls', detail: c };
    return { ok: false, code: 'unreachable', detail: c };
  }
  if (r.status >= 300 && r.status < 400) return { ok: false, code: 'redirect', status: r.status, location: r.location || null };
  const body = parse(r);
  if (r.status === 403) return { ok: false, code: body && body.error === 'bad_host' ? 'bad_host' : body && body.error === 'forbidden' ? 'forbidden' : 'http', status: 403 };
  if (r.status !== 200) return { ok: false, code: body && body.error ? 'http' : r.status >= 500 ? 'http' : 'not_hub', status: r.status };
  if (!body || typeof body.version !== 'string') return { ok: false, code: 'not_hub' };
  const h = (host && host.status === 200 && parse(host)) || {};
  const api = Number.isInteger(body.api) ? body.api : Number.isInteger(h.api) ? h.api : 0;
  const out = {
    ok: true,
    code: 'ok',
    id: typeof h.id === 'string' ? h.id : null,
    label: typeof h.label === 'string' ? h.label : null,
    herdr: typeof h.herdr === 'string' ? h.herdr : null,
    api,
    apiMatch: Number.isInteger(hubApi) ? api === hubApi : null,
    version: body.version + (body.dirty ? '+dirty' : ''),
    commit: typeof body.commit === 'string' ? body.commit : null,
  };
  if (selfId && out.id === selfId) return { ...out, ok: false, code: 'self' };
  return out;
}

// Asks url: /api/version, and /api/host when that answered as a Herdr Hub.
async function probe(url, { selfId, hubApi, timeoutMs = TEST_MS } = {}) {
  const origin = cleanUrl(url);
  const version = await fetchOnce(origin, '/api/version', { timeoutMs });
  let host = null;
  if (version.status === 200 && parse(version)) host = await fetchOnce(origin, '/api/host', { timeoutMs });
  return { url: origin, ...classify(version, host, { selfId, hubApi }) };
}

module.exports = { cleanUrl, cleanName, cleanPeer, checkUrl, sanitize, load, save, classify, probe, fetchOnce, MAX_PEERS, LABEL_MAX };
