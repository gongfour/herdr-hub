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
