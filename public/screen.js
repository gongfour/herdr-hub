'use strict';
// The screen box: a pane's text (coloured by ansi.js) in the agent sheet or body and the shell view.

// ------------------------------------------------------------ screen box

// The pane text in the agent screen sheet (or body) and the terminal view. Polls arrive every few seconds;
// the box changes only when the text did, follows new output while you're at the bottom, and
// holds still while you've scrolled up to read, selected text, or have a finger on it.
// Wrapping is a per-view choice: off for agents (TUI layouts keep their shape and scroll
// sideways inside the box), on for terminals.
const WRAP_KEY = { agent: 'herdr-hub.wrap.agent', term: 'herdr-hub.wrap.term' };
function getWrap(kind) {
  try {
    const v = localStorage.getItem(WRAP_KEY[kind]);
    if (v === '1' || v === '0') return v === '1';
  } catch {
    /* private mode: default */
  }
  return kind === 'term';
}
function saveWrap(kind, on) {
  try {
    localStorage.setItem(WRAP_KEY[kind], on ? '1' : '0');
  } catch {
    /* private mode: the choice lasts until reload */
  }
}

// Colours (herdr's ansi read) are one choice for both views, on unless switched off.
const COLOR_KEY = 'herdr-hub.color';
function getColor() {
  try {
    return localStorage.getItem(COLOR_KEY) !== '0';
  } catch {
    return true;
  }
}
function saveColor(on) {
  try {
    localStorage.setItem(COLOR_KEY, on ? '1' : '0');
  } catch {
    /* private mode: the choice lasts until reload */
  }
}
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
  body.innerHTML = `<p class="note">불러오는 중…</p>${top}<pre class="screen" hidden></pre>
    <div class="pill-dock"><button type="button" class="new-out" hidden>↓ 새 출력</button></div>`;
  const s = (scr = {
    kind, body, tools, wrap: getWrap(kind), color: getColor(), raw: null, shown: null, pending: null, follow: true, touching: false, error: null, note: '',
    pre: body.querySelector('.screen'), pill: body.querySelector('.new-out'), loading: body.querySelector('.note'),
  });
  s.pre.classList.toggle('wrap', s.wrap);
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
  s.pill.onclick = () => {
    s.follow = true;
    flushScreen(true);
  };
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

function screenStatus() {
  const el = scr && scr.tools && scr.tools.querySelector('.s-status');
  if (!el) return;
  el.textContent = scr.error || scr.note || '';
  el.classList.toggle('err', Boolean(scr.error));
  scr.tools.hidden = !scr.error; // a note alone is not worth a row
  if (scr.shown == null) scr.loading.textContent = scr.error ? '화면을 읽지 못했습니다' : '불러오는 중…';
}

function screenError(msg) {
  if (!scr || scr.error === msg) return;
  scr.error = msg;
  screenStatus();
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

function drawScreen(s, p) {
  if (p.view === 'ansi') s.pre.innerHTML = window.Ansi.toHtml(p.text, screenColors(s.pre));
  else s.pre.textContent = p.view === 'strip' ? window.Ansi.strip(p.text) : p.text;
  paneBackground(s, p.view === 'ansi');
}

// A full-screen program (helix, vim) paints its own background on most cells. That colour then
// fills the whole box, padding included, so no dark gutter or gaps show around its rows.
function paneBackground(s, ansi) {
  let best = '';
  if (ansi) {
    const counts = new Map();
    let most = 0;
    for (const sp of s.pre.querySelectorAll('span')) {
      const bg = sp.style.backgroundColor || (/(^|\s)a[bB]\d/.test(sp.className) ? getComputedStyle(sp).backgroundColor : '');
      if (!bg) continue;
      const n = (counts.get(bg) || 0) + sp.textContent.length;
      counts.set(bg, n);
      if (n > most) (most = n), (best = bg);
    }
    const cells = s.pre.textContent.replace(/\n/g, '').length;
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
  s.pill.hidden = s.pending == null || s.follow;
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
