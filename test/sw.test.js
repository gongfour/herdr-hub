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
