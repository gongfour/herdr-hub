'use strict';
// Answering an agent: key rows, choice buttons, the blocked box in the
// agent view, and sendKeys.

// Keys an agent takes from here: the blocked box's 직접 입력, the ⋯ 키 보내기 menu and the
// terminal sheet's key row (which adds Ctrl+C).
// ← → go between the questions AskUserQuestion asks together.
const AGENT_KEYS = [['esc', 'Esc'], ['shift+tab', '⇧Tab'], ['enter', 'Enter'], ['up', '↑'], ['down', '↓'], ['left', '←'], ['right', '→'], ['1', '1'], ['2', '2'], ['3', '3']];
// The sheet's row leads with the keys wanted in a hurry (Esc, Ctrl+C).
const SHEET_KEYS = [['esc', 'Esc'], ['ctrl+c', 'Ctrl+C'], ['enter', 'Enter'], ['up', '↑'], ['down', '↓'], ['shift+tab', '⇧Tab'], ['1', '1'], ['2', '2'], ['3', '3']];
// A slash command's menu (/config, /status …) without a list read here is moved through with these.
const MENU_KEYS = [['esc', 'Esc'], ['up', '↑'], ['down', '↓'], ['left', '←'], ['right', '→'], ['enter', 'Enter'], ['space', 'Space'], ['tab', 'Tab']];
const keyRow = (keys, cls = '') => `<div class="keys ${cls}">${keys.map(([k, label]) => `<button type="button" class="key" data-key="${k}" aria-label="${esc(label)} 키 보내기">${esc(label)}</button>`).join('')}</div>`;
function bindKeyRow(row) {
  if (row) row.querySelectorAll('.key').forEach((b) => (b.onclick = () => sendKeys([b.dataset.key])));
}
// A choice button (the blocked box) goes through
// the host's guard (POST /agents/<pane>/answer, lib/notify checkAnswer): the keys go only while
// the agent is still blocked on the prompt the buttons were drawn for (stateSeq) and option n
// still reads the same. A tapped button stays pressed while the answer is on its way and a
// moment after (or until the next status), so a double tap sends once; the host also refuses a
// second answer to the same prompt. One prompt can take several answers while herdr's status
// stays put (AskUserQuestion's questions one after another, a multiSelect's boxes): the press
// belongs to the screen it was made on (choicesSig), and a new screen lets the next one go.
const PRESS_MS = 1500;
const pressed = new Map(); // host|pane -> { seq, sig, n, until } (until is Infinity while in flight)
function pressedOn(host, a, choices = null) {
  const p = a && pressed.get(rowKey(host, a.pane));
  if (!p || a.stateSeq !== p.seq || Date.now() >= p.until) return null;
  return choices && p.until !== Infinity && choicesSig(choices) !== p.sig ? null : p;
}
// Both places that show choices, drawn again (each only changes what changed).
function redrawChoices() {
  if (listShown()) render();
  renderBlocked();
}
// The prompt moved on before the answer arrived: forget what was read for it and read again.
function questionChanged(host, pane) {
  if (view.name === 'agent' && detail.pane === pane && curHost() === host) {
    detail.blockedText = null;
    loadDetail();
  }
}
// True when the answer went.
// alt: the menu's own key on that row instead of Enter (choices.alt: /model's 「이 세션만」).
async function answerChoice(host, a, item, choices = null, alt = false) {
  const k = rowKey(host, a.pane);
  if (pressedOn(host, a, choices)) return false;
  const press = { seq: a.stateSeq, sig: choicesSig(choices), n: item.n, until: Infinity };
  pressed.set(k, press);
  redrawChoices();
  let ok = false;
  try {
    await api(hp(`/agents/${encodeURIComponent(a.pane)}/answer`, host), {
      method: 'POST',
      body: JSON.stringify({ stateSeq: a.stateSeq, n: item.n, label: item.label, own: TYPE_OWN.test(item.label), ...(alt ? { alt: true } : {}) }),
    });
    ok = true;
  } catch (err) {
    if (err.code === 'answered') ok = true; // it went already (the other tap, or a notification)
    else if (err.status === 409) {
      toast('질문이 바뀌었습니다. 새 질문을 보고 다시 고르세요');
      questionChanged(host, a.pane);
    } else toastErr(`답을 보내지 못했습니다: ${errText(err)}`);
  }
  if (ok) {
    press.until = Date.now() + PRESS_MS;
    setTimeout(redrawChoices, PRESS_MS + 50);
    closeNotes(host, a.pane);
    // The screen read again: the same prompt may now show its next step (a status change reads anyway).
    if (view.name === 'agent' && detail.pane === a.pane && curHost() === host) for (const ms of [500, PRESS_MS + 100]) setTimeout(loadDetail, ms);
  } else if (pressed.get(k) === press) pressed.delete(k); // not sent: the buttons come back at once
  redrawChoices();
  return ok;
}

// The emphasised answer: the first plain "Yes" only. Everything else has the same weight;
// refusals are tinted as a warning.
const primaryChoice = (items) => items.find((x) => !x.negative && /^yes\b/i.test(x.label)) || null;

// An option's words as shown: without 「(esc)」, a path set in the code face.
const choiceName = (label) => esc(shownLabel(label)).replace(/(^|\s)((?:[A-Za-z]:\\|~?\/)\S+)/g, '$1<code>$2</code>');

// One choice button: name (bold) over its description (muted), when the menu has one. In the
// agent view each shows its number, the key that picks it (1–9, keymap.js), numbered menu or not.
// press: pressedOn() for this agent (every button waits; the pressed one says so).
function choiceButton(choices, x, { press, primary, compact = false, alt = false }) {
  const ok = choiceKeys(choices, x.n, alt);
  const sent = Boolean(press) && press.n === x.n;
  const kind = x.negative ? ' negative' : x === primary ? ' primary' : '';
  // A multiSelect option is a box to tick: pressed or not, as its terminal row shows.
  const box = x.checked === undefined ? '' : ` aria-pressed="${x.checked}"`;
  const tick = x.checked === undefined ? '' : `<span class="tick" aria-hidden="true">${x.checked ? '☑' : '☐'}</span>`;
  return `<button type="button" class="choice${kind}${sent ? ' sent' : ''}${compact ? ' compact' : ''}${x.checked ? ' checked' : ''}" data-n="${x.n}"${box}${press || !ok ? ' disabled' : ''}>
    ${choices.numbered || (!compact && x.n <= 9) ? `<span class="num"${choices.numbered ? '' : ' title="숫자 키로 고르기"'}>${x.n}</span>` : ''}${tick}<span class="label"><span class="name">${choiceName(x.label)}</span>${x.desc && !compact ? `<span class="desc">${esc(x.desc)}</span>` : ''}</span>${sent ? `<span class="state">${press.until === Infinity ? '보내는 중' : '보냄'}</span>` : ''}</button>`;
}

// Re-drawn only when what it shows changed: a poll must not swallow a tap or a selection.
// The blocked box sits between the conversation and the composer: as it comes, grows or goes,
// the conversation's height changes from below. Read at its end, it stays at its end (the
// last message above the question), as the chat follows new messages (renderDetailBody).
function keepChatEnd(change) {
  const body = document.getElementById('d-body');
  const pinned = body && body.scrollHeight - body.scrollTop - body.clientHeight < 80;
  change();
  if (pinned) body.scrollTop = body.scrollHeight;
}

function renderBlocked() {
  const box = document.getElementById('d-blocked');
  const a = currentAgent();
  if (!box) return;
  if (!a || a.status !== 'blocked') {
    if (box._html !== '') keepChatEnd(() => (box.innerHTML = box._html = ''));
    box.removeAttribute('role');
    box.removeAttribute('aria-label');
    box.classList.remove('more');
    return;
  }
  box.setAttribute('role', 'region');
  box.setAttribute('aria-label', a.menu ? '메뉴' : '답 필요');
  const text = detail.blockedText;
  const choices = text ? parseChoices(text) : null;
  const screen = text ? `<pre>${esc(text)}</pre>` : '';
  const keys = keyRow(AGENT_KEYS);
  let html;
  const panel = !choices && text ? screenPanel(text) : null;
  // Esc leaves a slash command's menu (Claude Code's 「Esc to cancel」).
  const leave = `<button type="button" class="toggle b-leave" aria-label="메뉴 취소 (Esc 보내기)"${keyAttrs('back', '메뉴 취소')}>취소<span class="wide-only"> (Esc)</span></button>`;
  const hintOf = (p) => (p && p.hint ? `<p class="b-hint">${esc(p.hint)}</p>` : '');
  if (panel) {
    // A menu with no list read here (/status, /config's tabs, /privacy-settings): the panel as the
    // terminal shows it, its key hints, and the keys to move through it.
    html = `<div class="blocked-box menu">
        <div class="b-head"><span class="b-eyebrow"><span class="b-dot" aria-hidden="true"></span>메뉴</span><span class="toggles">${leave}</span></div>
        <strong class="b-title">${esc(panel.title)}</strong>
        ${panel.main.length ? `<pre>${esc(panel.main.join('\n'))}</pre>` : ''}
        ${hintOf(panel)}
        ${keyRow(MENU_KEYS)}
      </div>`;
  } else if (!choices) {
    html = `<div class="blocked-box">
        <strong class="b-title">답 필요</strong>
        ${text == null ? '<p class="question muted">화면을 불러오는 중…</p>' : screen}
        ${keys}
      </div>`;
  } else {
    const press = pressedOn(curHost(), a, choices);
    const primary = primaryChoice(choices.items);
    // Read top-down: what kind of request and what it is for, the command itself (folded at
    // 5 lines, never cut silently), the question, then the answers as one list.
    const parts = promptParts(choices);
    const menu = choices.panel && !parts.kind && !choices.ask && !/written up a plan/i.test(choices.question) ? choices.panel : null;
    const title = menu ? menu.title : parts.intent || parts.question || '답 필요';
    // A menu's own key (choices.alt): picked rows take it instead of Enter while 「이 세션만」 is on.
    const alt = Boolean(choices.alt && detail.menuAlt);
    // A menu's line under its title (/model: 「Switch between Claude models. …」).
    const q = (parts.question || '').trim();
    const menuNote = menu && q !== menu.title ? (q.startsWith(menu.title) ? q.slice(menu.title.length).trim() : q) : '';
    if (detail.ctxFor !== text) Object.assign(detail, { ctxFor: text, ctxOpen: false });
    const n = parts.body ? parts.body.split('\n').length : 0;
    // The command to approve wraps only at its spaces, never inside a word (`-- -`, `-clean`); a
    // word wider than the box scrolls sideways.
    const tokens = (s) => s.split(/(\s+)/).map((w, i) => (i % 2 ? w : w && `<span class="tok">${esc(w)}</span>`)).join('');
    const ctx = n
      ? `<div class="ctx${detail.ctxOpen ? ' open' : ''}"><pre class="context">${tokens(parts.body)}</pre><button type="button" class="ctx-more" aria-expanded="false" hidden>전체 보기${n > 1 ? ` (${n}줄)` : ''}</button></div>`
      : '';
    // AskUserQuestion asking several things: which are answered (☒ on the terminal's tab bar).
    const ask = choices.ask && choices.ask.tabs.length > 1 ? choices.ask : null;
    const steps = ask ? `<p class="b-steps">${ask.tabs.map((t) => `<span class="${t.done ? 'done' : ''}">${t.done ? '✓ ' : ''}${esc(t.label)}</span>`).join('<span aria-hidden="true"> · </span>')}</p>` : '';
    // A multiSelect goes on with its own row (Submit, or Next while more questions follow).
    const nk = nextKeys(choices);
    let next = nk
      ? `<p class="b-q">여러 개 고를 수 있습니다. 다 고르면 「${choices.next.label === 'Next' ? '다음 질문' : '다음'}」을 누르세요.</p>`
      : '';
    // A settings dialog (choices.js heldPrompt): values change with ←/→, and any row's Enter goes on.
    if (!nk && /←\/→ to change/i.test(text)) next = '<p class="b-q">값은 「키 직접 보내기」의 ← → 로 바꿉니다. 고르면 그 줄에서 Enter 를 보냅니다(Esc: 취소).</p>';
    const nextBtn = nk ? `<button type="button" class="choice primary b-next"${press ? ' disabled' : ''}><span class="label"><span class="name">${choices.next.label === 'Next' ? '다음 질문' : '다음 (답 확인)'}</span></span></button>` : '';
    const toggle = (k, label) => `<button type="button" class="toggle" data-toggle="${k}" aria-expanded="${Boolean(detail[k])}">${label}</button>`;
    html = `<div class="blocked-box${menu ? ' menu' : ''}">
        <div class="b-head"><span class="b-eyebrow"><span class="b-dot" aria-hidden="true"></span>${menu ? '메뉴' : `답 필요${parts.kind ? ` · ${esc(parts.kind)}` : ''}`}</span>
          <span class="toggles">${menu ? leave : ''}${toggle('showScreen', '<span class="wide-only">터미널 </span>화면')}${toggle('showKeys', '키<span class="wide-only"> 직접 보내기</span>')}</span></div>
        <strong class="b-title">${esc(title)}</strong>
        ${steps}
        ${ctx}
        ${parts.intent && parts.question ? `<p class="b-q">${esc(parts.question)}</p>` : ''}
        ${menuNote ? `<p class="b-q">${esc(menuNote)}</p>` : ''}
        ${choices.alt ? `<label class="b-alt"><input type="checkbox"${alt ? ' checked' : ''}> ${esc(choices.alt.label)}</label>` : ''}
        ${next}
        <div class="choices" role="group" aria-label="${esc(parts.question || '답')}">${choices.items.map((x) => choiceButton(choices, x, { press, primary: nk || menu ? null : primary, alt })).join('')}${nextBtn}</div>
        ${menu ? hintOf(menu) : ''}
        ${detail.showScreen ? screen : ''}
        ${detail.showKeys ? keys : ''}
      </div>`;
  }
  if (box._html === html) return;
  box._html = html;
  keepChatEnd(() => (box.innerHTML = html));
  const lv = box.querySelector('.b-leave');
  if (lv) lv.onclick = () => sendKeys(['esc']);
  if (choices) {
    box.querySelectorAll('.choice[data-n]').forEach((b) => {
      b.onclick = () => pickChoice(choices, Number(b.dataset.n));
    });
    const ab = box.querySelector('.b-alt input');
    if (ab)
      ab.onchange = () => {
        detail.menuAlt = ab.checked;
        renderBlocked();
      };
    const nb = box.querySelector('.b-next');
    if (nb) nb.onclick = () => nextStep(choices);
    box.querySelectorAll('.toggle').forEach((b) => {
      b.onclick = () => {
        detail[b.dataset.toggle] = !detail[b.dataset.toggle];
        renderBlocked();
      };
    });
  }
  bindKeyRow(box.querySelector('.keys'));
  // The choices sit at the bottom of the prompt; show them, not the preamble.
  const pre = box.querySelector('pre:not(.context)');
  if (pre) pre.scrollTop = pre.scrollHeight;
  foldContext(box);
  if (!box._fadeBound) {
    box._fadeBound = true;
    box.addEventListener('scroll', () => fadeBlocked(box), { passive: true });
    addEventListener('resize', () => fadeBlocked(box));
  }
  fadeBlocked(box);
  sayBlocked(a, choices);
}

// A context taller than its 5 lines shows that it is cut (a fade and 「명령 전체 보기」), and until
// it is opened no answer is filled in: the eye shouldn't land on Yes before the whole command.
function foldContext(box) {
  const wrap = box.querySelector('.ctx');
  if (!wrap || wrap.classList.contains('open')) return;
  const pre = wrap.querySelector('pre');
  const cut = pre.scrollHeight > pre.clientHeight + 2;
  wrap.classList.toggle('cut', cut);
  const more = wrap.querySelector('.ctx-more');
  more.hidden = !cut;
  more.onclick = () => {
    detail.ctxOpen = true;
    renderBlocked();
  };
  if (cut) box.querySelectorAll('.choice.primary').forEach((b) => b.classList.remove('primary'));
}

// The box scrolls inside itself; while more of it is below (the last choices, 화면 보기 / 직접
// 입력), its bottom edge fades out.
function fadeBlocked(box) {
  box.classList.toggle('more', box.scrollHeight - box.scrollTop - box.clientHeight > 4);
}

// A screen reader hears a new question once (role=status), not each redraw.
function sayBlocked(a, choices) {
  const key = `${rowKey(curHost(), a.pane)}|${a.stateSeq}`;
  if (!choices || detail.saidFor === key) return;
  detail.saidFor = key;
  const say = document.getElementById('d-say');
  if (say) say.textContent = a.menu ? `메뉴가 열렸습니다: ${(choices.panel && choices.panel.title) || choices.question || ''}` : `답이 필요합니다: ${choices.question || '선택지를 고르세요'}`;
}

// Choice n of the open agent's prompt, from its button or its number key (app.js answerKey).
async function pickChoice(choices, n) {
  const cur = currentAgent();
  const host = curHost();
  const item = choices.items.find((x) => x.n === n);
  // The buttons belong to the prompt read for this stateSeq (app.js clears it on a change).
  const alt = Boolean(choices.alt && detail.menuAlt);
  if (!cur || cur.status !== 'blocked' || !item || !choiceKeys(choices, item.n, alt)) return;
  const ok = await answerChoice(host, cur, item, choices, alt);
  // choices.js: an option that asks for your own words, typed into the composer next.
  if (ok && TYPE_OWN.test(item.label) && view.name === 'agent' && detail.pane === cur.pane && curHost() === host) startAnswer(choices);
}

// A multiSelect's 「다음」: its Submit/Next row (choices.js nextKeys). Raw keys, as the key row
// sends: what follows is another screen of the same prompt (the next question, or the review
// whose 「Submit answers」 is picked like any choice).
async function nextStep(choices) {
  const cur = currentAgent();
  const host = curHost();
  const keys = nextKeys(choices);
  if (!cur || cur.status !== 'blocked' || !keys || pressedOn(host, cur, choices)) return;
  const press = { seq: cur.stateSeq, sig: choicesSig(choices), n: 0, until: Infinity };
  pressed.set(rowKey(host, cur.pane), press);
  redrawChoices();
  const ok = await sendKeys(keys, host, cur.pane);
  press.until = ok ? Date.now() + PRESS_MS : 0;
  redrawChoices();
  if (ok) for (const ms of [400, PRESS_MS + 100]) setTimeout(loadDetail, ms);
}

// 1–9 on the page (keymap.js): the choice with that number, as a tap on its button. Taken only
// while the open agent shows that choice; a second key while the first answer is on its way waits.
function answerKey(n) {
  const a = view.name === 'agent' ? currentAgent() : null;
  const choices = a && a.status === 'blocked' && detail.blockedText ? parseChoices(detail.blockedText) : null;
  if (!choices || !choices.items.some((x) => x.n === n)) return false;
  if (!pressedOn(curHost(), a)) pickChoice(choices, n);
  return true;
}

// After a "Type something" choice the question waits for words: the composer sends them there,
// then the key that ends them (choices.js typedChoice: Enter, or ↑ in a multiSelect).
function startAnswer(choices = null) {
  const t = choices && typedChoice(choices);
  detail.answerAfter = t && t.after ? t.after : ['enter'];
  detail.answerMode = true;
  setPlaceholder();
  updateComposer();
  const input = document.getElementById('d-input');
  if (input) input.focus();
  toast('답을 아래 입력 칸에 적어 보내세요');
}

// True when the keys went through. A failure says so in Korean and changes nothing else.
async function sendKeys(keys, host = curHost(), pane = detail.pane) {
  try {
    await api(hp(`/agents/${encodeURIComponent(pane)}/keys`, host), { method: 'POST', body: JSON.stringify({ keys }) });
    if (view.name === 'agent' && detail.pane === pane && curHost() === host) setTimeout(loadDetail, 500);
    return true;
  } catch (err) {
    toastErr(`키를 보내지 못했습니다: ${errText(err)}`);
    return false;
  }
}
