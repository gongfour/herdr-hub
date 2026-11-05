'use strict';
// herdr API client: newline-delimited JSON over the server's local socket
// (a named pipe on Windows). The server answers one request per connection and
// then closes it; events.subscribe keeps the connection open and streams lines.

const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

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
const nextId = () => `herdr-hub-${process.pid}-${++seq}`;

// ------------------------------------------------------------ the connect helper (macOS)
// herdr (0.9.3–0.9.5 on macOS) reads a connection's request line non-blocking and sleeps 100 ms
// each time it is not there yet (src/api/server.rs read_initial_request_line_with_limits). Node
// writes one event-loop turn after connect, often too late: ~1 call in 5 then costs ~105 ms. Node
// has no synchronous connect, so on the Mac the one-shot calls go through a small Python process
// (lib/herdr-helper.py) that does connect() and send() back to back on one thread: never late (0 of
// 300, 30 at a time, where the Node way holds nearly every call sent beside another). Calls go the
// Node way until it is ready, while it restarts after a crash (backoff 1 s … 60 s), and on desktop.
// HERDR_HUB_HERDR_HELPER: 1 forces it on, 0 off (default: on on darwin). HERDR_HUB_PYTHON: the
// interpreter (default /usr/bin/python3).
const HELPER_SCRIPT = path.join(__dirname, 'herdr-helper.py');

function helperFromEnv(v, platform = process.platform) {
  if (/^(1|on|true|yes)$/i.test(v || '')) return true;
  if (/^(0|off|false|no)$/i.test(v || '')) return false;
  return platform === 'darwin';
}

function connectHelper({ python = process.env.HERDR_HUB_PYTHON || '/usr/bin/python3', script = HELPER_SCRIPT, log = console, minBackoff = 1000, maxBackoff = 60000 } = {}) {
  let child = null;
  let ready = false;
  let stopped = false;
  let backoff = minBackoff;
  let retry = null;
  let startedAt = 0;
  let n = 0;
  const pending = new Map(); // n -> (err, line) => void
  const stats = { starts: 0, exits: 0, calls: 0 };

  const start = () => {
    retry = null;
    if (stopped || child) return;
    stats.starts++;
    startedAt = Date.now();
    let c;
    try {
      c = spawn(python, ['-I', '-u', script], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
    } catch (err) {
      return lost(null, err);
    }
    child = c;
    c.unref();
    c.stdin.unref && c.stdin.unref();
    c.stdout.unref && c.stdout.unref();
    c.stdin.on('error', () => {}); // a dead helper: 'exit' handles it
    let buf = '';
    c.stdout.setEncoding('utf8');
    c.stdout.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.ready) {
          ready = true;
          stats.pid = msg.pid;
          log.log(`herdr helper: ready (pid ${msg.pid})`);
          continue;
        }
        const done = pending.get(msg.n);
        if (!done) continue; // its caller already timed out
        pending.delete(msg.n);
        msg.err ? done(new HerdrError(msg.err, msg.msg)) : done(null, msg.line);
      }
    });
    c.on('error', (err) => lost(c, err));
    c.on('exit', (code, sig) => lost(c, null, code, sig));
  };

  const lost = (c, err, code, sig) => {
    if (c && child !== c) return; // already handled ('error' then 'exit')
    child = null;
    ready = false;
    stats.exits++;
    for (const done of pending.values()) done(new HerdrError('helper_lost', 'herdr helper exited before answering'));
    pending.clear();
    if (stopped) return;
    if (Date.now() - startedAt > 60000) backoff = minBackoff;
    log.error(`herdr helper: ${err ? err.message : `exited (${sig || code})`}; Node path meanwhile, retry in ${backoff} ms`);
    retry = setTimeout(start, backoff);
    retry.unref && retry.unref();
    backoff = Math.min(backoff * 2, maxBackoff);
  };

  return {
    get ready() {
      return ready && !!child;
    },
    stats,
    pending: () => pending.size,
    start,
    // Sends one request line; done(err, replyLine) is called once (or never, after cancel()).
    send(line, socketPath, timeoutMs, done) {
      const id = ++n;
      pending.set(id, done);
      stats.calls++;
      child.stdin.write(JSON.stringify({ n: id, sock: socketPath, req: line, t: Math.ceil(timeoutMs) }) + '\n');
      return () => pending.delete(id);
    },
    stop() {
      stopped = true;
      clearTimeout(retry);
      if (child) child.kill('SIGKILL');
    },
    kill() {
      if (child) child.kill('SIGKILL'); // tests: a crash
    },
  };
}

let helper = null; // the process's helper, started on the first call when enabled
let helperOn = helperFromEnv(process.env.HERDR_HUB_HERDR_HELPER);
let helperOpts = {};
// Tests: turn it on or off (opts: connectHelper's, for the next helper started).
function useHelper(on, opts = {}) {
  helperOn = on;
  helperOpts = opts;
  if (helper) {
    helper.stop();
    helper = null;
  }
}
function theHelper() {
  if (!helperOn) return null;
  if (!helper) {
    helper = connectHelper(helperOpts);
    helper.start();
  }
  return helper.ready ? helper : null;
}

function call(method, params = {}, { timeoutMs = 10000, socketPath = defaultSocketPath() } = {}) {
  const h = theHelper();
  if (h) return callVia(h, method, params, timeoutMs, socketPath);
  return callNode(method, params, { timeoutMs, socketPath });
}

function parseReply(method, line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    throw new HerdrError('bad_response', `${method}: unparseable reply`);
  }
  if (msg.error) throw new HerdrError(msg.error.code, msg.error.message);
  return msg.result;
}

function callVia(h, method, params, timeoutMs, socketPath) {
  return new Promise((resolve, reject) => {
    const line = JSON.stringify({ id: nextId(), method, params });
    let cancel = null;
    const timer = setTimeout(() => {
      if (cancel) cancel();
      reject(new HerdrError('timeout', `${method} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    cancel = h.send(line, socketPath, timeoutMs + 50, (err, reply) => {
      clearTimeout(timer);
      if (err) {
        if (err.code === 'timeout') err = new HerdrError('timeout', `${method} timed out after ${timeoutMs} ms`);
        else if (err.code === 'unreachable') err = new HerdrError('unreachable', err.message);
        else if (err.code === 'empty_response') err = new HerdrError('empty_response', `${method}: server closed without a reply`);
        return reject(err);
      }
      try {
        resolve(parseReply(method, reply));
      } catch (e) {
        reject(e);
      }
    });
  });
}

function callNode(method, params = {}, { timeoutMs = 10000, socketPath = defaultSocketPath() } = {}) {
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
      let result;
      try {
        result = parseReply(method, line);
      } catch (err) {
        return finish(err);
      }
      finish(null, result);
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

module.exports = {
  call,
  callNode,
  subscribe,
  defaultSocketPath,
  HerdrError,
  connectHelper,
  helperFromEnv,
  useHelper,
  // true while the one-shot calls go through the helper: herdr does not hold them, so the
  // workarounds for held calls (lib/paneio.js: the ping before a key, keep-awake, hedged reads) rest.
  direct: () => !!(helperOn && helper && helper.ready),
  helperOn: () => helperOn,
  helperState: () => (helperOn ? { on: true, ready: !!(helper && helper.ready), pending: helper ? helper.pending() : 0, ...(helper ? helper.stats : {}) } : { on: false }),
  helperKill: () => helper && helper.kill(),
};
