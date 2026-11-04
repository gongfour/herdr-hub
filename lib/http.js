'use strict';
// Small HTTP helpers for server.js: JSON replies, request bodies, the static files, the Host check.

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
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
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

// Each file once in memory: its bytes, a content hash for the ETag, and its gzip and brotli
// forms, made on first use. Reloaded when the file's size or mtime changes (a deploy).
const files = new Map(); // file -> { stamp, raw, etag, gz, br }
function loadFile(file, cb) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return cb(err || new Error('not a file'));
    const stamp = `${st.size}:${st.mtimeMs}`;
    const hit = files.get(file);
    if (hit && hit.stamp === stamp) return cb(null, hit);
    fs.readFile(file, (err2, raw) => {
      if (err2) return cb(err2);
      // Weak: the same file goes out in three encodings.
      const etag = `W/"${crypto.createHash('sha1').update(raw).digest('base64url').slice(0, 20)}"`;
      const entry = { stamp, raw, etag, gz: null, br: null };
      if (COMPRESSIBLE.has(path.extname(file)) && raw.length >= 512) {
        entry.gz = zlib.gzipSync(raw, { level: 9 });
        entry.br = zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } });
      }
      files.set(file, entry);
      cb(null, entry);
    });
  });
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

// Files under root only; / is index.html. GET and HEAD.
//   ?v=<n> (index.html versions every asset that way): cached for a year, never revalidated; a
//   deploy bumps ?v= so the new index.html asks for new URLs.
//   anything else (index.html, sw.js, the manifest): revalidated every time, a 304 when unchanged.
// Text files go gzip or brotli compressed when the browser takes it.
function serveStatic(root, req, res, url) {
  const pathname = url.pathname;
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root + path.sep)) return send(res, 404, { error: 'not_found' });
  loadFile(file, (err, f) => {
    if (err) return send(res, 404, { error: 'not_found' });
    const versioned = url.searchParams.has('v');
    const headers = {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': versioned ? 'public, max-age=31536000, immutable' : 'no-cache',
      ETag: f.etag,
      'X-Content-Type-Options': 'nosniff',
    };
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
  });
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

// The app version this host serves: the ?v= of app.js in its index.html (public/update.js),
// read again when the file changes on disk. '' when there is none.
const { versionOf } = require('../public/update.js');
let versionCache = { stamp: '', v: '' };
function appVersion(dir) {
  const file = path.join(dir, 'index.html');
  try {
    const st = fs.statSync(file);
    const stamp = `${file}:${st.size}:${st.mtimeMs}`;
    if (versionCache.stamp !== stamp) versionCache = { stamp, v: versionOf(fs.readFileSync(file, 'utf8')) };
    return versionCache.v;
  } catch {
    return '';
  }
}

module.exports = { appVersion, send, sendEncoding, takesGzip, readJson, readRaw, serveStatic, pickEncoding, parseHosts, hostAllowed };
