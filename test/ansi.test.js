'use strict';
// npm test  (node --test test/*.test.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const Ansi = require('../public/ansi.js');
const { toHtml, strip, contrast } = Ansi;

const E = '\x1b';
const LIGHT = { dark: false, fg: [29, 28, 25], bg: [255, 255, 255] };
const DARK = { dark: true, fg: [236, 235, 230], bg: [31, 31, 28] };
const rgbOf = (html) => html.match(/rgb\((\d+),(\d+),(\d+)\)/).slice(1).map(Number);

test('plain text is escaped and needs no spans', () => {
  assert.equal(toHtml(`<img src=x onerror="alert('1')"> & co`), '&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt; &amp; co');
  assert.equal(toHtml(`${E}[31m<b>${E}[0m`), '<span class="af1">&lt;b&gt;</span>');
});

test('reset, attributes and their resets', () => {
  assert.equal(toHtml(`${E}[1ma${E}[22mb`), '<span class="a-b">a</span>b');
  assert.equal(toHtml(`${E}[2ma${E}[22mb`), '<span class="a-d">a</span>b');
  assert.equal(toHtml(`${E}[3ma${E}[23mb`), '<span class="a-i">a</span>b');
  assert.equal(toHtml(`${E}[4ma${E}[24mb`), '<span class="a-u">a</span>b');
  assert.equal(toHtml(`${E}[9ma${E}[29mb`), '<span class="a-s">a</span>b');
  assert.equal(toHtml(`${E}[4;9ma`), '<span class="a-us">a</span>');
  assert.equal(toHtml(`${E}[1;3;31ma${E}[0mb${E}[mc`), '<span class="af1 a-b a-i">a</span>bc');
});

test('basic foreground and background colours', () => {
  assert.equal(toHtml(`${E}[30ma${E}[37mb`), '<span class="af0">a</span><span class="af7">b</span>');
  assert.equal(toHtml(`${E}[90ma${E}[97mb`), '<span class="af8">a</span><span class="af15">b</span>');
  assert.equal(toHtml(`${E}[41ma${E}[47mb`), '<span class="ab1">a</span><span class="ab7">b</span>');
  assert.equal(toHtml(`${E}[100ma${E}[107mb`), '<span class="ab8">a</span><span class="ab15">b</span>');
  assert.equal(toHtml(`${E}[32;44ma${E}[39mb${E}[49mc`), '<span class="ab4 af2">a</span><span class="ab4">b</span>c');
});

test('inverse swaps colours, defaults included', () => {
  assert.equal(toHtml(`${E}[7ma${E}[27mb`), '<span class="abfg afbg">a</span>b');
  assert.equal(toHtml(`${E}[31;7ma`), '<span class="aB1 afbg">a</span>');
});

test('256 colours: 0-15 are classes, the rest rgb', () => {
  assert.equal(toHtml(`${E}[38;5;9ma`), '<span class="af9">a</span>');
  assert.equal(toHtml(`${E}[48;5;2ma`), '<span class="ab2">a</span>');
  assert.equal(toHtml(`${E}[38;5;214ma`, DARK), '<span style="color:rgb(255,175,0)">a</span>');
  // pure red is under 4.5:1 on the dark box: lifted toward white
  assert.ok(contrast(rgbOf(toHtml(`${E}[38;5;196ma`, DARK)), DARK.bg) >= 4.5);
  assert.equal(toHtml(`${E}[38;5;250ma`, DARK), '<span style="color:rgb(188,188,188)">a</span>');
  assert.equal(toHtml(`${E}[38;5;256ma`), 'a'); // out of range: ignored
});

test('truecolor, with ; and : separators', () => {
  assert.equal(toHtml(`${E}[38;2;215;119;87ma`, DARK), '<span style="color:rgb(215,119,87)">a</span>');
  assert.equal(toHtml(`${E}[38:2::215:119:87ma`, DARK), '<span style="color:rgb(215,119,87)">a</span>');
  assert.equal(toHtml(`${E}[38;2;300;0;0ma`, DARK), 'a'); // not a byte
  assert.equal(toHtml(`${E}[48;2;10;20;30ma`, DARK), '<span style="background:rgb(10,20,30)">a</span>');
  // parameters after a truecolor colour still apply
  assert.equal(toHtml(`${E}[38;2;215;119;87;1ma`, DARK), '<span class="a-b" style="color:rgb(215,119,87)">a</span>');
});

test('light theme: pale truecolor keeps its hue but reaches 4.5:1', () => {
  const html = toHtml(`${E}[38;2;153;153;153m(1m 5s)`, LIGHT);
  const c = rgbOf(html);
  assert.ok(contrast(c, LIGHT.bg) >= 4.5, html);
  assert.equal(c[0], c[1]); // still grey
  const orange = rgbOf(toHtml(`${E}[38;2;215;119;87m✳`, LIGHT));
  assert.ok(contrast(orange, LIGHT.bg) >= 4.5);
  assert.ok(orange[0] > orange[1] && orange[1] > orange[2]); // still orange
});

test('light theme: a dark background becomes a light tint the text reads on', () => {
  const html = toHtml(`${E}[48;2;2;40;0m${E}[38;2;255;255;255m+ added line`, LIGHT);
  const [bg, fg] = [...html.matchAll(/rgb\((\d+),(\d+),(\d+)\)/g)].map((m) => m.slice(1).map(Number));
  assert.ok(bg[1] > bg[0] && bg[1] > bg[2], `green-ish ${bg}`);
  assert.ok(bg.every((v) => v > 180), `light ${bg}`);
  assert.ok(contrast(fg, bg) >= 4.5, `${fg} on ${bg}`);
});

test('unknown and non-SGR sequences are stripped, never shown', () => {
  const junk = `${E}]0;title${E}\\${E}]8;;http://x${E}\\link${E}]8;;${E}\\${E}[?25l${E}[2J${E}[10;5H${E}[K${E}7${E}8${E}(B${E}[>4;2m${E}[5mok${E}P1;2q${E}\\\x07\x08\r`;
  assert.equal(toHtml(junk), 'linkok');
  assert.equal(strip(junk), 'linkok');
  assert.ok(!/\x1b|\[\?|\]0;/.test(toHtml(junk)));
});

test('adjacent runs with the same style merge', () => {
  assert.equal(toHtml(`${E}[0m${E}[31ma${E}[0m${E}[31mb${E}[31mc${E}[0m`), '<span class="af1">abc</span>');
  assert.equal(toHtml(`${E}[0ma${E}[0mb`), 'ab');
});

test('truncated or malformed sequences', () => {
  assert.equal(toHtml(`ok${E}[38;2;1`), 'ok');
  assert.equal(toHtml(`ok${E}`), 'ok');
  assert.equal(toHtml(`ok${E}]0;never ends`), 'ok');
  assert.equal(toHtml(`${E}[38;2;1;2ma`), 'a'); // missing blue swallows the rest
  assert.equal(toHtml(`${E}[38;5ma`), 'a');
  assert.equal(toHtml(`${E}[38;9;1;31ma`), 'a'); // unknown colour mode
  assert.equal(toHtml(`${E}[31;;1ma`), '<span class="a-b">a</span>'); // empty param is a reset
});

test('lines: \\r\\n, trailing blanks and blank tail lines go; coloured blanks stay', () => {
  assert.equal(toHtml(`a   \r\nb${E}[0m   ${E}[0m\r\n   \r\n\r\n`), 'a\nb');
  assert.equal(toHtml(`${E}[41m   ${E}[0m`), '<span class="ab1">   </span>');
  assert.equal(toHtml(`${E}[31ma\nb`), '<span class="af1">a</span>\n<span class="af1">b</span>');
  assert.equal(strip(`${E}[31ma  \r\n${E}[0mb\r\n\r\n`), 'a\nb');
});

test('basic colours on a background are checked against it when the palette is known', () => {
  const palette = Array.from({ length: 16 }, () => [128, 128, 128]);
  palette[2] = [42, 133, 64]; // green
  palette[4] = [31, 95, 191]; // blue
  const opts = { ...LIGHT, palette };
  // green on a soft blue tint: below 4.5:1, so the class gets an inline override
  const html = toHtml(`${E}[32;44mgreen on blue`, opts);
  assert.match(html, /^<span class="ab4 af2" style="color:rgb\(\d+,\d+,\d+\)">green on blue<\/span>$/);
  // the same green on the plain box is left to its class
  assert.equal(toHtml(`${E}[32mok`, opts), '<span class="af2">ok</span>');
});

test('toHtmlLines: one string per line, the same as toHtml split', () => {
  const s = '\x1b[31mred\nstill red\x1b[0m\n\nplain  \n\n';
  const lines = Ansi.toHtmlLines(s);
  assert.deepEqual(lines, Ansi.toHtml(s).split('\n'));
  assert.equal(lines.length, 4); // trailing blank lines dropped
  assert.match(lines[1], /class="af1"/); // the colour carries over the line break
});

test('toHtmlLines with a cache: the same lines, each line worked out once per starting style', () => {
  const cache = {};
  const a = '\x1b[31mred\nstill red\x1b[0m\nplain\n\x1b[1mbold';
  assert.deepEqual(Ansi.toHtmlLines(a, {}, cache), Ansi.toHtmlLines(a));
  const n = cache.map.size;
  // Moved up by a line, one new line at the end: one more entry. "plain" now starts unstyled
  // after a line that reset: the same entry as before.
  const b = 'still red\x1b[0m\nplain\n\x1b[1mbold\nnew';
  assert.deepEqual(Ansi.toHtmlLines(b, {}, cache), Ansi.toHtmlLines(b));
  assert.ok(cache.map.size <= n + 2);
  // Other colours (the theme flipped): the cache starts again.
  Ansi.toHtmlLines(b, { dark: true }, cache);
  assert.equal(cache.map.size, 4);
});
