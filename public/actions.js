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
