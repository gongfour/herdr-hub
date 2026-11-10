'use strict';
// Korean text in the page's code that is not passed through T() (public/i18n.js): every string or
// template literal with Hangul in it, outside comments and regular expressions, that is not the
// first argument of T(…). `node scripts/i18n-left.js [file…]` lists them (all of public/ by
// default); test/i18n.test.js expects none. A line that must stay Korean whatever the language
// (Claude Code's own Korean words it matches, the 언어 setting's own labels) ends with `// ko-only`.
const fs = require('fs');
const path = require('path');

const HANGUL = /[가-힣]/;
const REGEX_BEFORE = /[(,=:[!&|?{};+\-*%<>~^]$|(?:^|[^\w$])(?:return|typeof|case|of|in|void|delete|throw|new|else|do)$/;

// -> [{ line, text }] for the literals with Hangul outside T().
function leftovers(src) {
  const out = [];
  const lines = src.split('\n');
  const okLines = new Set(lines.map((l, i) => (/\/\/\s*ko-only\b/.test(l) ? i + 1 : 0)).filter(Boolean));
  let i = 0;
  let line = 1;
  const stack = []; // template nesting: '`' inside ${ … }
  let braceDepth = [];
  const lineAt = (from, to) => {
    for (let k = from; k < to; k++) if (src[k] === '\n') line++;
  };
  const prevSig = (k) => {
    let j = k - 1;
    while (j >= 0 && /\s/.test(src[j])) j--;
    let w = '';
    let m = j;
    while (m >= 0 && /[\w$]/.test(src[m])) w = src[m--] + w;
    return w ? src.slice(Math.max(0, m - 10), j + 1) : src[j] || '';
  };
  // Whether the literal starting at k is T's first argument: `T(` right before it.
  const inT = (k) => /(?:^|[^\w$.])T\(\s*$/.test(src.slice(Math.max(0, k - 20), k));
  const note = (start, text, startLine, isTemplateWithHoles) => {
    if (!HANGUL.test(text) || okLines.has(startLine)) return;
    if (inT(start) && !isTemplateWithHoles) return;
    out.push({ line: startLine, text: text.replace(/\s+/g, ' ').slice(0, 90) });
  };
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    // Inside a template's ${…}: a } that closes it goes back to the template.
    if (c === '}' && braceDepth.length && braceDepth[braceDepth.length - 1] === 0) {
      braceDepth.pop();
      i++;
      i = template(i, true);
      continue;
    }
    if (c === '{' && braceDepth.length) braceDepth[braceDepth.length - 1]++;
    if (c === '}' && braceDepth.length) braceDepth[braceDepth.length - 1]--;
    if (c === '\n') line++;
    if (c === '/' && n === '/') {
      const e = src.indexOf('\n', i);
      i = e < 0 ? src.length : e;
      continue;
    }
    if (c === '/' && n === '*') {
      const e = src.indexOf('*/', i + 2);
      lineAt(i, e < 0 ? src.length : e);
      i = e < 0 ? src.length : e + 2;
      continue;
    }
    if (c === "'" || c === '"') {
      const start = i;
      const startLine = line;
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      note(start, src.slice(start + 1, j), startLine, false);
      lineAt(start, j);
      i = j + 1;
      continue;
    }
    if (c === '`') {
      i = template(i + 1, false, i);
      continue;
    }
    if (c === '/' && REGEX_BEFORE.test(prevSig(i))) {
      let j = i + 1;
      let cls = false;
      while (j < src.length && src[j] !== '\n') {
        if (src[j] === '\\') j += 2;
        else {
          if (src[j] === '[') cls = true;
          else if (src[j] === ']') cls = false;
          else if (src[j] === '/' && !cls) break;
          j++;
        }
      }
      i = j + 1;
      continue;
    }
    i++;
  }
  // A template from k (just past ` or a ${…}'s }): its text parts, until ` or the next ${.
  function template(k, resumed, open = null) {
    const startLine = line;
    let text = '';
    let holes = resumed;
    let j = k;
    while (j < src.length) {
      if (src[j] === '\\') {
        text += src.slice(j, j + 2);
        j += 2;
        continue;
      }
      if (src[j] === '`') {
        if (open != null) note(open, text, startLine, holes);
        else if (HANGUL.test(text) && !okLines.has(startLine)) out.push({ line: startLine, text: text.replace(/\s+/g, ' ').slice(0, 90) });
        lineAt(k, j);
        return j + 1;
      }
      if (src[j] === '$' && src[j + 1] === '{') {
        holes = true;
        if (HANGUL.test(text) && !okLines.has(startLine)) out.push({ line: startLine, text: text.replace(/\s+/g, ' ').slice(0, 90) });
        lineAt(k, j);
        braceDepth.push(0);
        return j + 2;
      }
      text += src[j];
      j++;
    }
    return j;
  }
  return out;
}

module.exports = { leftovers };

if (require.main === module) {
  const PUB = path.join(__dirname, '..', 'public');
  const args = process.argv.slice(2);
  const list = args.length ? args : fs.readdirSync(PUB).filter((f) => f.endsWith('.js') && !f.startsWith('i18n') && f !== 'sw.js').map((f) => path.join(PUB, f));
  let total = 0;
  for (const f of list) {
    const left = leftovers(fs.readFileSync(f, 'utf8'));
    total += left.length;
    for (const x of left) console.log(`${path.relative(process.cwd(), f)}:${x.line}  ${x.text}`);
  }
  console.log(`${total} left`);
}
