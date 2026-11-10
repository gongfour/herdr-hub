'use strict';
// The conversation: transcript merging and each message's HTML (photos, markdown replies, tool
// lines, ! output), and the photo viewer.

// An upload path on a line of its own, as promptText writes it (either host's separators).
const UPLOAD_LINE = /^(?:.*[\\/])?(?:herdr-hub|paddock)-uploads[\\/](\d{8}-\d{6}-[0-9a-f]{8}\.(?:jpg|png|webp))$/;
// Split a sent prompt into what was typed and the attached upload names: from the transcript's
// image sources, or from path lines Claude Code left as text.
function userParts(m) {
  const pics = [...(m.uploads || [])];
  let text = String(m.text || '')
    .split('\n')
    .filter((line) => {
      const x = UPLOAD_LINE.exec(line.trim());
      if (x && !pics.includes(x[1])) pics.push(x[1]);
      return !x;
    })
    .join('\n');
  if (pics.length || m.images) text = text.replace(/\[Image #\d+\]\s?/g, '');
  return { text: text.trim(), pics };
}

function openViewer(src) {
  const el = document.createElement('div');
  el.className = 'viewer';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', '사진');
  el.innerHTML = `<img src="${esc(src)}" alt="첨부 사진"><button type="button" class="icon-btn x" aria-label="닫기">${ICON.x}</button>`;
  const layer = openLayer(el, { focus: '.x' });
  el.onclick = () => closeLayer(layer);
}

// The server's answer onto the copy here: unchanged, the tail from `since` on, or all of it.
function mergeTranscript(old, r) {
  if (!r || !r.supported || !r.found || !old || !old.messages || r.reset || (!r.unchanged && !r.since)) return r;
  if (r.unchanged) return old;
  const i = old.messages.findIndex((m) => m.id === r.since);
  if (i < 0) return r;
  return ChatKeep.joinSince(old, r, i); // older pages loaded above stay (chatkeep.js)
}

// Output of a "!" command (bash mode), under its line: monospace, folded after SHELL_FOLD lines.
const SHELL_FOLD = 12;
function shellOut(m) {
  // A failed command's output is all recorded as stderr: tinted only next to real stdout.
  const tint = Boolean(m.text);
  const lines = [...(m.text ? m.text.split('\n') : []), ...(m.err ? m.err.split('\n').map((l) => (tint ? { err: l } : l)) : [])];
  if (!lines.length) return `<div class="msg shell-out empty"><span class="muted">(출력 없음)</span></div>`;
  const open = Boolean(detail.openShell && detail.openShell.has(m.id));
  const shown = open || lines.length <= SHELL_FOLD + 2 ? lines : lines.slice(0, SHELL_FOLD);
  const body = shown.map((l) => (typeof l === 'string' ? esc(l) : `<span class="err">${esc(l.err)}</span>`)).join('\n');
  const fold = lines.length > SHELL_FOLD + 2
    ? `<button type="button" class="shell-more" data-shell="${esc(m.id)}" aria-expanded="${open}">${open ? '접기' : `${lines.length - SHELL_FOLD}줄 더 보기`}</button>`
    : '';
  return `<div class="msg shell-out"><pre>${body}</pre>${fold}</div>`;
}

function message(m) {
  if (m.role === 'note') return `<p class="note">${esc(m.text)}</p>`;
  if (m.role === 'shell') return shellOut(m);
  if (m.role === 'user' && m.bash) return `<div class="msg user bash"><span class="sr-only">나: </span><span>${esc(m.text)}</span></div>`;
  if (m.role === 'user') {
    const { text, pics } = userParts(m);
    const imgs = pics.map((n) => {
      const src = `/api${hp(`/uploads/${n}`)}`;
      return `<button type="button" class="pic" data-src="${esc(src)}" aria-label="사진 크게 보기"><img src="${esc(src)}" alt="첨부 사진" loading="lazy"></button>`;
    });
    // Inline images with no upload behind them (pasted on the host): a chip each, never the bytes.
    const chips = Array.from({ length: Math.max(0, (m.images || 0) - pics.length) }, () => '<span class="img-chip">이미지</span>');
    const media = imgs.length || chips.length ? `<div class="pics">${imgs.join('')}${chips.join('')}</div>` : '';
    // No whitespace between tags: the bubble keeps line breaks (pre-wrap).
    return `<div class="msg user"><span class="sr-only">나: </span>${media}${text ? `<span>${esc(text)}</span>` : ''}</div>`;
  }
  const tools = m.tools && m.tools.length ? `<div class="tools">${m.tools.map((t, i) => toolLine(t, `${m.id}:${i}`)).join('')}</div>` : '';
  return `<div class="msg assistant"><span class="sr-only">에이전트: </span>${m.text ? Markdown.md(m.text) : ''}${tools}</div>`;
}

// A tool line; AskUserQuestion shows what was chosen ("Pick a color? → Red"). One with a
// result in the transcript opens to show it (cut at 2000 characters by the server), under the
// whole command when the line shows only its description or the part after `cd … &&`.
function toolLine(t, key) {
  const asked = t.answers && t.answers.length ? t.answers.map((x) => `${esc(x.q)} → <span class="ans">${esc(x.a)}</span>`).join(' · ') : '';
  const head = `<b>${esc(t.name)}</b> ${asked || esc(t.summary)}`;
  const cls = `tool${asked ? ' asked' : ''}${t.error ? ' failed' : ''}`;
  // ExitPlanMode: the plan itself, to read before its approval prompt is answered.
  const plan = t.plan ? `<div class="tool-plan">${Markdown.md(t.plan)}</div>` : '';
  if (!t.result) return `<div class="${cls}">${head}</div>${plan}`;
  const open = Boolean(detail.openTools && detail.openTools.has(key));
  return `<div class="tool-wrap"><button type="button" class="${cls}" data-tool="${esc(key)}" aria-expanded="${open}"><span class="tool-head">${head}</span><span class="chev" aria-hidden="true">${open ? '▾' : '▸'}</span></button>${
    open ? `<pre class="tool-out">${t.cmd ? `<span class="tool-cmd">$ ${esc(t.cmd)}</span>\n` : ''}${esc(t.result)}${t.cut ? '\n… (뒤는 잘림)' : ''}</pre>` : ''
  }</div>${plan}`;
}

// The agent's last reply in the transcript, as it wrote it (markdown).
function lastReply() {
  const msgs = (detail.transcript && detail.transcript.messages) || [];
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'assistant' && msgs[i].text) return msgs[i].text;
  return '';
}
