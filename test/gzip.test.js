'use strict';
// API replies gzipped (lib/http.js send) and a peer's reply decoded or passed on (lib/peers.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const zlib = require('zlib');
const { send, sendEncoding, takesGzip } = require('../lib/http');
const { decodeBody } = require('../lib/peers');

const JSON_T = { 'Content-Type': 'application/json; charset=utf-8' };

test('gzip only for text of 1 KB or more, when the browser takes it', () => {
  assert.equal(sendEncoding('gzip, deflate, br', 5000, JSON_T), 'gzip');
  assert.equal(sendEncoding('br', 5000, JSON_T), null); // br only: not gzip
  assert.equal(sendEncoding('*', 5000, JSON_T), 'gzip');
  assert.equal(sendEncoding('gzip;q=0, br', 5000, JSON_T), null);
  assert.equal(sendEncoding('', 5000, JSON_T), null);
  assert.equal(sendEncoding('gzip', 1023, JSON_T), null);
  assert.equal(sendEncoding('gzip', 5000, { 'Content-Type': 'image/jpeg' }), null);
  assert.equal(sendEncoding('gzip', 5000, { 'Content-Type': 'text/plain; charset=utf-8' }), 'gzip');
  assert.equal(sendEncoding('gzip', 5000, { ...JSON_T, 'Content-Encoding': 'gzip' }), null); // already encoded
  assert.equal(takesGzip('deflate, gzip;q=0.5'), true);
  assert.equal(takesGzip('identity'), false);
});

function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}
function get(port, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/', headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('send(): a large JSON reply goes gzipped and labelled; small or not asked for, plain', async () => {
  const big = { messages: Array.from({ length: 200 }, (_, i) => ({ id: `m${i}`, text: '대화 내용 '.repeat(10) })) };
  let body = big;
  let extra = {};
  const server = await serve((req, res) => send(res, 200, body, extra));
  const { port } = server.address();
  try {
    let r = await get(port, { 'Accept-Encoding': 'gzip, br' });
    assert.equal(r.headers['content-encoding'], 'gzip');
    assert.equal(r.headers.vary, 'Accept-Encoding');
    assert.deepEqual(JSON.parse(zlib.gunzipSync(r.body)), big);
    assert.ok(r.body.length < JSON.stringify(big).length / 4);
    r = await get(port);
    assert.equal(r.headers['content-encoding'], undefined);
    assert.deepEqual(JSON.parse(r.body), big);
    body = { ok: true };
    r = await get(port, { 'Accept-Encoding': 'gzip' });
    assert.equal(r.headers['content-encoding'], undefined);
    assert.deepEqual(JSON.parse(r.body), { ok: true });
    // A peer's gzip passed on as it came: not compressed twice.
    const gz = zlib.gzipSync(JSON.stringify(big));
    body = gz;
    extra = { 'Content-Encoding': 'gzip' };
    r = await get(port, { 'Accept-Encoding': 'gzip' });
    assert.equal(r.headers['content-encoding'], 'gzip');
    assert.deepEqual(r.body, gz);
  } finally {
    server.close();
  }
});

test('a peer reply in any encoding comes out as plain bytes; gzip is kept for passing on', async () => {
  const plain = Buffer.from(JSON.stringify({ a: '한글'.repeat(300) }));
  assert.deepEqual(await decodeBody(plain, undefined), { body: plain, encoded: null });
  assert.deepEqual((await decodeBody(plain, 'identity')).body, plain);
  const gz = zlib.gzipSync(plain);
  const g = await decodeBody(gz, 'gzip');
  assert.deepEqual(g.body, plain);
  assert.deepEqual(g.encoded, { encoding: 'gzip', bytes: gz });
  assert.deepEqual(await decodeBody(zlib.brotliCompressSync(plain), 'br'), { body: plain, encoded: null });
  assert.deepEqual((await decodeBody(zlib.deflateSync(plain), 'deflate')).body, plain);
  await assert.rejects(decodeBody(plain, 'zstd'), /unknown content-encoding/);
});

// A gzip bomb: 64 KB that unpacks to far more than the limit is refused, not unpacked.
test('a peer reply that unpacks past the limit is refused', async () => {
  const bomb = zlib.gzipSync(Buffer.alloc(8 << 20));
  assert.ok(bomb.length < 64 << 10);
  await assert.rejects(decodeBody(bomb, 'gzip', 1 << 20), (err) => err.code === 'ETOOBIG');
  await assert.rejects(decodeBody(zlib.brotliCompressSync(Buffer.alloc(8 << 20)), 'br', 1 << 20), (err) => err.code === 'ETOOBIG');
  assert.equal((await decodeBody(bomb, 'gzip')).body.length, 8 << 20); // under the real limit: fine
});
