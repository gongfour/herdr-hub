'use strict';
// The colour someone gave each host (public/hostcolor.js, data/host-colors.json): kept by the host
// the page was opened from, the hub, for every device, as the order is. POST sets one host's
// ({ host, color }; '' takes it away) and the new state goes out.
const { route } = require('../router');
const { send, readJson } = require('../http');

module.exports = (hub) => {
  const known = (host) => host === hub.HOST_ID || hub.peerList.some((p) => p.id === host);
  return [
    route('GET', 'colors', (req, res) => send(res, 200, hub.hostColors)),
    route('POST', 'colors/hosts', async (req, res) => {
      const body = await readJson(req, 4 * 1024);
      if (typeof body.host !== 'string' || !known(body.host)) return send(res, 404, { error: 'unknown_host' });
      if (body.color != null && typeof body.color !== 'string') return send(res, 400, { error: 'bad_color' });
      await hub.setHostColor(body.host, body.color || '');
      return send(res, 200, { ok: true, colors: hub.hostColors });
    }),
    route('*', 'colors/*', (req, res) => send(res, 404, { error: 'not_found' })),
  ];
};
