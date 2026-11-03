'use strict';
// Minimal markdown for the agent's replies: fenced code, inline code, bold, links, headings
// (as bold lines), tables and lists; everything else stays a paragraph. Input is escaped first.
// Pure: loaded as a plain script in the page (window.Markdown), required by the tests.
(function (root) {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function inline(text) {
    let h = esc(text);
    h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    h = h.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/(https?:\/\/[^\s<)]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    return h;
  }

  const TABLE_ROW = /^\s*\|.*\|\s*$/;
  const TABLE_SEP = /^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*(:?-{2,}:?\s*)?\|?\s*$/;
  const LIST_ITEM = /^\s*(?:[-*•]|\d+[.)])\s+/;

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

  // One blank-line-separated block: tables and lists become real elements, other lines stay a paragraph.
  function block(p) {
    const lines = p.replace(/\s+$/, '').split('\n');
    let out = '';
    let text = [];
    const flush = () => {
      if (text.length) out += `<p>${text.map(inline).join('<br>')}</p>`;
      text = [];
    };
    for (let i = 0; i < lines.length; ) {
      const line = lines[i];
      const heading = line.trim().match(/^(#{1,4})\s+(.+)$/);
      if (heading) {
        flush();
        out += `<p><strong>${inline(heading[2])}</strong></p>`;
        i++;
      } else if (TABLE_ROW.test(line) && TABLE_SEP.test(lines[i + 1] || '')) {
        flush();
        let j = i + 2;
        while (j < lines.length && TABLE_ROW.test(lines[j])) j++;
        out += table(lines.slice(i, j));
        i = j;
      } else if (LIST_ITEM.test(line)) {
        flush();
        const ordered = /^\s*\d/.test(line);
        const items = [];
        const same = (l) => LIST_ITEM.test(l) && /^\s*\d/.test(l) === ordered;
        while (i < lines.length && (same(lines[i]) || (items.length && !LIST_ITEM.test(lines[i]) && /^\s{2,}\S/.test(lines[i])))) {
          if (same(lines[i])) items.push(lines[i].replace(LIST_ITEM, ''));
          else items[items.length - 1] += '\n' + lines[i].trim();
          i++;
        }
        const tag = ordered ? 'ol' : 'ul';
        out += `<${tag}>${items.map((t) => `<li>${t.split('\n').map(inline).join('<br>')}</li>`).join('')}</${tag}>`;
      } else {
        text.push(line);
        i++;
      }
    }
    flush();
    return out;
  }

  function md(src) {
    const parts = String(src).split(/```[^\n]*\n?([\s\S]*?)```/g);
    return parts
      .map((chunk, i) => {
        if (i % 2) return `<pre><code>${esc(chunk.replace(/\n$/, ''))}</code></pre>`;
        return chunk
          .split(/\n{2,}/)
          .filter((p) => p.trim())
          .map(block)
          .join('');
      })
      .join('');
  }

  const api = { md, inline };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Markdown = api;
})(typeof self !== 'undefined' ? self : this);
