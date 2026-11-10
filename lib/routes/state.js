'use strict';
// The merged state and its live stream, the build, this host, the folder browser, and the
// folders taken out of 최근 폴더.
const os = require('os');
const dirs = require('../dirs');
const { route } = require('../router');
const { send, readJson, corsOrigin } = require('../http');
const { KINDS, cleanCwd } = require('../validate');

module.exports = (hub) => [
  route('GET', 'state/*', (req, res) => send(res, 200, hub.state)),

  // The build this host serves: an installed app resumed from memory compares it with the one
  // it was served with and loads the new one (public/update.js).
  // Readable from the other hosts' pages too (CORS, this one path only): a page whose hub is down
  // asks the peers it remembers whether they answer (public/fallback.js). Build info only.
  route('GET', 'version', async (req, res) => {
    const origin = corsOrigin(req.headers.origin, hub.config.CORS_RULE);
    return send(res, 200, await hub.buildNow(), origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {});
  }),

  route('GET', 'stream/*', async (req, res) => {
    const build = await hub.buildNow();
    if (res.destroyed || req.destroyed) return; // gone meanwhile: nothing to keep in the clients
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`event: version\ndata: ${JSON.stringify(build)}\n\n`);
    res.write(`event: state\ndata: ${JSON.stringify(hub.state)}\n\n`);
    hub.clients.add(res);
    // A hub following this host (lib/peers.js): this host is its peer while it does.
    const unfollow = req.headers['x-herdr-hub-follower'] ? hub.follow(req.headers['x-herdr-hub-follower']) : () => {};
    req.on('close', () => {
      hub.clients.delete(res);
      unfollow();
    });
  }),

  route('GET', 'host/*', async (req, res) => {
    const { BUILD } = hub;
    return send(res, 200, { id: hub.HOST_ID, label: hub.HOSTNAME, herdr: hub.local.herdr, api: hub.API_VERSION, build: { version: BUILD.version, commit: BUILD.commit, time: BUILD.time, dirty: BUILD.dirty }, platform: process.platform, home: os.homedir(), kinds: KINDS, recentCwds: hub.recentCwds(), hiddenCwds: hub.hiddenCwds, places: await dirs.places() });
  }),

  // 최근 폴더's ✕ and its 되돌리기 (lib/hiddencwds): { cwd } hidden from or back in this host's
  // recentCwds. The folder need not exist (a deleted one is what is most often taken out).
  route('POST', 'recent/hide', async (req, res) => {
    const body = await readJson(req);
    await hub.hideCwd(body.cwd);
    return send(res, 200, { ok: true, recentCwds: hub.recentCwds(), hiddenCwds: hub.hiddenCwds });
  }),
  route('POST', 'recent/show', async (req, res) => {
    const body = await readJson(req);
    if (typeof body.cwd !== 'string') return send(res, 400, { error: 'bad_cwd' });
    await hub.unhideCwd(body.cwd);
    return send(res, 200, { ok: true, recentCwds: hub.recentCwds(), hiddenCwds: hub.hiddenCwds });
  }),

  // Folder browser: subfolders of ?path= (home when empty), or the drive letters on Windows.
  route('GET', 'dirs', async (req, res, { url }) => {
    const p = url.searchParams.get('path') || '';
    if (url.searchParams.get('drives') === '1' || p === dirs.DRIVES) return send(res, 200, await dirs.drives());
    return send(res, 200, await dirs.list(p ? await cleanCwd(p) : os.homedir()));
  }),
  route('POST', 'dirs', async (req, res) => {
    const body = await readJson(req);
    const parent = await cleanCwd(body.parent);
    return send(res, 200, { ok: true, path: await dirs.create(parent, body.name) });
  }),
];
