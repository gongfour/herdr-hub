'use strict';
// The hub's peer list as data (lib/hoststore.js): addresses, entries, the file and its env seed,
// and what 연결 시험 makes of the replies it gets.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const hs = require('../lib/hoststore');

const self = { id: 'desktop', urls: ['https://desktop.example.ts.net'] };
const code = (fn) => {
  try {
    fn();
  } catch (err) {
    return err.code;
  }
  return 'no error';
};

test('cleanUrl: an http(s) origin only; https when no scheme; trailing slash dropped', () => {
  assert.equal(hs.cleanUrl('https://server.example.ts.net:8443'), 'https://server.example.ts.net:8443');
  assert.equal(hs.cleanUrl(' https://server.example.ts.net:8443/ '), 'https://server.example.ts.net:8443');
  assert.equal(hs.cleanUrl('server.example.ts.net:8443'), 'https://server.example.ts.net:8443');
  assert.equal(hs.cleanUrl('http://127.0.0.1:8798'), 'http://127.0.0.1:8798');
  assert.equal(hs.cleanUrl('HTTPS://Server.Example.ts.net'), 'https://server.example.ts.net');
  assert.equal(hs.cleanUrl('https://server.example.ts.net:443'), 'https://server.example.ts.net');
  for (const bad of ['', '   ', 'ftp://x.ts.net', 'file:///etc/passwd', 'javascript:alert(1)', 'https://x.ts.net/api', 'https://x.ts.net?a=1', 'https://x.ts.net#h', 'https://u:p@x.ts.net', 'https://x y.ts.net', 42, null, 'https://', 'a'.repeat(400)])
    assert.equal(code(() => hs.cleanUrl(bad)), 'bad_url', String(bad));
});

test('cleanPeer: a valid id, not this hub, no duplicate id or address', () => {
  const list = [{ id: 'server', url: 'https://server.example.ts.net:8443' }];
  assert.deepEqual(hs.cleanPeer({ id: 'laptop', url: 'laptop.example.ts.net:8443', label: ' 노트북 ' }, { self, list }), { id: 'laptop', url: 'https://laptop.example.ts.net:8443', label: '노트북' });
  assert.deepEqual(hs.cleanPeer({ id: 'laptop', url: 'https://laptop.example.ts.net', label: '' }, { self, list }), { id: 'laptop', url: 'https://laptop.example.ts.net' });
  assert.equal(code(() => hs.cleanPeer({ id: 'Server2', url: 'https://a.ts.net' }, { self, list })), 'bad_host_id');
  assert.equal(code(() => hs.cleanPeer({ id: 'all', url: 'https://a.ts.net' }, { self, list })), 'bad_host_id');
  assert.equal(code(() => hs.cleanPeer({ id: 'desktop', url: 'https://a.ts.net' }, { self, list })), 'host_is_self');
  assert.equal(code(() => hs.cleanPeer({ id: 'other', url: 'https://desktop.example.ts.net/' }, { self, list })), 'host_is_self');
  assert.equal(code(() => hs.cleanPeer({ id: 'server', url: 'https://a.ts.net' }, { self, list })), 'host_id_taken');
  assert.equal(code(() => hs.cleanPeer({ id: 'other', url: 'server.example.ts.net:8443' }, { self, list })), 'host_url_taken');
  assert.equal(code(() => hs.cleanPeer({ id: 'other', url: 'https://a.ts.net', label: 'x'.repeat(41) }, { self, list })), 'bad_label');
  assert.equal(code(() => hs.cleanPeer({ id: 'other', url: 'https://a.ts.net', label: '<b>' }, { self, list })), 'bad_label');
  const full = Array.from({ length: hs.MAX_PEERS }, (_, i) => ({ id: `h${i}`, url: `https://h${i}.ts.net` }));
  assert.equal(code(() => hs.cleanPeer({ id: 'one-more', url: 'https://more.ts.net' }, { self, list: full })), 'too_many_hosts');
  // Changing an address: its own old one is fine, another's is not.
  assert.equal(code(() => hs.checkUrl('https://server.example.ts.net:8443', { self, list, except: 'server' })), 'no error');
  assert.equal(code(() => hs.checkUrl('https://server.example.ts.net:8443', { self, list, except: 'laptop' })), 'host_url_taken');
});

test('load: seeded from the env var once, then the file wins; a peer has neither', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-peers-'));
  const file = path.join(dir, 'peers.json');
  try {
    assert.deepEqual(hs.load(file, '', self), { list: [], manageable: false, from: 'none' });
    assert.equal(fs.existsSync(file), false);
    const a = hs.load(file, 'server=https://server.example.ts.net:8443', self);
    assert.deepEqual(a, { list: [{ id: 'server', url: 'https://server.example.ts.net:8443' }], manageable: true, from: 'env' });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), a.list);
    // Changed in 설정 (the file), then a restart with the same env var: the file's list.
    hs.save(file, [{ id: 'laptop', url: 'https://laptop.example.ts.net', label: '노트북' }]);
    assert.deepEqual(hs.load(file, 'server=https://server.example.ts.net:8443', self), { list: [{ id: 'laptop', url: 'https://laptop.example.ts.net', label: '노트북' }], manageable: true, from: 'file' });
    // Every peer removed: still a hub (the file is there, empty).
    hs.save(file, []);
    assert.deepEqual(hs.load(file, 'server=https://server.example.ts.net:8443', self), { list: [], manageable: true, from: 'file' });
    assert.equal(fs.existsSync(`${file}.tmp`), false);
    // A hand-edited file: what makes sense is kept, the rest logged and dropped.
    fs.writeFileSync(file, JSON.stringify([{ id: 'ok', url: 'https://ok.ts.net' }, { id: 'ok', url: 'https://dup.ts.net' }, { id: 'desktop', url: 'https://x.ts.net' }, { id: 'p', url: 'ftp://p' }, 'junk']));
    const logs = [];
    assert.deepEqual(hs.load(file, '', self, (m) => logs.push(m)).list, [{ id: 'ok', url: 'https://ok.ts.net' }]);
    assert.equal(logs.length, 4);
    fs.writeFileSync(file, '{not json');
    assert.deepEqual(hs.load(file, '', self, () => {}), { list: [], manageable: true, from: 'file' });
    assert.equal(fs.readFileSync(`${file}.bad`, 'utf8'), '{not json');
    // A bad seed stops the start, as HERDR_HUB_PEERS always did.
    fs.rmSync(file);
    assert.throws(() => hs.load(file, 'nonsense', self), /bad HERDR_HUB_PEERS/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const json = (status, body) => ({ status, type: 'application/json; charset=utf-8', body: JSON.stringify(body) });
const ver = json(200, { version: '1.0.600', commit: 'abc1234', api: 1, id: 'x' });
const host = json(200, { id: 'server', label: 'server', herdr: 'up', api: 1 });

test('classify: a Herdr Hub, and every way an address can fail', () => {
  assert.deepEqual(hs.classify(ver, host, { selfId: 'desktop', hubApi: 1 }), { ok: true, code: 'ok', id: 'server', label: 'server', herdr: 'up', api: 1, apiMatch: true, version: '1.0.600', commit: 'abc1234' });
  assert.equal(hs.classify(ver, host, { selfId: 'desktop', hubApi: 2 }).apiMatch, false);
  assert.equal(hs.classify(json(200, { version: '1.0.1', dirty: true }), null, {}).version, '1.0.1+dirty');
  assert.equal(hs.classify(json(200, { version: '0.9' }), json(200, { id: 'old' }), {}).herdr, null); // an older peer
  assert.equal(hs.classify(ver, host, { selfId: 'server' }).code, 'self');
  assert.equal(hs.classify({ error: 'ETIMEDOUT' }).code, 'timeout');
  assert.equal(hs.classify({ error: 'ENOTFOUND' }).code, 'dns');
  assert.equal(hs.classify({ error: 'EAI_AGAIN' }).code, 'dns');
  assert.equal(hs.classify({ error: 'ECONNREFUSED' }).code, 'refused');
  assert.equal(hs.classify({ error: 'ERR_TLS_CERT_ALTNAME_INVALID' }).code, 'tls');
  assert.equal(hs.classify({ error: 'DEPTH_ZERO_SELF_SIGNED_CERT' }).code, 'tls');
  assert.equal(hs.classify({ error: 'EPROTO' }).code, 'tls');
  assert.equal(hs.classify({ error: 'ECONNRESET' }).code, 'unreachable');
  assert.deepEqual(hs.classify({ status: 302, location: 'https://login.example.com/' }), { ok: false, code: 'redirect', status: 302, location: 'https://login.example.com/' });
  assert.equal(hs.classify(json(403, { error: 'bad_host' })).code, 'bad_host');
  assert.equal(hs.classify({ status: 403, type: 'text/plain', body: '{"error":"forbidden"}' }).code, 'http'); // not JSON: not ours
  assert.equal(hs.classify(json(403, { error: 'forbidden' })).code, 'forbidden');
  assert.equal(hs.classify({ status: 502, type: 'text/plain', body: 'Bad Gateway' }).code, 'http');
  assert.equal(hs.classify({ status: 404, type: 'text/html', body: '<h1>nope</h1>' }).code, 'not_hub');
  assert.equal(hs.classify({ status: 200, type: 'text/html', body: '<html>' }).code, 'not_hub');
  assert.equal(hs.classify(json(200, { hello: 'world' })).code, 'not_hub');
});

test('probe: asks /api/version then /api/host, follows no redirect', async () => {
  const seen = [];
  const srv = http.createServer((req, res) => {
    seen.push(req.url);
    if (req.url === '/api/version') return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ version: '1.0.9', api: 1 }));
    if (req.url === '/api/host') return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id: 'peer', label: 'Peer', herdr: 'down', api: 1 }));
    res.writeHead(404).end();
  });
  const redirect = http.createServer((req, res) => res.writeHead(301, { Location: 'http://169.254.169.254/' }).end());
  const silent = http.createServer(() => {}); // never answers
  await Promise.all([srv, redirect, silent].map((s) => new Promise((r) => s.listen(0, '127.0.0.1', r))));
  const at = (s) => `http://127.0.0.1:${s.address().port}`;
  try {
    const r = await hs.probe(at(srv), { selfId: 'desktop', hubApi: 1 });
    assert.equal(r.code, 'ok');
    assert.equal(r.herdr, 'down');
    assert.equal(r.label, 'Peer');
    assert.equal(r.url, at(srv));
    assert.deepEqual(seen, ['/api/version', '/api/host']);
    const rd = await hs.probe(at(redirect));
    assert.equal(rd.code, 'redirect');
    assert.equal(rd.location, 'http://169.254.169.254/');
    const t = await hs.probe(at(silent), { timeoutMs: 200 });
    assert.equal(t.code, 'timeout');
    const refused = await hs.probe('http://127.0.0.1:1', { timeoutMs: 1000 });
    assert.equal(refused.code, 'refused');
    await assert.rejects(hs.probe('https://x.ts.net/path'), { code: 'bad_url' });
  } finally {
    for (const s of [srv, redirect, silent]) s.closeAllConnections(), s.close();
  }
});
