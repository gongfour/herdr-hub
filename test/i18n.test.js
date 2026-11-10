'use strict';
// The page's English (public/i18n.js, i18n.en.js): every text the page passes to T() has its
// English, with the same {placeholders}; and the translation itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const I18n = require('../public/i18n.js');
const EN = require('../public/i18n.en.js');

const PUB = path.join(__dirname, '..', 'public');
const files = fs.readdirSync(PUB).filter((f) => f.endsWith('.js') && !f.startsWith('i18n'));
// T('…'), T("…") and T(`…`) without ${}: the first argument as written.
const CALL = /\bT\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\$]|\\.)*)`)/g;
const unq = (s) => s.replace(/\\(.)/g, (m, c) => ({ n: '\n', t: '\t' })[c] || c);
const holes = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

function keysUsed() {
  const out = new Map(); // key -> first file:line
  for (const f of files) {
    const src = fs.readFileSync(path.join(PUB, f), 'utf8');
    for (const m of src.matchAll(CALL)) {
      const key = unq(m[1] ?? m[2] ?? m[3]);
      if (!out.has(key)) out.set(key, `${f}:${src.slice(0, m.index).split('\n').length}`);
    }
  }
  return out;
}

test('every T() text has its English, with the same placeholders', () => {
  const missing = [];
  const holesDiffer = [];
  for (const [key, at] of keysUsed()) {
    const e = EN[key];
    if (e == null) missing.push(`${at}  ${key}`);
    else for (const v of typeof e === 'string' ? [e] : [e.one, e.other]) if (holes(v) !== holes(key)) holesDiffer.push(`${at}  ${key} -> ${v}`);
  }
  assert.deepEqual(missing, [], `no English for:\n${missing.join('\n')}`);
  assert.deepEqual(holesDiffer, []);
});

test('English words for every key; no Hangul left in them', () => {
  for (const [k, v] of Object.entries(EN)) {
    for (const s of typeof v === 'string' ? [v] : [v.one, v.other]) {
      assert.equal(typeof s, 'string', k);
      assert.ok(s.length, k);
      assert.doesNotMatch(s, /[가-힣]/, `${k} -> ${s}`);
    }
  }
});

test('T: Korean as written, English when chosen, placeholders and counts', () => {
  const EN2 = { '답 필요 {n}개': { one: '{n} needs an answer', other: '{n} need answers' }, '열기': 'Open' };
  const saved = { ...EN };
  Object.assign(EN, EN2);
  try {
    assert.equal(I18n.tIn('ko', '답 필요 {n}개', { n: 2 }), '답 필요 2개');
    assert.equal(I18n.tIn('en', '답 필요 {n}개', { n: 1 }), '1 needs an answer');
    assert.equal(I18n.tIn('en', '답 필요 {n}개', { n: 3 }), '3 need answers');
    assert.equal(I18n.tIn('en', '열기'), 'Open');
    assert.equal(I18n.tIn('en', '아직 없는 말'), '아직 없는 말'); // no English yet: the Korean
    assert.equal(I18n.tIn('en', '{a}와 {b}', { a: 'x' }), '{a}와 {b}'.replace('{a}', 'x')); // a missing var stays
    assert.equal(I18n.t('열기'), '열기'); // the tests run in Korean
  } finally {
    for (const k of Object.keys(EN2)) if (!(k in saved)) delete EN[k];
  }
});
