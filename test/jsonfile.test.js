'use strict';
// The Hub's own data files (lib/jsonfile.js) and the notification store on them (lib/push.js): a
// file cut short by a crash must not keep the hub from starting.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jsonfile = require('../lib/jsonfile');
const { Push } = require('../lib/push');

const tmpDir = (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-jsonfile-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};

test('read: the file, the fallback when there is none, a broken one set aside as .bad', (t) => {
  const d = tmpDir(t);
  const f = path.join(d, 'x.json');
  assert.deepEqual(jsonfile.read(f, { fallback: [] }), []);
  fs.writeFileSync(f, '[1,2]');
  assert.deepEqual(jsonfile.read(f), [1, 2]);
  fs.writeFileSync(f, '[{"endpoint": "https://a", "ke');
  const logged = [];
  assert.deepEqual(jsonfile.read(f, { fallback: [], log: (m) => logged.push(m) }), []);
  assert.equal(fs.existsSync(f), false);
  assert.equal(fs.readFileSync(`${f}.bad`, 'utf8'), '[{"endpoint": "https://a", "ke');
  assert.match(logged[0], /not JSON/);
});

test('writer: writes in the order asked, whole, and leaves no .tmp', async (t) => {
  const d = tmpDir(t);
  const f = path.join(d, 'sub', 'y.json');
  const save = jsonfile.writer(f, { mode: 0o600 });
  await Promise.all([save([1]), save([1, 2]), save([1, 2, 3])]);
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), [1, 2, 3]);
  assert.equal(fs.existsSync(`${f}.tmp`), false);
  if (process.platform !== 'win32') assert.equal(fs.statSync(f).mode & 0o777, 0o600);
});

test('Push starts on a cut-short subscriptions.json (no devices) and a broken vapid.json (new keys)', async (t) => {
  const d = tmpDir(t);
  const first = new Push(d, 'https://hub.invalid');
  await first.add({ endpoint: 'https://push.example/1', keys: { p256dh: 'a', auth: 'b' } });
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, 'subscriptions.json'), 'utf8')).length, 1);
  assert.equal(new Push(d, 'https://hub.invalid').publicKey, first.publicKey); // kept across starts

  fs.writeFileSync(path.join(d, 'subscriptions.json'), '[{"endpoint":');
  const again = new Push(d, 'https://hub.invalid');
  assert.deepEqual(again.subs, []);
  assert.ok(fs.existsSync(path.join(d, 'subscriptions.json.bad')));
  assert.equal(again.publicKey, first.publicKey);

  fs.writeFileSync(path.join(d, 'vapid.json'), '{"publicKey": "BA');
  const fresh = new Push(d, 'https://hub.invalid');
  assert.notEqual(fresh.publicKey, first.publicKey);
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, 'vapid.json'), 'utf8')).publicKey, fresh.publicKey);
});

test('Push keeps only a well-formed https subscription, at most 50 devices', async (t) => {
  const d = tmpDir(t);
  const p = new Push(d, 'https://hub.invalid');
  const ok = (i) => ({ endpoint: `https://push.example/${i}`, keys: { p256dh: 'BKey', auth: 'aa' }, extra: 'dropped' });
  for (const bad of [null, {}, { endpoint: 'http://push.example/1', keys: { p256dh: 'a', auth: 'b' } }, { endpoint: 'https://p/1', keys: { p256dh: 'a' } }, { endpoint: 'https://p/1', keys: { p256dh: 'x'.repeat(300), auth: 'b' } }])
    assert.throws(() => p.add(bad), (e) => e.status === 400 && e.code === 'bad_subscription');
  for (let i = 0; i < 55; i++) await p.add(ok(i));
  assert.equal(p.subs.length, 50);
  assert.equal(p.subs[0].endpoint, 'https://push.example/5'); // the oldest went
  assert.deepEqual(Object.keys(p.subs[0]).sort(), ['added', 'endpoint', 'keys', 'lang']);
});

test('Push: each device gets the payload in its own language, made once per language', async (t) => {
  const d = tmpDir(t);
  const p = new Push(d, 'https://hub.invalid');
  await p.add({ endpoint: 'https://push.example/a', keys: { p256dh: 'BKey', auth: 'aa' }, lang: 'en' });
  await p.add({ endpoint: 'https://push.example/b', keys: { p256dh: 'BKey', auth: 'aa' } });
  await p.add({ endpoint: 'https://push.example/c', keys: { p256dh: 'BKey', auth: 'aa' }, lang: 'xx' });
  assert.deepEqual(p.subs.map((s) => s.lang), ['en', 'ko', 'ko']);
  const webpush = require('web-push');
  const sent = [];
  t.mock.method(webpush, 'sendNotification', async (sub, body) => sent.push([sub.endpoint, JSON.parse(body).title]));
  const made = [];
  const r = await p.send((lang) => (made.push(lang), { title: lang === 'en' ? 'Needs answer' : '답 필요' }));
  assert.equal(r.sent, 3);
  assert.deepEqual(made.sort(), ['en', 'ko']);
  assert.deepEqual(sent.sort(), [['https://push.example/a', 'Needs answer'], ['https://push.example/b', '답 필요'], ['https://push.example/c', '답 필요']]);
});
