'use strict';
// Static files (lib/http.js): caching, compression, HEAD, and the Host check. A real server on
// a free port over a temporary folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const { serveStatic, pickEncoding, parseHosts, hostAllowed } = require('../lib/http');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-hub-http-'));
const big = `/* ${'style rules '.repeat(400)} */`;
fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>x</title>');
fs.writeFileSync(path.join(root, 'style.css'), big);
fs.writeFileSync(path.join(root, 'icon.png'), Buffer.alloc(2000, 7));

let server;
let port;
test.before(async () => {
  server = http.createServer((req, res) => serveStatic(root, req, res, new URL(req.url, 'http://x')));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
test.after(() => {
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
});

function get(p, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('?v= files are cached for a year; the rest revalidate with an ETag and get a 304', async () => {
  const v = await get('/style.css?v=61');
  assert.equal(v.status, 200);
  assert.equal(v.headers['cache-control'], 'public, max-age=31536000, immutable');
  const page = await get('/');
  assert.equal(page.headers['cache-control'], 'no-cache');
  assert.match(page.headers.etag, /^W\/"[\w-]+"$/);
  const again = await get('/', { 'If-None-Match': page.headers.etag });
  assert.equal(again.status, 304);
  assert.equal(again.body.length, 0);
  assert.equal(again.headers.etag, page.headers.etag);
  assert.equal((await get('/', { 'If-None-Match': '"other", ' + page.headers.etag.slice(2) })).status, 304);
  assert.equal((await get('/', { 'If-None-Match': 'W/"nope"' })).status, 200);
});

test('a changed file gets a new ETag', async () => {
  const before = (await get('/index.html')).headers.etag;
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>y</title><!-- v=62 -->');
  const after = await get('/index.html', { 'If-None-Match': before });
  assert.equal(after.status, 200);
  assert.notEqual(after.headers.etag, before);
  assert.match(after.body.toString(), /v=62/);
});

test('text goes brotli or gzip when the browser takes it; images and small files as they are', async () => {
  const br = await get('/style.css?v=1', { 'Accept-Encoding': 'gzip, deflate, br' });
  assert.equal(br.headers['content-encoding'], 'br');
  assert.equal(br.headers.vary, 'Accept-Encoding');
  assert.equal(zlib.brotliDecompressSync(br.body).toString(), big);
  assert.ok(br.body.length < big.length / 5);
  const gz = await get('/style.css?v=1', { 'Accept-Encoding': 'gzip' });
  assert.equal(gz.headers['content-encoding'], 'gzip');
  assert.equal(zlib.gunzipSync(gz.body).toString(), big);
  const plain = await get('/style.css?v=1');
  assert.equal(plain.headers['content-encoding'], undefined);
  assert.equal(plain.body.toString(), big);
  assert.equal(Number(plain.headers['content-length']), Buffer.byteLength(big));
  const png = await get('/icon.png', { 'Accept-Encoding': 'gzip, br' });
  assert.equal(png.headers['content-encoding'], undefined);
  assert.equal(png.headers['content-type'], 'image/png');
});

test('HEAD: the same headers, no body; outside the folder is 404', async () => {
  const h = await get('/style.css?v=1', { 'Accept-Encoding': 'br' }, 'HEAD');
  assert.equal(h.status, 200);
  assert.equal(h.body.length, 0);
  assert.equal(h.headers['content-encoding'], 'br');
  assert.ok(Number(h.headers['content-length']) > 0);
  assert.equal((await get('/../package.json')).status, 404);
  assert.equal((await get('/%2e%2e/package.json')).status, 404);
  assert.equal((await get('/nope.js')).status, 404);
});

test('pickEncoding', () => {
  assert.equal(pickEncoding('gzip, deflate, br, zstd'), 'br');
  assert.equal(pickEncoding('gzip'), 'gzip');
  assert.equal(pickEncoding('br;q=0, gzip'), 'gzip');
  assert.equal(pickEncoding('*'), 'br');
  assert.equal(pickEncoding('identity'), null);
  assert.equal(pickEncoding(''), null);
  assert.equal(pickEncoding(undefined), null);
});

test('hostAllowed: the serve names, loopback only when listed, anything else refused', () => {
  const rule = { allowed: parseHosts(' desktop.ex.ts.net , server.ex.ts.net:8443,127.0.0.1:8797'), suffixes: [] };
  assert.equal(hostAllowed('desktop.ex.ts.net', rule), true);
  assert.equal(hostAllowed('DESKTOP.ex.ts.net:443', rule), true); // :443 is the same name
  assert.equal(hostAllowed('desktop.ex.ts.net:8443', rule), false);
  assert.equal(hostAllowed('server.ex.ts.net:8443', rule), true);
  assert.equal(hostAllowed('server.ex.ts.net', rule), false);
  assert.equal(hostAllowed('127.0.0.1:8797', rule), true);
  assert.equal(hostAllowed('127.0.0.1:8787', rule), false);
  assert.equal(hostAllowed('localhost:8797', rule), false);
  assert.equal(hostAllowed('evil.example:8787', rule), false); // a rebound domain keeps its own name
  assert.equal(hostAllowed('', rule), false);
  assert.equal(hostAllowed(undefined, rule), false);
  assert.equal(hostAllowed('desktop.ex.ts.net/x', rule), false);
  // Nothing configured: any *.ts.net name (a domain under it can't be rebound by anyone else).
  const any = { allowed: [], suffixes: ['.ts.net'] };
  assert.equal(hostAllowed('desktop.ex.ts.net', any), true);
  assert.equal(hostAllowed('server.ex.ts.net:8443', any), true);
  assert.equal(hostAllowed('ts.net', any), false);
  assert.equal(hostAllowed('evilts.net', any), false);
  assert.equal(hostAllowed('127.0.0.1:8787', any), false);
});
