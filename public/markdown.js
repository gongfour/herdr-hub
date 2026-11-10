'use strict';
// Markdown for the agent's replies. Blocks: fenced code, headings (as bold lines), tables, lists that
// nest by indentation (an item holds its own paragraphs, code, quotes, tables and lists), > quotes
// (nested too) and --- rules; everything else is a paragraph whose lines keep their breaks.
// Inline: code, bold, *italic*/_italic_ (never inside a word: snake_case, file*names), ~~strike~~,
// [text](https://…) and bare http(s) links. No raw HTML: every piece of text is escaped.
// Pure: loaded as a plain script in the page (window.Markdown), required by the tests.
(function (root) {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---- inline ----
  // Code spans, backslash escapes and links are cut out first (as \0n\1 marks) so nothing inside
  // them is read as emphasis, and put back at the end.
  function inline(text) {
    const kept = [];
    const keep = (html) => `\u0000${kept.push(html) - 1}\u0001`;
    let s = String(text ?? '').replace(/[\u0000\u0001]/g, '');
    s = s.replace(/(`+)(?!`)([^\n]*?[^`\n])\1(?!`)/g, (_, _t, body) => {
      const b = /^ .* $/.test(body) && body.trim() ? body.slice(1, -1) : body;
      return keep(`<code>${esc(b)}</code>`);
    });
    s = s.replace(/\\([\\`*_~[\]()#>|!-])/g, (_, c) => keep(esc(c)));
    const a = (url, label) => keep(`<a href="${esc(url)}" target="_blank" rel="noopener">${label}</a>`);
    // A URL never takes in a mark (\0n\1): what was cut out before it (a link, code) would be put
    // back inside its href, and that piece's own quotes would end the attribute early.
    s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s()<>\u0000\u0001]+)\)/g, (_, label, url) => a(url, emphasis(esc(label))));
    // A bare link ends at a space, a bracket or quote, Hangul, or the sentence's last punctuation.
    s = s.replace(/https?:\/\/[^\s<>()[\]{}"'`ㄱ-힣「」『』，。\u0000\u0001]+/g, (url) => {
      const tail = (url.match(/[.,:;!?*_~]+$/) || [''])[0];
      const u = url.slice(0, url.length - tail.length);
      return /^https?:\/\/[^/]/.test(u) ? a(u, esc(u)) + tail : url;
    });
    s = emphasis(esc(s));
    for (let n = 0; n < 4 && s.includes('\u0000'); n++) s = s.replace(/\u0000(\d+)\u0001/g, (_, i) => kept[i]);
    return s;
  }

  // On already-escaped text (the entities hold no * _ ~). A span whose inside would cut another
  // span's tags in two stays as it is.
  const whole = (h) => ['strong', 'del', 'em'].every((t) => h.split(`<${t}>`).length === h.split(`</${t}>`).length);
  const wrap = (tag) => (m, pre, body) => (whole(body) ? `${pre}<${tag}>${body}</${tag}>` : m);
  function emphasis(h) {
    h = h.replace(/()\*\*(?![\s*])(.+?)(?<!\s)\*\*(?!\*)/g, wrap('strong'));
    h = h.replace(/()~~(?![\s~])(.+?)(?<![\s~])~~/g, wrap('del'));
    // * may touch Hangul (「*기울임*은」) but not a Latin letter or digit: a*b*c, file*names* stay.
    h = h.replace(/(^|[^A-Za-z0-9*])\*(?![\s*])(.+?)(?<![\s*])\*(?![A-Za-z0-9*])/g, wrap('em'));
    // _ touches no letter at all: snake_case_name, __init__ stay.
    h = h.replace(/(^|[^\p{L}\p{N}_])_(?![\s_])(.+?)(?<![\s_])_(?![\p{L}\p{N}_])/gu, wrap('em'));
    return h;
  }

  // ---- blocks ----
  const TABLE_ROW = /^\s*\|.*\|\s*$/;
  const TABLE_SEP = /^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*(:?-{2,}:?\s*)?\|?\s*$/;
  const LIST = /^( *)([-*+•]|(\d{1,9})[.)])( +|$)/;
  const FENCE = /^ *(`{3,}|~{3,})/;
  const HEADING = /^ *(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/;
  const QUOTE = /^ {0,3}>/;
  const RULE = /^ {0,3}([-*_])( *\1){2,} *$/;

  const indent = (l) => l.match(/^ */)[0].length;
  const blank = (l) => !l.trim();
  const dedent = (l, n) => l.slice(Math.min(indent(l), n));
  const isTable = (lines, i) => TABLE_ROW.test(lines[i]) && TABLE_SEP.test(lines[i + 1] || '');
  const starts = (lines, i) => {
    const l = lines[i];
    return blank(l) || FENCE.test(l) || HEADING.test(l) || QUOTE.test(l) || RULE.test(l) || LIST.test(l) || isTable(lines, i);
  };

  function cells(line) {
    // An escaped pipe (\|) is part of the cell text, not a column break.
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').replace(/\\\|/g, '\u0000').split('|').map((c) => c.replace(/\u0000/g, '|').trim());
  }

  function table(lines) {
    const align = cells(lines[1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : ''));
    const row = (line, tag) =>
      `<tr>${cells(line).map((c, i) => `<${tag}${align[i] ? ` style="text-align:${align[i]}"` : ''}>${inline(c)}</${tag}>`).join('')}</tr>`;
    return `<div class="table-wrap"><table><thead>${row(lines[0], 'th')}</thead><tbody>${lines.slice(2).map((l) => row(l, 'td')).join('')}</tbody></table></div>`;
  }

  // An opening fence at lines[i]: where its closing fence is (or the end, if it never closes).
  function fence(lines, i) {
    const open = lines[i].match(FENCE)[1];
    const close = new RegExp(`^ *\\${open[0]}{${open.length},} *$`);
    let j = i + 1;
    while (j < lines.length && !close.test(lines[j])) j++;
    return { close: j, end: Math.min(j + 1, lines.length) };
  }

  // A list from lines[i]. An item owns the lines after it that are indented past its marker
  // (a marker two spaces in or more starts a list nested in it), blank lines followed by such a
  // line, and a fenced block that starts in it. A marker at the item's own column (±1) is the next
  // item; another kind of list (numbers after bullets) or a line back at the margin ends it.
  function list(lines, i) {
    const first = lines[i].match(LIST);
    const base = first[1].length;
    const ordered = first[3] !== undefined;
    const start = ordered ? parseInt(first[3], 10) : 1;
    const sibling = (l) => {
      const m = l.match(LIST);
      return !!m && m[1].length <= base + 1 && (m[3] !== undefined) === ordered && !RULE.test(l);
    };
    const owned = (l) => (LIST.test(l) ? indent(l) >= base + 2 : indent(l) > base);
    const items = [];
    let loose = false;
    while (i < lines.length && sibling(lines[i])) {
      const m = lines[i].match(LIST);
      const spaces = m[4].length;
      // The item's text column; a marker with 5+ spaces after it starts an indented code line.
      const ci = m[1].length + m[2].length + (spaces && spaces <= 4 ? spaces : 1);
      const body = [lines[i].slice(spaces > 4 ? ci : m[0].length)];
      i++;
      while (i < lines.length) {
        const l = lines[i];
        if (blank(l)) {
          let k = i;
          while (k < lines.length && blank(lines[k])) k++;
          if (k < lines.length && owned(lines[k])) {
            loose = true;
            for (; i < k; i++) body.push('');
            continue;
          }
          if (k < lines.length && sibling(lines[k])) {
            loose = true;
            i = k;
          }
          break;
        }
        if (!owned(l)) break;
        if (FENCE.test(dedent(l, ci))) {
          const { end } = fence(lines, i);
          for (; i < end; i++) body.push(dedent(lines[i], ci));
          continue;
        }
        body.push(dedent(l, ci));
        i++;
      }
      items.push(body);
    }
    const tag = ordered ? 'ol' : 'ul';
    const at = ordered && start !== 1 ? ` start="${start}"` : '';
    return { i, html: `<${tag}${at}>${items.map((b) => `<li>${blocks(b, !loose)}</li>`).join('')}</${tag}>` };
  }

  // Lines → HTML. In a tight list's item a paragraph is bare text, not a <p>.
  function blocks(lines, tight) {
    let out = '';
    for (let i = 0; i < lines.length; ) {
      const l = lines[i];
      if (blank(l)) {
        i++;
      } else if (FENCE.test(l)) {
        const f = fence(lines, i);
        const pad = indent(l);
        out += `<pre><code>${esc(lines.slice(i + 1, f.close).map((c) => dedent(c, pad)).join('\n'))}</code></pre>`;
        i = f.end;
      } else if (HEADING.test(l)) {
        out += `<p><strong>${inline(l.match(HEADING)[2])}</strong></p>`;
        i++;
      } else if (RULE.test(l)) {
        out += '<hr>';
        i++;
      } else if (QUOTE.test(l)) {
        const q = [];
        while (i < lines.length && QUOTE.test(lines[i])) q.push(lines[i++].replace(/^ {0,3}> ?/, ''));
        out += `<blockquote>${blocks(q, false)}</blockquote>`;
      } else if (LIST.test(l)) {
        const r = list(lines, i);
        out += r.html;
        i = r.i;
      } else if (isTable(lines, i)) {
        let j = i + 2;
        while (j < lines.length && TABLE_ROW.test(lines[j])) j++;
        out += table(lines.slice(i, j));
        i = j;
      } else {
        const text = [l.trim()];
        for (i++; i < lines.length && !starts(lines, i); i++) text.push(lines[i].trim());
        const h = text.map(inline).join('<br>');
        out += tight ? h : `<p>${h}</p>`;
      }
    }
    return out;
  }

  function md(src) {
    // A leading tab counts as four spaces.
    const lines = String(src ?? '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((l) => l.replace(/^[ \t]+/, (w) => w.replace(/\t/g, '    ')).replace(/[ \t]+$/, ''));
    return blocks(lines, false);
  }

  const api = { md, inline };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Markdown = api;
})(typeof self !== 'undefined' ? self : this);
