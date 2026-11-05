'use strict';
// Terminal colours for the screen box: herdr's ansi read (SGR only) → escaped HTML.
// Pure: a string in, a string out. Every escape sequence that isn't SGR (OSC titles, cursor
// moves, anything unknown or cut off) is dropped, never shown. Text is HTML-escaped; colours
// come out only as class names or rgb() built from validated 0-255 numbers.
//
// The 16 basic colours are classes (af0-af15 / ab0-ab15) whose values are CSS variables tuned
// per theme. 256-colour and truecolor values are written inline, but first pass a contrast
// guard against the box's background: Claude Code paints for a dark terminal, so in light mode
// a pale grey keeps its hue and gets darker until it reads. Dark backgrounds meant for a dark
// terminal are turned into light tints of the same hue in light mode.
// Loaded as a plain script in the page (window.Ansi) and required by the tests.
(function (root) {
  // CSI (7-bit or C1) with its final byte optional, so a truncated one is swallowed whole;
  // OSC/DCS/SOS/PM/APC up to BEL, ST or the end of the line; any other ESC sequence; C0 controls
  // except tab and newline.
  const SEQ =
    /\x1b\[([0-?]*)[ -/]*([@-~]?)|\x9b([0-?]*)[ -/]*([@-~]?)|[\x1b][\]PX^_][^\x07\x1b\n]*(?:\x07|\x1b\\)?|\x1b[ -/]*[0-~]?|[\x00-\x08\x0b-\x1f\x7f]/g;

  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // xterm's 256-colour cube and grey ramp (0-15 stay classes).
  function rgb256(n) {
    if (n >= 232) {
      const v = 8 + (n - 232) * 10;
      return [v, v, v];
    }
    const i = n - 16;
    const step = (x) => (x ? 55 + x * 40 : 0);
    return [step(Math.floor(i / 36)), step(Math.floor(i / 6) % 6), step(i % 6)];
  }

  const byte = (v) => (Number.isInteger(v) && v >= 0 && v <= 255 ? v : null);
  const num = (s) => (s === '' || s == null ? 0 : /^\d{1,9}$/.test(s) ? Number(s) : NaN);

  // Colour after 38/48: params from index i (5;n or 2;r;g;b). Returns { color, used }.
  function extColor(p, i) {
    const mode = p[i];
    if (mode === 5) {
      const n = byte(p[i + 1]);
      return { color: n == null ? undefined : n < 16 ? { i: n } : { rgb: rgb256(n) }, used: 2 };
    }
    if (mode === 2) {
      const c = [byte(p[i + 1]), byte(p[i + 2]), byte(p[i + 3])];
      return { color: c.includes(null) ? undefined : { rgb: c }, used: 4 };
    }
    return { color: undefined, used: p.length }; // unknown mode: the rest can't be trusted
  }

  const RESET = { fg: null, bg: null, bold: false, dim: false, italic: false, under: false, inverse: false, strike: false };

  // Apply one SGR parameter string ("1;38;2;215;119;87") to a style; returns the new style.
  function sgr(style, params) {
    const st = { ...style };
    const items = params.split(';');
    const p = items.map((x) => (x.includes(':') ? NaN : num(x)));
    for (let i = 0; i < p.length; i++) {
      const c = p[i];
      if (Number.isNaN(c)) {
        // Colon sub-parameters form one item: "38:2::r:g:b", "38:5:n", "4:3" (curly underline).
        const sub = items[i].split(':').map(num);
        if (sub[0] === 38 || sub[0] === 48) {
          // 38:2:<colour space>:r:g:b has an extra (often empty) field; 38:2:r:g:b doesn't.
          const q = sub[1] === 2 && sub.length >= 6 ? [sub[0], 2, ...sub.slice(3)] : sub;
          const { color } = extColor(q, 1);
          if (color) st[sub[0] === 38 ? 'fg' : 'bg'] = color;
        } else if (sub[0] === 4) st.under = sub[1] !== 0;
        continue;
      }
      if (c === 0) Object.assign(st, RESET);
      else if (c === 1) st.bold = true;
      else if (c === 2) st.dim = true;
      else if (c === 3) st.italic = true;
      else if (c === 4 || c === 21) st.under = true;
      else if (c === 7) st.inverse = true;
      else if (c === 9) st.strike = true;
      else if (c === 22) st.bold = st.dim = false;
      else if (c === 23) st.italic = false;
      else if (c === 24) st.under = false;
      else if (c === 27) st.inverse = false;
      else if (c === 29) st.strike = false;
      else if (c >= 30 && c <= 37) st.fg = { i: c - 30 };
      else if (c >= 90 && c <= 97) st.fg = { i: c - 90 + 8 };
      else if (c >= 40 && c <= 47) st.bg = { i: c - 40 };
      else if (c >= 100 && c <= 107) st.bg = { i: c - 100 + 8 };
      else if (c === 39) st.fg = null;
      else if (c === 49) st.bg = null;
      else if (c === 38 || c === 48) {
        const { color, used } = extColor(p, i + 1);
        if (color) st[c === 38 ? 'fg' : 'bg'] = color;
        i += used;
      }
      // anything else (blink, conceal, fonts, overline…): ignored
    }
    return st;
  }

  // One line (no newline in it) from the style it starts with: its { text, st } runs and the style
  // it ends with. \r and other controls are gone. No escape sequence spans a line (OSC and the
  // rest stop at a newline), so a screen is its lines one after another.
  function parseLine(line, st0 = RESET) {
    const runs = [];
    let st = st0;
    let last = 0;
    SEQ.lastIndex = 0;
    for (let m; (m = SEQ.exec(line)); ) {
      if (m.index > last) runs.push({ text: line.slice(last, m.index), st });
      last = SEQ.lastIndex;
      // SGR only when the parameters are plain numbers: "\x1b[>4;2m" is a key mode, not dim.
      const params = m[1] != null ? m[1] : m[3];
      const final = m[1] != null ? m[2] : m[4];
      if (final === 'm' && /^[\d;:]*$/.test(params)) st = sgr(st, params);
    }
    if (last < line.length) runs.push({ text: line.slice(last), st });
    return { runs, st };
  }

  // Split into lines of { text, st } runs.
  function parse(str) {
    let st = RESET;
    return String(str)
      .split('\n')
      .map((line) => {
        const r = parseLine(line, st);
        st = r.st;
        return r.runs;
      });
  }

  // Plain text, with the same trailing-blank trimming the plain screen gets.
  function strip(str) {
    return parse(str)
      .map((runs) => runs.map((r) => r.text).join('').replace(/[ \t]+$/, ''))
      .join('\n')
      .replace(/\s+$/, '');
  }

  // ---- colour maths (sRGB, WCAG contrast)
  const lin = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const contrast = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
  };
  const mix = (a, b, t) => a.map((v, k) => Math.round(v + (b[k] - v) * t));

  // Move c toward black (light bg) or white (dark bg) until it reaches `min` contrast with bg.
  function readable(c, bg, min) {
    if (contrast(c, bg) >= min) return c;
    const target = lum(bg) > 0.4 ? [0, 0, 0] : [255, 255, 255];
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 12; k++) {
      const t = (lo + hi) / 2;
      if (contrast(mix(c, target, t), bg) >= min) hi = t;
      else lo = t;
    }
    return mix(c, target, hi);
  }

  // A background meant for a dark terminal shown on a light page: same hue, light tint.
  function lightTint(c, page) {
    if (lum(c) > 0.3) return c;
    const max = Math.max(...c);
    // Stretch the colour to full strength (keeps hue), then lay a thin layer of it on the page.
    const vivid = max ? c.map((v) => (v * 255) / max) : c;
    const chroma = max - Math.min(...c);
    return mix(page, vivid, chroma < 12 ? 0.08 : 0.18);
  }

  const rgbCss = (c) => `rgb(${c.map((v) => Math.max(0, Math.min(255, Math.round(v)))).join(',')})`;

  // Basic backgrounds are this much of the colour over the box (style.css .abN says the same).
  const SOFT = 0.26;

  // opts: { dark, fg: [r,g,b], bg: [r,g,b], palette: [[r,g,b] × 16] } — the box's default text and
  // background colours and the theme's basic colours (the --ansi-N variables). Without them,
  // light theme defaults are assumed; without a palette, basic colours on a background go unchecked.
  // The same, one string per line (no newlines), for a box that changes only the lines that did.
  // cache (optional, an object the caller keeps): each line's HTML by its text and the style it
  // starts with, so a screen that moved by a line costs one line's work, not the whole screen's.
  function toHtmlLines(str, opts = {}, cache = null) {
    const dark = Boolean(opts.dark);
    const pageFg = opts.fg || (dark ? [236, 235, 230] : [29, 28, 25]);
    const pageBg = opts.bg || (dark ? [31, 31, 28] : [255, 255, 255]);
    const MIN = 4.5;
    if (cache) {
      const ok = JSON.stringify([dark, pageFg, pageBg, opts.palette || null]);
      if (cache.opts !== ok || !cache.map || cache.map.size > CACHE_MAX) (cache.opts = ok), (cache.map = new Map());
    }
    const lineHtml = (runs) => {
      const spans = [];
      for (const { text, st } of runs) {
        let fg = st.fg;
        let bg = st.bg;
        let solidBg = false;
        if (st.inverse) {
          [fg, bg] = [bg || 'page-bg', fg || 'page-fg'];
          solidBg = true;
        }
        const cls = [];
        const css = [];
        // background first: the text colour is checked against it
        let under = pageBg;
        const pal = (i) => (opts.palette && opts.palette[i]) || null;
        if (bg === 'page-fg') {
          cls.push('abfg');
          under = pageFg;
        } else if (bg && bg.i != null) {
          cls.push(solidBg ? `aB${bg.i}` : `ab${bg.i}`);
          under = pal(bg.i) && (solidBg ? pal(bg.i) : mix(pageBg, pal(bg.i), SOFT));
        } else if (bg && bg.rgb) {
          const b = dark ? bg.rgb : lightTint(bg.rgb, pageBg);
          css.push(`background:${rgbCss(b)}`);
          under = b;
        }
        // Text on a background of its own is checked against it (a class colour gets an inline
        // override only when it would not read there); text on the box needs nothing for classes.
        const onBg = under && under !== pageBg;
        if (fg === 'page-bg') cls.push('afbg');
        else if (fg && fg.i != null) {
          cls.push(`af${fg.i}`);
          const c = pal(fg.i);
          if (onBg && c && contrast(c, under) < MIN) css.push(`color:${rgbCss(readable(c, under, MIN))}`);
        } else if (fg && fg.rgb) css.push(`color:${rgbCss(readable(fg.rgb, under || pageBg, MIN))}`);
        else if (onBg && contrast(pageFg, under) < MIN) css.push(`color:${rgbCss(readable(pageFg, under, MIN))}`);
        if (st.bold) cls.push('a-b');
        if (st.dim) cls.push('a-d');
        if (st.italic) cls.push('a-i');
        if (st.under && st.strike) cls.push('a-us');
        else if (st.under) cls.push('a-u');
        else if (st.strike) cls.push('a-s');
        const key = `${cls.join(' ')}|${css.join(';')}`;
        // Only blanks with nothing visible on them may be trimmed off the line's end.
        const blankOk = !css.some((x) => x.startsWith('background')) && !cls.some((x) => /^a[bB]|^a-[us]/.test(x));
        const prev = spans[spans.length - 1];
        if (prev && prev.key === key) prev.text += text;
        else spans.push({ key, cls, css, text, blankOk });
      }
      // Trailing blanks only widen the sideways scroll.
      while (spans.length && spans[spans.length - 1].blankOk) {
        const s = spans[spans.length - 1];
        s.text = s.text.replace(/[ \t]+$/, '');
        if (s.text) break;
        spans.pop();
      }
      return spans
        .map((s) => {
          if (s.key === '|') return esc(s.text);
          const c = s.cls.length ? ` class="${s.cls.join(' ')}"` : '';
          const y = s.css.length ? ` style="${s.css.join(';')}"` : '';
          return `<span${c}${y}>${esc(s.text)}</span>`;
        })
        .join('');
    };
    const out = [];
    let st = RESET;
    for (const line of String(str).split('\n')) {
      const key = cache ? `${styleKey(st)}\u0001${line}` : null;
      let hit = cache && cache.map.get(key);
      if (!hit) {
        const r = parseLine(line, st);
        hit = { html: lineHtml(r.runs), st: r.st };
        if (cache) cache.map.set(key, hit);
      }
      out.push(hit.html);
      st = hit.st;
    }
    while (out.length && out[out.length - 1] === '') out.pop();
    return out;
  }
  const CACHE_MAX = 4000; // lines kept (a 400-line screen ten times over), then it starts again
  const styleKey = (st) => (st === RESET ? '' : JSON.stringify(st));
  const toHtml = (str, opts) => toHtmlLines(str, opts).join('\n');

  const api = { toHtml, toHtmlLines, strip, parse, parseLine, contrast, readable };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Ansi = api;
})(typeof window !== 'undefined' ? window : globalThis);
