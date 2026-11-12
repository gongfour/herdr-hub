'use strict';
// Terminal cells in a monospace box: text laid out for a terminal (a box drawing, a table of
// columns) keeps its columns only when every character is as wide as the terminal made it. The
// page's monospace font has no Hangul, CJK or emoji, so those come from a fallback font whose
// width is not 2ch (Hangul in SF Mono's place is about 1.44ch), and a symbol the font lacks
// (⏺) is not quite 1ch either. html(text) escapes the text and puts each wide character (East
// Asian Width W/F, emoji shown as emoji) in a 2ch span and each run of other non-ASCII characters
// in a span of its count in ch (style.css .tc), so the columns line up again. A combining mark,
// a zero-width joiner sequence or a Hangul syllable written as jamo stays one character with the
// one before it. The spans hold the text itself, so selection and copy give the text unchanged.
// Pure: loaded as a plain script in the page (window.Cells), required by markdown.js, ansi.js and
// the tests.
(function (root) {
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // East Asian Width W and F (Unicode 15), the blocks that matter; emoji are found below.
  const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏ꥠ-꥿가-힣豈-﫿︐-︙︰-﹯＀-｠￠-￦\u{16FE0}-\u{18D08}\u{1AFF0}-\u{1B2FF}\u{1F200}-\u{1F2FF}\u{1F300}-\u{1F64F}\u{1F900}-\u{1F9FF}\u{20000}-\u{2FFFD}\u{30000}-\u{3FFFD}]/u;
  const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}️/u;
  // One character as the terminal counts it: a base and what joins it (marks, variation
  // selectors, skin tones, a zero-width joiner and the next one, Hangul vowel and final jamo), a
  // flag's two letters, or marks on their own (after an ASCII letter: they join it on the page).
  const CHAR = /\p{RI}\p{RI}|[^\p{M}](?:[\p{M}︀-️\u{1F3FB}-\u{1F3FF}ᅠ-ᇿힰ-퟿]|‍[^\p{M}])*|\p{M}+/gu;
  const ZERO = /^[\p{M}\p{Cf}]+$/u;

  const widthOf = (c) => (ZERO.test(c) ? 0 : WIDE.test(c) || EMOJI.test(c) ? 2 : 1);

  function run(chars) {
    let out = '';
    let narrow = '';
    let n = 0;
    const flush = () => {
      if (n) out += `<span class="tc"${n > 1 ? ` style="width:${n}ch"` : ''}>${esc(narrow)}</span>`;
      narrow = '';
      n = 0;
    };
    for (const c of chars.match(CHAR) || []) {
      const w = widthOf(c);
      if (w === 1) {
        narrow += c;
        // A run is cut every 8 so a long ─ rule can still fold in a box that wraps its lines.
        if (++n === 8) flush();
        continue;
      }
      flush();
      out += w ? `<span class="tc w2">${esc(c)}</span>` : esc(c);
    }
    flush();
    return out;
  }

  // Text → HTML (escaped), its non-ASCII characters in cells. ASCII-only text is just escaped.
  const html = (text) => String(text ?? '').replace(/[^\x00-\x7f]+|[\x00-\x7f]+/g, (part) => (part.charCodeAt(0) < 0x80 ? esc(part) : run(part)));

  const api = { html, widthOf };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Cells = api;
})(typeof self !== 'undefined' ? self : this);
