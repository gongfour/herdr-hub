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
const crypto = require('crypto');
const { serveStatic, indexPage, pickEncoding, parseHosts, hostAllowed } = require('../lib/http');

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

const hash8 = (file) => crypto.createHash('sha1').update(fs.readFileSync(path.join(root, file))).digest('hex').slice(0, 8);

test('?v=<its hash> is cached for a year; another ?v= gets the file as it is, revalidated', async () => {
  const v = await get(`/style.css?v=${hash8('style.css')}`);
  assert.equal(v.status, 200);
  assert.equal(v.headers['cache-control'], 'public, max-age=31536000, immutable');
  // A page from before a deploy (or a hand-made ?v=115): today's file, but not kept under that URL.
  const stale = await get('/style.css?v=115');
  assert.equal(stale.status, 200);
  assert.equal(stale.body.toString(), big);
  assert.equal(stale.headers['cache-control'], 'no-cache');
  assert.equal((await get('/style.css?v=115', { 'If-None-Match': stale.headers.etag })).status, 304);
});

test('the rest revalidate with an ETag and get a 304', async () => {
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

test('index.html: every local asset gets ?v=<its hash>; only a changed file a new one', async () => {
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-hub-site-'));
  const w = (f, body) => fs.writeFileSync(path.join(site, f), body);
  w('index.html', `<!doctype html><head><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/icon.svg?v=2"><link rel="stylesheet" href="/style.css"><script src="https://cdn.example/x.js"></script><script src="//cdn.example/y.js"></script></head><body><script src="/a.js" defer></script><script src="/b.js?v=115" defer></script><script src="/gone.js" defer></script><a href="/settings">x</a><!-- ${'padding '.repeat(80)} --></body>`);
  for (const f of ['a.js', 'b.js', 'style.css', 'icon.svg', 'manifest.webmanifest']) w(f, `/* ${f} */`);
  const srv = http.createServer((req, res) => serveStatic(site, req, res, new URL(req.url, 'http://x'), { decorate: (html, assets) => html.replace('</head>', `<meta name="assets" content="${assets}"></head>`) }));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const at = (p, headers = {}) =>
    new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: srv.address().port, path: p, headers }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      }).on('error', reject);
    });
  const h = (f) => crypto.createHash('sha1').update(fs.readFileSync(path.join(site, f))).digest('hex').slice(0, 8);
  try {
    const one = await at('/');
    const html = one.body.toString();
    assert.equal(one.headers['cache-control'], 'no-cache');
    assert.ok(html.includes(`src="/a.js?v=${h('a.js')}"`));
    assert.ok(html.includes(`src="/b.js?v=${h('b.js')}"`)); // a hand-written ?v= is replaced
    assert.ok(html.includes(`href="/style.css?v=${h('style.css')}"`));
    assert.ok(html.includes(`href="/icon.svg?v=${h('icon.svg')}"`));
    assert.ok(html.includes('href="/manifest.webmanifest"')); // an installed app may key on its URL
    assert.ok(html.includes('src="https://cdn.example/x.js"') && html.includes('src="//cdn.example/y.js"'));
    assert.ok(html.includes('src="/gone.js"') && html.includes('href="/settings"')); // not a file: as it was
    assert.match(html, /<meta name="assets" content="[0-9a-f]{12}"><\/head>/);
    assert.equal((await at('/index.html')).body.toString(), html);
    assert.equal((await at('/', { 'If-None-Match': one.headers.etag })).status, 304);
    // The asset itself, at the URL the page names: immutable, gzip, 304.
    const a = await at(`/a.js?v=${h('a.js')}`);
    assert.equal(a.headers['cache-control'], 'public, max-age=31536000, immutable');
    // One file changes: its URL and the page's ETag change, nothing else.
    const before = h('style.css');
    w('style.css', `/* ${'changed '.repeat(200)} */`);
    const two = await at('/', { 'If-None-Match': one.headers.etag, 'Accept-Encoding': 'gzip' });
    assert.equal(two.status, 200);
    assert.notEqual(two.headers.etag, one.headers.etag);
    assert.equal(two.headers['content-encoding'], 'gzip');
    const html2 = zlib.gunzipSync(two.body).toString();
    assert.ok(html2.includes(`href="/style.css?v=${h('style.css')}"`) && h('style.css') !== before);
    assert.equal(html2.replace(/style\.css\?v=\w+/, '').replace(/content="\w+"/, ''), html.replace(/style\.css\?v=\w+/, '').replace(/content="\w+"/, ''));
    // The old URL still brings the file (today's), only not to keep.
    const old = await at(`/style.css?v=${before}`);
    assert.equal(old.status, 200);
    assert.equal(old.headers['cache-control'], 'no-cache');
    assert.match(old.body.toString(), /changed/);
    assert.equal((await at('/', { 'If-None-Match': two.headers.etag })).status, 304);
    // HEAD of the page: the headers, no body.
    const head = await new Promise((resolve) => http.request({ host: '127.0.0.1', port: srv.address().port, path: '/', method: 'HEAD' }, resolve).end());
    assert.equal(head.statusCode, 200);
    assert.equal(head.headers.etag, two.headers.etag);
    assert.equal(indexPage(site, {}).assets.length, 12);
  } finally {
    srv.close();
    fs.rmSync(site, { recursive: true, force: true });
  }
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
