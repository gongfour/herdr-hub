'use strict';
// 연결 (public/conn.js): remembering hosts, when the hub counts as down, the notice, probing the
// remembered peers, ids for new hosts, and the 연결 시험 text.
const test = require('node:test');
const assert = require('node:assert/strict');
const Conn = require('../public/conn.js');

const HUB = 'https://desktop.example.ts.net';
const state = {
  hostId: 'desktop',
  hostLabel: 'desktop',
  hosts: [
    { id: 'desktop', label: 'desktop', local: true, online: true },
    { id: 'server', label: 'server', url: 'https://server.example.ts.net:8443', online: false },
  ],
};

test('remember: this page as the hub at its own origin, the peers at their addresses', () => {
  const rec = Conn.remember(null, HUB, state, 5);
  assert.deepEqual(rec, { self: { id: 'desktop', label: 'desktop', url: HUB, hub: true }, hosts: [{ id: 'server', label: 'server', url: 'https://server.example.ts.net:8443' }], at: 5 });
  // A hub from before (no url on its hosts) keeps the address remembered earlier.
  const old = { ...state, hosts: [state.hosts[0], { id: 'server', label: 'Mac' }] };
  assert.deepEqual(Conn.remember(rec, HUB, old, 6).hosts, [{ id: 'server', label: 'Mac', url: 'https://server.example.ts.net:8443' }]);
  // A host gone from the state is forgotten; a peer's own page remembers only itself.
  assert.deepEqual(Conn.remember(rec, HUB, { ...state, hosts: [state.hosts[0]] }, 7).hosts, []);
  const peerPage = Conn.remember(null, 'https://server.example.ts.net:8443', { hostId: 'server', hostLabel: 'server', hosts: [{ id: 'server', label: 'server', local: true }] }, 8);
  assert.deepEqual(peerPage.self, { id: 'server', label: 'server', url: 'https://server.example.ts.net:8443', hub: false });
  // Nothing usable: what was there stays.
  assert.equal(Conn.remember(rec, HUB, null), rec);
  assert.equal(Conn.remember(rec, 'not a url', state), rec);
  // A url that isn't http(s) is never kept.
  assert.deepEqual(Conn.remember(null, HUB, { ...state, hosts: [state.hosts[0], { id: 'x', label: 'x', url: 'javascript:alert(1)' }] }).hosts, []);
});

test('read/write: localStorage under herdr-hub.hosts; written only on a change; storage errors are no errors', () => {
  const m = new Map();
  const storage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
  assert.equal(Conn.KEY, 'herdr-hub.hosts');
  assert.equal(Conn.read(storage), null);
  const rec = Conn.remember(null, HUB, state, 1);
  assert.equal(Conn.write(storage, rec), true);
  assert.equal(Conn.write(storage, { ...rec, at: 2 }), false);
  assert.deepEqual(Conn.read(storage), rec);
  m.set(Conn.KEY, '{bad');
  assert.equal(Conn.read(storage), null);
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(Conn.read(broken), null);
  assert.equal(Conn.write(broken, rec), false);
});

test('hubDown: only after the stream has been down a while and /api/version fails too', () => {
  const t = 1_000_000;
  assert.equal(Conn.hubDown({ downSince: null, now: t, versionOk: false }), false);
  assert.equal(Conn.hubDown({ downSince: t - Conn.DOWN_MS + 1, now: t, versionOk: false }), false); // a restart
  assert.equal(Conn.hubDown({ downSince: t - Conn.DOWN_MS, now: t, versionOk: false }), true);
  assert.equal(Conn.hubDown({ downSince: t - 60000, now: t, versionOk: true }), false); // the server answers: just the stream
  assert.equal(Conn.hubDown({ downSince: t - 60000, now: t, versionOk: undefined }), false); // not asked yet
});

test('candidates and the notice: the likeliest cause first, a button per peer that answers', () => {
  const rec = Conn.remember(null, HUB, state, 1);
  assert.deepEqual(Conn.candidates(rec, HUB).map((h) => h.id), ['server']);
  assert.deepEqual(Conn.candidates(rec, 'https://server.example.ts.net:8443'), []); // not itself
  assert.deepEqual(Conn.candidates(null, HUB), []);
  const n = Conn.notice(rec, { live: rec.hosts });
  assert.equal(n.title, '허브(desktop)에 연결할 수 없습니다');
  assert.match(n.lines[0], /Tailscale 이 켜져 있는지/);
  assert.deepEqual(n.buttons, [{ label: 'server 로 직접 열기', url: 'https://server.example.ts.net:8443', id: 'server' }]);
  assert.match(n.note, /다른 주소라/);
  assert.match(Conn.notice(rec, { probing: true }).note, /보는 중/);
  assert.match(Conn.notice(rec, {}).note, /답하지 않습니다/);
  assert.equal(Conn.notice(null).title, '이 호스트에 연결할 수 없습니다');
  assert.equal(Conn.notice(null).note, '');
  const html = Conn.noticeHtml(Conn.notice(rec, { live: [{ id: 'server', label: '<s>', url: 'https://server.example.ts.net:8443' }] }));
  assert.match(html, /href="https:\/\/server\.example\.ts\.net:8443\/"/);
  assert.match(html, /&lt;s&gt; 로 직접 열기/);
  assert.match(html, /data-retry>다시 시도</);
});

test('probe: the hosts whose /api/version answers as a Herdr Hub, without credentials', async () => {
  const hosts = [
    { id: 'a', url: 'https://a.ts.net' },
    { id: 'b', url: 'https://b.ts.net' },
    { id: 'c', url: 'https://c.ts.net' },
    { id: 'd', url: 'https://d.ts.net' },
  ];
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([url, init.mode, init.credentials]);
    if (url.startsWith('https://a.')) return { status: 200, json: async () => ({ version: '1.0.1' }) };
    if (url.startsWith('https://b.')) throw new TypeError('Failed to fetch'); // down, or CORS refused
    if (url.startsWith('https://c.')) return { status: 502, json: async () => { throw new Error('html'); } };
    return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  };
  assert.deepEqual((await Conn.probe(hosts, fetchImpl, 50)).map((h) => h.id), ['a']);
  assert.deepEqual(calls[0], ['https://a.ts.net/api/version', 'cors', 'omit']);
});

test('idFor: the name when it is an id, else the address\'s first name; unique', () => {
  assert.equal(Conn.idFor('server', 'https://mac.example.ts.net:8443'), 'server');
  assert.equal(Conn.idFor('맥북', 'https://mac.example.ts.net:8443'), 'mac');
  assert.equal(Conn.idFor('', 'mac.example.ts.net'), 'mac');
  assert.equal(Conn.idFor('My Laptop!', ''), 'my-laptop');
  assert.equal(Conn.idFor('', 'https://100.64.0.1:8443'), 'host');
  assert.equal(Conn.idFor('server', '', ['server', 'server-2']), 'server-3');
  assert.equal(Conn.idFor('all', 'https://all.ts.net'), 'host');
  assert.match(Conn.idFor('a'.repeat(50), ''), /^a{28}$/);
  assert.equal(Conn.idFor('맥미니', 'https://100.64.0.1:8443', [], 'server'), 'server'); // the id it gave itself
  assert.equal(Conn.idFor('맥미니', 'https://mac.ts.net', ['server'], 'server'), 'server-2');
});

test('testText: each result in Korean, with a tone', () => {
  const ok = { ok: true, code: 'ok', id: 'server', label: 'server', herdr: 'up', api: 1, apiMatch: true, version: '1.0.600' };
  assert.deepEqual(Conn.testText(ok), { ok: true, tone: 'on', text: 'server — Herdr Hub 응답 · herdr 연결됨 · API 1 · 빌드 1.0.600.' });
  assert.equal(Conn.testText({ ...ok, apiMatch: false }).tone, 'warn');
  assert.match(Conn.testText({ ...ok, apiMatch: false }).text, /배포가 필요/);
  assert.equal(Conn.testText({ ...ok, herdr: 'down' }).tone, 'warn');
  for (const [code, re] of [
    ['timeout', /답이 없습니다/],
    ['dns', /DNS/],
    ['refused', /거부/],
    ['tls', /TLS/],
    ['redirect', /따라가지 않습니다/],
    ['bad_host', /403 Host/],
    ['forbidden', /ALLOWED_LOGINS/],
    ['not_hub', /Herdr Hub 가 아닙니다/],
    ['self', /자신의 주소/],
    ['unreachable', /닿지 못했습니다/],
  ]) {
    const t = Conn.testText({ ok: false, code });
    assert.equal(t.ok, false, code);
    assert.equal(t.tone, 'bad', code);
    assert.match(t.text, re, code);
  }
  assert.match(Conn.testText({ ok: false, code: 'http', status: 502 }).text, /꺼져 있는 것 같습니다/);
});
