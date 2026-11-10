'use strict';
// Rename, close and new tab for panes and workspaces, shared by the agent, shell and workspace
// views and the list's row actions.

// Rename and close, shared by the agent, shell and workspace menus and the list's row actions.
// Each takes the host explicitly: from the list it is the row's, not the route's.
// herdr's rule for agent names, checked while typing (the server checks again).
const AGENT_NAME = /^[a-z][a-z0-9_-]{0,31}$/;
const agentNameHint = (v) => {
  const t = v.trim();
  if (!t || AGENT_NAME.test(t)) return '';
  if (/[A-Z]/.test(t)) return T('대문자는 쓸 수 없습니다. 소문자로 적어 주세요.');
  if (!/^[a-z]/.test(t)) return T('영문 소문자로 시작해야 합니다.');
  if (t.length > 32) return T('32자까지입니다(지금 {n}자).', { n: t.length });
  return T('영문 소문자·숫자·-·_ 만 쓸 수 있습니다.');
};
const labelHint = (v) => (v.trim().length > 60 ? T('60자까지입니다(지금 {n}자).', { n: v.trim().length }) : '');

// An offline peer's ghost (lib/peers.js staleView: x.stale) is only to look at: what would act on
// it says why it can't (the menus, ghostOff) or refuses with a toast (a key, a command).
const ghostWhy = (x) => T('{host} 오프라인 — 돌아오면 할 수 있습니다', { host: hostLabel(x.host || localId()) });
function ghostRefuse(x) {
  if (!x || !x.stale) return false;
  toast(ghostWhy(x));
  return true;
}
// Menu items of a ghost: what only looks or opens stays, the rest is shown off with the reason.
const LOOKS = new Set(['open', 'ws', 'copy', 'usage', 'wrap', 'input', 'color', 'reorder']);
const ghostOff = (items, x) => (x && x.stale ? items.map((it) => (Array.isArray(it) && !LOOKS.has(it[0]) ? [it[0], it[1], it[2], it[3], it[4], ghostWhy(x)] : it)) : items);

// A mistake keeps the sheet (and what was typed) with the error in it, like 새 폴더.
async function renamePane(x, isAgent) {
  if (ghostRefuse(x)) return;
  const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
  const r = isAgent
    ? await askLoop(
        { title: T('에이전트 이름'), text: T('영문 소문자로 시작하고 소문자·숫자·-·_ 만, 32자까지. 비우면 이름을 지웁니다.'), input: { value: x.name || '', placeholder: 'reviewer' }, ok: T('바꾸기'), validate: agentNameHint },
        (name) => post(hp(`/agents/${encodeURIComponent(x.pane)}/rename`, x.host), { name })
      )
    : await askLoop({ title: T('셸 이름'), text: T('비우면 이름을 지웁니다.'), input: { value: x.label || '', placeholder: T('빌드') }, ok: T('바꾸기'), validate: labelHint }, (label) =>
        post(hp(`/panes/${encodeURIComponent(x.pane)}/rename`, x.host), { label })
      );
  if (r) toast(T('이름을 바꿨습니다'));
}

// An agent started from this tab and never used (quick.js unused: nothing sent to it from here,
// no user message in its chat, nothing waiting) closes without the sheet: a Ctrl+N taken back.
function unusedAgent(host, pane) {
  const a = state.agents.find((x) => same(x, host, pane));
  if (!a) return false;
  const open = view.name === 'agent' && curHost() === host && detail.pane === pane;
  const t = open ? detail.transcript : null;
  return Quick.unused({
    state: Quick.stateOf(rowKey(host, pane)),
    messages: t && t.supported ? (t.found ? t.messages : []) : null,
    pending: open ? pendingNow(rowKey(host, pane), a).length : 0,
    noTranscript: screenBody(a),
    working: a.status === 'working',
  });
}

// 끝내기 (an agent, a shell) and 워크스페이스 닫기: one verb each, the same in the sheet, the ⋯ menu,
// the keymap's words and the toasts (닫기 alone is 대화창 닫기, leaving the view: keymap.js leaveView).
async function closePane(host, pane, label, isAgent) {
  if (ghostRefuse(state.agents.concat(state.terminals || []).find((x) => same(x, host, pane)))) return;
  if (isAgent && unusedAgent(host, pane)) {
    return closeNow(host, 'pane', pane, T('새 대화를 끝냈습니다'), T('에이전트를 끝내지 못했습니다'));
  }
  const ok = await sheet({
    subject: label,
    title: isAgent ? T('에이전트를 끝낼까요?') : T('셸을 끝낼까요?'),
    text: isAgent ? T('에이전트와 대화가 끝나고 되돌릴 수 없습니다.') : T('셸에서 돌던 것이 끝납니다. 되돌릴 수 없습니다.'),
    ok: T('끝내기'),
    danger: true,
    key: 'closeView',
  });
  if (ok) closeNow(host, 'pane', pane, isAgent ? T('에이전트를 끝냈습니다') : T('셸을 끝냈습니다'), isAgent ? T('에이전트를 끝내지 못했습니다') : T('셸을 끝내지 못했습니다'));
}

// A close feels instant: what it ends drops out of the page at once (and out of every state that
// arrives meanwhile: app.js runs each through hideClosing), the view goes back, and the close is
// sent behind it. herdr takes 0.2–0.3 s to close and refresh, more through a peer. A refusal
// brings it back, with the error; once landed, an id that comes again is a new one and shows.
const closing = Closing.create(15000); // closing.js: until the close has landed
const hideClosing = (s) => closing.filter(s);

// key: 'pane' or 'workspace'.
async function closeNow(host, key, id, okText, failText) {
  const leave = key === 'pane' ? leaveFor(host, id) : leaveFor(host, null, id);
  const k = closing.start(host, key, id);
  state = closing.filter(state, { fresh: false });
  if (leave) goBack(homeHash());
  onState();
  toast(okText);
  try {
    await api(hp(`/${key === 'pane' ? 'panes' : 'workspaces'}/${encodeURIComponent(id)}/close`, host), { method: 'POST', body: '{}' });
    closing.landed(k);
  } catch (err) {
    closing.drop(k);
    toastErr(`${failText}: ${errText(err)}`);
    try {
      state = hideClosing(await api('/state'));
      onState();
    } catch {}
  }
}

// After closing a pane or workspace: back to the list when that was open. On the phone the list
// is the only other place a close comes from; split, the list's rows can close something else.
function leaveFor(host, pane, wsId) {
  if (!split) return view.name !== 'list';
  if (!isDetail() || curHost() !== (host || localId())) return false;
  if (wsId == null) return ['agent', 'term'].includes(view.name) && detail.pane === pane;
  if (view.name === 'ws') return view.id === wsId;
  const open = [...state.agents, ...(state.terminals || [])].find((x) => same(x, curHost(), detail.pane));
  return Boolean(open && open.workspace === wsId);
}

async function renameWorkspace(w) {
  if (ghostRefuse(w)) return;
  const r = await askLoop({ title: T('워크스페이스 이름'), input: { value: w.label }, ok: T('바꾸기'), validate: (v) => (!v.trim() ? T('이름을 적어 주세요.') : labelHint(v)) }, (label) =>
    api(hp(`/workspaces/${encodeURIComponent(w.workspace_id)}/rename`, w.host), { method: 'POST', body: JSON.stringify({ label }) })
  );
  if (r) toast(T('이름을 바꿨습니다'));
}

// What closing a workspace ends, in words: 「안의 에이전트 2개와 셸 1개가 모두 끝납니다.」
// (the panes that are not agents are shells).
function wsEnds(agents, panes) {
  const shells = Math.max(0, panes - agents);
  if (agents && shells) return T('안의 에이전트 {a}개와 셸 {s}개가 모두 끝납니다.', { a: agents, s: shells });
  if (agents) return T('안의 에이전트 {n}개가 모두 끝납니다.', { n: agents });
  if (shells) return T('안의 셸 {n}개가 모두 끝납니다.', { n: shells });
  return T('안에 돌고 있는 것이 없습니다.');
}

// key: the action that asked (closeView: Alt+W in the workspace view; closeWorkspace: Alt+Shift+W),
// which confirms when pressed again.
async function closeWorkspace(w, key = 'closeView') {
  if (ghostRefuse(w)) return;
  const host = w.host || localId();
  const agents = state.agents.filter((a) => same(a, host, w.workspace_id, 'workspace')).length;
  const panes = w.pane_count || agents + (state.terminals || []).filter((t) => same(t, host, w.workspace_id, 'workspace')).length;
  const ok = await sheet({
    subject: w.label,
    title: T('워크스페이스를 닫을까요?'),
    text: `${wsEnds(agents, panes)}${agents || panes ? ` ${T('되돌릴 수 없습니다.')}` : ''}`,
    ok: T('워크스페이스 닫기'),
    danger: true,
    key,
  });
  if (ok) closeNow(host, 'workspace', w.workspace_id, T('워크스페이스를 닫았습니다'), T('워크스페이스를 닫지 못했습니다'));
}

async function newTab(w) {
  if (ghostRefuse(w)) return;
  const host = w.host || localId();
  // Where Ctrl+N would start (app.js startFolderFor): the open one's folder, else the 기본 폴더 …
  const cwd = startFolderFor(host, w.workspace_id);
  const r = await act(hp(`/workspaces/${encodeURIComponent(w.workspace_id)}/tabs`, host), cwd ? { cwd } : {}, T('새 탭을 열었습니다'), T('새 셸을 열지 못했습니다'));
  if (r && r.pane) location.hash = link(host, `/term/${encodeURIComponent(r.pane)}`);
}

// POST a mutation; toasts on failure, saying what failed (failText: 「워크스페이스를 닫지 못했습니다」).
// Returns the response body or null.
async function act(path, body, okText, failText = T('하지 못했습니다')) {
  try {
    const r = await api(path, { method: 'POST', body: JSON.stringify(body) });
    if (okText) toast(okText);
    return r;
  } catch (err) {
    toastErr(`${failText}: ${errText(err)}`);
    return null;
  }
}

// ---- one menu per thing: an agent, a shell, a workspace
// The same items wherever it opens (the ⋯ of its own view, or a long press / ⋯ on its row in a
// list), in blocks: what to do with it, then managing it, then closing it (red). From a row it
// starts with 열기. Opened in its own view, an item with a shortcut shows the key (with a keyboard).

// The items of a pane's menu (also 명령's 「지금 연 것」 rows, switcher.js).
function paneMenuItems(kind, x, { fromRow = false, here = false } = {}) {
  const agent = kind === 'agent';
  return ghostOff(paneItems(kind, agent, x, fromRow, here), x);
}
function paneItems(kind, agent, x, fromRow, here) {
  return agent
    ? [
        fromRow ? ['open', T('대화 열기')] : null,
        fromRow ? '-' : null,
        x.status === 'working' ? ['stop', T('중단'), false, '', here ? 'stop' : null] : null,
        screenBody(x) ? null : ['screen', T('터미널 화면 보기'), false, '', here ? 'terminal' : null],
        ['keys', T('키 보내기'), false, 'Esc · ⇧Tab · Enter · ↑ ↓ · 1–3'],
        here && lastReply() ? ['copy', T('마지막 답 복사')] : null,
        usageOf(x) ? ['usage', T('사용량'), false, Usage.limitsLine(x.usage.limits) || (Usage.chip(x.usage) || {}).full || '', here ? 'usage' : null] : null,
        '-',
        ['rename', T('이름 바꾸기')],
        ['ws', T('워크스페이스 보기')],
        fromRow ? ['reorder', T('순서 바꾸기'), false, '', 'reorder'] : null,
        ['close', T('에이전트 끝내기'), true, T('에이전트와 대화가 끝납니다'), here ? 'closeView' : null],
      ]
    : [
        fromRow ? ['open', T('셸 보기')] : null,
        fromRow ? '-' : null,
        ['agent', T('여기서 에이전트 시작')],
        ['down', T('아래로 나누기')],
        ['right', T('오른쪽으로 나누기')],
        ['tab', T('새 셸 열기'), false, T('새 탭에')],
        '-',
        // How this view shows and takes input (설정 → 입력·화면 has the same), at hand while a
        // table needs 줄바꿈 off or a long Korean command wants the line.
        ...(here
          ? [
              Prefs.get('wrap.term') ? ['wrap', T('줄바꿈 끄기'), false, T('긴 줄을 접지 않고 옆으로 밀어 봅니다'), 'wrap'] : ['wrap', T('줄바꿈 켜기'), false, T('긴 줄을 화면 폭에 접습니다'), 'wrap'],
              getShellInput() === 'raw' ? ['input', T('한 줄 입력으로 쓰기'), false, T('명령을 다 쓰고 리턴으로 실행합니다')] : ['input', T('키 직접 입력으로 쓰기'), false, T('누르는 키가 바로 셸로 갑니다')],
              getColor() ? ['color', T('색상 끄기'), false, T('한 가지 색으로 봅니다')] : ['color', T('색상 켜기')],
              '-',
            ]
          : []),
        ['rename', T('이름 바꾸기')],
        ['ws', T('워크스페이스 보기')],
        fromRow ? ['reorder', T('순서 바꾸기'), false, '', 'reorder'] : null,
        ['close', T('셸 끝내기'), true, '', here ? 'closeView' : null],
      ];
}

async function paneMenu(kind, x, opts = {}) {
  const { fromRow = false } = opts;
  if (!x) return;
  const here = !fromRow && ['agent', 'term'].includes(view.name) && same(x, curHost(), detail.pane);
  const agent = kind === 'agent';
  const items = paneMenuItems(kind, x, { fromRow, here });
  // Titled as its row reads (rows.js rowLabel): the conversation's title, the agent's name under it.
  const k = await menu(rowLabel(kind, x), items, { sub: agent ? [x.title && x.name, T('에이전트')].filter(Boolean).join(' · ') : T('셸'), anchor: opts.anchor });
  if (k) paneAction(kind, x, k, { here });
}

async function paneAction(kind, x, k, { here = false } = {}) {
  const host = x.host || localId();
  const pane = encodeURIComponent(x.pane);
  const agent = kind === 'agent';
  if (!LOOKS.has(k) && ghostRefuse(x)) return;
  if (k === 'open') location.hash = link(x.host, `/${agent ? 'agent' : 'term'}/${pane}`);
  if (k === 'ws') location.hash = link(x.host, `/ws/${encodeURIComponent(x.workspace)}`);
  if (k === 'stop') confirmStop(x); // agent.js
  if (k === 'usage') openUsage(x); // agent.js
  if (k === 'screen') {
    if (here) openScreenSheet();
    else location.hash = link(x.host, `/agent/${pane}/screen`); // the chat with its terminal sheet
  }
  if (k === 'keys') {
    const key = await menu(T('키 보내기'), AGENT_KEYS.map(([kk, l]) => [kk, l]), { sub: rowLabel('agent', x) });
    if (key && (await sendKeys([key], host, x.pane))) toast(T('{key} 키를 보냈습니다', { key: AGENT_KEYS.find((y) => y[0] === key)[1] }));
  }
  if (k === 'wrap') setPref('wrap.term', !Prefs.get('wrap.term'));
  if (k === 'input') setPref('shellInput', getShellInput() === 'raw' ? 'line' : 'raw');
  if (k === 'color') setPref('color', !getColor());
  if (k === 'copy') copyText(lastReply(), T('마지막 답을 복사했습니다'));
  if (k === 'reorder') setReorder(true); // reorder.js
  if (k === 'rename') renamePane(x, agent);
  if (k === 'close') closePane(x.host, x.pane, agent ? x.name || x.title : termTitle(x), agent);
  if (k === 'agent') location.hash = link(x.host, `/start/pane/${pane}`);
  if (k === 'down' || k === 'right') {
    const r = await act(hp(`/panes/${pane}/split`, host), { direction: k }, T('새 셸을 열었습니다'), T('새 셸을 열지 못했습니다'));
    if (r && r.pane) location.hash = link(x.host, `/term/${encodeURIComponent(r.pane)}`);
  }
  if (k === 'tab') {
    const w = wsFor(host, x.workspace);
    if (w) newTab(w);
  }
}

function wsMenuItems(w, { fromRow = false, here = false } = {}) {
  return ghostOff(wsItems(w, fromRow, here), w);
}
function wsItems(w, fromRow, here) {
  return [
    fromRow ? ['open', T('워크스페이스 보기')] : null,
    fromRow ? '-' : null,
    ['agent', T('에이전트 시작'), false, '', here ? 'newAgent' : null],
    ['tab', T('새 셸 열기'), false, T('새 탭에')],
    '-',
    ['dir', T('기본 폴더 정하기'), false, w.defaultCwd ? basename(w.defaultCwd) : T('없음')],
    ['rename', T('이름 바꾸기')],
    fromRow ? ['reorder', T('순서 바꾸기'), false, T('카드와 그 안의 줄'), 'reorder'] : null,
    ['close', T('워크스페이스 닫기'), true, T('안의 에이전트·셸이 모두 끝납니다'), here ? 'closeWorkspace' : null],
  ];
}

async function wsMenu(w, { fromRow = false, anchor = null } = {}) {
  if (!w) return;
  const here = !fromRow && view.name === 'ws' && same(w, curHost(), view.id, 'workspace_id');
  const k = await menu(w.label, wsMenuItems(w, { fromRow, here }), { sub: T('워크스페이스'), anchor });
  if (k) wsAction(w, k);
}

function wsAction(w, k) {
  const id = encodeURIComponent(w.workspace_id);
  if (!LOOKS.has(k) && ghostRefuse(w)) return;
  if (k === 'open') location.hash = link(w.host, `/ws/${id}`);
  if (k === 'agent') location.hash = link(w.host, `/start/ws/${id}`);
  if (k === 'tab') newTab(w);
  if (k === 'dir') location.hash = link(w.host, `/dir/ws/${id}`);
  if (k === 'rename') renameWorkspace(w);
  if (k === 'reorder') setReorder(true); // reorder.js
  if (k === 'close') closeWorkspace(w);
}
