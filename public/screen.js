'use strict';
// The screen box: a pane's text (coloured by ansi.js) in the agent sheet or body and the shell view.

// ------------------------------------------------------------ screen box

// The pane text in the agent screen sheet (or body) and the terminal view. Polls arrive every few seconds;
// the box changes only when the text did, follows new output while you're at the bottom, and
// holds still while you've scrolled up to read, selected text, or have a finger on it.
// Wrapping is a per-view choice: off for agents (TUI layouts keep their shape and scroll
// sideways inside the box), on for terminals.
// Both are settings (prefs.js): wrap.term / wrap.agent and color, the same colours for both views.
const getWrap = (kind) => Prefs.get(kind === 'term' ? 'wrap.term' : 'wrap.agent');
const getColor = () => Prefs.get('color');
const colorQuery = () => (getColor() ? '&format=ansi' : '');

const FOLLOW_SLACK = 40; // px from the bottom that still counts as "at the bottom"
let scr = null; // { kind, body, pre, pill, tools, wrap, color, raw, shown, pending, follow, touching, error, note }
const atBottom = (el) => el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_SLACK;
const selecting = () => {
  const s = window.getSelection();
  return Boolean(scr && s && !s.isCollapsed && s.rangeCount && scr.pre.contains(s.getRangeAt(0).commonAncestorContainer));
};

// tools: the bar for the status and the colour/wrap toggles. topHtml: a note above the text
// (agent TUIs draw on the alternate screen, so herdr has nothing above what is on screen now).
function mountScreen(body, kind, tools, topHtml = '') {
  body.classList.add('screen-mode');
  const top = topHtml ? `<div class="screen-top">${topHtml}</div>` : '';
  body.innerHTML = `<div class="note screen-note"><p class="n-main">불러오는 중…</p><p class="n-sub" hidden></p><button type="button" class="btn secondary n-retry" hidden>다시 시도</button></div>${top}<pre class="screen ${kind}" hidden></pre>
    <div class="pill-dock"><button type="button" class="new-out to-start" hidden>← 처음으로</button><button type="button" class="new-out"${keyAttrs('jumpEnd', '맨 아래로')} hidden>↓ 새 출력</button></div>`;
  const s = (scr = {
    kind, body, tools, wrap: getWrap(kind), color: getColor(), raw: null, shown: null, pending: null, follow: true, touching: false, error: null, note: '',
    pre: body.querySelector('.screen'), pill: body.querySelector('.new-out:not(.to-start)'), start: body.querySelector('.to-start'), loading: body.querySelector('.screen-note'),
    // 다시 시도: the read this box is fed by (shell.js, agent.js).
    retry: () => (kind === 'term' ? loadTerminal() : loadDetail()),
  });
  s.pre.classList.toggle('wrap', s.wrap);
  // Unwrapped lines pushed sideways leave the short ones (the prompt) off screen: 「← 처음으로」.
  s.pre.addEventListener('scroll', () => scr === s && (s.start.hidden = s.wrap || s.pre.scrollLeft < 8), { passive: true });
  s.start.onclick = () => {
    s.pre.scrollLeft = 0;
    s.start.hidden = true;
  };
  s.loading.querySelector('.n-retry').onclick = () => {
    s.loading.querySelector('.n-main').textContent = '다시 읽는 중…';
    s.retry();
  };
  body.onscroll = () => {
    if (scr !== s) return;
    s.follow = atBottom(body);
    flushScreen();
  };
  body.ontouchstart = () => scr === s && (s.touching = true);
  body.ontouchend = body.ontouchcancel = () => {
    if (scr !== s) return;
    s.touching = false;
    setTimeout(flushScreen, 60);
  };
  s.pill.onclick = () => jumpLatest(keyboardLikely()); // agent.js; a phone's keyboard stays down
  // 색상 and 줄바꿈 live in 설정; the tools row only says what went wrong, when something did.
  if (tools) tools.innerHTML = '<span class="s-status"></span>';
  screenStatus();
}

function unmountScreen() {
  if (!scr) return;
  const { body, tools } = scr;
  body.classList.remove('screen-mode');
  body.style.removeProperty('--term-bg');
  body.onscroll = body.ontouchstart = body.ontouchend = body.ontouchcancel = null;
  if (tools && tools.id === 's-tools') {
    tools.hidden = true;
    tools.innerHTML = '';
  }
  scr = null;
}

// A read failed. Nothing drawn yet: one note in the middle of the box (화면을 읽지 못했습니다, the
// reason, 다시 시도) and no row above. A screen already there: the row above says so, whole
// (two lines at most), and what the app does about it: the next poll reads again by itself.
function screenStatus() {
  if (!scr) return;
  const first = scr.shown == null;
  const el = scr.tools && scr.tools.querySelector('.s-status');
  if (el) {
    el.textContent = scr.error ? `화면을 새로 읽지 못했습니다: ${scr.error}. 자동으로 다시 시도합니다.` : scr.note || '';
    el.classList.toggle('err', Boolean(scr.error));
    scr.tools.hidden = !scr.error || first; // a note alone is not worth a row
  }
  if (first) {
    const n = scr.loading;
    n.classList.toggle('err', Boolean(scr.error));
    n.querySelector('.n-main').textContent = scr.error ? '화면을 읽지 못했습니다' : '불러오는 중…';
    n.querySelector('.n-sub').textContent = scr.error || '';
    n.querySelector('.n-sub').hidden = n.querySelector('.n-retry').hidden = !scr.error;
  }
}

// reason: a short why (errReason), or a whole sentence from an older caller (made short too).
function screenError(reason) {
  if (!scr) return;
  const r = shortReason(String(reason).replace(/^불러오지 못했습니다:\s*/, ''));
  if (scr.error === r && scr.shown != null) return;
  scr.error = r;
  screenStatus();
}

// A failure in a few words, for a line that says itself what happens next: 「호스트 오류(502)」,
// 「연결이 끊겼습니다」, never 「다시 시도해 주세요」.
const shortReason = (text) =>
  String(text)
    .replace(/\s*(잠시 뒤에 )?다시 시도해 주세요\.?$/, '')
    .replace(/(입니다)?\.$/, '');
const errReason = (err) => shortReason(errText(err));

// 설정 or the shell's ⋯ changed 줄바꿈 or 색상 (core.js PREF_EFFECTS): the box open now follows.
function applyScreenPrefs() {
  const s = scr;
  if (!s) return;
  s.wrap = getWrap(s.kind);
  s.pre.classList.toggle('wrap', s.wrap);
  if (s.wrap) s.start.hidden = true;
  const color = getColor();
  if (color === s.color) return;
  s.color = color;
  // Colour off: the coloured read drawn plain at once. On: a plain read has no colours to show,
  // so read again.
  if (s.raw && (!color || s.raw.format === 'ansi')) setScreenText(s.raw.text, s.raw.format, true);
  if (color) s.retry();
}

// format "ansi": herdr's coloured read, drawn as spans (ansi.js); "text" or missing: plain.
// Change detection compares the raw string, colour codes and all.
function setScreenText(raw, format, force) {
  if (!scr) return;
  const ansi = format === 'ansi' && Boolean(window.Ansi);
  scr.raw = { text: raw, format };
  // Trailing blanks only widen the sideways scroll (ansi.js trims the ansi read the same way).
  const text = ansi ? String(raw).replace(/\r/g, '') : String(raw).replace(/[ \t]+$/gm, '').replace(/\s+$/, '');
  const view = ansi ? (scr.color ? 'ansi' : 'strip') : 'text';
  const key = `${view}\u0000${text}`;
  scr.error = null;
  screenStatus();
  scr.pending = key === scr.shown && !force ? null : { key, view, text };
  flushScreen(force);
}

function screenColors(pre) {
  const cs = getComputedStyle(pre);
  const rgb = (v) => (v.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
  const bg = rgb(cs.backgroundColor);
  const fg = rgb(cs.color);
  const palette = Array.from({ length: 16 }, (_, i) => {
    const h = cs.getPropertyValue(`--ansi-${i}`).trim();
    return /^#[0-9a-f]{6}$/i.test(h) ? [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16)) : null;
  });
  return { fg: fg.length === 3 ? fg : undefined, bg: bg.length === 3 ? bg : undefined, palette, dark: bg.length === 3 ? 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2] < 128 : darkNow() };
}

// The box holds one element per line (a span ending in its newline, so the text, selection and
// copy are as one <pre>), and a new screen changes only the lines that changed: output moving by
// a line removes one element and adds one, a key typed redraws the prompt's line. ScreenDiff
// finds them, the same way the live channel does.
const htmlEsc = (t) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
function drawScreen(s, p) {
  const lines = p.view === 'ansi' ? window.Ansi.toHtmlLines(p.text, screenColors(s.pre), s.htmlCache || (s.htmlCache = {})) : (p.view === 'strip' ? window.Ansi.strip(p.text) : p.text).split('\n').map(htmlEsc);
  // A line drawn over (shell.js: 셸 예측 입력) goes back to the host's first, and comes back after.
  if (s.overlay) s.overlay.clear();
  patchLines(s, lines);
  paneBackground(s, p.view === 'ansi');
  if (s.overlay) s.overlay.draw();
}

const lineEl = (html) => {
  const el = document.createElement('span');
  el.className = 'ln';
  el.innerHTML = `${html}\n`;
  return el;
};
function patchLines(s, next) {
  const pre = s.pre;
  const prev = s.lines;
  if (!prev || pre.childElementCount !== prev.length || pre.childNodes.length !== prev.length) {
    const f = document.createDocumentFragment();
    for (const h of next) f.appendChild(lineEl(h));
    pre.replaceChildren(f);
    s.lines = next;
    return;
  }
  const d = window.ScreenDiff.diff(prev, next);
  const kids = pre.children;
  for (let i = 0; i < d.k; i++) kids[0].remove();
  // The old lines between the kept start (h) and the kept end (z): reused for the new ones as far
  // as they go, the rest removed or added before the kept end.
  const old = prev.length - d.k - d.h - d.z;
  const both = Math.min(old, d.a.length);
  for (let i = 0; i < both; i++) {
    const el = kids[d.h + i];
    el.innerHTML = `${d.a[i]}\n`;
    el._bg = null;
  }
  for (let i = both; i < old; i++) kids[d.h + both].remove();
  if (d.a.length > both) {
    const f = document.createDocumentFragment();
    for (let i = both; i < d.a.length; i++) f.appendChild(lineEl(d.a[i]));
    pre.insertBefore(f, kids[d.h + both] || null);
  }
  s.lines = next;
}

// A full-screen program (helix, vim) paints its own background on most cells. That colour then
// fills the whole box, padding included, so no dark gutter or gaps show around its rows.
// Counted per line and kept with it, so an unchanged line is not looked at again.
function lineBackgrounds(el) {
  if (el._bg) return el._bg;
  const counts = new Map();
  for (const sp of el.querySelectorAll('span')) {
    const bg = sp.style.backgroundColor || (/(^|\s)a[bB]\d/.test(sp.className) ? getComputedStyle(sp).backgroundColor : '');
    if (bg) counts.set(bg, (counts.get(bg) || 0) + sp.textContent.length);
  }
  return (el._bg = { counts, cells: el.textContent.length - 1 });
}
function paneBackground(s, ansi) {
  let best = '';
  if (ansi) {
    const counts = new Map();
    let cells = 0;
    let most = 0;
    for (const el of s.pre.children) {
      const b = lineBackgrounds(el);
      cells += b.cells;
      for (const [bg, n0] of b.counts) {
        const n = (counts.get(bg) || 0) + n0;
        counts.set(bg, n);
        if (n > most) (most = n), (best = bg);
      }
    }
    if (!cells || most / cells < 0.4) best = '';
  }
  if (best) s.body.style.setProperty('--term-bg', best);
  else s.body.style.removeProperty('--term-bg');
}

// Put the waiting text on screen unless the reader is busy with what's there.
function flushScreen(force) {
  const s = scr;
  if (!s) return;
  if (s.pending != null && (force || (s.follow && !s.touching && !selecting()))) {
    drawScreen(s, s.pending);
    s.shown = s.pending.key;
    s.pending = null;
    s.pre.hidden = false;
    s.loading.hidden = true;
    if (s.follow) s.body.scrollTop = s.body.scrollHeight;
  }
  // Scrolled up: the pill goes back to the end, and says when there is new output there.
  s.pill.textContent = s.pending != null ? '↓ 새 출력' : '↓ 맨 아래로';
  s.pill.hidden = s.follow;
}

// Earlier lines came in above what is being read (the shell's longer scrollback): draw them now
// and keep the same lines in view.
function prependScreenText(raw, format) {
  if (!scr) return;
  const b = scr.body;
  const fromBottom = b.scrollHeight - b.scrollTop;
  setScreenText(raw, format, true);
  b.scrollTop = b.scrollHeight - fromBottom;
}

// The guarded colours depend on the theme: redraw when it flips.
function redrawScreen() {
  if (scr && scr.raw && scr.pending == null) setScreenText(scr.raw.text, scr.raw.format, true);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  applyTheme(getTheme());
  redrawScreen();
});

document.addEventListener('selectionchange', () => {
  if (scr && scr.pending != null && !selecting()) flushScreen();
});
