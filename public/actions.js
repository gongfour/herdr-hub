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

async function closePane(host, pane, label, isAgent) {
  const ok = await sheet({
    title: isAgent ? '에이전트 닫기' : '셸 닫기',
    text: `‘${label}’ 패널을 닫을까요?${isAgent ? ' 에이전트도 함께 끝납니다.' : ''} 되돌릴 수 없습니다.`,
    ok: '닫기',
    danger: true,
  });
  if (ok && (await act(hp(`/panes/${encodeURIComponent(pane)}/close`, host), {}, '패널을 닫았습니다')) && leaveFor(host, pane)) goBack(homeHash());
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

async function closeWorkspace(w) {
  const host = w.host || localId();
  const agents = state.agents.filter((a) => same(a, host, w.workspace_id, 'workspace')).length;
  const panes = w.pane_count || agents + (state.terminals || []).filter((t) => same(t, host, w.workspace_id, 'workspace')).length;
  const ok = await sheet({
    title: '워크스페이스 닫기',
    text: `‘${w.label}’ 워크스페이스를 닫을까요? 안의 패널 ${panes}개${agents ? `와 에이전트 ${agents}개` : ''}가 모두 끝납니다. 되돌릴 수 없습니다.`,
    ok: '닫기',
    danger: true,
  });
  if (ok && (await act(hp(`/workspaces/${encodeURIComponent(w.workspace_id)}/close`, w.host), {}, '워크스페이스를 닫았습니다')) && leaveFor(host, null, w.workspace_id)) goBack(homeHash());
}

async function newTab(w) {
  const host = w.host || localId();
  const r = await act(hp(`/workspaces/${encodeURIComponent(w.workspace_id)}/tabs`, host), {}, '새 탭을 열었습니다');
  if (r && r.pane) location.hash = link(host, `/term/${encodeURIComponent(r.pane)}`);
}

// POST a mutation; toasts on failure. Returns the response body or null.
async function act(path, body, okText) {
  try {
    const r = await api(path, { method: 'POST', body: JSON.stringify(body) });
    if (okText) toast(okText);
    return r;
  } catch (err) {
    toastErr(`하지 못했습니다: ${errText(err)}`);
    return null;
  }
}

// ---- one menu per thing: an agent, a shell, a workspace
// The same items wherever it opens (the ⋯ of its own view, or a long press / ⋯ on its row in a
// list), in blocks: what to do with it, then managing it, then closing it (red). From a row it
// starts with 열기. Opened in its own view, an item with a shortcut shows the key (with a keyboard).

async function paneMenu(kind, x, { fromRow = false } = {}) {
  if (!x) return;
  const host = x.host || localId();
  const here = !fromRow && ['agent', 'term'].includes(view.name) && same(x, curHost(), detail.pane);
  const agent = kind === 'agent';
  const items = agent
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
        ['close', '에이전트 닫기', true, '에이전트도 함께 끝납니다', here ? 'closeView' : null],
      ]
    : [
        fromRow ? ['open', '셸 보기'] : null,
        fromRow ? '-' : null,
        ['agent', '여기서 에이전트 시작'],
        ['down', '아래로 나누기'],
        ['right', '오른쪽으로 나누기'],
        ['tab', '새 셸 열기', false, '새 탭에'],
        '-',
        ['rename', '이름 바꾸기'],
        ['ws', '워크스페이스 보기'],
        ['close', '셸 닫기', true, '', here ? 'closeView' : null],
      ];
  const label = agent ? x.name || x.title : termTitle(x);
  const k = await menu(label, items, { sub: agent ? '에이전트' : '셸' });
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
    const key = await menu('키 보내기', AGENT_KEYS.map(([kk, l]) => [kk, l]), { sub: x.name || x.title });
    if (key && (await sendKeys([key], host, x.pane))) toast(`${AGENT_KEYS.find((y) => y[0] === key)[1]} 키를 보냈습니다`);
  }
  if (k === 'copy') copyText(lastReply(), '마지막 답을 복사했습니다');
  if (k === 'rename') renamePane(x, agent);
  if (k === 'close') closePane(x.host, x.pane, agent ? x.name || x.title : termTitle(x), agent);
  if (k === 'agent') location.hash = link(x.host, `/start/pane/${pane}`);
  if (k === 'down' || k === 'right') {
    const r = await act(hp(`/panes/${pane}/split`, host), { direction: k }, '새 셸을 열었습니다');
    if (r && r.pane) location.hash = link(x.host, `/term/${encodeURIComponent(r.pane)}`);
  }
  if (k === 'tab') {
    const w = wsFor(host, x.workspace);
    if (w) newTab(w);
  }
}

async function wsMenu(w, { fromRow = false } = {}) {
  if (!w) return;
  const here = !fromRow && view.name === 'ws' && same(w, curHost(), view.id, 'workspace_id');
  const k = await menu(
    w.label,
    [
      fromRow ? ['open', '워크스페이스 보기'] : null,
      fromRow ? '-' : null,
      ['agent', '에이전트 시작', false, '', here ? 'newAgent' : null],
      ['tab', '새 셸 열기', false, '새 탭에'],
      '-',
      ['rename', '이름 바꾸기'],
      ['close', '워크스페이스 닫기', true, '안의 패널이 모두 끝납니다', here ? 'closeView' : null],
    ],
    { sub: '워크스페이스' },
  );
  if (k) wsAction(w, k);
}

function wsAction(w, k) {
  const id = encodeURIComponent(w.workspace_id);
  if (k === 'open') location.hash = link(w.host, `/ws/${id}`);
  if (k === 'agent') location.hash = link(w.host, `/start/ws/${id}`);
  if (k === 'tab') newTab(w);
  if (k === 'rename') renameWorkspace(w);
  if (k === 'close') closeWorkspace(w);
}
