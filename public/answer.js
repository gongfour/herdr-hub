'use strict';
// Answering an agent: key rows, choice buttons, the blocked box in the
// agent view, and sendKeys.

// Keys an agent takes from here: the blocked box's 직접 입력, the ⋯ 키 보내기 menu and the
// terminal sheet's key row (which adds Ctrl+C).
const AGENT_KEYS = [['esc', 'Esc'], ['shift+tab', '⇧Tab'], ['enter', 'Enter'], ['up', '↑'], ['down', '↓'], ['1', '1'], ['2', '2'], ['3', '3']];
const SHEET_KEYS = [...AGENT_KEYS, ['ctrl+c', 'Ctrl+C']];
const keyRow = (keys, cls = '') => `<div class="keys ${cls}">${keys.map(([k, label]) => `<button type="button" class="key" data-key="${k}" aria-label="${esc(label)} 키 보내기">${esc(label)}</button>`).join('')}</div>`;
function bindKeyRow(row) {
  if (row) row.querySelectorAll('.key').forEach((b) => (b.onclick = () => sendKeys([b.dataset.key])));
}
// A choice button (the blocked box) goes through
// the host's guard (POST /agents/<pane>/answer, lib/notify checkAnswer): the keys go only while
// the agent is still blocked on the prompt the buttons were drawn for (stateSeq) and option n
// still reads the same. A tapped button stays pressed while the answer is on its way and a
// moment after (or until the next status), so a double tap sends once; the host also refuses a
// second answer to the same prompt.
const PRESS_MS = 1500;
const pressed = new Map(); // host|pane -> { seq, n, until } (until is Infinity while in flight)
function pressedOn(host, a) {
  const p = a && pressed.get(rowKey(host, a.pane));
  return p && a.stateSeq === p.seq && Date.now() < p.until ? p : null;
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
async function answerChoice(host, a, item) {
  const k = rowKey(host, a.pane);
  if (pressedOn(host, a)) return false;
  const press = { seq: a.stateSeq, n: item.n, until: Infinity };
  pressed.set(k, press);
  redrawChoices();
  let ok = false;
  try {
    await api(hp(`/agents/${encodeURIComponent(a.pane)}/answer`, host), {
      method: 'POST',
      body: JSON.stringify({ stateSeq: a.stateSeq, n: item.n, label: item.label, own: TYPE_OWN.test(item.label) }),
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
    if (view.name === 'agent' && detail.pane === a.pane && curHost() === host) setTimeout(loadDetail, 500);
  } else if (pressed.get(k) === press) pressed.delete(k); // not sent: the buttons come back at once
  redrawChoices();
  return ok;
}

// The emphasised answer: the first plain "Yes" only. Everything else has the same weight;
// refusals are tinted as a warning.
const primaryChoice = (items) => items.find((x) => !x.negative && /^yes\b/i.test(x.label)) || null;

// One choice button: name (bold) over its description (muted), when the menu has one. In the
// agent view each shows its number, the key that picks it (1–9, keymap.js), numbered menu or not.
// press: pressedOn() for this agent (every button waits; the pressed one says so).
function choiceButton(choices, x, { press, primary, compact = false }) {
  const ok = choiceKeys(choices, x.n);
  const sent = Boolean(press) && press.n === x.n;
  const kind = x.negative ? ' negative' : x === primary ? ' primary' : '';
  return `<button type="button" class="choice${kind}${sent ? ' sent' : ''}${compact ? ' compact' : ''}" data-n="${x.n}"${press || !ok ? ' disabled' : ''}>
    ${choices.numbered || (!compact && x.n <= 9) ? `<span class="num"${choices.numbered ? '' : ' title="숫자 키로 고르기"'}>${x.n}</span>` : ''}<span class="label"><span class="name">${esc(x.label)}</span>${x.desc && !compact ? `<span class="desc">${esc(x.desc)}</span>` : ''}</span>${sent ? `<span class="state">${press.until === Infinity ? '보내는 중' : '보냄'}</span>` : ''}</button>`;
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
    return;
  }
  const text = detail.blockedText;
  const choices = text ? parseChoices(text) : null;
  const screen = text ? `<pre>${esc(text)}</pre>` : '';
  const keys = keyRow(AGENT_KEYS);
  let html;
  if (!choices) {
    html = `<div class="blocked-box">
        <strong class="b-title">답 필요</strong>
        ${text == null ? '<p class="question muted">화면을 불러오는 중…</p>' : screen}
        ${keys}
      </div>`;
  } else {
    const press = pressedOn(curHost(), a);
    const primary = primaryChoice(choices.items);
    html = `<div class="blocked-box">
        <strong class="b-title">${esc(choices.question || '답 필요')}</strong>
        ${choices.context.length ? `<pre class="context">${esc(choices.context.join('\n'))}</pre>` : ''}
        <div class="choices">${choices.items.map((x) => choiceButton(choices, x, { press, primary })).join('')}</div>
        <div class="toggles">
          <button type="button" class="toggle" data-toggle="showScreen" aria-expanded="${Boolean(detail.showScreen)}">화면 보기</button>
          <button type="button" class="toggle" data-toggle="showKeys" aria-expanded="${Boolean(detail.showKeys)}">직접 입력</button>
        </div>
        ${detail.showScreen ? screen : ''}
        ${detail.showKeys ? keys : ''}
      </div>`;
  }
  if (box._html === html) return;
  box._html = html;
  keepChatEnd(() => (box.innerHTML = html));
  if (choices) {
    box.querySelectorAll('.choice').forEach((b) => {
      b.onclick = () => pickChoice(choices, Number(b.dataset.n));
    });
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
}

// Choice n of the open agent's prompt, from its button or its number key (app.js answerKey).
async function pickChoice(choices, n) {
  const cur = currentAgent();
  const host = curHost();
  const item = choices.items.find((x) => x.n === n);
  // The buttons belong to the prompt read for this stateSeq (app.js clears it on a change).
  if (!cur || cur.status !== 'blocked' || !item || !choiceKeys(choices, item.n)) return;
  const ok = await answerChoice(host, cur, item);
  // choices.js: an option that asks for your own words, typed into the composer next.
  if (ok && TYPE_OWN.test(item.label) && view.name === 'agent' && detail.pane === cur.pane && curHost() === host) startAnswer();
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

// After a "Type something" choice the question waits for words: the composer sends them there.
function startAnswer() {
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
    if (view.name === 'agent' && detail.pane === pane) setTimeout(loadDetail, 500);
    return true;
  } catch (err) {
    toastErr(`키를 보내지 못했습니다: ${errText(err)}`);
    return false;
  }
}
