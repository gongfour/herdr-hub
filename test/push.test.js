'use strict';
// 시험 알림 goes to the asking device only. web-push is stubbed: nothing leaves this process.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const webpush = require('web-push');
const { Push } = require('../lib/push');

test('sendTo reaches only the given endpoint; send reaches all', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-hub-push-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sent = [];
  t.mock.method(webpush, 'sendNotification', async (sub) => {
    sent.push(sub.endpoint);
    if (sub.endpoint === 'https://push.invalid/gone') throw Object.assign(new Error('gone'), { statusCode: 410 });
  });
  const push = new Push(dir, 'https://herdr-hub.invalid');
  const keys = { p256dh: 'x', auth: 'y' };
  push.add({ endpoint: 'https://push.invalid/phone', keys });
  push.add({ endpoint: 'https://push.invalid/laptop', keys });

  assert.deepEqual(await push.sendTo('https://push.invalid/laptop', { title: 't' }), { sent: 1, removed: 0, found: true });
  assert.deepEqual(sent, ['https://push.invalid/laptop']);

  sent.length = 0;
  assert.deepEqual(await push.sendTo('https://push.invalid/unknown', { title: 't' }), { sent: 0, removed: 0, found: false });
  assert.deepEqual(sent, []);

  push.add({ endpoint: 'https://push.invalid/gone', keys });
  const r = await push.send({ title: 't' });
  assert.equal(r.sent, 2);
  assert.equal(r.removed, 1);
  assert.equal(push.has('https://push.invalid/gone'), false);
});
