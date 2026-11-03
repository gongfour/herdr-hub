'use strict';
// Answering an agent: key rows, choice buttons (also on the 답 필요 strip), the blocked box in the
// agent view, and sendKeys.

// Keys an agent takes from here: the blocked box's 직접 입력, the ⋯ 키 보내기 menu and the
// terminal sheet's key row (which adds Ctrl+C).
const AGENT_KEYS = [['esc', 'Esc'], ['shift+tab', '⇧Tab'], ['enter', 'Enter'], ['up', '↑'], ['down', '↓'], ['1', '1'], ['2', '2'], ['3', '3']];
const SHEET_KEYS = [...AGENT_KEYS, ['ctrl+c', 'Ctrl+C']];
// An option that asks for your own words (AskUserQuestion's "Type something.").
const TYPE_OWN = /^(type something|type your own|other\b|something else|직접 입력|기타)/i;
const keyRow = (keys, cls = '') => `<div class="keys ${cls}">${keys.map(([k, label]) => `<button type="button" class="key" data-key="${k}" aria-label="${esc(label)} 키 보내기">${esc(label)}</button>`).join('')}</div>`;
function bindKeyRow(row) {
  if (row) row.querySelectorAll('.key').forEach((b) => (b.onclick = () => sendKeys([b.dataset.key])));
}
// After a choice is sent, the buttons wait this long (or for the next status) so a double tap
// can't answer the prompt that comes next.
const CHOICE_LOCK_MS = 4000;
const choiceLocked = (a) => detail.lock && Date.now() < detail.lock.until && a && a.stateSeq === detail.lock.seq;

// The emphasised answer: the first plain "Yes" only. Everything else has the same weight;
// refusals are tinted as a warning.
const primaryChoice = (items) => items.find((x) => !x.negative && /^yes\b/i.test(x.label)) || null;

// One choice button: name (bold) over its description (muted), when the menu has one.
function choiceButton(choices, x, { locked, sentN, primary, compact = false }) {
  const ok = choiceKeys(choices, x.n);
  const sent = locked && sentN === x.n;
  const kind = x.negative ? ' negative' : x === primary ? ' primary' : '';
  return `<button type="button" class="choice${kind}${sent ? ' sent' : ''}${compact ? ' compact' : ''}" data-n="${x.n}"${locked || !ok ? ' disabled' : ''}>
    ${choices.numbered ? `<span class="num">${x.n}</span>` : ''}<span class="label"><span class="name">${esc(x.label)}</span>${x.desc && !compact ? `<span class="desc">${esc(x.desc)}</span>` : ''}</span>${sent ? '<span class="state">보냄</span>' : ''}</button>`;
}

// Re-drawn only when what it shows changed: a poll must not swallow a tap or a selection.
function renderBlocked() {
  const box = document.getElementById('d-blocked');
  const a = currentAgent();
  if (!box) return;
  if (!a || a.status !== 'blocked') {
    if (box._html !== '') box.innerHTML = box._html = '';
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
    const locked = choiceLocked(a);
    const primary = primaryChoice(choices.items);
    html = `<div class="blocked-box">
        <strong class="b-title">${esc(choices.question || '답 필요')}</strong>
        ${choices.context.length ? `<pre class="context">${esc(choices.context.join('\n'))}</pre>` : ''}
        <div class="choices">${choices.items.map((x) => choiceButton(choices, x, { locked, sentN: locked && detail.lock.n, primary })).join('')}</div>
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
  box.innerHTML = html;
  if (choices) {
    box.querySelectorAll('.choice').forEach((b) => {
      b.onclick = async () => {
        const cur = currentAgent();
        const n = Number(b.dataset.n);
        const k = choiceKeys(choices, n);
        if (!k || choiceLocked(cur)) return;
        const lock = (detail.lock = { until: Date.now() + CHOICE_LOCK_MS, seq: cur && cur.stateSeq, n });
        setTimeout(renderBlocked, CHOICE_LOCK_MS + 50);
        renderBlocked();
        const item = choices.items.find((x) => x.n === n);
        if (!(await sendKeys(k))) {
          // Not sent: the buttons come back at once.
          if (detail.lock === lock) detail.lock = null;
          return renderBlocked();
        }
        closeNotes(curHost(), detail.pane);
        if (item && TYPE_OWN.test(item.label)) startAnswer();
      };
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

// After a "Type something" choice the question waits for words: the composer sends them there.
function startAnswer() {
  detail.answerMode = true;
  detail.answerSeq = (currentAgent() || {}).stateSeq;
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
