'use strict';
// The shell's live channel: a WebSocket per open shell view (lib/ws.js, lib/live.js): keys up as
// they are typed, the screen down when it changes. On a hub, /api/peers/<host>/panes/<id>/live is
// piped to that peer's /api/panes/<id>/live. The same checks as a request (Host, login), and the
// Origin: a WebSocket is not held back by CORS, so a browser's must be this page's own; the hub's
// leg has none and sends X-Herdr-Hub instead (a browser cannot set that on a WebSocket).
const ws = require('../ws');
const echo = require('../echo');
const { liveSession, resumeBook } = require('../live');
const { PANE_KEYS, validKeys, badText, cleanLines } = require('../validate');

const LIVE = /^\/api\/panes\/([^/]+)\/live$/;
const PEER_LIVE = /^\/api\/peers\/([^/]+)\/panes\/([^/]+)\/live$/;
const liveShape = (url) => ({ lines: cleanLines(url.searchParams.get('lines'), 200), format: url.searchParams.get('format') === 'ansi' ? 'ansi' : 'text' });

// checks: { requestUrl, hostAllowed(host), identity(req) } — the request's own (lib/hub.js).
// Returns { upgrade(req, socket, head) for the server's 'upgrade', closeAll() }.
function liveUpgrade(hub, { requestUrl, hostAllowed, identity }) {
  const { io } = hub;
  const ALLOW_LOCAL = hub.config.ALLOW_LOCAL;
  // Keys a dropped channel left: what each page's keys reached on each pane (lib/live resume).
  const liveBook = resumeBook();
  const liveConns = new Set();
  // Each end of a channel is pinged; one that answers nothing for LIVE_DEAD_MS is closed (lib/ws keepalive).
  const LIVE_PING_MS = Number(hub.env.HERDR_HUB_LIVE_PING_MS) || 15000;
  const LIVE_DEAD_MS = LIVE_PING_MS * 3;

  function liveOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return req.headers['x-herdr-hub'] === '1';
    const host = req.headers.host || '';
    return origin === `https://${host}` || (ALLOW_LOCAL && origin === `http://${host}`);
  }

  function liveLocal(req, socket, head, pane, url) {
    if (!hub.findTerminal(pane)) return ws.refuse(socket, 404, 'pane_not_found');
    const conn = ws.accept(req, socket, head);
    if (!conn) return;
    conn.keepalive(LIVE_PING_MS, LIVE_DEAD_MS);
    liveConns.add(conn);
    const read = (shape) => io.maybeHedge(() => io.readPane(pane, 'recent_unwrapped', shape.lines, shape.format));
    const channel = {
      // Reads and the echo wait are sent again when herdr holds them (lib/live hedge); keys never.
      read,
      input: async (text, keys, info) => {
        await io.sendPaneInput(pane, text, keys, info);
        if (keys.includes('enter')) hub.refreshAfterKeys();
      },
      echo: async ({ text, before }, shape, info = {}) => {
        const r = await echo.waitEcho(
          {
            waitFor: (pattern, ms) => io.waitOutput(pane, shape.lines, pattern, ms, { hedged: true, info }),
            read: () => read(shape),
            sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
            now: () => performance.now(),
          },
          { text, before }
        );
        info.how = r.how;
        info.reads = r.reads;
        return r.screen;
      },
      touch: () => io.touchAwake(),
      now: () => performance.now(),
      setTimeout: (f, ms) => setTimeout(f, ms),
      clearTimeout: (t) => clearTimeout(t),
      buffered: () => conn.buffered,
    };
    // The pane went away (lib/live says 'gone'): the channel goes with it.
    const send = (m) => {
      conn.send(JSON.stringify(m));
      if (m.t === 'gone') conn.close(1000, 'gone');
    };
    const session = liveSession({ io: channel, send, pane, shape: liveShape(url), api: hub.API_VERSION, book: liveBook, idlePollMs: hub.LIVE_IDLE_MS });
    conn.on('message', (text) => {
      let m;
      try {
        m = JSON.parse(text);
      } catch {
        return;
      }
      if (m && m.t === 'k') {
        // The same checks as POST /keys: text alone, or keys herdr knows (with text before them).
        const x = typeof m.x === 'string' ? m.x : '';
        const y = Array.isArray(m.y) ? m.y : [];
        const bad = badText(x) ? 'bad_text' : y.length ? (validKeys(y, PANE_KEYS) ? null : 'bad_keys') : x ? null : 'bad_keys';
        if (bad) return conn.send(JSON.stringify({ t: 'kerr', from: m.s, to: m.s, error: bad, message: bad }));
        m = { t: 'k', s: m.s, x, y, ...(m.tr ? { tr: 1 } : {}) };
      }
      session.message(m);
    });
    conn.on('close', () => {
      liveConns.delete(conn);
      session.stop();
    });
  }

  // The hub's leg: the peer's channel first (so a peer that cannot, or a pane that is gone, is a
  // plain HTTP answer the page falls back on), then the page's, then each message through as it is.
  async function livePeer(req, socket, head, hostId, encodedPane, url) {
    const peer = hub.peers.get(hostId);
    if (!peer) return ws.refuse(socket, 404, 'unknown_host');
    if (!peer.online) return ws.refuse(socket, 503, 'peer_offline', `${peer.shown()} 오프라인`);
    if (!peer.build || !(peer.build.api >= hub.LIVE_API)) return ws.refuse(socket, 501, 'peer_no_live');
    let up;
    try {
      up = await ws.connect(new URL(`/api/panes/${encodedPane}/live${url.search}`, peer.url).href, { headers: { 'X-Herdr-Hub': '1' } });
    } catch (err) {
      if (err.status) return ws.refuse(socket, err.status, err.code || 'peer_error');
      console.error(`${new Date().toISOString()} live ${peer.id}: ${err.code || err.message}`);
      return ws.refuse(socket, err.timeout ? 504 : 502, err.timeout ? 'peer_timeout' : 'peer_unreachable');
    }
    if (socket.destroyed) return up.close(1001);
    const down = ws.accept(req, socket, head);
    if (!down) return up.close(1001);
    up.keepalive(LIVE_PING_MS, LIVE_DEAD_MS);
    down.keepalive(LIVE_PING_MS, LIVE_DEAD_MS);
    liveConns.add(down);
    // A traced key (lib/live tr): the hub adds how long the peer took from where it stands (hub.rt,
    // from passing the key on to its group's trace coming back). Untraced messages pass untouched.
    const tracedAt = new Map();
    up.on('message', (t) => {
      if (tracedAt.size && t.startsWith('{"t":"tr"')) {
        try {
          const m = JSON.parse(t);
          const at = tracedAt.get(m.from);
          for (const s of tracedAt.keys()) if (s <= m.to) tracedAt.delete(s);
          if (at != null) t = JSON.stringify({ ...m, hub: Math.round((performance.now() - at) * 10) / 10 });
        } catch {}
      }
      down.send(t);
      ws.holdWhileFull(up, down); // a slow page: the peer's reads wait, so the peer skips screens
    });
    down.on('message', (t) => {
      if (t.includes('"tr":1') && tracedAt.size < 256) {
        const s = /"s":(\d+)/.exec(t);
        if (s) tracedAt.set(Number(s[1]), performance.now());
      }
      up.send(t);
    });
    up.on('close', (code) => down.close(code === 1006 || code === 1005 ? 1011 : code, 'peer'));
    down.on('close', () => {
      liveConns.delete(down);
      up.close(1000);
    });
  }

  function upgrade(req, socket, head) {
    socket.on('error', () => {});
    const url = requestUrl(req.url);
    if (!url) return ws.refuse(socket, 400, 'bad_url');
    if (!hostAllowed(req.headers.host)) return ws.refuse(socket, 403, 'bad_host');
    if (!identity(req)) return ws.refuse(socket, 403, 'forbidden');
    if (!liveOrigin(req)) return ws.refuse(socket, 403, 'bad_origin');
    if (!ws.upgradeKey(req)) return ws.refuse(socket, 400, 'not_websocket');
    let m;
    try {
      if ((m = LIVE.exec(url.pathname))) return liveLocal(req, socket, head, hub.decodePart(m[1]), url);
      if ((m = PEER_LIVE.exec(url.pathname))) return livePeer(req, socket, head, hub.decodePart(m[1]), m[2], url).catch(() => ws.refuse(socket, 500, 'error'));
    } catch (err) {
      if (err.status === 400) return ws.refuse(socket, 400, 'bad_path');
      throw err;
    }
    ws.refuse(socket, 404, 'not_found');
  }

  const closeAll = () => {
    for (const c of liveConns) c.close(1001);
  };
  return { upgrade, closeAll };
}

module.exports = { liveUpgrade };
