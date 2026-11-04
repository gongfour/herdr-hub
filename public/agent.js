'use strict';
// The agent view: its page, header, loading, the activity line, the mode chip, the terminal screen
// sheet and the ⋯ menu.

// ------------------------------------------------------------ detail view

function renderDetail() {
  detailRoot().innerHTML = `
    <div class="detail">
      <header class="bar">
        ${backLink(homeHash())}
        <h1 id="d-title"></h1>
        <button type="button" class="mode-chip" id="d-mode" hidden></button>
        <span id="d-badge"></span>
        <button class="icon-btn" id="d-more" aria-label="더 보기">${ICON.more}</button>
      </header>
      <button type="button" class="activity" id="d-activity" aria-label="터미널 화면 보기" hidden></button>
      <div id="d-blocked"></div>
      <div class="screen-tools" id="s-tools" hidden></div>
      <div class="scroll" id="d-body"></div>
      <div class="attach-tray" id="d-tray" hidden></div>
      <input type="file" id="d-file" accept="image/*" multiple hidden>
      <input type="file" id="d-cam" accept="image/*" capture="environment" hidden>
      <div class="palette" id="d-pal" role="listbox" aria-label="명령 제안" hidden></div>
      <div class="composer" id="d-form">
        <button type="button" class="attach" id="d-attach" aria-label="사진 첨부">${ICON.photo}</button>
        <button type="button" class="attach" id="d-camera" aria-label="카메라로 찍기">${ICON.camera}</button>
        <div id="d-input" class="input" contenteditable="plaintext-only" role="textbox" aria-multiline="true" aria-label="메시지" data-placeholder="메시지 보내기" enterkeyhint="${getEnter() === 'send' ? 'send' : 'enter'}" autocapitalize="sentences"></div>
        <button type="button" class="stop" id="d-stop" aria-label="중단" hidden>${ICON.stop}</button>
        <button type="button" class="send" id="d-send" aria-label="보내기" disabled>${ICON.send}</button>
      </div>
    </div>`;
  document.getElementById('d-activity').onclick = openScreenSheet;
  // An editable div, not a <textarea>: iOS puts its ⌃ ⌄ / contact AutoFill bar over the keyboard
  // for text fields, but not for contenteditable. `value` keeps the textarea-style API below.
  const input = document.getElementById('d-input');
  Object.defineProperty(input, 'value', {
    get: () => input.innerText.replace(/\n$/, ''),
    set: (v) => (input.textContent = v),
  });
  input.oninput = () => {
    if (!input.innerText.trim()) input.textContent = ''; // a leftover <br> would hide the placeholder
    updateComposer();
    updatePalette();
    keepDraft();
  };
  input.onkeydown = (e) => {
    if (paletteKey(e) || recallKey(e, input)) return;
    const act = Keys.enterAction(e, getEnter());
    if (act === 'send') {
      e.preventDefault();
      sendNow();
    } else if (act === 'send-later') sendAfterIme = Date.now();
  };
  // ⌘/Ctrl+Enter on the syllable still being composed: sent as soon as the IME has put it in
  // (a moment, so a stray compositionend much later doesn't send).
  let sendAfterIme = 0;
  input.addEventListener('compositionend', () => {
    if (Date.now() - sendAfterIme > 1000) return;
    sendAfterIme = 0;
    setTimeout(sendNow, 0);
  });
  input.addEventListener('click', updatePalette);
  input.addEventListener('focus', updatePalette);
  // A tap on a suggestion must not count as leaving the field.
  input.addEventListener('blur', () => setTimeout(() => document.activeElement !== input && !(pal && pal.pressing) && hidePalette(), 0));
  bindPalette(input);
  // Pasted images (iOS: screenshot → Copy → long-press here → Paste) join the attachments;
  // text pastes as usual.
  input.addEventListener('paste', (e) => {
    const images = pastedImages(e.clipboardData);
    if (!images.length) return;
    // Keep any text that came along; with images only there is nothing to insert.
    if (!e.clipboardData.types.includes('text/plain')) e.preventDefault();
    addFiles(images);
  });
  for (const [btn, id] of [['d-attach', 'd-file'], ['d-camera', 'd-cam']]) {
    const picker = document.getElementById(id);
    document.getElementById(btn).onclick = () => picker.click();
    picker.onchange = () => {
      addFiles([...picker.files]);
      picker.value = ''; // the same photo can be picked again
    };
  }
  document.getElementById('d-tray').onclick = (e) => {
    const x = e.target.closest('[data-drop]');
    if (x) removeFile(Number(x.dataset.drop));
  };
  document.getElementById('d-body').addEventListener('click', (e) => {
    const pic = e.target.closest('.pic');
    if (pic) openViewer(pic.dataset.src);
    const more = e.target.closest('[data-shell]');
    if (more) {
      const set = (detail.openShell ||= new Set());
      const k = more.dataset.shell;
      if (set.has(k)) set.delete(k);
      else set.add(k);
      return renderDetailBody(false);
    }
    const tool = e.target.closest('[data-tool]');
    if (tool) {
      const set = (detail.openTools ||= new Set());
      const k = tool.dataset.tool;
      if (set.has(k)) set.delete(k);
      else set.add(k);
      renderDetailBody(false);
    }
  });
  // Not a <form>: iOS would add its ⌃ ⌄ / contact AutoFill bar above the keyboard.
  const sendNow = async () => {
    const text = input.value.replace(/\s+$/, '');
    const files = detail.files;
    if (detail.sending || (!text.trim() && !files.length)) return;
    if (files.some((f) => !f.blob)) return toast('사진을 준비하는 중입니다. 잠시 뒤에 보내 주세요.');
    const host = curHost();
    const pane = detail.pane;
    const key = rowKey(host, pane);
    const here = () => view.name === 'agent' && detail.pane === pane && curHost() === host;
    detail.sending = true;
    updateComposer();
    // The answer typed after a "Type something" choice: into the open question, then Enter.
    if (detail.answerMode && !files.length) {
      try {
        await api(hp(`/agents/${encodeURIComponent(pane)}/keys`, host), { method: 'POST', body: JSON.stringify({ text: text.replace(/\s+/g, ' ').trim(), keys: ['enter'] }) });
        if (here()) {
          input.value = '';
          detail.answerMode = false;
          setPlaceholder();
        }
        drafts.delete(key);
        setTimeout(loadDetail, 500);
      } catch (err) {
        toastErr(`답을 보내지 못했습니다: ${errText(err)} 글은 그대로 있습니다.`, { label: '다시 보내기', run: () => here() && sendNow() });
      } finally {
        detail.sending = false;
        updateComposer();
      }
      return;
    }
    try {
      // Photos go to the agent's own host first; the prompt then names each file on its own line.
      for (const f of files) {
        if (f.path) continue; // uploaded on an earlier try
        try {
          f.path = (await api(hp('/uploads', host), { method: 'POST', body: f.blob, headers: { 'Content-Type': f.blob.type } })).path;
        } catch (err) {
          throw Object.assign(err, { upload: true });
        }
      }
      await api(hp(`/agents/${encodeURIComponent(pane)}/prompt`, host), { method: 'POST', body: JSON.stringify({ text: promptText(text, files.map((f) => f.path)) }) });
      if (here() && detail.files === files) {
        input.value = '';
        hidePalette();
        dropFiles();
        renderTray();
        drafts.delete(key);
      } else for (const f of files) URL.revokeObjectURL(f.url);
      if ((drafts.get(key) || {}).files === files) drafts.delete(key);
      setTimeout(loadDetail, 600);
    } catch (err) {
      const retry = { label: '다시 보내기', run: () => here() && sendNow() };
      if (err.code === 'agent_blocked') toastErr(errText(err));
      else if (err.network) toastErr(`연결이 끊겨 ${err.upload ? '사진을 올리지' : '보내지'} 못했습니다. 글은 그대로 있습니다.`, retry);
      else toastErr(`${err.upload ? '사진을 올리지' : '보내지'} 못했습니다: ${errText(err)} 글은 그대로 있습니다.`, retry);
    } finally {
      detail.sending = false;
      updateComposer();
    }
  };
  document.getElementById('d-send').onclick = sendNow;
  keepFocusTap(document.getElementById('d-send'), sendNow);
  document.getElementById('d-stop').onclick = confirmStop;
  document.getElementById('d-more').onclick = agentMenu;
  document.getElementById('d-mode').onclick = cycleMode;
  renderDetailHeader();
  renderDetailBody(true);
}

async function confirmStop() {
  if (!(await sheet({ title: '작업 멈추기', text: '작업을 멈출까요? 대화는 남습니다.', ok: '멈추기', danger: true }))) return;
  sendKeys(['esc']);
}

function setPlaceholder() {
  const input = document.getElementById('d-input');
  if (input) input.dataset.placeholder = detail.answerMode ? '답을 적어 보내세요' : '메시지 보내기';
}

function updateComposer() {
  const a = currentAgent();
  const input = document.getElementById('d-input');
  const send = document.getElementById('d-send');
  const stop = document.getElementById('d-stop');
  if (!input) return;
  const working = a && a.status === 'working';
  stop.hidden = !working;
  const files = detail.files || [];
  // Blocked: only the answer to a "Type something" choice goes from here.
  const blockedNow = a && a.status === 'blocked' && !detail.answerMode;
  send.disabled = !a || (!input.value.trim() && !files.length) || blockedNow || Boolean(detail.sending);
  for (const id of ['d-attach', 'd-camera']) {
    const b = document.getElementById(id);
    if (b) b.disabled = Boolean(detail.sending) || files.length >= MAX_FILES;
  }
}

function renderDetailHeader() {
  const a = currentAgent();
  const title = document.getElementById('d-title');
  if (!title) return;
  // The agent exited and left its shell behind: show that pane as a terminal. Only once the
  // agent has been seen here; just after a start the state may still list the pane as a shell.
  if (a) detail.seen = true;
  else if (detail.seen && (state.terminals || []).some((t) => same(t, curHost(), detail.pane))) return (location.hash = link(curHost(), `/term/${encodeURIComponent(detail.pane)}`));
  if (!a) {
    // Before the first state arrives (or before a peer's first report) nothing is known yet.
    const known = state.herdr !== 'connecting' && (state.hosts || []).some((h) => h.id === curHost());
    title._html = null;
    title.innerHTML = !known
      ? '불러오는 중…'
      : !online(curHost())
      ? `${esc(hostLabel(curHost()))} 오프라인<span class="sub">호스트가 돌아오면 다시 보입니다</span>`
      : `에이전트 없음<span class="sub">이 패널의 에이전트가 끝났거나 닫혔습니다</span>`;
    document.getElementById('d-badge').innerHTML = '';
    renderActivity();
    updateComposer();
    return;
  }
  // The status and its time sit beside the title on wide screens (#d-badge) and lead the
  // subtitle on the phone (.sub-st), where the title row is left to the name (style.css).
  const time = a.status === 'working' ? '' : timeTag(a);
  const status = esc(STATUS_LABEL[a.status] || a.status);
  const th = `<span class="t">${esc(a.name || a.title)}</span><span class="sub"><span class="sub-st"><b class="st ${esc(a.status)}">${status}</b>${time ? ` · ${time}` : ''} · </span>${multi() ? `${esc(hostLabel(a.host))} · ` : ''}${a.agent === 'claude' ? '' : `${esc(a.agent)} · `}${esc(wsAndDir(a.workspaceLabel, a.cwd))}</span>`;
  if (title._html !== th) {
    title._html = th;
    title.innerHTML = th;
    fillTimes(title);
  }
  const badge = document.getElementById('d-badge');
  const bh = `${liveDot()}${time}<span class="badge ${esc(a.status)}">${status}</span>`;
  if (badge._html !== bh) {
    badge._html = bh;
    badge.innerHTML = bh;
    fillTimes(badge);
  }
  if (a.status !== 'working') detail.activity = null;
  renderMode();
  if (detail.answerMode && a.status !== 'blocked') {
    detail.answerMode = false;
    setPlaceholder();
  }
  if (detail.wantSheet) {
    detail.wantSheet = false;
    openScreenSheet();
  }
  renderBlocked();
  renderActivity();
  updateComposer();
}

let loading = false;
let reloadAfter = false; // a load was asked for while one was running
async function loadDetail() {
  const a = currentAgent();
  if (!a) return;
  if (loading) return void (reloadAfter = true);
  loading = true;
  const pane = encodeURIComponent(a.pane);
  const host = curHost();
  try {
    if (a.status === 'blocked') {
      const seq = a.stateSeq;
      const v = await api(hp(`/agents/${pane}/screen?source=visible&lines=30`, host));
      // Read before a state change: that screen belongs to the previous prompt.
      if ((currentAgent() || {}).stateSeq === seq) detail.blockedText = v.text.replace(/\s+$/, '');
      else reloadAfter = true;
      renderBlocked();
    } else detail.blockedText = null;
    const working = a.status === 'working';
    const d = detail;
    let activityText = null;
    let footer = false; // the visible screen was read this round (for the mode chip)
    if (!screenBody(a)) {
      // Only what changed since the copy here (?rev, ?since): an unchanged chat costs nothing.
      const t = d.transcript;
      const last = t && t.messages && t.messages[t.messages.length - 1];
      const q = `${t && t.rev ? `&rev=${encodeURIComponent(t.rev)}` : ''}${last && last.id ? `&since=${encodeURIComponent(last.id)}` : ''}`;
      const r = await api(hp(`/agents/${pane}/transcript?limit=150${q}`, host));
      if (d === detail) d.transcript = mergeTranscript(d.transcript, r);
    }
    if (screenBody(a) || detail.sheet) {
      // A working agent can't give its scrollback; Claude draws on the alternate screen anyway,
      // so what is visible is the whole picture. The server falls back to it too.
      const source = working || a.status === 'blocked' ? 'visible' : 'recent';
      const s = (detail.screen = await api(hp(`/agents/${pane}/screen?source=${source}&lines=200${colorQuery()}`, host)));
      if (working && s.source === 'visible') activityText = s.format === 'ansi' && window.Ansi ? window.Ansi.strip(s.text) : s.text;
      if (s.source === 'visible' && a.status !== 'blocked') {
        noteMode(s.text);
        footer = true;
      }
    }
    // The activity line: what the visible screen says the agent is doing, only while working.
    if (working && activityText == null) activityText = (await api(hp(`/agents/${pane}/screen?source=visible&lines=60`, host))).text;
    if (working && (currentAgent() || {}).status === 'working') setActivity(activityText);
    if (activityText != null) {
      noteMode(activityText);
      footer = true;
    }
    // Idle Claude: a short read of the bottom lines for the mode chip.
    if (!footer && !working && a.status !== 'blocked' && a.agent === 'claude' && d === detail) noteMode((await api(hp(`/agents/${pane}/screen?source=visible&lines=8`, host))).text);
    renderMode();
    detail.lastErr = null;
    renderDetailBody(false);
    renderScreen();
    renderActivity();
  } catch (err) {
    if (['agent_not_found', 'peer_offline'].includes(err.code)) return;
    const msg = `불러오지 못했습니다: ${errText(err)}`;
    // Polls repeat the same failure every few seconds: say it once, inline on the screen.
    if (scr) screenError(msg);
    else if (msg !== detail.lastErr) toast(msg);
    detail.lastErr = msg;
  } finally {
    loading = false;
    if (reloadAfter) {
      reloadAfter = false;
      loadDetail();
    }
  }
}

// Only Claude has a transcript; any other agent kind shows its terminal screen in the body.
const screenBody = (a = currentAgent()) => Boolean(a && a.agent && a.agent !== 'claude');

function renderDetailBody(reset) {
  const body = document.getElementById('d-body');
  if (!body) return;
  if (screenBody()) {
    body._html = null;
    closeScreenSheet();
    if (!scr || scr.body !== body)
      mountScreen(body, 'agent', document.getElementById('s-tools'), '이 에이전트는 대화 기록이 없어 터미널 화면을 보여 줍니다. 지금 보이는 화면만 있습니다.');
    renderScreen();
    return;
  }
  if (scr && scr.body === body) {
    unmountScreen();
    body._html = null;
    reset = true;
  }
  const nearBottom = reset || body.scrollHeight - body.scrollTop - body.clientHeight < 80;
  const t = detail.transcript;
  const note = !t ? '불러오는 중…' : !t.supported ? (currentAgent()?.agent ? '아직 대화 기록이 없습니다.' : '에이전트를 시작하는 중…') : !t.found ? '아직 대화 기록이 없습니다.' : '';
  if (note) {
    const html = `<p class="note">${note}</p>`;
    if (body._html !== html) body.innerHTML = body._html = html;
  } else {
    if (body._html !== 'chat' || !body.querySelector('.msgs')) {
      body.innerHTML = '<p class="note trunc" hidden>최근 대화만 표시합니다</p><div class="msgs"></div>';
      body._html = 'chat';
    }
    body.querySelector('.trunc').hidden = !t.truncated;
    // One element per message, replaced only when its HTML changed: a poll that brings
    // nothing new touches nothing, so a text selection or a press survives it.
    patchList(body.querySelector('.msgs'), t.messages.map((m, i) => [m.id || `i${i}`, message(m)]));
  }
  if (nearBottom) body.scrollTop = body.scrollHeight;
}

// The latest screen read, into whichever screen box is mounted (the body or the sheet).
function renderScreen() {
  const s = detail.screen;
  if (!scr || scr.kind !== 'agent' || !s) return;
  scr.note = s.source === 'visible' ? '보이는 화면' : '';
  setScreenText(s.text, s.format);
}

// ---- live activity line: under the header while the agent works; a tap opens the screen

function setActivity(text) {
  const p = text != null && window.Activity ? window.Activity.parseActivity(text) : null;
  detail.activity = p ? { ...p, at: Date.now() } : null;
}

function renderActivity() {
  const box = document.getElementById('d-activity');
  if (!box) return;
  const a = currentAgent();
  if (!a || a.status !== 'working') {
    box.hidden = true;
    clearInterval(tickTimer);
    tickTimer = null;
    return;
  }
  const act = detail.activity;
  const tail = (act && act.tool) || transcriptTool() || (act && (act.detail || act.tokens));
  box.disabled = screenBody(a); // the screen is already the body
  box.innerHTML = `<span class="spin" aria-hidden="true"></span><b>${esc(act ? act.word : '작업 중…')}</b><span class="el"></span>${
    tail ? `<span class="tail">${esc(tail)}</span>` : ''
  }${box.disabled ? '' : '<span class="go" aria-hidden="true">터미널 ›</span>'}`;
  box.hidden = false;
  tickActivity();
  if (!tickTimer) tickTimer = setInterval(tickActivity, 1000);
}

// The last tool of this turn from the transcript, for screens that don't show the tool block
// (Claude on Windows often has only the spinner in view): the tools of the replies after the
// last prompt.
function transcriptTool() {
  const msgs = (detail.transcript && detail.transcript.messages) || [];
  for (let i = msgs.length - 1; i >= 0 && !['user', 'note'].includes(msgs[i].role); i--) {
    const t = msgs[i].tools && msgs[i].tools[msgs[i].tools.length - 1];
    if (t) return `${t.name}: ${t.summary}`;
  }
  return null;
}

// Elapsed time runs on between reads: since the hub saw the status turn to working, else from
// the spinner's own count. The header's "완료 · 3분 전" ticks here too.
function tickActivity() {
  for (const id of ['d-badge', 'd-title']) {
    const box = document.getElementById(id);
    if (box) fillTimes(box);
  }
  const el = document.querySelector('#d-activity .el');
  if (!el) return;
  const act = detail.activity;
  const a = currentAgent();
  const since = a && a.workingSince ? a.workingSince : act && act.seconds != null ? act.at - act.seconds * 1000 : null;
  el.textContent = since ? durKo((Date.now() - since) / 1000) : '';
}

// ---- permission mode chip (Claude): read off the footer; a tap sends ⇧Tab, the next mode
const MODE_LABEL = { auto: '자동', manual: '수동 승인', accept: '편집 허용', plan: '계획', bypass: '권한 우회' };
// The phone's narrow header shows the chip in two letters (style.css picks one).
const MODE_SHORT = { auto: '자동', manual: '수동', accept: '편집', plan: '계획', bypass: '우회' };
function noteMode(text) {
  if (text == null || !window.parseMode) return;
  const m = parseMode(window.Ansi ? window.Ansi.strip(String(text)) : String(text));
  if (m) detail.mode = m;
}
function renderMode() {
  const chip = document.getElementById('d-mode');
  const a = currentAgent();
  if (!chip) return;
  const m = a && a.agent === 'claude' ? detail.mode : null;
  chip.hidden = !m;
  if (!m) return;
  chip.innerHTML = `<span class="full">${esc(MODE_LABEL[m] || m)}</span><span class="short" aria-hidden="true">${esc(MODE_SHORT[m] || MODE_LABEL[m] || m)}</span>`;
  chip.dataset.mode = m;
  // ⇧Tab in the middle of a question would act on the question.
  chip.disabled = a.status === 'blocked' || Boolean(detail.modeBusy);
  chip.setAttribute('aria-label', `권한 모드: ${MODE_LABEL[m] || m}. 누르면 다음 모드로 바꿉니다(⇧Tab)`);
}
async function cycleMode() {
  const a = currentAgent();
  if (!a || a.status === 'blocked' || detail.modeBusy) return;
  const pane = a.pane;
  const host = curHost();
  detail.modeBusy = true;
  renderMode();
  const ok = await sendKeys(['shift+tab'], host, pane);
  // Read the footer again once Claude has redrawn it.
  if (ok)
    await new Promise((r) => setTimeout(r, 450)).then(() =>
      api(hp(`/agents/${encodeURIComponent(pane)}/screen?source=visible&lines=8`, host))
        .then((s) => detail.pane === pane && noteMode(s.text))
        .catch(() => {})
    );
  detail.modeBusy = false;
  renderMode();
}

// ---- the terminal screen as a tall sheet over the chat

function openScreenSheet() {
  const a = currentAgent();
  if (!a || screenBody(a) || detail.sheet || !document.getElementById('d-body')) return;
  const el = document.createElement('div');
  el.className = 'sheet-back';
  el.innerHTML = `<div class="sheet term-sheet" role="dialog" aria-modal="true" aria-label="터미널 화면">
      <div class="term-sheet-head">
        <h2>터미널 화면<span class="sub">${esc(a.name || a.title)}</span></h2>
        <button type="button" class="icon-btn" data-close aria-label="닫기">${ICON.x}</button>
      </div>
      <div class="screen-tools"></div>
      <div class="scroll" id="ss-body"></div>
      ${keyRow(SHEET_KEYS, 'sheet-keys')}
    </div>`;
  el.onclick = (e) => {
    if (e.target === el) closeScreenSheet();
  };
  el.querySelector('[data-close]').onclick = closeScreenSheet;
  detail.sheet = el;
  // Closed by Escape or the backdrop too: whichever way, the screen box goes with it.
  detail.sheetLayer = openLayer(el, { focus: '[data-close]', onClose: () => closeScreenSheet() });
  mountScreen(el.querySelector('#ss-body'), 'agent', el.querySelector('.screen-tools'), '터미널에 지금 보이는 화면의 맨 위입니다. 이전 내용은 <button type="button" class="linkish">대화</button>에서 볼 수 있습니다.');
  el.querySelector('.screen-top .linkish').onclick = closeScreenSheet;
  bindKeyRow(el.querySelector('.sheet-keys'));
  loadDetail();
}

function closeScreenSheet() {
  const el = detail.sheet;
  if (!el) return;
  if (scr && el.contains(scr.body)) unmountScreen();
  detail.sheet = null;
  const layer = detail.sheetLayer;
  detail.sheetLayer = null;
  if (layer) closeLayer(layer);
  else el.remove();
}

async function agentMenu() {
  const a = currentAgent();
  if (!a) return;
  const last = lastReply();
  const k = await menu(a.name || a.title, [
    a.status === 'working' ? ['stop', '멈추기'] : null,
    screenBody(a) ? null : ['screen', '터미널 화면 보기'],
    ['keys', '키 보내기', false, 'Esc · ⇧Tab · Enter · ↑ ↓ · 1–3'],
    last ? ['copy', '마지막 답 복사'] : null,
    ['rename', '이름 바꾸기'],
    ['ws', '워크스페이스 보기'],
    ['close', '패널 닫기(에이전트 종료)', true],
  ]);
  if (k === 'stop') confirmStop();
  if (k === 'screen') openScreenSheet();
  if (k === 'keys') {
    const key = await menu('키 보내기', AGENT_KEYS.map(([key, label]) => [key, label]), { sub: a.name || a.title });
    if (key) {
      const host = a.host;
      const pane = a.pane;
      if (await sendKeys([key], host, pane)) toast(`${AGENT_KEYS.find((x) => x[0] === key)[1]} 키를 보냈습니다`);
    }
  }
  if (k === 'copy') copyText(lastReply(), '마지막 답을 복사했습니다');
  if (k === 'ws') location.hash = link(a.host, `/ws/${encodeURIComponent(a.workspace)}`);
  if (k === 'rename') renamePane(a, true);
  if (k === 'close') closePane(a.host, a.pane, a.name || a.title, true);
}

async function copyText(text, okText) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Older Safari, or no permission: a hidden field and the copy command.
    const t = document.createElement('textarea');
    t.value = text;
    t.setAttribute('readonly', '');
    t.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand && document.execCommand('copy');
    t.remove();
    if (!ok) return toastErr('복사하지 못했습니다');
  }
  toast(okText);
}
