'use strict';
// The JSON API under /api/: one table (lib/router.js) made of each area's rows, tried in order.
//   state.js       state, version, stream, host, dirs, recent (최근 폴더 hide / show)
//   peers.js       /peers/<host>/… (the hub's leg to a peer) and /hosts (설정 → 연결)
//   workspaces.js  new workspace, rename, close, 기본 폴더, new tab or agent
//   panes.js       shell panes: screen, input, keys, rename, split, agent, close
//   agents.js      agents: screen, commands, files, transcript, prompt, keys, sendnow, answer,
//                  rename; and /answer (a notification's button)
//   uploads.js     the composer's photos
//   push.js        notifications
//   order.js       the order of hosts, workspace cards and rows (data/order.json)
// The live channel (a WebSocket, not a request) is live.js.
const { send } = require('../http');
const { dispatch } = require('../router');

const AREAS = ['state', 'peers', 'workspaces', 'panes', 'agents', 'uploads', 'push', 'order'].map((n) => require(`./${n}`));
const tables = new WeakMap(); // hub -> its rows

async function api(hub, req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1).map(hub.decodePart); // drop "api"
  const method = req.method;
  // Mutations must carry a custom header: a cross-site form cannot set it.
  if (method !== 'GET' && req.headers['x-herdr-hub'] !== '1') return send(res, 403, { error: 'missing_header' });
  let routes = tables.get(hub);
  if (!routes) tables.set(hub, (routes = AREAS.flatMap((area) => area(hub))));
  if (!(await dispatch(routes, req, res, { method, parts, url, params: {} }))) send(res, 404, { error: 'not_found' });
}

module.exports = { api };
