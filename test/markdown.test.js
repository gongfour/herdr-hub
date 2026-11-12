'use strict';
// The agent replies' markdown (public/markdown.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { md, inline } = require('../public/markdown.js');

test('inline: escaped first, then code, bold and links', () => {
  assert.equal(inline('a <b> & "c"'), 'a &lt;b&gt; &amp; &quot;c&quot;');
  assert.equal(inline('run `ls -la` **now**'), 'run <code>ls -la</code> <strong>now</strong>');
  assert.equal(inline('see https://x.dev/a?b=1)'), 'see <a href="https://x.dev/a?b=1" target="_blank" rel="noopener">https://x.dev/a?b=1</a>)');
});

test('paragraphs, line breaks and headings', () => {
  assert.equal(md('one\ntwo\n\nthree'), '<p>one<br>two</p><p>three</p>');
  assert.equal(md('## Title\nbody'), '<p><strong>Title</strong></p><p>body</p>');
});

test('fenced code is escaped and kept as it is', () => {
  assert.equal(md('```js\nif (a < b) **x**\n```'), '<pre><code>if (a &lt; b) **x**</code></pre>');
});

test('fenced code: wide characters in 2-cell spans, other non-ASCII in 1-cell runs, the text unchanged', () => {
  assert.equal(md('```\n│ 한글 ── a\n```'), '<pre><code><span class="tc">│</span> <span class="tc w2">한</span><span class="tc w2">글</span> <span class="tc" style="width:2ch">──</span> a</code></pre>');
  // The text inside the tags is the block's text as written: marks, joined emoji, flags and jamo
  // stay whole, nothing added or lost.
  const src = [
    '┌ 커밋 그래프 ──────────────┬ diff ──┐',
    '│ ◌ 커밋 안 한 변경 3       │ ⏺ 漢字 │',
    '│ e\u0301 n\u0303 👩\u200d💻 🇰🇷 ❤\ufe0f \u1100\u1161 ｱ Ａ │',
    '└──────────────────────────┴────────┘',
    'a\ttab <b> & "q"',
  ].join('\n');
  const html = md('```\n' + src + '\n```');
  const text = html.replace(/<[^>]*>/g, '').replace(/&(lt|gt|amp|quot|#39);/g, (_, e) => ({ lt: '<', gt: '>', amp: '&', quot: '"', '#39': "'" })[e]);
  assert.equal(text, src);
  assert.doesNotMatch(html, /<b>/);
  // Prose and tables are left as they were.
  assert.equal(md('한글 ── 본문'), '<p>한글 ── 본문</p>');
  assert.doesNotMatch(md('| 가 | ─ |\n|--|--|\n| 나 | ● |'), /class="tc/);
});

test('cells: widths as a terminal counts them', () => {
  const { widthOf, html } = require('../public/cells.js');
  for (const c of ['가', '漢', 'か', 'Ａ', '😀', '✅', '❤\ufe0f', '👩\u200d💻', '\u1100\u1161']) assert.equal(widthOf(c), 2, c);
  for (const c of ['─', '│', '●', '◌', '⏺', '·', '…', '❯', 'é', 'ｱ']) assert.equal(widthOf(c), 1, c);
  assert.equal(widthOf('\u0301'), 0);
  assert.equal(html('plain <ascii>'), 'plain &lt;ascii&gt;');
  // A long rule is cut into runs of 8, so a box that wraps its lines can still fold it.
  assert.equal((html('─'.repeat(20)).match(/<span/g) || []).length, 3);
});

test('tables: header, alignment, escaped pipes', () => {
  const html = md('| a | b |\n|:--:|--:|\n| 1 \\| 2 | x |');
  assert.equal(
    html,
    '<div class="table-wrap"><table><thead><tr><th style="text-align:center">a</th><th style="text-align:right">b</th></tr></thead>' +
      '<tbody><tr><td style="text-align:center">1 | 2</td><td style="text-align:right">x</td></tr></tbody></table></div>'
  );
  // A row of pipes without a separator line (two dashes at least) is just text.
  assert.equal(md('| a |\n|:-:|'), '<p>| a |<br>|:-:|</p>');
  assert.equal(md('| a |\n| b |'), '<p>| a |<br>| b |</p>');
});

test('lists: bullets, numbers, continuation lines', () => {
  assert.equal(md('- one\n  more\n- two'), '<ul><li>one<br>more</li><li>two</li></ul>');
  assert.equal(md('1. a\n2) b'), '<ol><li>a</li><li>b</li></ol>');
  assert.equal(md('intro\n- x'), '<p>intro</p><ul><li>x</li></ul>');
});

test('lists nest by indentation, bullets and numbers mixed', () => {
  assert.equal(
    md('올린 것:\n- a\n  - b\n    - c\n  - d\n- e'),
    '<p>올린 것:</p><ul><li>a<ul><li>b<ul><li>c</li></ul></li><li>d</li></ul></li><li>e</li></ul>'
  );
  // Under "1." the item's text starts at column 3, but two spaces already nest a list.
  assert.equal(md('1. a\n   - x\n2. b\n  - y'), '<ol><li>a<ul><li>x</li></ul></li><li>b<ul><li>y</li></ul></li></ol>');
  assert.equal(md('- a\n    1. deep\n    2. deeper'), '<ul><li>a<ol><li>deep</li><li>deeper</li></ol></li></ul>');
  // A marker one space in is still the next item; another kind of list at the margin is a new list.
  assert.equal(md('- a\n - b'), '<ul><li>a</li><li>b</li></ul>');
  assert.equal(md('- a\n1. b'), '<ul><li>a</li></ul><ol><li>b</li></ol>');
  // A line back at the margin ends the list.
  assert.equal(md('- a\nafter'), '<ul><li>a</li></ul><p>after</p>');
  assert.equal(md('3. three\n4. four'), '<ol start="3"><li>three</li><li>four</li></ol>');
  assert.equal(md('* * *\n- x'), '<hr><ul><li>x</li></ul>');
});

test('an item holds its own paragraphs, code, tables and quotes', () => {
  assert.equal(
    md('1. **첫째**\n\n   설명 문단\n   다음 줄\n\n   ```sh\n   ls -la\n\n   pwd\n   ```\n2. 둘째'),
    '<ol><li><p><strong>첫째</strong></p><p>설명 문단<br>다음 줄</p><pre><code>ls -la\n\npwd</code></pre></li><li><p>둘째</p></li></ol>'
  );
  // Blank lines between items make the list loose (paragraphs); without them it stays bare text.
  assert.equal(md('- one\n\n- two'), '<ul><li><p>one</p></li><li><p>two</p></li></ul>');
  assert.equal(md('- a\n  | x | y |\n  |---|---|\n  | 1 | 2 |'),
    '<ul><li>a<div class="table-wrap"><table><thead><tr><th>x</th><th>y</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table></div></li></ul>');
  assert.equal(md('- a\n  > said'), '<ul><li>a<blockquote><p>said</p></blockquote></li></ul>');
  // A fence in an item keeps a line that is less indented than the item.
  assert.equal(md('- run:\n  ```\nraw\n  ```\n- next'), '<ul><li>run:<pre><code>raw</code></pre></li><li>next</li></ul>');
});

test('quotes, nested, with blocks inside', () => {
  assert.equal(md('> 인용\n> 둘째 줄'), '<blockquote><p>인용<br>둘째 줄</p></blockquote>');
  assert.equal(md('> a\n> > b\n> - c'), '<blockquote><p>a</p><blockquote><p>b</p></blockquote><ul><li>c</li></ul></blockquote>');
  assert.equal(md('text\n> q\nafter'), '<p>text</p><blockquote><p>q</p></blockquote><p>after</p>');
  assert.equal(md('a > b'), '<p>a &gt; b</p>');
});

test('fences: indented, tildes, unclosed, inside quotes', () => {
  assert.equal(md('text\n```\n**not bold** <b>\n```\nmore'), '<p>text</p><pre><code>**not bold** &lt;b&gt;</code></pre><p>more</p>');
  assert.equal(md('~~~\n```\n~~~'), '<pre><code>```</code></pre>');
  assert.equal(md('```\nstill\ncode'), '<pre><code>still\ncode</code></pre>');
  assert.equal(md('> ```\n> x\n> ```'), '<blockquote><pre><code>x</code></pre></blockquote>');
});

test('inline: italic, strike, never inside a word', () => {
  assert.equal(inline('*기울임*은 _이것_'), '<em>기울임</em>은 <em>이것</em>');
  assert.equal(inline('snake_case_name file*names* a*b*c __init__'), 'snake_case_name file*names* a*b*c __init__');
  assert.equal(inline('*.js, *.ts and 2 * 3 * 4'), '*.js, *.ts and 2 * 3 * 4');
  assert.equal(inline('~~취소~~ ~5분 ~~ x ~~'), '<del>취소</del> ~5분 ~~ x ~~');
  assert.equal(inline('**굵게 *안***'), '<strong>굵게 <em>안</em></strong>');
  assert.equal(inline('*a **b** c*'), '<em>a <strong>b</strong> c</em>');
  // A span that would cut another in two stays text.
  assert.equal(inline('~~a *b~~ c*'), '<del>a *b</del> c*');
  assert.equal(inline('\\*literal\\* `*code*` `` a`b ``'), '*literal* <code>*code*</code> <code>a`b</code>');
});

test('inline: links stay links, emphasis stays out of them', () => {
  assert.equal(inline('[문서](https://x.dev/a_b_c?q=1&r=2)'), '<a href="https://x.dev/a_b_c?q=1&amp;r=2" target="_blank" rel="noopener">문서</a>');
  assert.equal(inline('see https://x.dev/_a_/b.'), 'see <a href="https://x.dev/_a_/b" target="_blank" rel="noopener">https://x.dev/_a_/b</a>.');
  assert.equal(inline('https://x.dev에서'), '<a href="https://x.dev" target="_blank" rel="noopener">https://x.dev</a>에서');
  // Only http(s): no javascript: link from [text](...), and the text is escaped.
  assert.equal(inline('[x](javascript:alert(1))'), '[x](javascript:alert(1))');
  assert.equal(inline('[<b>](https://x.dev)'), '<a href="https://x.dev" target="_blank" rel="noopener">&lt;b&gt;</a>');
  assert.equal(inline('https://x.dev/"onmouseover="x'), '<a href="https://x.dev/" target="_blank" rel="noopener">https://x.dev/</a>&quot;onmouseover=&quot;x');
});

test('no raw HTML anywhere', () => {
  const html = md('<script>alert(1)</script>\n- <img src=x onerror=y>\n> <iframe>\n\n| <b> |\n|---|\n| <i> |');
  assert.doesNotMatch(html, /<(script|img|iframe|b|i)[\s>]/);
  assert.equal(md('a\u0000b\u00011\u0001'), '<p>ab1</p>');
});

// A link never ends up inside another link's href (a mark put back there would close the
// attribute with its own quotes, and the rest of the URL would become attributes: onmouseover=…).
test('links: nothing cut out before a URL lands in its href', () => {
  const nested = (html) => {
    let depth = 0;
    for (const m of html.matchAll(/<a\b[^>]*>|<\/a>/g)) {
      depth += m[0] === '</a>' ? -1 : 1;
      if (depth > 1) return true;
    }
    return false;
  };
  const cases = [
    'http://x/[l](http://y/onmouseover=location=/javascript:alert%281%29/.source//)',
    'https://x/[a](https://y)[b](https://z)',
    '[a](http://y/`z`)',
    'http://x/`code`y',
    'http://x/\\*y',
    '[t](http://a/[u](http://b))',
  ];
  for (const t of cases) {
    const html = inline(t);
    assert.equal(nested(html), false, `${t} -> ${html}`);
    for (const [, href] of html.matchAll(/href="([^"]*)"/g)) assert.doesNotMatch(href, /[<>\u0000\u0001]/, `${t} -> ${html}`);
    // Every tag holds only its own attributes: no on…= outside a quoted value.
    for (const [tag] of html.matchAll(/<a\b[^>]*>/g)) assert.match(tag, /^<a href="[^"<>]*" target="_blank" rel="noopener">$/, `${t} -> ${html}`);
  }
  assert.equal(inline('http://x/[l](http://y/z)'), '<a href="http://x/" target="_blank" rel="noopener">http://x/</a><a href="http://y/z" target="_blank" rel="noopener">l</a>');
});
