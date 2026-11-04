'use strict';
// The workspace page, in 설정's grouped cards: what to do here first (에이전트 시작, 셸 열기),
// where it is (its folder, its host and tabs), its agents and shells as the list draws them
// (list.js agentRow / termRow: icon, unread dot, time, status), and last the rare and the
// destructive (이름 바꾸기, 워크스페이스 닫기) as quiet rows rather than big buttons.

function renderWorkspace() {
  const host = curHost();
  const w = (state.workspaces || []).find((x) => same(x, host, view.id, 'workspace_id'));
  const agents = state.agents.filter((a) => same(a, host, view.id, 'workspace')).sort(paneOrder);
  const terms = (state.terminals || []).filter((t) => same(t, host, view.id, 'workspace')).sort(paneOrder);
  const id = encodeURIComponent(view.id);
  const missing = !online(host) ? `${esc(hostLabel(host))} 오프라인` : '닫혔거나 찾을 수 없습니다';
  // The folder: the one its panes run in (as the list's card shows it).
  const first = [...agents, ...terms].find((x) => x.cwd);
  const counts = [agents.length && `에이전트 ${agents.length}`, terms.length && `셸 ${terms.length}`].filter(Boolean).join(' · ') || '패널 없음';
  const sub = w ? [multi() && hostLabel(host), counts].filter(Boolean).map(esc).join(' · ') : missing;
  const info = w
    ? [
        first ? ['폴더', `<code class="ws-path">${esc(first.cwd)}</code>`] : null,
        multi() ? ['호스트', esc(hostLabel(host))] : null,
        ['탭', esc(String(w.tab_count ?? '—'))],
      ].filter(Boolean)
    : [];
  detailRoot().innerHTML = `
    <header class="bar">
      ${backLink(homeHash())}
      <h1>${w ? esc(w.label) : '워크스페이스 없음'}<span class="sub">${sub}</span></h1>
    </header>
    <main class="panel settings ws-page">
      ${w ? `
      <div class="row ws-acts">
        <a class="btn" href="${link(host, `/start/ws/${id}`)}"${keyAttrs('newAgent', '에이전트 시작')}>에이전트 시작</a>
        <button type="button" class="btn secondary" id="w-tab" title="이 워크스페이스에 새 탭을 열고 셸을 띄웁니다">셸 열기</button>
      </div>
      <section class="pgroup" aria-label="정보">
        <div class="pcard ws-info">${info.map(([k, v]) => `<div class="ws-kv"><span class="ws-k">${k}</span><span class="ws-v">${v}</span></div>`).join('')}</div>
      </section>
      <section class="pgroup" aria-labelledby="ws-ag">
        <h2 id="ws-ag">에이전트${agents.length ? ` · ${agents.length}` : ''}</h2>
        <div class="pcard ws-rows">${agents.length ? agents.map(agentRow).join('') : `<p class="ws-none">아직 없습니다. 「에이전트 시작」으로 여기서 시작합니다.</p>`}</div>
      </section>
      ${terms.length ? `<section class="pgroup" aria-labelledby="ws-sh"><h2 id="ws-sh">셸 · ${terms.length}</h2><div class="pcard ws-rows">${terms.map(termRow).join('')}</div></section>` : ''}
      <section class="pgroup" aria-labelledby="ws-mg">
        <h2 id="ws-mg">워크스페이스</h2>
        <div class="pcard">
          <button type="button" class="pref-link" id="w-rename"><span>이름 바꾸기</span><span class="pl-end" aria-hidden="true">›</span></button>
          <button type="button" class="pref-link danger-text" id="w-close"${keyAttrs('closeView', '워크스페이스 닫기')}><span>워크스페이스 닫기</span><span class="pl-end ws-close-note">안의 패널이 모두 끝납니다</span></button>
        </div>
      </section>` : ''}
    </main>`;
  if (!w) return;
  tickList();
  document.getElementById('w-tab').onclick = () => newTab(w);
  document.getElementById('w-rename').onclick = () => renameWorkspace(w);
  document.getElementById('w-close').onclick = () => closeWorkspace(w);
}
