'use strict';
// The service worker's notification buttons: a stubbed worker scope, no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function load({ fetchReply }) {
  const handlers = {};
  const shown = [];
  const fetched = [];
  const opened = [];
  const self = {
    location: { origin: 'https://hub.invalid' },
    addEventListener: (type, fn) => (handlers[type] = fn),
    skipWaiting() {},
    clients: { claim() {}, matchAll: async () => [], openWindow: async (u) => opened.push(u) },
    registration: { showNotification: async (title, opts) => shown.push({ title, ...opts }), getNotifications: async () => [] },
  };
  const fetch = async (url, init) => {
    fetched.push({ url, init, body: JSON.parse(init.body) });
    return fetchReply();
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8'), { self, fetch, URL, setTimeout: () => 0, Notification: { maxActions: 2 } });
  const click = async (action, data) => {
    let wait;
    handlers.notificationclick({ action, notification: { title: 'a: 답 필요', tag: 'server|w1:p1', data, close() {} }, waitUntil: (p) => (wait = p) });
    await wait;
  };
  const push = async (payload) => {
    let wait;
    handlers.push({ data: { json: () => payload }, waitUntil: (p) => (wait = p) });
    await wait;
  };
  return { click, push, shown, fetched, opened };
}

const data = { url: '/#/h/server/agent/w1%3Ap1', host: 'server', pane: 'w1:p1', stateSeq: 7, answers: { 1: 'Yes', 3: 'No' } };

test('a button posts the answer with stateSeq and label, then confirms quietly', async () => {
  const w = load({ fetchReply: () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }) });
  await w.click('answer:3', data);
  assert.equal(w.fetched.length, 1);
  assert.equal(w.fetched[0].url, '/api/answer');
  assert.equal(w.fetched[0].init.method, 'POST');
  assert.equal(w.fetched[0].init.headers['X-Herdr-Hub'], '1');
  assert.equal(w.fetched[0].init.credentials, 'same-origin');
  assert.deepEqual(w.fetched[0].body, { host: 'server', pane: 'w1:p1', stateSeq: 7, n: 3, label: 'No' });
  assert.equal(w.shown[0].body, '보냄: No');
  assert.equal(w.shown[0].tag, 'server|w1:p1');
  assert.equal(w.shown[0].silent, true);
  assert.deepEqual(w.opened, []);
});

test('a refused answer says so; a plain tap opens the agent and sends nothing', async () => {
  const w = load({ fetchReply: () => ({ ok: false, status: 409, json: async () => ({ error: 'stale' }) }) });
  await w.click('answer:1', data);
  assert.match(w.shown[0].body, /이미 바뀌었습니다/);
  await w.click('', data);
  assert.equal(w.fetched.length, 1);
  assert.deepEqual(w.opened, ['https://hub.invalid/#/h/server/agent/w1%3Ap1']);
});

test('push: actions only where the browser shows them; renotify from the payload', async () => {
  const w = load({ fetchReply: () => ({}) });
  await w.push({ title: 't', body: 'b', tag: 'server|w1:p1', renotify: false, kind: 'done', actions: [{ action: 'answer:1', title: 'Yes' }, { action: 'answer:2', title: 'No' }, { action: 'answer:3', title: 'x' }] });
  assert.equal(w.shown[0].renotify, false);
  assert.equal(w.shown[0].actions.length, 2);
});

// The page load fallback: offline.html (cached at install) when the hub's page can't be loaded.
function loadNav(netReply) {
  const handlers = {};
  const cache = new Map();
  const added = [];
  const caches = {
    open: async () => ({ addAll: async (reqs) => reqs.forEach((r) => (added.push(r.url), cache.set(r.url, `cached ${r.url}`))) }),
    match: async (u) => cache.get(u) || undefined,
  };
  const self = { location: { origin: 'https://hub.invalid' }, addEventListener: (t, fn) => (handlers[t] = fn), skipWaiting() {}, clients: { claim() {} }, registration: {} };
  class Request {
    constructor(url, init) {
      this.url = url;
      this.init = init;
    }
  }
  const fetch = async (req) => netReply(req);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8'), { self, fetch, caches, Request, URL, Response: { error: () => 'error' }, setTimeout: () => 0, Date });
  const install = async () => {
    let wait;
    handlers.install({ waitUntil: (p) => (wait = p) });
    await wait;
  };
  const get = async (url, mode = 'navigate') => {
    let reply = 'not handled';
    const waits = [];
    handlers.fetch({ request: { url, method: 'GET', mode }, respondWith: (p) => (reply = p), waitUntil: (p) => waits.push(p) });
    return reply === 'not handled' ? reply : await reply.catch((e) => `threw ${e.message}`);
  };
  return { install, get, added };
}

test('a page load that fails gets offline.html; a working one, the API and assets go to the network untouched', async () => {
  let net = (req) => ({ ok: true, status: 200, body: `net ${req.url}` });
  const w = loadNav((req) => net(req));
  await w.install();
  assert.deepEqual(w.added, ['/offline.html', '/conn.js', '/style.css']);
  assert.deepEqual(await w.get('https://hub.invalid/#/'), { ok: true, status: 200, body: 'net https://hub.invalid/#/' });
  assert.equal(await w.get('https://hub.invalid/api/stream', 'cors'), 'not handled');
  assert.equal(await w.get('https://hub.invalid/app.js?v=1234abcd', 'no-cors'), 'not handled');
  assert.equal(await w.get('https://other.invalid/', 'navigate'), 'not handled');
  net = () => {
    throw new TypeError('Failed to fetch');
  };
  assert.equal(await w.get('https://hub.invalid/'), 'cached /offline.html');
  assert.equal(await w.get('https://hub.invalid/conn.js', 'no-cors'), 'cached /conn.js');
  assert.equal(await w.get('https://hub.invalid/style.css', 'no-cors'), 'cached /style.css');
  // tailscale serve's 502 while Herdr Hub is down counts as down; a 403 or 404 does not.
  net = () => ({ ok: false, status: 502 });
  assert.equal(await w.get('https://hub.invalid/'), 'cached /offline.html');
  net = () => ({ ok: false, status: 403 });
  assert.deepEqual(await w.get('https://hub.invalid/'), { ok: false, status: 403 });
});
