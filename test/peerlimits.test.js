'use strict';
// A broken or hostile peer against the hub (lib/peers.js, lib/routes/peers.js): what it may make
// the hub hold or serve. A fake peer (a plain HTTP server) answers each path its own way.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const zlib = require('zlib');
const { hubInProcess, until } = require('./fixtures/hub');
const { MAX_REPLY_BYTES } = require('../lib/peers');

async function fakePeer(t, routes) {
  const streams = new Set();
  let connects = 0;
  const server = http.createServer((req, res) => {
    if (req.url.split('?')[0] === '/api/stream') {
      connects++;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`event: state\ndata: ${JSON.stringify({ hostId: 'fk', hostLabel: 'fk', herdr: 'up', agents: [], terminals: [], workspaces: [] })}\n\n`);
      streams.add(res);
      req.on('close', () => streams.delete(res));
      return;
    }
    const fn = routes[req.url.replace(/\?.*$/, '')];
    if (fn) return fn(req, res);
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"error":"not_found"}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    for (const s of streams) s.destroy();
    server.close();
  });
  return { port: server.address().port, streams, connects: () => connects };
}

test('peer replies: only JSON and photos pass, sandboxed; oversized and bomb replies are refused', async (t) => {
  const peer = await fakePeer(t, {
    // A page with a script, said to be the host info: must not render on the hub's origin.
    '/api/host': (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<script>parent.alert(1)</script>');
    },
    '/api/uploads/20261110-120000-abcdef01.png': (req, res) => {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    },
    // Past the reply limit, sent as it comes.
    '/api/dirs': (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const chunk = Buffer.alloc(1 << 20, 0x20);
      let sent = 0;
      const more = () => {
        while (sent <= MAX_REPLY_BYTES + (1 << 20)) {
          sent += chunk.length;
          if (!res.write(chunk)) return res.once('drain', more);
        }
        res.end();
      };
      res.on('error', () => {});
      more();
    },
    // 100 KB that unpacks to 100 MB.
    '/api/recent': (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' });
      res.end(zlib.gzipSync(Buffer.alloc(100 << 20, 0x20)));
    },
  });
  const h = await hubInProcess(t, { id: 'hub', env: { HERDR_HUB_PEERS: `fk=http://127.0.0.1:${peer.port}` } });
  await until(async () => (await h.request('GET', '/api/state')).body.hosts.some((x) => x.id === 'fk' && x.online), 'peer online');

  const host = await h.request('GET', '/api/peers/fk/host');
  assert.equal(host.status, 200);
  assert.match(host.headers['content-type'], /^application\/json/);
  assert.equal(host.headers['x-content-type-options'], 'nosniff');
  assert.equal(host.headers['content-security-policy'], "sandbox; default-src 'none'");

  const png = await h.request('GET', '/api/peers/fk/uploads/20261110-120000-abcdef01.png');
  assert.equal(png.headers['content-type'], 'image/png');

  const big = await h.request('GET', '/api/peers/fk/dirs');
  assert.equal(big.status, 502);
  assert.match(big.body.message, /ETOOBIG/);
  const bomb = await h.request('GET', '/api/peers/fk/recent');
  assert.equal(bomb.status, 502);
  assert.match(bomb.body.message, /ETOOBIG/);
  // Still serving, the peer still there.
  assert.equal((await h.request('GET', '/api/peers/fk/host')).status, 200);
});

test('peer stream: an event past the limit drops the connection, which comes back', async (t) => {
  const peer = await fakePeer(t, {});
  const h = await hubInProcess(t, { id: 'hub2', env: { HERDR_HUB_PEERS: `fk=http://127.0.0.1:${peer.port}` } });
  await until(async () => (await h.request('GET', '/api/state')).body.hosts.some((x) => x.id === 'fk' && x.online), 'peer online');
  const before = peer.connects();
  // 17 MB of one event that never ends.
  const s = [...peer.streams][0];
  const chunk = 'x'.repeat(1 << 20);
  s.write('event: state\ndata: ');
  for (let i = 0; i < 17; i++) s.write(chunk);
  await until(() => peer.connects() > before, 'reconnected', 15000);
});
