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
        <span class="sync" id="d-sync" role="img" aria-label="새로 불러오는 중" title="새로 불러오는 중" hidden></span>
        <button type="button" class="mode-chip" id="d-mode"${keyAttrs('mode', '모드 바꾸기')} hidden></button>
        <span id="d-badge"></span>
        <button class="icon-btn" id="d-more" aria-label="더 보기">${ICON.more}</button>
      </header>
      <button type="button" class="activity" id="d-activity" aria-label="터미널 화면 보기"${keyAttrs('terminal', '터미널 화면 보기')} hidden></button>
      <div class="screen-tools" id="s-tools" hidden></div>
      <div class="scroll" id="d-body"></div>
      <div id="d-blocked"></div>
      <div class="attach-tray" id="d-tray" hidden></div>
      <input type="file" id="d-file" accept="image/*" multiple hidden>
      <input type="file" id="d-cam" accept="image/*" capture="environment" hidden>
      <div class="palette" id="d-pal" role="listbox" aria-label="명령 제안" hidden></div>
      <div class="composer" id="d-form">
        <button type="button" class="attach" id="d-attach" aria-label="사진 첨부">${ICON.photo}</button>
        <div id="d-input" class="input" contenteditable="plaintext-only" role="textbox" aria-multiline="true" aria-label="메시지" data-placeholder="메시지 보내기" enterkeyhint="${getEnter() === 'send' ? 'send' : 'enter'}" autocapitalize="sentences"></div>
        <button type="button" class="stop" id="d-stop" aria-label="중단"${keyAttrs('stop', '중단')} hidden>${ICON.stop}</button>
        <button type="button" class="send" id="d-send" aria-label="보내기"${keyAttrs(null, '보내기', Keymap.label('Ctrl+Enter'))} disabled>${ICON.send}</button>
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
  // One button. The iPhone's picker offers 사진 찍기 itself, and a desktop has no camera to aim;
  // Android's may leave the camera out of a multiple-photo picker, so there it asks first.
  for (const id of ['d-file', 'd-cam']) {
    const picker = document.getElementById(id);
    picker.onchange = () => {
      addFiles([...picker.files]);
      picker.value = ''; // the same photo can be picked again
    };
  }
  document.getElementById('d-attach').onclick = async () => {
    if (!ANDROID) return document.getElementById('d-file').click();
    const k = await menu('사진 첨부', [['pick', '사진 고르기'], ['cam', '카메라로 찍기']]);
    if (k) document.getElementById(k === 'cam' ? 'd-cam' : 'd-file').click();
  };
  document.getElementById('d-tray').onclick = (e) => {
    const x = e.target.closest('[data-drop]');
    if (x) removeFile(Number(x.dataset.drop));
  };
  document.getElementById('d-body').addEventListener('scroll', (e) => updateJump(e.currentTarget), { passive: true });
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
      if (here()) {
        addPending(key, text.trim(), files.length);
        renderDetailBody(true); // to the end, where the message just sent is
      }
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
  document.getElementById('d-stop').onclick = () => confirmStop();
  document.getElementById('d-more').onclick = () => paneMenu('agent', currentAgent()); // actions.js
  document.getElementById('d-mode').onclick = cycleMode;
  renderDetailHeader();
  renderDetailBody(true);
}

// 중단 (the stop button, a menu): an agent's work, after asking. Esc to it; the chat stays.
async function confirmStop(a = currentAgent()) {
  if (!a) return;
  if (!(await sheet({ title: '작업 중단', text: `‘${a.name || a.title}’ 의 작업을 중단할까요? 대화는 남습니다.`, ok: '중단', danger: true }))) return;
  if ((await sendKeys(['esc'], a.host || localId(), a.pane)) && view.name !== 'agent') toast('중단하라고 보냈습니다');
}

// Alt+. twice within STOP_MS (keymap.js): what 중단 does once its sheet says yes. The first press
// only says so; taken only while the open agent works.
const STOP_MS = 2000;
let stopArm = null; // { key, at }: the first press, for this agent
function stopKey() {
  const a = view.name === 'agent' ? currentAgent() : null;
  if (!a || a.status !== 'working') return false;
  const key = rowKey(curHost(), a.pane);
  if (stopArm && stopArm.key === key && Date.now() - stopArm.at <= STOP_MS) {
    stopArm = null;
    sendKeys(['esc']);
  } else {
    stopArm = { key, at: Date.now() };
    toast('한 번 더 누르면 중단합니다', { ms: STOP_MS });
  }
  return true;
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
  for (const id of ['d-attach']) {
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

// One load at a time per opened agent (a load asked for meanwhile runs after it); a newly opened
// agent doesn't wait for the last one's.
let loading = null; // the detail being loaded
let reloadAfter = false; // a load was asked for while one was running
async function loadDetail() {
  const a = currentAgent();
  if (!a) return;
  if (loading === detail) return void (reloadAfter = true);
  const mine = (loading = detail);
  reloadAfter = false;
  const pane = encodeURIComponent(a.pane);
  const host = curHost();
  // Started first, so a blocked agent's screen read below doesn't hold the chat up.
  const chat = screenBody(a) ? null : loadChat(detail, a, pane, host);
  if (chat) chat.catch(() => {}); // awaited below; a failure there is reported once
  try {
    if (a.status === 'blocked') {
      const seq = a.stateSeq;
      const v = await api(hp(`/agents/${pane}/screen?source=visible&lines=30`, host));
      if (detail !== mine) return; // another agent was opened meanwhile: its own load runs
      // Read before a state change: that screen belongs to the previous prompt.
      if ((currentAgent() || {}).stateSeq === seq) detail.blockedText = v.text.replace(/\s+$/, '');
      else reloadAfter = true;
      renderBlocked();
    } else detail.blockedText = null;
    const working = a.status === 'working';
    const d = detail;
    let activityText = null;
    let footer = false; // the visible screen was read this round (for the mode chip)
    // The chat is drawn as soon as it arrives; the screen reads below (activity, mode chip) follow.
    if (!screenBody(a)) await chat;
    if (detail !== mine) return;
    if (screenBody(a) || detail.sheet) {
      // A working agent can't give its scrollback; Claude draws on the alternate screen anyway,
      // so what is visible is the whole picture. The server falls back to it too.
      const source = working || a.status === 'blocked' ? 'visible' : 'recent';
      const s = await api(hp(`/agents/${pane}/screen?source=${source}&lines=200${colorQuery()}`, host));
      if (detail !== mine) return;
      detail.screen = s;
      if (working && s.source === 'visible') activityText = s.format === 'ansi' && window.Ansi ? window.Ansi.strip(s.text) : s.text;
      if (s.source === 'visible' && a.status !== 'blocked') {
        noteMode(s.text);
        footer = true;
      }
    }
    // The activity line: what the visible screen says the agent is doing, only while working.
    if (working && activityText == null) activityText = (await api(hp(`/agents/${pane}/screen?source=visible&lines=60`, host))).text;
    if (detail !== mine) return;
    if (working && (currentAgent() || {}).status === 'working') setActivity(activityText);
    if (activityText != null) {
      noteMode(activityText);
      footer = true;
    }
    // Idle Claude: a short read of the bottom lines for the mode chip.
    if (!footer && !working && a.status !== 'blocked' && a.agent === 'claude') {
      const m = (await api(hp(`/agents/${pane}/screen?source=visible&lines=8`, host))).text;
      if (detail !== mine) return;
      noteMode(m);
    }
    renderMode();
    detail.lastErr = null;
    renderDetailBody(false);
    renderScreen();
    renderActivity();
    keepChat(d, a);
  } catch (err) {
    if (detail !== mine) return;
    if (detail.stale) {
      detail.stale = false;
      renderSync();
    }
    if (['agent_not_found', 'peer_offline'].includes(err.code)) return;
    const msg = `불러오지 못했습니다: ${errText(err)}`;
    // Polls repeat the same failure every few seconds: say it once, inline on the screen.
    if (scr) screenError(msg);
    else if (msg !== detail.lastErr) toast(msg);
    detail.lastErr = msg;
  } finally {
    if (loading === mine) {
      loading = null;
      if (reloadAfter) {
        reloadAfter = false;
        loadDetail();
      }
    }
  }
}

// The transcript into d (the detail it was asked for; it is dropped if another agent is open by
// then), drawn the moment it arrives.
//   a full copy here (kept from before): only what changed since (?rev, ?since), 20–35 ms.
//   nothing yet: the latest QUICK messages and the usual window side by side; the short one is
//   drawn if it comes first, and the window then puts the older messages above it.
//   a short copy (the first QUICK, or one kept on the device): the window, older ones above.
const QUICK = 20;
async function loadChat(d, a, pane, host) {
  const t = d.transcript;
  const apply = (r) => {
    if (d !== detail) return;
    d.transcript = mergeTranscript(d.transcript, r);
    d.stale = false;
    renderDetailBody(false);
    renderSync();
    renderActivity(); // its tail may come from the transcript
    keepChat(d, a);
    if (!d.prefetched) {
      d.prefetched = true;
      prefetchNeighbours();
    }
  };
  if (t && !t.partial) {
    const last = t.messages && t.messages[t.messages.length - 1];
    const q = `${t.rev ? `&rev=${encodeURIComponent(t.rev)}` : ''}${last && last.id ? `&since=${encodeURIComponent(last.id)}` : ''}`;
    return apply(await api(hp(`/agents/${pane}/transcript?limit=150${q}`, host)));
  }
  const full = api(hp(`/agents/${pane}/transcript?limit=150`, host));
  if (!t)
    api(hp(`/agents/${pane}/transcript?limit=${QUICK}`, host))
      .then((r) => {
        if (d !== detail || d.transcript || !r.supported || !r.found) return;
        d.transcript = { ...r, partial: true };
        renderDetailBody(false);
      })
      .catch(() => {});
  const r = await full;
  // mergeTranscript takes a full window as it is.
  apply(r);
}

// ---- kept chats (chatkeep.js): in memory while the page lives, the latest few on the device

const chatKeep = new ChatKeep.Lru(12); // host|pane -> { session, transcript, mode, activity }
const STORE_KEY = 'herdr-hub.chats.v1';
let stored = null; // the device's copies, read once
function readStored() {
  if (stored) return stored;
  try {
    stored = JSON.parse(localStorage.getItem(STORE_KEY)) || {};
    if (typeof stored !== 'object' || Array.isArray(stored)) stored = {};
  } catch {
    stored = {};
  }
  return stored;
}
let storeTimer = null;
function writeStored() {
  clearTimeout(storeTimer);
  storeTimer = null;
  stored = ChatKeep.prune(readStored());
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(stored));
  } catch {
    /* full or blocked: the copy in memory still serves this visit */
  }
}
// After a load: a moment later (polls come every few seconds), or as the page goes away.
const writeStoredSoon = () => storeTimer || (storeTimer = setTimeout(writeStored, 2000));
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && storeTimer && writeStored());

function keepChat(d, a) {
  const t = d.transcript;
  if (!t || !t.supported || !t.found || !a || !a.session || t.partial) return;
  const key = rowKey(d.host || localId(), d.pane);
  chatKeep.set(key, { session: a.session, transcript: t, mode: d.mode || null, activity: d.activity || null });
  const s = readStored();
  const old = s[key];
  // Written again only when the chat or the mode changed, or to mark it as opened lately.
  if (old && old.rev === t.rev && old.session === a.session && old.mode === (d.mode || null) && Date.now() - old.at < 600000) return;
  const e = ChatKeep.entryFor(t, { session: a.session, mode: d.mode || null, at: Date.now() });
  if (e) s[key] = e;
  else delete s[key];
  writeStoredSoon();
}

// The kept copy of the open agent, if it is of the conversation the pane has now: shown at once,
// marked stale (the header's small spinner) until loadChat brings the fresh one.
function adoptKept() {
  const d = detail;
  if (d.transcript || view.name !== 'agent') return false;
  const a = currentAgent();
  if (!a || !a.session || screenBody(a)) return false;
  const key = rowKey(curHost(), d.pane);
  const k = chatKeep.get(key);
  if (k && k.session === a.session) {
    Object.assign(d, { transcript: k.transcript, stale: true, mode: d.mode || k.mode, activity: d.activity || k.activity });
    return true;
  }
  const e = readStored()[key];
  const t = e && e.session === a.session && ChatKeep.restore(e);
  if (!t) return false;
  Object.assign(d, { transcript: t, stale: true, mode: d.mode || e.mode });
  return true;
}

function renderSync() {
  const el = document.getElementById('d-sync');
  if (el) el.hidden = !detail.stale;
}

// Copies of agents that are gone (closed, or the pane runs another conversation) go, once their
// host has said so; a host that is offline keeps its own.
function forgetGone() {
  const s = readStored();
  const sessionOf = (k) => (s[k] ? s[k].session : chatKeep.peek(k) ? chatKeep.peek(k).session : null);
  const keys = [...new Set([...Object.keys(s), ...chatKeep.keys()])];
  const out = ChatKeep.gone(keys, state, (a) => rowKey(a.host, a.pane), sessionOf);
  if (!out.length) return;
  let changed = false;
  for (const k of out) {
    chatKeep.delete(k);
    if (k in s) {
      delete s[k];
      changed = true;
    }
  }
  if (changed) writeStored();
}

// Split, with a keyboard: Alt+↑/↓ opens the row above or below. Their chats are fetched once
// this one has loaded, so the step lands on a kept copy. Only agents not kept at all (a kept
// one needs just the small refresh), one at a time, a moment after the open.
let prefetchTimer = null;
function prefetchNeighbours() {
  clearTimeout(prefetchTimer);
  if (!split || view.name !== 'agent') return;
  const d = detail;
  prefetchTimer = setTimeout(async () => {
    const main = listRoot() && listRoot().querySelector(':scope > main.home');
    if (!main || d !== detail) return;
    const links = [...main.querySelectorAll('a.sw-front')].map((x) => x.getAttribute('href'));
    const cur = main.querySelector('a[aria-current]');
    const here = cur && cur.getAttribute('href');
    for (const dir of [1, -1]) {
      const href = here && Split.stepRow(links, here, dir);
      const r = href && Route.parse(href.replace(/^#/, ''));
      if (!r || r.name !== 'agent' || d !== detail) continue;
      const host = r.host || localId();
      const a = state.agents.find((x) => same(x, host, r.pane));
      const key = rowKey(host, r.pane);
      if (!a || !a.session || screenBody(a) || chatKeep.has(key)) continue;
      try {
        const t = await api(hp(`/agents/${encodeURIComponent(r.pane)}/transcript?limit=150`, host));
        const now = state.agents.find((x) => same(x, host, r.pane));
        if (t.supported && t.found && now && now.session === a.session && !chatKeep.has(key)) chatKeep.set(key, { session: a.session, transcript: t, mode: null, activity: null });
      } catch {
        /* only a head start */
      }
    }
  }, 400);
}

// ---- sent, not in the transcript yet

// Claude Code holds a prompt that comes while it is busy and writes it down only when it takes
// it (between tool calls, or once the turn ends): a bubble marked 대기 중 shows it meanwhile.
// Per agent while the page lives. One goes when a user message with its text turns up after
// the point it was sent at, or when the agent has been idle a minute since (taken, or dropped).
const pendingSent = new Map(); // host|pane -> [{ text, after, at, pics }]
const sameText = (s) => String(s).replace(/\s+/g, ' ').trim();
function addPending(key, text, pics) {
  const msgs = (detail.transcript && detail.transcript.messages) || [];
  const last = msgs[msgs.length - 1];
  pendingSent.set(key, [...(pendingSent.get(key) || []), { text, after: last ? last.id : null, at: Date.now(), pics }]);
}
function pendingNow(key, a) {
  const list = pendingSent.get(key);
  if (!list) return [];
  const msgs = (detail.transcript && detail.transcript.messages) || [];
  const idle = a && a.status !== 'working' && a.status !== 'blocked';
  const keep = list.filter((p) => {
    if (idle && Date.now() - p.at > 60000) return false;
    const from = p.after ? msgs.findIndex((m) => m.id === p.after) + 1 : 0;
    return !msgs.slice(from).some((m) => m.role === 'user' && !m.bash && sameText(userParts(m).text) === sameText(p.text));
  });
  if (keep.length) pendingSent.set(key, keep);
  else pendingSent.delete(key);
  return keep;
}
function pendingBubble(p) {
  const pics = p.pics ? `<div class="pics"><span class="img-chip">사진 ${p.pics}장</span></div>` : '';
  return `<div class="msg user pending">${pics}${p.text ? `<span>${esc(p.text)}</span>` : ''}<small class="wait">대기 중</small></div>`;
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
      body.innerHTML = '<p class="note trunc" hidden>최근 대화만 표시합니다</p><div class="msgs"></div>' +
        `<div class="pill-dock"><button type="button" class="new-out jump"${keyAttrs('jumpEnd', '맨 아래로')} hidden>↓ 최신 대화</button></div>`;
      body._html = 'chat';
      body._seen = null;
      body.querySelector('.jump').onclick = () => jumpLatest(keyboardLikely()); // a phone's keyboard stays down
    }
    // A short copy (the latest few, more on the way) says nothing about older ones yet.
    body.querySelector('.trunc').hidden = !t.truncated || Boolean(t.partial);
    // One element per message, replaced only when its HTML changed: a poll that brings
    // nothing new touches nothing, so a text selection or a press survives it.
    const waiting = pendingNow(rowKey(curHost(), detail.pane), currentAgent()).map((p) => [`wait:${p.at}`, pendingBubble(p)]);
    const box = body.querySelector('.msgs');
    // Scrolled up: the message at the top of the view stays where it is, whatever comes in
    // above it (the older messages after a short first copy) or below.
    const anchor = nearBottom ? null : topMessage(body, box);
    patchList(box, [...t.messages.map((m, i) => [m.id || `i${i}`, message(m)]), ...waiting]);
    if (anchor && anchor.el.isConnected) body.scrollTop += anchor.el.getBoundingClientRect().top - anchor.top;
  }
  if (nearBottom) body.scrollTop = body.scrollHeight;
  updateJump(body);
}

// The first message whose bottom is inside the view, and where it is now.
function topMessage(body, box) {
  const top = body.getBoundingClientRect().top;
  for (const el of box.children) {
    const r = el.getBoundingClientRect();
    if (r.bottom > top) return { el, top: r.top };
  }
  return null;
}

// ---- 최신 대화: back to the end of the conversation

// Scrolled up to read: a pill at the bottom of the body goes back to the latest message, with
// how many came in meanwhile. _seen is the key of the last message seen at the bottom (keys, not
// a count: the transcript keeps only its latest messages, so older ones drop off the top).
const JUMP_SLACK = 80; // the same distance that still follows new messages (renderDetailBody)
function updateJump(body) {
  const pill = body && body._html === 'chat' && body.querySelector('.jump');
  if (!pill) return;
  const msgs = [...body.querySelector('.msgs').children];
  const last = msgs.length ? msgs[msgs.length - 1].dataset.key : null;
  const away = body.scrollHeight - body.scrollTop - body.clientHeight >= JUMP_SLACK;
  if (!away || body._seen === undefined || body._seen === null) body._seen = last;
  const i = msgs.findIndex((el) => el.dataset.key === body._seen);
  const fresh = i < 0 ? 0 : msgs.length - 1 - i;
  pill.textContent = fresh ? `↓ 새 메시지 ${fresh}` : '↓ 최신 대화';
  pill.hidden = !away;
}

// The pill, Ctrl+↓, Ctrl+End, ⌘+↓ or End: the open view to its latest line. The screen box (the
// terminal sheet, a screen-only agent, the shell) follows its output again; the conversation
// scrolls to its last message. focus: then the caret goes to the view's field (the composer, or
// the shell's command line), at the end of what is there; not under a sheet. False when there
// is nothing to jump in.
// Ctrl+↑ / Ctrl+K (prev) and Ctrl+J (next): the conversation by the messages you sent, each put
// at the top of the view and lit for a moment. Before the first one, the top; past the last,
// the end (jumpLatest, with the caret in the composer). A screen box (the terminal sheet, a
// screen-only agent, the shell) has no messages: a page up or down, and the end after the last
// page. The focus stays where it is, so the keys go on stepping. False with nothing to step.
const NAV_GAP = 8; // px left above the message
function navStep(dir) {
  const top = topLayer();
  if (scr && (!top || top.el.contains(scr.body))) {
    const b = scr.body;
    const left = b.scrollHeight - b.scrollTop - b.clientHeight;
    if (dir > 0 && left <= b.clientHeight) return jumpLatest(true);
    b.scrollTop += (dir > 0 ? 1 : -1) * Math.round(b.clientHeight * 0.9);
    return true;
  }
  const body = document.getElementById('d-body');
  if (top || !body || body._html !== 'chat') return false;
  const base = body.getBoundingClientRect().top - body.scrollTop;
  const mine = [...body.querySelectorAll('.msgs > .msg.user')].map((el) => ({ el, y: el.getBoundingClientRect().top - base - NAV_GAP }));
  const at = body.scrollTop;
  // Scrolled as far as it goes: a later message can't come to the top, so on is the end.
  if (dir > 0 && at >= body.scrollHeight - body.clientHeight - 2) return jumpLatest(true);
  const to = dir < 0 ? mine.filter((m) => m.y < at - 2).pop() : mine.find((m) => m.y > at + 2);
  if (!to) {
    if (dir > 0) return jumpLatest(true);
    body.scrollTop = 0;
    return true;
  }
  body.scrollTop = to.y; // at once: a glide would still be moving at the next press
  to.el.classList.remove('lit');
  void to.el.offsetWidth; // restart the light on a second press
  to.el.classList.add('lit');
  clearTimeout(to.el._lit);
  to.el._lit = setTimeout(() => to.el.classList.remove('lit'), 1200);
  return true;
}

// The box Ctrl+K/J and Ctrl+Shift+↑ move: the screen box in view (the terminal sheet, a
// screen-only agent, the shell), else the conversation; nothing under another sheet.
// Any other page has its own: 설정, 단축키, a workspace, a form (viewport.js mainScroller), or the
// list, on the phone or in a split sidebar with nothing on the right that scrolls.
function scrollBox() {
  const top = topLayer();
  if (scr && (!top || top.el.contains(scr.body))) return scr.body;
  if (top) return null;
  const chat = document.getElementById('d-body');
  if (chat) return chat._html === 'chat' ? chat : null;
  const page = mainScroller();
  if (page && page.scrollHeight > page.clientHeight) return page;
  const list = split && !sideOff() && listRoot() && listRoot().querySelector(':scope > main');
  return list || page || null;
}

// Ctrl+K / Ctrl+J. A press: a quarter of the view up or down, gliding; a press while that glide
// is still going adds to where it was headed. Held (the key repeating): no glide per repeat,
// which would restart thirty times a second and judder, but one steady scroll, every frame,
// until the key or Ctrl comes up (keyup below). The focus stays. False with nothing to scroll.
const GLIDE_MS = 450;
const HOLD_SPEED = 1.5; // views a second while held
let hold = null; // { box, dir, raf, last }
// A held key is also one whose next keydown comes with no keyup between: some keyboards (or
// their browser) leave e.repeat false on the repeats, and each would glide again, creeping
// while held and then running on to all the presses' goal when let go.
let stepDown = null; // { dir, at } of the last Ctrl+K/J keydown not yet let go
function scrollStep(dir, repeat) {
  const box = scrollBox();
  if (!box) return false;
  const now = Date.now();
  const again = stepDown && stepDown.dir === dir && now - stepDown.at < 1000;
  stepDown = { dir, at: now };
  if ((repeat || again) && !reduced()) return startHold(box, dir), true;
  stopHold();
  const from = box._goal != null && now - box._goalAt < GLIDE_MS ? box._goal : box.scrollTop;
  const max = box.scrollHeight - box.clientHeight;
  box._goal = Math.max(0, Math.min(max, from + dir * Math.round(box.clientHeight / 4)));
  box._goalAt = now;
  box.scrollTo({ top: box._goal, behavior: reduced() ? 'auto' : 'smooth' });
  return true;
}
function startHold(box, dir) {
  if (hold && hold.box === box && hold.dir === dir) return;
  stopHold();
  box._goal = null;
  box.scrollTo({ top: box.scrollTop, behavior: 'instant' }); // stops a glide still going
  const h = (hold = { box, dir, pos: box.scrollTop, last: performance.now(), raf: 0 });
  const tick = (t) => {
    if (hold !== h || !box.isConnected) return;
    const dt = Math.min(50, t - h.last); // a dropped frame doesn't jump
    h.last = t;
    const max = box.scrollHeight - box.clientHeight;
    // Kept unrounded here: scrollTop rounds, and a slow frame's step would be lost to it.
    h.pos = Math.max(0, Math.min(max, h.pos + (h.dir * box.clientHeight * HOLD_SPEED * dt) / 1000));
    box.scrollTop = h.pos;
    h.raf = requestAnimationFrame(tick);
  };
  h.raf = requestAnimationFrame(tick);
}
function stopHold() {
  if (hold) cancelAnimationFrame(hold.raf);
  hold = null;
}
// Not a shortcut (keymap.js has those): only the end of a held Ctrl+K/J.
document.addEventListener('keyup', (e) => {
  if (e.key === 'Control' || /^Key[JK]$/.test(e.code || '') || /^[jk]$/i.test(e.key)) {
    stepDown = null;
    stopHold();
  }
});
window.addEventListener('blur', () => {
  stepDown = null;
  stopHold();
});

// Ctrl+Shift+↑: the conversation (or the screen box in view) to its top. The focus stays. In
// the shell the top of a full box reads the longer scrollback (shell.js), as scrolling there does.
function jumpTop() {
  const box = scrollBox();
  if (!box) return false;
  stopHold();
  box._goal = null;
  box.scrollTop = 0;
  return true;
}

function jumpLatest(focus) {
  const top = topLayer();
  if (scr && (!top || top.el.contains(scr.body))) {
    scr.follow = true;
    flushScreen(true);
    scr.body.scrollTop = scr.body.scrollHeight;
  } else {
    const body = document.getElementById('d-body');
    if (top || !body || body._html !== 'chat') return false;
    // Glide a short way; a long way at once (messages arriving during a long glide would move
    // the end away from it, and the glide would stop short of them).
    const far = body.scrollHeight - body.scrollTop - body.clientHeight > body.clientHeight * 2;
    body.scrollTo({ top: body.scrollHeight, behavior: far || reduced() ? 'auto' : 'smooth' });
  }
  const f = !top && focus && (document.getElementById('d-input') || document.getElementById('t-input'));
  if (f && !f.disabled && document.activeElement !== f) {
    f.focus({ preventScroll: true });
    if (f.isContentEditable) caretToEnd(f);
  }
  return true;
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
        <button type="button" class="icon-btn" data-close aria-label="닫기"${keyAttrs('terminal', '닫기')}>${ICON.x}</button>
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

// Alt+T: the terminal sheet over the chat, opened or closed. Not for an agent whose body is
// already its screen, nor over another sheet or menu.
function toggleScreenSheet() {
  if (view.name !== 'agent') return false;
  const top = topLayer();
  if (detail.sheet) {
    if (top && top.el !== detail.sheet) return false;
    closeScreenSheet();
    return true;
  }
  if (top || screenBody()) return false;
  openScreenSheet();
  return Boolean(detail.sheet);
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
