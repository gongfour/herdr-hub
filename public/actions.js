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
  if (/[A-Z]/.test(t)) return '대문자는 쓸 수 없습니다. 소문자로 적어 주세요.';
  if (!/^[a-z]/.test(t)) return '영문 소문자로 시작해야 합니다.';
  if (t.length > 32) return `32자까지입니다(지금 ${t.length}자).`;
  return '영문 소문자·숫자·-·_ 만 쓸 수 있습니다.';
};
const labelHint = (v) => (v.trim().length > 60 ? `60자까지입니다(지금 ${v.trim().length}자).` : '');

// A mistake keeps the sheet (and what was typed) with the error in it, like 새 폴더.
async function renamePane(x, isAgent) {
  const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
  const r = isAgent
    ? await askLoop(
        { title: '에이전트 이름', text: '영문 소문자로 시작하고 소문자·숫자·-·_ 만, 32자까지. 비우면 이름을 지웁니다.', input: { value: x.name || '', placeholder: 'reviewer' }, ok: '바꾸기', validate: agentNameHint },
        (name) => post(hp(`/agents/${encodeURIComponent(x.pane)}/rename`, x.host), { name })
      )
    : await askLoop({ title: '셸 이름', text: '비우면 이름을 지웁니다.', input: { value: x.label || '', placeholder: '빌드' }, ok: '바꾸기', validate: labelHint }, (label) =>
        post(hp(`/panes/${encodeURIComponent(x.pane)}/rename`, x.host), { label })
      );
  if (r) toast('이름을 바꿨습니다');
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
  if (isAgent && unusedAgent(host, pane)) {
    if ((await act(hp(`/panes/${encodeURIComponent(pane)}/close`, host), {}, '새 대화를 끝냈습니다', '에이전트를 끝내지 못했습니다')) && leaveFor(host, pane)) goBack(homeHash());
    return;
  }
  const ok = await sheet({
    subject: label,
    title: isAgent ? '에이전트를 끝낼까요?' : '셸을 끝낼까요?',
    text: isAgent ? '에이전트와 대화가 끝나고 되돌릴 수 없습니다.' : '셸에서 돌던 것이 끝납니다. 되돌릴 수 없습니다.',
    ok: '끝내기',
    danger: true,
    key: 'closeView',
  });
  if (ok && (await act(hp(`/panes/${encodeURIComponent(pane)}/close`, host), {}, isAgent ? '에이전트를 끝냈습니다' : '셸을 끝냈습니다', isAgent ? '에이전트를 끝내지 못했습니다' : '셸을 끝내지 못했습니다')) && leaveFor(host, pane)) goBack(homeHash());
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
  const r = await askLoop({ title: '워크스페이스 이름', input: { value: w.label }, ok: '바꾸기', validate: (v) => (!v.trim() ? '이름을 적어 주세요.' : labelHint(v)) }, (label) =>
    api(hp(`/workspaces/${encodeURIComponent(w.workspace_id)}/rename`, w.host), { method: 'POST', body: JSON.stringify({ label }) })
  );
  if (r) toast('이름을 바꿨습니다');
}

// What closing a workspace ends, in words: 「안의 에이전트 2개와 셸 1개가 모두 끝납니다.」
// (the panes that are not agents are shells).
function wsEnds(agents, panes) {
  const shells = Math.max(0, panes - agents);
  const parts = [agents ? `에이전트 ${agents}개` : '', shells ? `셸 ${shells}개` : ''].filter(Boolean);
  return parts.length ? `안의 ${parts.join('와 ')}가 모두 끝납니다.` : '안에 돌고 있는 것이 없습니다.';
}

// key: the action that asked (closeView: Alt+W in the workspace view; closeWorkspace: Alt+Shift+W),
// which confirms when pressed again.
async function closeWorkspace(w, key = 'closeView') {
  const host = w.host || localId();
  const agents = state.agents.filter((a) => same(a, host, w.workspace_id, 'workspace')).length;
  const panes = w.pane_count || agents + (state.terminals || []).filter((t) => same(t, host, w.workspace_id, 'workspace')).length;
  const ok = await sheet({
    subject: w.label,
    title: '워크스페이스를 닫을까요?',
    text: `${wsEnds(agents, panes)}${agents || panes ? ' 되돌릴 수 없습니다.' : ''}`,
    ok: '워크스페이스 닫기',
    danger: true,
    key,
  });
  if (ok && (await act(hp(`/workspaces/${encodeURIComponent(w.workspace_id)}/close`, w.host), {}, '워크스페이스를 닫았습니다', '워크스페이스를 닫지 못했습니다')) && leaveFor(host, null, w.workspace_id)) goBack(homeHash());
}

async function newTab(w) {
  const host = w.host || localId();
  // Where Ctrl+N would start (app.js startFolderFor): the open one's folder, else the 기본 폴더 …
  const cwd = startFolderFor(host, w.workspace_id);
  const r = await act(hp(`/workspaces/${encodeURIComponent(w.workspace_id)}/tabs`, host), cwd ? { cwd } : {}, '새 탭을 열었습니다', '새 셸을 열지 못했습니다');
  if (r && r.pane) location.hash = link(host, `/term/${encodeURIComponent(r.pane)}`);
}

// POST a mutation; toasts on failure, saying what failed (failText: 「워크스페이스를 닫지 못했습니다」).
// Returns the response body or null.
async function act(path, body, okText, failText = '하지 못했습니다') {
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
  return agent
    ? [
        fromRow ? ['open', '대화 열기'] : null,
        fromRow ? '-' : null,
        x.status === 'working' ? ['stop', '중단', false, '', here ? 'stop' : null] : null,
        screenBody(x) ? null : ['screen', '터미널 화면 보기', false, '', here ? 'terminal' : null],
        ['keys', '키 보내기', false, 'Esc · ⇧Tab · Enter · ↑ ↓ · 1–3'],
        here && lastReply() ? ['copy', '마지막 답 복사'] : null,
        '-',
        ['rename', '이름 바꾸기'],
        ['ws', '워크스페이스 보기'],
        ['close', '에이전트 끝내기', true, '에이전트와 대화가 끝납니다', here ? 'closeView' : null],
      ]
    : [
        fromRow ? ['open', '셸 보기'] : null,
        fromRow ? '-' : null,
        ['agent', '여기서 에이전트 시작'],
        ['down', '아래로 나누기'],
        ['right', '오른쪽으로 나누기'],
        ['tab', '새 셸 열기', false, '새 탭에'],
        '-',
        // How this view shows and takes input (설정 → 입력·화면 has the same), at hand while a
        // table needs 줄바꿈 off or a long Korean command wants the line.
        ...(here
          ? [
              Prefs.get('wrap.term') ? ['wrap', '줄바꿈 끄기', false, '긴 줄을 접지 않고 옆으로 밀어 봅니다', 'wrap'] : ['wrap', '줄바꿈 켜기', false, '긴 줄을 화면 폭에 접습니다', 'wrap'],
              getShellInput() === 'raw' ? ['input', '한 줄 입력으로 쓰기', false, '명령을 다 쓰고 리턴으로 실행합니다'] : ['input', '키 직접 입력으로 쓰기', false, '누르는 키가 바로 셸로 갑니다'],
              getColor() ? ['color', '색상 끄기', false, '한 가지 색으로 봅니다'] : ['color', '색상 켜기'],
              '-',
            ]
          : []),
        ['rename', '이름 바꾸기'],
        ['ws', '워크스페이스 보기'],
        ['close', '셸 끝내기', true, '', here ? 'closeView' : null],
      ];
}

async function paneMenu(kind, x, opts = {}) {
  const { fromRow = false } = opts;
  if (!x) return;
  const here = !fromRow && ['agent', 'term'].includes(view.name) && same(x, curHost(), detail.pane);
  const agent = kind === 'agent';
  const items = paneMenuItems(kind, x, { fromRow, here });
  // Titled as its row reads (rows.js rowLabel): the conversation's title, the agent's name under it.
  const k = await menu(rowLabel(kind, x), items, { sub: agent ? [x.title && x.name, '에이전트'].filter(Boolean).join(' · ') : '셸', anchor: opts.anchor });
  if (k) paneAction(kind, x, k, { here });
}

async function paneAction(kind, x, k, { here = false } = {}) {
  const host = x.host || localId();
  const pane = encodeURIComponent(x.pane);
  const agent = kind === 'agent';
  if (k === 'open') location.hash = link(x.host, `/${agent ? 'agent' : 'term'}/${pane}`);
  if (k === 'ws') location.hash = link(x.host, `/ws/${encodeURIComponent(x.workspace)}`);
  if (k === 'stop') confirmStop(x); // agent.js
  if (k === 'screen') {
    if (here) openScreenSheet();
    else location.hash = link(x.host, `/agent/${pane}/screen`); // the chat with its terminal sheet
  }
  if (k === 'keys') {
    const key = await menu('키 보내기', AGENT_KEYS.map(([kk, l]) => [kk, l]), { sub: rowLabel('agent', x) });
    if (key && (await sendKeys([key], host, x.pane))) toast(`${AGENT_KEYS.find((y) => y[0] === key)[1]} 키를 보냈습니다`);
  }
  if (k === 'wrap') setPref('wrap.term', !Prefs.get('wrap.term'));
  if (k === 'input') setPref('shellInput', getShellInput() === 'raw' ? 'line' : 'raw');
  if (k === 'color') setPref('color', !getColor());
  if (k === 'copy') copyText(lastReply(), '마지막 답을 복사했습니다');
  if (k === 'rename') renamePane(x, agent);
  if (k === 'close') closePane(x.host, x.pane, agent ? x.name || x.title : termTitle(x), agent);
  if (k === 'agent') location.hash = link(x.host, `/start/pane/${pane}`);
  if (k === 'down' || k === 'right') {
    const r = await act(hp(`/panes/${pane}/split`, host), { direction: k }, '새 셸을 열었습니다', '새 셸을 열지 못했습니다');
    if (r && r.pane) location.hash = link(x.host, `/term/${encodeURIComponent(r.pane)}`);
  }
  if (k === 'tab') {
    const w = wsFor(host, x.workspace);
    if (w) newTab(w);
  }
}

function wsMenuItems(w, { fromRow = false, here = false } = {}) {
  return [
    fromRow ? ['open', '워크스페이스 보기'] : null,
    fromRow ? '-' : null,
    ['agent', '에이전트 시작', false, '', here ? 'newAgent' : null],
    ['tab', '새 셸 열기', false, '새 탭에'],
    '-',
    ['dir', '기본 폴더 정하기', false, w.defaultCwd ? basename(w.defaultCwd) : '없음'],
    ['rename', '이름 바꾸기'],
    ['close', '워크스페이스 닫기', true, '안의 에이전트·셸이 모두 끝납니다', here ? 'closeWorkspace' : null],
  ];
}

async function wsMenu(w, { fromRow = false, anchor = null } = {}) {
  if (!w) return;
  const here = !fromRow && view.name === 'ws' && same(w, curHost(), view.id, 'workspace_id');
  const k = await menu(w.label, wsMenuItems(w, { fromRow, here }), { sub: '워크스페이스', anchor });
  if (k) wsAction(w, k);
}

function wsAction(w, k) {
  const id = encodeURIComponent(w.workspace_id);
  if (k === 'open') location.hash = link(w.host, `/ws/${id}`);
  if (k === 'agent') location.hash = link(w.host, `/start/ws/${id}`);
  if (k === 'tab') newTab(w);
  if (k === 'dir') location.hash = link(w.host, `/dir/ws/${id}`);
  if (k === 'rename') renameWorkspace(w);
  if (k === 'close') closeWorkspace(w);
}
