'use strict';
// 최근 폴더's ✕ (lib/hiddencwds): folders hidden from a host's recentCwds, kept by that host in
// data/hidden-cwds.json for every device; POST /api/recent/hide|show, through the peer proxy too;
// a tab or workspace started there takes it off the list.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('../lib/hiddencwds');
const { startHub, until } = require('./fixtures/hub');

test('key: a trailing separator never matters; on Windows neither do case and / vs \\', () => {
  assert.equal(H.key('/a/b/', 'linux'), '/a/b');
  assert.equal(H.key('/a/b//', 'darwin'), '/a/b');
  assert.equal(H.key('/', 'darwin'), '/');
  assert.notEqual(H.key('/A/b', 'darwin'), H.key('/a/b', 'darwin'));
  assert.equal(H.key('C:\\Users\\Alex\\Proj\\', 'win32'), H.key('c:/users/alex/proj', 'win32'));
  assert.equal(H.norm('C:\\x\\'), 'C:\\x');
});

test('hide / show / without / clean', () => {
  let l = H.hide([], '/a/b/', 'linux');
  assert.deepEqual(l, ['/a/b']);
  l = H.hide(l, '/a/b', 'linux'); // once
  assert.deepEqual(l, ['/a/b']);
  l = H.hide(l, '/c', 'linux');
  assert.deepEqual(H.without(['/a/b', '/a/b/', '/d', '/c/'], l, 'linux'), ['/d']);
  assert.deepEqual(H.show(l, '/a/b/', 'linux'), ['/c']);
  assert.deepEqual(H.show(l, 42, 'linux'), l);
  // Windows: one folder however written.
  const w = H.hide([], 'C:\\Proj', 'win32');
  assert.deepEqual(H.without(['c:/proj/', 'C:\\Other'], w, 'win32'), ['C:\\Other']);
  assert.deepEqual(H.show(w, 'c:\\PROJ\\', 'win32'), []);
  for (const bad of ['', 42, null, 'a\nb', 'x'.repeat(5000)]) assert.throws(() => H.hide([], bad, 'linux'), { code: 'bad_cwd' });
  // Bounded: the newest MAX; hiding again moves it to the end.
  let big = [];
  for (let i = 0; i < H.MAX + 20; i++) big = H.hide(big, `/d${i}`, 'linux');
  assert.equal(big.length, H.MAX);
  assert.equal(big[0], '/d20');
  big = H.hide(big, '/d20', 'linux');
  assert.equal(big.at(-1), '/d20');
  assert.equal(big.length, H.MAX);
  // A file edited by hand: what is not a path goes, duplicates once.
  assert.deepEqual(H.clean(['/a', 3, '', '/a/', '/b', { x: 1 }], 'linux'), ['/a', '/b']);
  assert.deepEqual(H.clean({ a: 1 }), []);
});

const agent = (pane, cwd) => ({ pane_id: pane, workspace_id: 'w1', agent: 'codex', agent_status: 'idle', state_change_seq: 1, terminal_title: 'codex', cwd });

test('routes: hidden on the host, out of recentCwds for everyone, kept in the file, back on show or on use', async (t) => {
  const hub = await startHub(t, { id: 'hid' });
  const a = fs.realpathSync(fs.mkdtempSync(path.join(hub.tmp, 'a-')));
  const b = fs.realpathSync(fs.mkdtempSync(path.join(hub.tmp, 'b-')));
  hub.herdr.agents.push(agent('w1-p2', a), agent('w1-p3', a + '/'), agent('w1-p4', b));
  const recent = async () => (await hub.request('GET', '/api/host')).body;
  await until(async () => (await recent()).recentCwds.includes(b), 'agents seen');
  let h = await recent();
  assert.deepEqual(h.recentCwds, [a, b, '/'], 'one folder for a and a/, most common first');
  assert.deepEqual(h.hiddenCwds, []);

  // Hide (written with its trailing separator: the same folder).
  let r = await hub.request('POST', '/api/recent/hide', { cwd: a + '/' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body, { ok: true, recentCwds: [b, '/'], hiddenCwds: [a] });
  h = await recent();
  assert.deepEqual([h.recentCwds, h.hiddenCwds], [[b, '/'], [a]]);
  const file = path.join(hub.tmp, 'data', 'hidden-cwds.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), [a]);
  assert.ok(!fs.existsSync(file + '.tmp'));
  // A folder that does not exist (deleted) can be hidden too.
  r = await hub.request('POST', '/api/recent/hide', { cwd: '/no/such/folder' });
  assert.deepEqual(r.body.hiddenCwds, [a, '/no/such/folder']);

  // Refusals: nothing hidden, the header still needed.
  for (const body of [{}, { cwd: '' }, { cwd: 7 }, { cwd: 'a\u0000b' }]) {
    r = await hub.request('POST', '/api/recent/hide', body);
    assert.deepEqual([r.status, r.body.error], [400, 'bad_cwd'], JSON.stringify(body));
  }
  r = await hub.request('POST', '/api/recent/show', {});
  assert.deepEqual([r.status, r.body.error], [400, 'bad_cwd']);
  r = await hub.request('POST', '/api/recent/hide', { cwd: b }, { 'X-Herdr-Hub': null });
  assert.equal(r.status, 403);
  assert.deepEqual((await recent()).hiddenCwds, [a, '/no/such/folder']);
  r = await hub.request('GET', '/api/recent/hide');
  assert.equal(r.status, 404);

  // 되돌리기.
  r = await hub.request('POST', '/api/recent/show', { cwd: '/no/such/folder/' });
  assert.deepEqual(r.body, { ok: true, recentCwds: [b, '/'], hiddenCwds: [a] });

  // A tab started there on purpose: back in 최근 폴더.
  r = await hub.request('POST', '/api/workspaces/w1/tabs', { cwd: a });
  assert.equal(r.status, 200, r.text);
  await until(async () => (await recent()).hiddenCwds.length === 0, 'unhidden by a new tab');
  assert.deepEqual((await recent()).recentCwds, [a, b, '/']);
  // And a new workspace there.
  await hub.request('POST', '/api/recent/hide', { cwd: b });
  r = await hub.request('POST', '/api/workspaces', { cwd: b + '/' });
  assert.equal(r.status, 200, r.text);
  await until(async () => (await recent()).hiddenCwds.length === 0, 'unhidden by a new workspace');
  await until(() => JSON.parse(fs.readFileSync(file, 'utf8')).length === 0, 'file written');
});

test('routes: the list is read back at start, cleaned', async (t) => {
  const hub = await startHub(t, { id: 'hid2', env: {} });
  // Write the file, then a second hub over the same data.
  await hub.request('POST', '/api/recent/hide', { cwd: '/' });
  assert.deepEqual((await hub.request('GET', '/api/host')).body.recentCwds, []);
  const data = path.join(hub.tmp, 'data');
  fs.writeFileSync(path.join(data, 'hidden-cwds.json'), JSON.stringify(['/', 5, '/x/', '/x']));
  const again = await startHub(t, { id: 'hid3', env: { HERDR_HUB_DATA: data } });
  const h = (await again.request('GET', '/api/host')).body;
  assert.deepEqual([h.recentCwds, h.hiddenCwds], [[], ['/', '/x']]);
});

test('proxy: a peer folder is hidden on that peer, not on the hub', async (t) => {
  const peer = await startHub(t, { id: 'hpa' });
  const hub = await startHub(t, { id: 'hhub', env: { HERDR_HUB_PEERS: `hpa=http://127.0.0.1:${peer.port}` } });
  await until(async () => (await hub.request('GET', '/api/state')).body.hosts.some((h) => h.id === 'hpa' && h.online), 'peer online');
  const r = await hub.request('POST', '/api/peers/hpa/recent/hide', { cwd: '/' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body, { ok: true, recentCwds: [], hiddenCwds: ['/'] });
  assert.deepEqual((await peer.request('GET', '/api/host')).body.hiddenCwds, ['/']);
  assert.deepEqual((await hub.request('GET', '/api/peers/hpa/host')).body.recentCwds, []);
  const own = (await hub.request('GET', '/api/host')).body;
  assert.deepEqual([own.recentCwds, own.hiddenCwds], [['/'], []]);
  assert.deepEqual((await hub.request('POST', '/api/peers/hpa/recent/show', { cwd: '/' })).body, { ok: true, recentCwds: ['/'], hiddenCwds: [] });
});
