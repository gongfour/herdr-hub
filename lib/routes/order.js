'use strict';
// The order someone gave the hosts, the workspace cards and the rows in them (lib/order.js,
// data/order.json): kept by the host the page was opened from, the hub, for every device. Each
// POST replaces one list (an empty one goes back to herdr's order) and the new state goes out.
const orderLib = require('../order');
const { route, NEXT } = require('../router');
const { send, readJson } = require('../http');

module.exports = (hub) => {
  const known = (host) => host === hub.HOST_ID || hub.peerList.some((p) => p.id === host);
  const done = async (res, next) => {
    await hub.setOrder(next);
    return send(res, 200, { ok: true, order: hub.order });
  };
  return [
    route('GET', 'order', (req, res) => send(res, 200, hub.order)),
    route('POST', 'order/*', async (req, res, m) => {
      m.body = await readJson(req, 64 * 1024);
      if (m.parts.length > 1 && m.parts[1] !== 'hosts' && (typeof m.body.host !== 'string' || !known(m.body.host))) return send(res, 404, { error: 'unknown_host' });
      return NEXT;
    }),
    route('POST', 'order/hosts', (req, res, { body }) => done(res, orderLib.setHosts(hub.order, body.ids))),
    route('POST', 'order/workspaces', (req, res, { body }) => done(res, orderLib.setWorkspaces(hub.order, body.host, body.ids))),
    route('POST', 'order/panes', (req, res, { body }) => {
      if (typeof body.workspace !== 'string') return send(res, 400, { error: 'bad_order' });
      return done(res, orderLib.setPanes(hub.order, body.host, body.workspace, body.ids));
    }),
    route('*', 'order/*', (req, res) => send(res, 404, { error: 'not_found' })),
  ];
};
