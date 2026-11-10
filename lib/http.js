'use strict';
// Small HTTP helpers for the hub (lib/hub.js, lib/routes/): JSON replies, request bodies, the static files, the Host check.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

// API replies: JSON (or a peer's reply passed on). A text reply of a few KB or more goes gzipped
// when the browser takes it: a 150-message transcript is 65–210 KB of JSON and about a fifth of
// that gzipped. Level 5: a 200 KB transcript in about 2 ms. Photos and anything already encoded
// go as they are. The live stream (/api/stream) writes its own headers and never comes here.
const GZIP_MIN = 1024;
const TEXTY = /^(?:application\/(?:json|[\w.+-]+\+json)|text\/)/i;
function sendEncoding(acceptEncoding, size, headers) {
  if (size < GZIP_MIN || headers['Content-Encoding'] || !TEXTY.test(headers['Content-Type'] || '')) return null;
  return takesGzip(acceptEncoding) ? 'gzip' : null; // gzip, not br: much quicker to make on the fly
}

function send(res, status, body, headers = {}) {
  let data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  const h = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers };
  const size = Buffer.byteLength(data);
  const enc = res.req && status !== 204 && status !== 304 ? sendEncoding(res.req.headers['accept-encoding'], size, h) : null;
  if (enc) {
    data = zlib.gzipSync(data, { level: 5 });
    h['Content-Encoding'] = enc;
  }
  if (enc || h['Content-Encoding']) h.Vary = 'Accept-Encoding';
  res.writeHead(status, h);
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
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
        // Every route reads fields off it: null, a number or a list would be a TypeError (500).
        if (!body || typeof body !== 'object' || Array.isArray(body)) return reject(Object.assign(new Error('the body must be a JSON object'), { status: 400, code: 'bad_body' }));
        resolve(body);
      } catch {
        reject(Object.assign(new Error('invalid JSON'), { status: 400 }));
      }
    });
  });
}

function readRaw(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('body too large'), { status: 413, code: 'body_too_large' }));
        req.resume();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.webmanifest', '.svg', '.json']);

// Each file once in memory: its bytes, a content hash (the ETag, and the ?v= index.html gives
// it), and its gzip and brotli forms. Reloaded when the file's size or mtime changes (a deploy).
const files = new Map(); // file -> { stamp, raw, hash, etag, gz, br }
function entryOf(raw, ext) {
  const hash = crypto.createHash('sha1').update(raw).digest('hex');
  // Weak: the same file goes out in three encodings.
  const entry = { raw, hash, etag: `W/"${Buffer.from(hash, 'hex').toString('base64url').slice(0, 20)}"`, gz: null, br: null };
  if (COMPRESSIBLE.has(ext) && raw.length >= 512) {
    entry.gz = zlib.gzipSync(raw, { level: 9 });
    entry.br = zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } });
  }
  return entry;
}
function loadFile(file, cb) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return cb(err || new Error('not a file'));
    const stamp = `${st.size}:${st.mtimeMs}`;
    const hit = files.get(file);
    if (hit && hit.stamp === stamp) return cb(null, hit);
    fs.readFile(file, (err2, raw) => {
      if (err2) return cb(err2);
      const entry = { stamp, ...entryOf(raw, path.extname(file)) };
      files.set(file, entry);
      cb(null, entry);
    });
  });
}
// The same, at once (index.html's assets, a few dozen stats); null when there is no such file.
function loadFileSync(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return null;
    const stamp = `${st.size}:${st.mtimeMs}`;
    const hit = files.get(file);
    if (hit && hit.stamp === stamp) return hit;
    const entry = { stamp, ...entryOf(fs.readFileSync(file), path.extname(file)) };
    files.set(file, entry);
    return entry;
  } catch {
    return null;
  }
}

// The file under root a URL path names, or null outside it.
function fileUnder(root, pathname) {
  const file = path.normalize(path.join(root, pathname === '/' ? 'index.html' : pathname.slice(1)));
  return file.startsWith(root + path.sep) ? file : null;
}

// index.html as served: every local src/href gets ?v=<the first 8 hex of the file's content hash>
// (whatever ?v= the file had is dropped), so only a changed file gets a new URL and is fetched
// again. The manifest keeps its plain URL: an installed app may key on it. decorate(html,
// assets) may add to the page; assets is one hash of index.html and every hash it refers to,
// what changes when any of them does. Made again only when that changes.
const ASSET_REF = /(\s(?:src|href)=")(\/(?!\/)[^"?#]*)(?:\?[^"#]*)?(")/g;
const pages = new Map(); // root -> { assets, entry }
const short = (hash) => hash.slice(0, 8);
// get(file) -> its entry or null: loadFileSync at start and in tests (indexPage), the files read
// asynchronously beforehand on a request (indexPageAsync: no blocking stat on that path).
function indexPage(root, { decorate } = {}) {
  return pageOf(root, decorate, loadFileSync);
}
const loadFileP = (file) => new Promise((resolve) => loadFile(file, (err, f) => resolve(err ? null : f)));
const refsIn = (root, raw) => [...new Set([...raw.toString('utf8').matchAll(ASSET_REF)].map((m) => m[2]).filter((p) => !p.endsWith('.webmanifest')).map((p) => fileUnder(root, p)).filter(Boolean))];
async function indexPageAsync(root, { decorate } = {}) {
  const index = path.join(root, 'index.html');
  const tpl = await loadFileP(index);
  if (!tpl) return null;
  const got = new Map([[index, tpl]]);
  await Promise.all(refsIn(root, tpl.raw).map(async (f) => got.set(f, await loadFileP(f))));
  return pageOf(root, decorate, (f) => got.get(f) || null);
}
function pageOf(root, decorate, get) {
  const tpl = get(path.join(root, 'index.html'));
  if (!tpl) return null;
  const refs = [];
  const html = tpl.raw.toString('utf8').replace(ASSET_REF, (m, pre, p, post) => {
    const file = !p.endsWith('.webmanifest') && fileUnder(root, p);
    const f = file && get(file);
    if (!f) return m;
    refs.push(`${p}:${short(f.hash)}`);
    return `${pre}${p}?v=${short(f.hash)}${post}`;
  });
  const assets = crypto.createHash('sha1').update(`${tpl.hash}\n${refs.join('\n')}`).digest('hex').slice(0, 12);
  const hit = pages.get(root);
  if (hit && hit.assets === assets && hit.decorate === decorate) return hit;
  const page = { assets, decorate, entry: entryOf(Buffer.from(decorate ? decorate(html, assets) : html), '.html') };
  pages.set(root, page);
  return page;
}

// The encoding to send for an Accept-Encoding header: br, gzip or none (identity).
function pickEncoding(accept) {
  const ok = accepts(accept);
  return ok('br') ? 'br' : ok('gzip') ? 'gzip' : null;
}
// Whether an Accept-Encoding header takes gzip.
const takesGzip = (accept) => accepts(accept)('gzip');
function accepts(accept) {
  const list = String(accept || '')
    .toLowerCase()
    .split(',')
    .map((part) => {
      const [name, ...params] = part.trim().split(';');
      const q = params.map((x) => /^\s*q=([\d.]+)/.exec(x)).find(Boolean);
      return { name: name.trim(), q: q ? Number(q[1]) : 1 };
    });
  return (name) => list.some((x) => (x.name === name || x.name === '*') && x.q > 0) && !list.some((x) => x.name === name && x.q === 0);
}

// If-None-Match against our ETag ("*", a list, weak or not).
const opaque = (t) => t.trim().replace(/^W\//, '');
const matches = (header, etag) => Boolean(header) && (header.trim() === '*' || header.split(',').some((t) => opaque(t) === opaque(etag)));

// Files under root only; / and /index.html are indexPage() above. GET and HEAD.
//   ?v=<its hash> (what index.html gives every asset): cached for a year, never revalidated.
//   Any other ?v= (a page from before a deploy asking for a file that has changed since) gets the
//   file as it is now, revalidated like the rest, so the old URL never keeps the wrong bytes.
//   anything else (index.html, sw.js, the manifest): revalidated every time, a 304 when unchanged.
// Text files go gzip or brotli compressed when the browser takes it.
function serveStatic(root, req, res, url, opts = {}) {
  const file = fileUnder(root, url.pathname);
  if (!file) return send(res, 404, { error: 'not_found' });
  if (file === path.join(root, 'index.html')) {
    return void indexPageAsync(root, opts).then((page) => (page ? sendFile(req, res, page.entry, '.html', false) : send(res, 404, { error: 'not_found' })));
  }
  loadFile(file, (err, f) => {
    if (err) return send(res, 404, { error: 'not_found' });
    sendFile(req, res, f, path.extname(file), url.searchParams.get('v') === short(f.hash));
  });
}
// A page's Content-Security-Policy: scripts only from this origin and the page's own inline
// <script> blocks (by hash), so markup that slipped through into the page (an event handler
// attribute, a javascript: link, an injected <script>) does not run; no plugins, no <base>, not
// framed. Nothing else is limited: the page asks peers' /api/version on other origins.
function cspOf(html) {
  const hashes = [...String(html).matchAll(/<script>([\s\S]*?)<\/script>/g)].map(([, body]) => `'sha256-${crypto.createHash('sha256').update(body).digest('base64')}'`);
  return [`script-src 'self'${hashes.map((h) => ` ${h}`).join('')}`, "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'"].join('; ');
}
function sendFile(req, res, f, ext, immutable) {
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    ETag: f.etag,
    'X-Content-Type-Options': 'nosniff',
  };
  if (ext === '.html') headers['Content-Security-Policy'] = f.csp || (f.csp = cspOf(f.raw));
  if (f.gz) headers.Vary = 'Accept-Encoding';
  if (matches(req.headers['if-none-match'], f.etag)) {
    res.writeHead(304, headers);
    return res.end();
  }
  const enc = f.gz ? pickEncoding(req.headers['accept-encoding']) : null;
  const body = enc === 'br' ? f.br : enc === 'gzip' ? f.gz : f.raw;
  if (enc) headers['Content-Encoding'] = enc;
  headers['Content-Length'] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

// The Host header against the names this Herdr Hub answers to: a page whose
// own domain was rebound to 127.0.0.1 still sends its own name, and is turned away. allowed:
// ['desktop.example.ts.net', 'server.example.ts.net:8443', ...]; a name without a port also
// matches :443. suffixes: name endings accepted with any port (the default: '.ts.net').
function parseHosts(spec) {
  return String(spec || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
function hostAllowed(host, { allowed = [], suffixes = [] } = {}) {
  const h = String(host || '').trim().toLowerCase();
  if (!h || !/^[a-z0-9.\-]+(?::\d{1,5})?$|^\[[0-9a-f:]+\](?::\d{1,5})?$/.test(h)) return false;
  const name = h.replace(/:\d+$/, '');
  if (allowed.includes(h) || (allowed.includes(name) && (h === name || h === `${name}:443`))) return true;
  return suffixes.some((s) => name.endsWith(s) && name.length > s.length);
}

// An Origin header -> itself when a page there may read this reply (CORS), else null: https and a
// name under one of suffixes (this tailnet), or http(s) on loopback when local. Nothing else, and
// never "*". Used for /api/version only, which carries build info and nothing private.
function corsOrigin(origin, { suffixes = [], local = false } = {}) {
  let u;
  try {
    u = new URL(String(origin || ''));
  } catch {
    return null;
  }
  if (u.origin !== origin) return null; // a path, a login: not an Origin header
  const name = u.hostname.toLowerCase();
  if (local && (u.protocol === 'http:' || u.protocol === 'https:') && ['127.0.0.1', 'localhost', '[::1]'].includes(name)) return origin;
  if (u.protocol !== 'https:') return null;
  return suffixes.some((s) => s && name.endsWith(s) && name.length > s.length) ? origin : null;
}

module.exports = { cspOf, corsOrigin, indexPage, indexPageAsync, send, sendEncoding, takesGzip, readJson, readRaw, serveStatic, pickEncoding, parseHosts, hostAllowed };
