'use strict';
// herdr API client: newline-delimited JSON over the server's local socket
// (a named pipe on Windows). The server answers one request per connection and
// then closes it; events.subscribe keeps the connection open and streams lines.

const net = require('net');
const os = require('os');
const path = require('path');

function defaultSocketPath() {
  if (process.env.HERDR_SOCKET) return process.env.HERDR_SOCKET;
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return `\\\\.\\pipe\\${path.join(appData, 'herdr', 'herdr.sock')}`;
  }
  const config = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(config, 'herdr', 'herdr.sock');
}

class HerdrError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

let seq = 0;
const nextId = () => `paddock-${process.pid}-${++seq}`;

function call(method, params = {}, { timeoutMs = 10000, socketPath = defaultSocketPath() } = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId();
    const conn = net.connect(socketPath);
    let buf = '';
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      conn.destroy();
      err ? reject(err) : resolve(value);
    };
    const timer = setTimeout(() => finish(new HerdrError('timeout', `${method} timed out after ${timeoutMs} ms`)), timeoutMs);
    conn.setEncoding('utf8');
    conn.on('connect', () => conn.write(JSON.stringify({ id, method, params }) + '\n'));
    conn.on('data', (chunk) => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl >= 0) parse(buf.slice(0, nl));
    });
    conn.on('end', () => (buf.trim() ? parse(buf) : finish(new HerdrError('empty_response', `${method}: server closed without a reply`))));
    conn.on('error', (err) => finish(new HerdrError('unreachable', `herdr socket ${socketPath}: ${err.message}`)));

    function parse(line) {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return finish(new HerdrError('bad_response', `${method}: unparseable reply`));
      }
      if (msg.error) return finish(new HerdrError(msg.error.code, msg.error.message));
      finish(null, msg.result);
    }
  });
}

/**
 * Keep an events.subscribe stream open, reconnecting with backoff.
 * Returns { stop(), restart(subscriptions) }.
 */
function subscribe(subscriptions, onEvent, { socketPath = defaultSocketPath(), onState = () => {} } = {}) {
  let conn = null;
  let stopped = false;
  let backoff = 500;
  let retry = null;
  let subs = subscriptions;

  const open = () => {
    if (stopped) return;
    const c = net.connect(socketPath);
    conn = c;
    let buf = '';
    c.setEncoding('utf8');
    c.on('connect', () => c.write(JSON.stringify({ id: nextId(), method: 'events.subscribe', params: { subscriptions: subs } }) + '\n'));
    c.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.result && msg.result.type === 'subscription_started') {
          backoff = 500;
          onState('live');
          continue;
        }
        if (msg.error) {
          onState('error', msg.error);
          continue;
        }
        onEvent(msg);
      }
    });
    const lost = () => {
      if (conn !== c) return;
      conn = null;
      if (stopped) return;
      onState('down');
      retry = setTimeout(open, backoff);
      backoff = Math.min(backoff * 2, 15000);
    };
    c.on('error', lost);
    c.on('close', lost);
  };

  open();
  return {
    stop() {
      stopped = true;
      clearTimeout(retry);
      if (conn) conn.destroy();
    },
    restart(next) {
      subs = next;
      clearTimeout(retry);
      backoff = 500;
      const old = conn;
      conn = null;
      if (old) old.destroy();
      open();
    },
  };
}

module.exports = { call, subscribe, defaultSocketPath, HerdrError };
