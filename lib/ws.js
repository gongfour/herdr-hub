'use strict';
// A small WebSocket (RFC 6455) for the shell's live channel: text messages only, no extensions.
// The server side takes an http 'upgrade'; the client side is the hub's leg to a peer. Node 20
// has no WebSocket server, and a dependency would have to be installed on both hosts.
//
// Conn: send(text), close(code, reason), on('message', text), on('close', code). Pings from the
// other end are answered; ping() sends one (the client side of a dead link only finds out by
// writing, so each end sends its own heartbeat, see lib/live.js).

const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 1 << 20; // a key frame is tens of bytes; a screen, tens of KB
const MAX_FRAGMENTS = 1024; // frames in one message (ours send one); many empty ones are only work
const acceptFor = (key) => crypto.createHash('sha1').update(key + GUID).digest('base64');

// One frame: FIN set, the payload masked when we are the client (the RFC requires it).
function frame(opcode, payload, masked) {
  const len = payload.length;
  const head = len < 126 ? 2 : len < 65536 ? 4 : 10;
  const buf = Buffer.allocUnsafe(head + (masked ? 4 : 0) + len);
  buf[0] = 0x80 | opcode;
  if (len < 126) buf[1] = len;
  else if (len < 65536) (buf[1] = 126), buf.writeUInt16BE(len, 2);
  else (buf[1] = 127), buf.writeBigUInt64BE(BigInt(len), 2);
  if (masked) {
    buf[1] |= 0x80;
    const mask = crypto.randomBytes(4);
    mask.copy(buf, head);
    for (let i = 0; i < len; i++) buf[head + 4 + i] = payload[i] ^ mask[i & 3];
  } else payload.copy(buf, head);
  return buf;
}

// Frames out of a growing buffer. Returns { frames: [{ fin, opcode, payload }], rest } or throws
// on a frame no peer of ours would send (too big, a 64-bit length past 2^53).
function parse(buf, { maxMessage = MAX_MESSAGE } = {}) {
  const frames = [];
  let at = 0;
  for (;;) {
    if (buf.length - at < 2) break;
    const b0 = buf[at];
    const b1 = buf[at + 1];
    let len = b1 & 0x7f;
    let p = at + 2;
    if (len === 126) {
      if (buf.length - p < 2) break;
      len = buf.readUInt16BE(p);
      p += 2;
    } else if (len === 127) {
      if (buf.length - p < 8) break;
      const big = buf.readBigUInt64BE(p);
      if (big > BigInt(maxMessage)) throw Object.assign(new Error('frame too large'), { code: 1009 });
      len = Number(big);
      p += 8;
    }
    if (len > maxMessage) throw Object.assign(new Error('frame too large'), { code: 1009 });
    const masked = Boolean(b1 & 0x80);
    if (buf.length - p < (masked ? 4 : 0) + len) break;
    let payload;
    if (masked) {
      const mask = buf.subarray(p, p + 4);
      p += 4;
      payload = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) payload[i] = buf[p + i] ^ mask[i & 3];
    } else payload = Buffer.from(buf.subarray(p, p + len));
    frames.push({ fin: Boolean(b0 & 0x80), opcode: b0 & 0x0f, payload, masked });
    at = p + len;
  }
  return { frames, rest: at ? buf.subarray(at) : buf };
}

class Conn extends EventEmitter {
  constructor(socket, { client = false, head = null, maxMessage = MAX_MESSAGE } = {}) {
    super();
    this.socket = socket;
    this.client = client; // a client masks what it sends; a server expects masked frames
    this.maxMessage = maxMessage;
    this.open = true;
    this.closed = false;
    this.bytesIn = 0;
    this.bytesOut = 0;
    this.buf = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
    this.parts = null; // a fragmented message being put together
    this.heardAt = Date.now(); // the last bytes from the other end (keepalive)
    this.alive = null;
    socket.setNoDelay(true);
    socket.on('data', (d) => this.data(d));
    socket.on('error', () => this.finish(1006));
    socket.on('close', () => this.finish(1006));
    if (this.buf.length) setImmediate(() => this.data(Buffer.alloc(0)));
  }
  data(d) {
    if (this.closed) return;
    this.bytesIn += d.length;
    this.heardAt = Date.now();
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    let r;
    try {
      r = parse(this.buf, { maxMessage: this.maxMessage });
    } catch (err) {
      return this.close(err.code || 1002, 'bad frame');
    }
    this.buf = r.rest;
    for (const f of r.frames) {
      if (this.closed) return;
      if (f.masked === this.client) return this.close(1002, 'mask');
      if (f.opcode === 8) {
        const code = f.payload.length >= 2 ? f.payload.readUInt16BE(0) : 1005;
        if (this.open) this.write(8, f.payload.subarray(0, 2));
        this.open = false;
        this.socket.end();
        return this.finish(code);
      }
      if (f.opcode === 9) this.write(10, f.payload);
      else if (f.opcode === 10) this.emit('pong');
      else if (f.opcode === 1 || f.opcode === 2 || f.opcode === 0) {
        if (f.opcode !== 0) (this.parts = []), (this.partsLen = 0);
        if (!this.parts) return this.close(1002, 'continuation');
        this.parts.push(f.payload);
        this.partsLen += f.payload.length;
        if (this.partsLen > this.maxMessage || this.parts.length > MAX_FRAGMENTS) return this.close(1009, 'too large');
        if (f.fin) {
          const msg = Buffer.concat(this.parts, this.partsLen).toString('utf8');
          this.parts = null;
          this.emit('message', msg);
        }
      }
    }
  }
  write(opcode, payload) {
    if (!this.open || this.socket.destroyed) return false;
    const f = frame(opcode, payload, this.client);
    this.bytesOut += f.length;
    return this.socket.write(f);
  }
  send(text) {
    return this.write(1, Buffer.from(String(text), 'utf8'));
  }
  ping() {
    return this.write(9, Buffer.alloc(0));
  }
  // A link that died without a close (a phone that left the Wi-Fi, a tailnet path gone): a ping
  // every everyMs (browsers and Conn answer it by themselves), and a close when nothing at all
  // came back for deadMs. Without it the session behind the channel goes on until TCP gives up.
  keepalive(everyMs = 15000, deadMs = 45000) {
    clearInterval(this.alive);
    this.alive = setInterval(() => {
      if (Date.now() - this.heardAt > deadMs) return this.close(1001, 'silent');
      this.ping();
    }, everyMs);
    this.alive.unref && this.alive.unref();
    return this;
  }
  // What is still waiting to go out on the socket (backpressure).
  get buffered() {
    return this.socket.writableLength || 0;
  }
  close(code = 1000, reason = '') {
    if (!this.open) return;
    const r = Buffer.from(String(reason).slice(0, 100), 'utf8');
    const p = Buffer.allocUnsafe(2 + r.length);
    p.writeUInt16BE(code, 0);
    r.copy(p, 2);
    this.write(8, p);
    this.open = false;
    this.socket.end();
    // A peer that never answers the close: the socket goes anyway.
    setTimeout(() => this.socket.destroy(), 2000).unref();
    this.finish(code);
  }
  finish(code) {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    clearInterval(this.alive);
    if (!this.socket.destroyed) setTimeout(() => this.socket.destroy(), 2000).unref();
    this.emit('close', code);
  }
}

// Is this request a WebSocket upgrade we can take? Returns the key or null.
function upgradeKey(req) {
  const up = String(req.headers.upgrade || '').toLowerCase();
  const key = req.headers['sec-websocket-key'];
  if (req.method !== 'GET' || up !== 'websocket' || !key || req.headers['sec-websocket-version'] !== '13') return null;
  return key;
}

// Answer an upgrade (after the caller's checks) and hand back the connection.
function accept(req, socket, head) {
  const key = upgradeKey(req);
  if (!key) return refuse(socket, 400, 'not_websocket'), null;
  socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${acceptFor(key)}`, '', ''].join('\r\n'));
  return new Conn(socket, { head });
}

// An upgrade we do not take: a plain HTTP answer with a JSON body, then the socket goes.
function refuse(socket, status, error, message) {
  if (socket.destroyed) return;
  const body = JSON.stringify({ error, ...(message ? { message } : {}) });
  socket.end(`HTTP/1.1 ${status} ${http.STATUS_CODES[status] || 'Error'}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
}

// The client side: open url (http/https). Resolves a Conn once the handshake is done; rejects with
// { status, body } when the other end answers with plain HTTP (an old peer: 404), or a network error.
function connect(url, { headers = {}, timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(String(url).replace(/^ws(s?):/, 'http$1:'));
    const mod = u.protocol === 'https:' ? https : http;
    const key = crypto.randomBytes(16).toString('base64');
    const req = mod.request(u, {
      method: 'GET',
      agent: false,
      headers: { ...headers, Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key },
    });
    const timer = setTimeout(() => req.destroy(Object.assign(new Error('timeout'), { code: 'timeout', timeout: true })), timeoutMs);
    req.on('upgrade', (res, socket, head) => {
      clearTimeout(timer);
      if (res.headers['sec-websocket-accept'] !== acceptFor(key)) {
        socket.destroy();
        return reject(Object.assign(new Error('bad handshake'), { code: 'bad_handshake' }));
      }
      resolve(new Conn(socket, { client: true, head }));
    });
    req.on('response', (res) => {
      clearTimeout(timer);
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => body.length < 4096 && (body += c));
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(body);
        } catch {}
        reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { code: (parsed && parsed.error) || 'http', status: res.statusCode, body: parsed }));
      });
    });
    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    req.end();
  });
}

module.exports = { Conn, frame, parse, accept, refuse, connect, upgradeKey, acceptFor, MAX_MESSAGE, MAX_FRAGMENTS };
