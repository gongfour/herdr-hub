'use strict';
// For converting a file to T() (public/i18n.js): `node scripts/i18n-check.js <english.json> <file…>`
// says which T() texts in those files have no English in the JSON ({ 'Korean': 'English' |
// { one, other } }), which entries have other {placeholders} than their key, and any Hangul left
// outside T() (scripts/i18n-left.js). Exit 1 if anything is wrong.
const fs = require('fs');
const path = require('path');
const { leftovers } = require('./i18n-left');

const [json, ...files] = process.argv.slice(2);
const EN = { ...require('../public/i18n.en.js'), ...JSON.parse(fs.readFileSync(json, 'utf8')) };
const CALL = /\bT\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\$]|\\.)*)`)/g;
const unq = (s) => s.replace(/\\(.)/g, (m, c) => ({ n: '\n', t: '\t' })[c] || c);
const holes = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
let bad = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(CALL)) {
    const key = unq(m[1] ?? m[2] ?? m[3]);
    const at = `${path.basename(f)}:${src.slice(0, m.index).split('\n').length}`;
    const e = EN[key];
    if (e == null) {
      console.log(`no English  ${at}  ${key}`);
      bad++;
      continue;
    }
    for (const v of typeof e === 'string' ? [e] : [e.one, e.other])
      if (typeof v !== 'string' || holes(v) !== holes(key) || /[가-힣]/.test(v)) {
        console.log(`bad English ${at}  ${key} -> ${JSON.stringify(e)}`);
        bad++;
      }
  }
  for (const x of leftovers(src)) {
    console.log(`not in T()  ${path.basename(f)}:${x.line}  ${x.text}`);
    bad++;
  }
}
console.log(bad ? `${bad} to fix` : 'ok');
process.exit(bad ? 1 : 0);
