'use strict';
// The workspace page, in 설정's grouped cards: where it is (its host; a herdr workspace has no
// folder, each row shows its own), its agents and
// shells as the list draws them (list.js agentRow / termRow: icon, unread dot, time, status), the
// rare and the destructive (이름 바꾸기, 워크스페이스 닫기) as quiet rows rather than big buttons,
// and what to do here (에이전트 시작, 새 셸 열기) in a row at the bottom, where a thumb reaches.

function renderWorkspace() {
  const host = curHost();
  const w = (state.workspaces || []).find((x) => same(x, host, view.id, 'workspace_id'));
  const agents = state.agents.filter((a) => same(a, host, view.id, 'workspace')).sort(paneOrder);
  const terms = (state.terminals || []).filter((t) => same(t, host, view.id, 'workspace')).sort(paneOrder);
  const id = encodeURIComponent(view.id);
  const counts = [agents.length && `에이전트 ${agents.length}`, terms.length && `셸 ${terms.length}`].filter(Boolean).join(' · ') || '패널 없음';
  const sub = w ? [multi() && hostLabel(host), counts].filter(Boolean).map(esc).join(' · ') : '';
  const info = w && multi() ? [['호스트', esc(hostLabel(host))]] : [];
  // Not here: say why, and give a way out (the back arrow alone is easy to miss). It draws again by
  // itself when a state brings it back (onState).
  const gone = w
    ? null
    : !live && state.herdr === 'connecting'
      ? { title: '워크스페이스', text: '불러오는 중…' }
      : !live
        ? { title: '워크스페이스', text: '실시간 연결이 끊겨 이 워크스페이스를 불러오지 못했습니다. 다시 붙으면 저절로 나타납니다.' }
        : !online(host)
          ? { title: `${hostLabel(host)} 오프라인`, text: `${hostLabel(host)} 호스트에 닿지 않습니다. 연결되면 저절로 다시 나타납니다.` }
          : { title: '워크스페이스 없음', text: '이 워크스페이스는 닫혔거나 찾을 수 없습니다.' };
  detailRoot().innerHTML = `
    <header class="bar ws-bar">
      ${backLink(homeHash())}
      <h1${w ? ` title="${esc(w.label)}"` : ''}><span class="t">${esc(w ? w.label : gone.title)}</span>${sub ? `<span class="sub">${sub}</span>` : ''}</h1>
      ${liveDot()}
    </header>
    <main class="panel settings ws-page">
      ${w ? `
      ${info.length ? `<section class="pgroup" aria-label="정보">
        <div class="pcard ws-info">${info.map(([k, v]) => `<div class="ws-kv"><span class="ws-k">${k}</span><span class="ws-v">${v}</span></div>`).join('')}</div>
      </section>` : ''}
      <section class="pgroup" aria-labelledby="ws-ag">
        <h2 id="ws-ag">에이전트${agents.length ? ` · ${agents.length}` : ''}</h2>
        <div class="pcard ws-rows">${agents.length ? agents.map(agentRow).join('') : `<p class="ws-none">아직 없습니다. 아래 「에이전트 시작」으로 여기서 시작합니다.</p>`}</div>
      </section>
      ${terms.length ? `<section class="pgroup" aria-labelledby="ws-sh"><h2 id="ws-sh">셸 · ${terms.length}</h2><div class="pcard ws-rows">${terms.map(termRow).join('')}</div></section>` : ''}
      <section class="pgroup" aria-labelledby="ws-mg">
        <h2 id="ws-mg">워크스페이스</h2>
        <div class="pcard">
          <button type="button" class="pref-link" id="w-rename"><span>이름 바꾸기</span><span class="pl-end" aria-hidden="true">›</span></button>
          <button type="button" class="pref-link danger-text" id="w-close"${keyAttrs('closeWorkspace', '워크스페이스 닫기')}><span>워크스페이스 닫기</span><span class="pl-end ws-close-note">안의 에이전트·셸이 모두 끝납니다</span></button>
        </div>
      </section>` : `
      <div class="ws-gone" role="status">
        <p>${esc(gone.text)}</p>
        <a class="btn" href="${homeHash()}">작업공간으로</a>
      </div>`}
    </main>
    ${w ? `<div class="ws-dock">
      <a class="btn" href="${link(host, `/start/ws/${id}`)}"${keyAttrs('newAgent', '에이전트 시작')}>에이전트 시작</a>
      <button type="button" class="btn secondary" id="w-tab" title="이 워크스페이스에 새 탭을 열고 셸을 띄웁니다">새 셸 열기</button>
    </div>` : ''}`;
  if (!w) return;
  tickList();
  document.getElementById('w-tab').onclick = () => newTab(w);
  document.getElementById('w-rename').onclick = () => renameWorkspace(w);
  document.getElementById('w-close').onclick = () => closeWorkspace(w);
}
