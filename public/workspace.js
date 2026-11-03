'use strict';
// The workspace page: its agents and shells as cards, 에이전트 시작, 새 탭, 이름 바꾸기, 닫기.

// Cards for the workspace view (agents and shells of one workspace).
function termCard(t) {
  return `<a class="card" href="${link(t.host, `/term/${encodeURIComponent(t.pane)}`)}">
    <div class="main">
      <div class="title">${esc(termTitle(t))}</div>
      <div class="meta">${hostChip(t)}셸 · ${esc(t.workspaceLabel)} · ${esc(basename(t.cwd))}</div>
    </div>
    <span class="badge idle">셸</span>
  </a>`;
}

function card(a) {
  return `<a class="card" href="${link(a.host, `/agent/${encodeURIComponent(a.pane)}`)}">
    <div class="main">
      <div class="title">${esc(agentTitle(a))}</div>
      <div class="meta">${hostChip(a)}${esc(a.agent)} · ${esc(wsAndDir(a.workspaceLabel, a.cwd))}</div>
    </div>
    ${timeTag(a)}
    <span class="badge ${esc(a.status)}">${esc(STATUS_LABEL[a.status] || a.status)}</span>
  </a>`;
}

// ------------------------------------------------------------ workspace view

function renderWorkspace() {
  const host = curHost();
  const w = (state.workspaces || []).find((x) => same(x, host, view.id, 'workspace_id'));
  const agents = state.agents.filter((a) => same(a, host, view.id, 'workspace'));
  const terms = (state.terminals || []).filter((t) => same(t, host, view.id, 'workspace'));
  const id = encodeURIComponent(view.id);
  const missing = !online(host) ? `${esc(hostLabel(host))} 오프라인` : '닫혔거나 찾을 수 없습니다';
  detailRoot().innerHTML = `
    <header class="bar">
      ${backLink(homeHash())}
      <h1>${w ? esc(w.label) : '워크스페이스 없음'}<span class="sub">${w ? `${multi() ? `${esc(hostLabel(host))} · ` : ''}${esc(w.workspace_id)} · 탭 ${w.tab_count} · 에이전트 ${agents.length} · 셸 ${terms.length}` : missing}</span></h1>
    </header>
    <main class="list">
      ${w ? `
      <div class="row">
        <a class="btn" href="${link(host, `/start/ws/${id}`)}">에이전트 시작</a>
        <button type="button" class="btn secondary" id="w-tab">새 탭</button>
        <button type="button" class="btn secondary" id="w-rename">이름 바꾸기</button>
      </div>
      ${agents.length ? `<section class="group"><h2>에이전트 · ${agents.length}</h2><div class="cards">${agents.map(card).join('')}</div></section>` : ''}
      ${terms.length ? `<section class="group"><h2>셸 · ${terms.length}</h2><div class="cards">${terms.map(termCard).join('')}</div></section>` : ''}
      <section class="group danger-zone"><button type="button" class="btn secondary danger-text wide" id="w-close">워크스페이스 닫기</button></section>` : ''}
    </main>`;
  if (!w) return;
  tickList();
  document.getElementById('w-tab').onclick = () => newTab(w);
  document.getElementById('w-rename').onclick = () => renameWorkspace(w);
  document.getElementById('w-close').onclick = () => closeWorkspace(w);
}
