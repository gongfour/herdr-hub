'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('../lib/transcript');

const line = (o) => JSON.stringify(o);
// Claude Code 2.1.317 after a prompt "이 이미지에 뭐가 보여?\n<upload path>" (base64 shortened).
const jsonl = [
  line({ type: 'user', promptId: 'p1', timestamp: 't1', message: { role: 'user', content: [{ type: 'text', text: '[Image #1]이 이미지에 뭐가 보여?' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0K' } }] } }),
  line({ type: 'user', promptId: 'p1', isMeta: true, message: { role: 'user', content: [{ type: 'text', text: '[Image: source: C:\\Users\\k\\AppData\\Local\\Temp\\herdr-hub-uploads\\20261103-115548-fabc3788.png]' }] } }),
  line({ type: 'assistant', message: { id: 'a1', content: [{ type: 'text', text: 'PADDOCK 42' }] } }),
  line({ type: 'user', promptId: 'p3', message: { role: 'user', content: [{ type: 'text', text: '[Image #2] [Image #3]둘 다' }, { type: 'image', source: {} }, { type: 'image', source: {} }] } }),
  line({ type: 'user', promptId: 'p3', isMeta: true, message: { role: 'user', content: [{ type: 'text', text: '[Image: source: /tmp/herdr-hub-uploads/20261103-115729-aeda50ca.png]' }, { type: 'text', text: '[Image: source: /tmp/herdr-hub-uploads/20261103-115729-e83689a9.jpg]' }] } }),
  line({ type: 'user', promptId: 'p2', message: { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'x' } }] } }),
  line({ type: 'user', promptId: 'p2', isMeta: true, message: { role: 'user', content: [{ type: 'text', text: '[Image: source: /Users/k/Desktop/shot.png]' }] } }),
  line({ type: 'user', isMeta: true, message: { role: 'user', content: 'Caveat: meta' } }),
].join('\n');

test('inline images are counted, never passed on, and their uploads named', () => {
  const m = parse(jsonl);
  assert.equal(m.length, 4);
  assert.deepEqual(m[2].uploads, ['20261103-115729-aeda50ca.png', '20261103-115729-e83689a9.jpg']);
  assert.deepEqual(m[0], { role: 'user', text: '[Image #1]이 이미지에 뭐가 보여?', ts: 't1', images: 1, uploads: ['20261103-115548-fabc3788.png'] });
  assert.equal(m[1].text, 'PADDOCK 42');
  // An image that is not a Herdr Hub upload: counted only.
  assert.deepEqual({ images: m[3].images, uploads: m[3].uploads, text: m[3].text }, { images: 1, uploads: undefined, text: '' });
  assert.ok(!JSON.stringify(m).includes('iVBOR'));
});
