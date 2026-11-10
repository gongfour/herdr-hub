'use strict';
// Notifications: the key, a device's subscription, 시험 알림, whether a device is subscribed.
const { route, NEXT } = require('../router');
const { send, readJson } = require('../http');
const { tIn } = require('../../public/i18n');

module.exports = (hub) => {
  const { push } = hub;
  return [
    route('*', 'push/*', (req, res, { method }) => (push ? NEXT : send(res, method === 'GET' ? 200 : 409, { error: 'push_disabled', disabled: true }))),
    route('GET', 'push/key/*', (req, res) => send(res, 200, { publicKey: push.publicKey })),
    route('POST', 'push/subscribe/*', async (req, res) => {
      await push.add(await readJson(req));
      return send(res, 200, { ok: true });
    }),
    route('POST', 'push/unsubscribe/*', async (req, res) => {
      const { endpoint } = await readJson(req);
      await push.remove(endpoint);
      return send(res, 200, { ok: true });
    }),
    // 시험 알림: only to the device that asks (its subscription endpoint), never to all.
    route('POST', 'push/test/*', async (req, res) => {
      const { endpoint } = await readJson(req);
      if (typeof endpoint !== 'string' || !endpoint) return send(res, 400, { error: 'endpoint_required' });
      const r = await push.sendTo(endpoint, (lang) => ({ title: 'Herdr Hub', body: tIn(lang, '{host} 알림 시험 — 이 기기', { host: hub.HOSTNAME }), url: '/', lang }));
      console.log(`${new Date().toISOString()} push test found=${r.found} sent=${r.sent}`);
      if (!r.found) return send(res, 404, { error: 'not_subscribed' });
      return send(res, 200, r);
    }),
    route('POST', 'push/status/*', async (req, res) => {
      const { endpoint } = await readJson(req);
      const sub = typeof endpoint === 'string' ? push.subs.find((s) => s.endpoint === endpoint) : null;
      return send(res, 200, { subscribed: Boolean(sub), ...(sub ? { lang: sub.lang || 'ko' } : {}) });
    }),
  ];
};
