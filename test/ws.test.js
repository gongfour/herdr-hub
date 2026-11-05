'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const ws = require('../lib/ws');

test('frame/parse: lengths of every size, masked and not, split anywhere', () => {
  for (const len of [0, 1, 125, 126, 127, 65535, 65536, 70000]) {
    for (const masked of [false, true]) {
      const payload = Buffer.alloc(len, 0x61 + (len % 26));
      const f = ws.frame(1, payload, masked);
      const whole = ws.parse(f);
      assert.equal(whole.frames.length, 1);
      assert.equal(whole.frames[0].opcode, 1);
      assert.equal(whole.frames[0].masked, masked);
      assert.ok(whole.frames[0].payload.equals(payload));
      assert.equal(whole.rest.length, 0);
      // A frame cut short waits for the rest.
      if (f.length > 1) assert.equal(ws.parse(f.subarray(0, f.length - 1)).frames.length, 0);
    }
  }
  // Two frames in one chunk, then half of a third.
  const a = ws.frame(1, Buffer.from('one'), true);
  const b = ws.frame(1, Buffer.from('two'), true);
  const c = ws.frame(1, Buffer.from('three'), true);
  const r = ws.parse(Buffer.concat([a, b, c.subarray(0, 3)]));
  assert.deepEqual(r.frames.map((x) => x.payload.toString()), ['one', 'two']);
  assert.equal(r.rest.length, 3);
});

test('parse: a frame past the size limit is refused', () => {
  assert.throws(() => ws.parse(ws.frame(1, Buffer.alloc(2000), true), { maxMessage: 1000 }), /too large/);
});

function serve(onConn) {
  const server = http.createServer((req, res) => res.end('plain'));
  server.on('upgrade', (req, socket, head) => {
    if (req.url === '/no') return ws.refuse(socket, 501, 'peer_no_live');
    const conn = ws.accept(req, socket, head);
    if (conn) onConn(conn, req);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test('accept/connect: messages both ways, unicode, a large one, a close from either side', async () => {
  const got = [];
  let serverConn;
  const server = await serve((conn) => {
    serverConn = conn;
    conn.on('message', (m) => {
      got.push(m);
      conn.send(`echo:${m}`);
    });
  });
  const { port } = server.address();
  const c = await ws.connect(`ws://127.0.0.1:${port}/x`, { headers: { 'X-Herdr-Hub': '1' } });
  const replies = [];
  c.on('message', (m) => replies.push(m));
  const big = '한'.repeat(40000);
  c.send('a');
  c.send('❯ ls');
  c.send(big);
  while (replies.length < 3) await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(got, ['a', '❯ ls', big]);
  assert.deepEqual(replies, ['echo:a', 'echo:❯ ls', `echo:${big}`]);
  const closed = new Promise((r) => serverConn.on('close', r));
  const clientClosed = new Promise((r) => c.on('close', r));
  c.close(1000, 'bye');
  assert.equal(await closed, 1000);
  assert.equal(await clientClosed, 1000);
  assert.equal(c.send('late'), false);
  server.close();
});

test('connect: a plain HTTP answer rejects with its status and error (an old peer)', async () => {
  const server = await serve(() => {});
  const { port } = server.address();
  await assert.rejects(ws.connect(`ws://127.0.0.1:${port}/no`), (err) => err.status === 501 && err.code === 'peer_no_live');
  server.close();
});

test('a server drops a client that sends unmasked frames', async () => {
  let closedWith = null;
  const server = await serve((conn) => conn.on('close', (code) => (closedWith = code)));
  const { port } = server.address();
  const c = await ws.connect(`ws://127.0.0.1:${port}/x`);
  c.socket.write(ws.frame(1, Buffer.from('bare'), false));
  while (closedWith == null) await new Promise((r) => setTimeout(r, 5));
  assert.equal(closedWith, 1002);
  server.close();
});

test('fragmented messages are put together; pings are answered', async () => {
  const got = [];
  const server = await serve((conn) => conn.on('message', (m) => got.push(m)));
  const { port } = server.address();
  const c = await ws.connect(`ws://127.0.0.1:${port}/x`);
  const part = (fin, opcode, text) => {
    const f = ws.frame(opcode, Buffer.from(text), true);
    if (!fin) f[0] &= 0x7f;
    return f;
  };
  c.socket.write(Buffer.concat([part(false, 1, 'hel'), part(false, 0, 'lo '), part(true, 0, 'there')]));
  const pong = new Promise((r) => c.on('pong', r));
  c.ping();
  await pong;
  while (!got.length) await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(got, ['hello there']);
  c.close();
  server.close();
});

test('a message in many empty fragments is closed at MAX_FRAGMENTS, without a quadratic stall', () => {
  const { EventEmitter } = require('events');
  const sock = Object.assign(new EventEmitter(), { setNoDelay() {}, write: () => true, end() {}, destroy() {}, destroyed: false });
  const c = new ws.Conn(sock, {});
  let closed = null;
  c.on('close', (code) => (closed = code));
  const part = (opcode) => {
    const f = ws.frame(opcode, Buffer.alloc(0), true);
    f[0] &= 0x7f; // not the last
    return f;
  };
  // 160k empty fragments (under 1 MB): summing the parts per frame took ~10 s of the main thread.
  const all = Buffer.concat([part(1), ...Array.from({ length: 160000 }, () => part(0))]);
  const t0 = performance.now();
  for (let i = 0; i < all.length; i += 65536) sock.emit('data', all.subarray(i, i + 65536));
  assert.ok(performance.now() - t0 < 1000, `took ${performance.now() - t0} ms`);
  assert.equal(closed, 1009);
});

test('connect: a plain HTTP answer whose body never ends rejects at the timeout', { timeout: 5000 }, async () => {
  const server = http.createServer();
  server.on('upgrade', (req, socket) => socket.write('HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{"err')); // and nothing more
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const t0 = Date.now();
  await assert.rejects(ws.connect(`ws://127.0.0.1:${server.address().port}/x`, { timeoutMs: 300 }), { code: 'timeout' });
  assert.ok(Date.now() - t0 < 2000);
  server.closeAllConnections?.();
  server.close();
});
