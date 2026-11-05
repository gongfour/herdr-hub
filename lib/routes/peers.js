'use strict';
// The hub's leg to its peers: /api/peers/<host>/<rest> -> <peer>/api/<rest>, for the per-host
// endpoints only (the stream, state and push stay with the hub; the X-Herdr-Hub check has run).
// And /api/hosts, 설정 → 연결's peer list (lib/hoststore.js).
const uploads = require('../uploads');
const hoststore = require('../hoststore');
const { route, NEXT } = require('../router');
const { send, readJson, readRaw, takesGzip } = require('../http');

const PROXIED = new Set(['host', 'dirs', 'agents', 'panes', 'workspaces', 'uploads']);
// A peer agent's last full chat window (a transcript GET without since/rev), kept as it passed by
// (hub.lastChats), so that peer's ghost (offline) still opens to its last chat on a device that
// had no copy of its own. Read-only, for the few dozen agents opened last; a request that asks only
// for what changed since (it has a copy) or an older page (?before=) is not answered from here.
const LAST_CHATS = 32;
const LAST_CHAT_BYTES = 4 << 20;
function chatWindow(rest, url) {
  return chatRoute(rest) && !url.searchParams.has('since') && !url.searchParams.has('rev') && !url.searchParams.has('before');
}
const chatRoute = (rest) => rest.length === 3 && rest[0] === 'agents' && rest[2] === 'transcript';

module.exports = (hub) => {
  const { lastChats } = hub;

  async function proxy(req, res, url) {
    const raw = url.pathname.split('/').filter(Boolean); // api, peers, <host>, ...rest (still encoded)
    const peer = hub.peers.get(hub.decodePart(raw[2]));
    if (!peer) return send(res, 404, { error: 'unknown_host' });
    if (!PROXIED.has(raw[3])) return send(res, 404, { error: 'not_found' });
    const rest = raw.slice(3).map(decodeURIComponent);
    const chatKey = req.method === 'GET' && chatWindow(rest, url) ? `${peer.id}|${rest[1]}` : null;
    if (!peer.online) {
      const kept = chatKey && lastChats.get(chatKey);
      if (kept) return send(res, 200, kept.body, { 'Content-Type': kept.type, 'Cache-Control': 'no-store' });
      // No copy here either: said as an answer (the page says so), not as an error to retry.
      if (chatKey) return send(res, 200, { supported: true, found: false, messages: [], ghostless: true }, { 'Cache-Control': 'no-store' });
      // An older page (?before=) of a ghost's chat: the hub keeps only its last window, so no more.
      if (req.method === 'GET' && chatRoute(rest) && url.searchParams.has('before')) return send(res, 200, { supported: true, found: true, before: url.searchParams.get('before'), messages: [], more: false, ghost: true }, { 'Cache-Control': 'no-store' });
      return send(res, 503, { error: 'peer_offline', message: `${peer.shown()} 오프라인` });
    }
    // Photo uploads are raw image bytes; everything else is JSON. Bodies stay Buffers both ways.
    const body = req.method === 'GET' ? null : await readRaw(req, raw[3] === 'uploads' ? uploads.MAX_BYTES : undefined);
    const headers = req.method === 'GET' ? {} : { 'Content-Type': req.headers['content-type'] || 'application/json', 'X-Herdr-Hub': '1' };
    let r;
    try {
      r = await peer.request(req.method, `/api/${raw.slice(3).join('/')}${url.search}`, { body, headers, timeoutMs: req.method === 'GET' ? 15000 : 60000 });
    } catch (err) {
      const timeout = Boolean(err.timeout);
      console.error(`${new Date().toISOString()} proxy ${req.method} ${peer.id} ${raw.slice(3).join('/')}: ${err.code || err.message}`);
      return send(res, timeout ? 504 : 502, { error: timeout ? 'peer_timeout' : 'peer_unreachable', message: `${peer.shown()}: ${err.code || err.message}` });
    }
    if (chatKey && r.status === 200 && r.body.length <= LAST_CHAT_BYTES) {
      lastChats.delete(chatKey);
      lastChats.set(chatKey, { body: r.body, type: r.type });
      if (lastChats.size > LAST_CHATS) lastChats.delete(lastChats.keys().next().value);
    }
    const out = { 'Content-Type': r.type, ...(r.cache ? { 'Cache-Control': r.cache } : {}) };
    // Came gzipped and the browser takes gzip: passed on as it is; otherwise send() decides.
    if (r.encoded && r.encoded.encoding === 'gzip' && takesGzip(req.headers['accept-encoding']))
      return send(res, r.status, r.encoded.bytes, { ...out, 'Content-Encoding': 'gzip' });
    send(res, r.status, r.body, out);
  }

  const { SELF } = hub.config;
  const next = (list) => {
    hub.setPeerList(list);
    return list;
  };

  return [
    route('*', 'peers/:host/*', (req, res, { url }) => proxy(req, res, url)),

    // 설정 → 연결: the peer list. Changed only on a hub (manageable), by its own page: the Host,
    // login and X-Herdr-Hub checks have run; /api/peers/<id>/… never reaches here.
    route('GET', 'hosts', (req, res) => send(res, 200, hub.peerView())),
    route('POST', 'hosts/*', async (req, res, m) => {
      if (!hub.peerStore.manageable) return send(res, 409, { error: 'not_hub' });
      m.body = await readJson(req, 8 * 1024);
      return NEXT;
    }),
    // 연결 시험: whether a Herdr Hub answers at that address, and what it runs.
    route('POST', 'hosts/test', async (req, res, { body }) => {
      const r = await hoststore.probe(body.url, { selfId: hub.HOST_ID, hubApi: hub.API_VERSION });
      console.log(`${new Date().toISOString()} host test ${r.url} -> ${r.code}`);
      return send(res, 200, r);
    }),
    route('POST', 'hosts', (req, res, { body }) => {
      const p = hoststore.cleanPeer(body, { self: SELF, list: hub.peerList });
      next([...hub.peerList, p]);
      return send(res, 200, { ok: true, peer: p, ...hub.peerView() });
    }),
    route('POST', 'hosts/:id/*', (req, res, m) => {
      m.cur = hub.peerList.find((p) => p.id === m.params.id);
      if (!m.cur) return send(res, 404, { error: 'unknown_host' });
      return NEXT;
    }),
    route('POST', 'hosts/:id/rename/*', (req, res, { cur, body }) => {
      const label = hoststore.cleanName(body.label);
      next(hub.peerList.map((p) => (p.id === cur.id ? (label ? { ...p, label } : { id: p.id, url: p.url }) : p)));
      return send(res, 200, { ok: true, ...hub.peerView() });
    }),
    route('POST', 'hosts/:id/url/*', (req, res, { cur, body }) => {
      const u = hoststore.cleanUrl(body.url);
      hoststore.checkUrl(u, { self: SELF, list: hub.peerList, except: cur.id });
      next(hub.peerList.map((p) => (p.id === cur.id ? { ...p, url: u } : p)));
      return send(res, 200, { ok: true, ...hub.peerView() });
    }),
    route('POST', 'hosts/:id/remove/*', (req, res, { cur }) => {
      next(hub.peerList.filter((p) => p.id !== cur.id));
      return send(res, 200, { ok: true, ...hub.peerView() });
    }),
    route('*', 'hosts/*', (req, res) => send(res, 404, { error: 'not_found' })),
  ];
};
