'use strict';
// The colour someone gave each host: public/hostcolor.js (pure, the hub's and the page's), and the
// /api/colors routes (stored on the hub, sent with each host in the state).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const HostColor = require('../public/hostcolor');
const { hubInProcess, until } = require('./fixtures/hub');

test('clean: a hand-edited file keeps the hosts with a known colour', () => {
  assert.deepEqual(HostColor.clean(null), {});
  assert.deepEqual(HostColor.clean(['blue']), {});
  assert.deepEqual(HostColor.clean({ desk: 'blue', srv: 'chartreuse', '': 'green', mac: 3, lap: 'teal' }), { desk: 'blue', lap: 'teal' });
});

test('set: one host at a time, empty takes it away, the same map when nothing changed', () => {
  const a = HostColor.set({}, 'desk', 'blue');
  assert.deepEqual(a, { desk: 'blue' });
  assert.equal(HostColor.set(a, 'desk', 'blue'), a, 'unchanged: the same map');
  assert.equal(HostColor.set(a, 'srv', ''), a, 'nothing to take away');
  const b = HostColor.set(a, 'srv', 'pink');
  assert.deepEqual(b, { desk: 'blue', srv: 'pink' });
  assert.deepEqual(a, { desk: 'blue' }, 'not changed in place');
  assert.deepEqual(HostColor.set(b, 'desk', ''), { srv: 'pink' });
  assert.deepEqual(HostColor.set(b, 'desk', null), { srv: 'pink' });
  // A host no longer known loses its colour with the next change.
  assert.deepEqual(HostColor.set(b, 'desk', 'green', ['desk']), { desk: 'green' });
  assert.throws(() => HostColor.set(b, 'desk', 'chartreuse'), { code: 'bad_color', status: 400 });
  for (const c of HostColor.COLORS) assert.match(c, /^[a-z]+$/, 'safe in an attribute and a CSS selector');
});

test('every colour has a light and a dark value, and its [data-hc] rule (style.css)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  for (const c of HostColor.COLORS) {
    assert.match(css, new RegExp(`--hc-${c}: #[0-9a-f]{6}`), `--hc-${c}`);
    assert.match(css, new RegExp(`--d-hc-${c}: #[0-9a-f]{6}`), `--d-hc-${c}`);
    assert.equal(css.split(`--hc-${c}: var(--d-hc-${c})`).length - 1, 2, `${c} switched on in both dark blocks`);
    assert.match(css, new RegExp(`\\[data-hc="${c}"\\] \\{ --hc: var\\(--hc-${c}\\); \\}`), `[data-hc="${c}"]`);
  }
});

test('/api/colors: stored on the hub (data/host-colors.json), with each host in the state at once; bad bodies change nothing', async (t) => {
  const h = await hubInProcess(t, { id: 'desk', env: { HERDR_HUB_PEERS: 'srv=http://127.0.0.1:9' } });
  const state = async () => (await h.request('GET', '/api/state')).body;
  const colors = async () => Object.fromEntries((await state()).hosts.map((x) => [x.id, x.color || null]));
  assert.deepEqual(await colors(), { desk: null, srv: null }, 'none until one is given');
  for (const [p, body, status, error] of [
    ['/api/colors/hosts', { host: 'nope', color: 'blue' }, 404, 'unknown_host'],
    ['/api/colors/hosts', { color: 'blue' }, 404, 'unknown_host'],
    ['/api/colors/hosts', { host: 'desk', color: 'chartreuse' }, 400, 'bad_color'],
    ['/api/colors/hosts', { host: 'desk', color: 3 }, 400, 'bad_color'],
    ['/api/colors/bogus', { host: 'desk' }, 404, 'not_found'],
  ]) {
    const r = await h.request('POST', p, body);
    assert.equal(r.status, status, `${p} ${JSON.stringify(body)}`);
    assert.equal(r.body.error, error, p);
  }
  assert.equal((await h.request('POST', '/api/colors/hosts', { host: 'desk', color: 'blue' }, { 'X-Herdr-Hub': null })).status, 403);
  assert.deepEqual((await h.request('GET', '/api/colors')).body, {});

  const r = await h.request('POST', '/api/colors/hosts', { host: 'desk', color: 'blue' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.colors, { desk: 'blue' });
  // A peer's colour too (the hub's, not passed to the peer); the state has both at once.
  assert.equal((await h.request('POST', '/api/colors/hosts', { host: 'srv', color: 'pink' })).status, 200);
  assert.deepEqual(await colors(), { desk: 'blue', srv: 'pink' });
  const file = path.join(h.tmp, 'data', 'host-colors.json');
  await until(() => fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).srv === 'pink', 'host-colors.json written');
  assert.deepEqual(HostColor.clean(JSON.parse(fs.readFileSync(file, 'utf8'))), { desk: 'blue', srv: 'pink' }, 'read back at the next start');
  // Taken away: the host goes back to none.
  assert.equal((await h.request('POST', '/api/colors/hosts', { host: 'desk', color: '' })).status, 200);
  assert.deepEqual(await colors(), { desk: null, srv: 'pink' });
});
