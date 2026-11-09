'use strict';
// The forms: 새 워크스페이스, 에이전트 시작 and a workspace's 기본 폴더, with the folder choice
// (recent rows, the browser sheet).

// ------------------------------------------------------------ new workspace / start agent

async function renderForm() {
  await ready; // the host list and ids come with the first state
  if (view.name !== 'form') return;
  const isNew = view.mode === 'new';
  const isDir = view.mode === 'dir'; // the workspace's 기본 폴더 (lib/wsdirs), nothing started
  const host = curHost();
  const ws = view.mode === 'ws' || isDir ? (state.workspaces || []).find((x) => same(x, host, view.target, 'workspace_id')) : null;
  const term = view.mode === 'pane' ? (state.terminals || []).find((t) => same(t, host, view.target)) : null;
  // A folder to choose: a new workspace's (where its first tab opens) and a new tab's. Starting in
  // a shell (pane) runs in that shell's folder.
  const folder = isNew || Boolean(ws);
  const on = isNew ? '' : multi() ? ` · ${hostLabel(host)}` : '';
  const where = isNew ? '' : ws ? `${ws.label} 워크스페이스${isDir ? '' : '의 새 탭'}${on}` : term ? `${termTitle(term)} 셸 (${term.workspaceLabel})${on}` : '찾을 수 없음';
  const submitName = isNew ? '만들기' : isDir ? '저장' : '시작';
  const back = isNew ? homeHash() : formBack(ws ? link(host, `/ws/${encodeURIComponent(ws.workspace_id)}`) : term ? link(host, `/term/${encodeURIComponent(term.pane)}`) : homeHash());
  detailRoot().innerHTML = `
    <header class="bar">
      ${backLink(back, '뒤로', split)}
      <h1>${isNew ? '새 워크스페이스' : isDir ? '기본 폴더' : '에이전트 시작'}${where ? `<span class="sub">${esc(where)}</span>` : ''}</h1>
    </header>
    <form class="panel" id="f-form">
      ${isNew ? `
      <section>
        ${multi() ? `
        <h2><label for="f-host">호스트</label></h2>
        <select class="field" id="f-host">${hosts().map((x) => `<option value="${esc(x.id)}" ${x.id === host ? 'selected' : ''} ${x.online ? '' : 'disabled'}>${esc(x.label)}${x.online ? '' : ' (오프라인)'}</option>`).join('')}</select>` : ''}
        ${folderField('first')}
        <h2><label for="f-label">워크스페이스 이름 (선택)</label></h2>
        <input class="field" id="f-label" placeholder="비우면 폴더 이름" autocomplete="off">
        <label class="check"><input type="checkbox" id="f-with" checked> 에이전트도 바로 시작</label>
      </section>` : ''}
      ${ws && !isDir ? `<section>${folderField('tab')}
        <label class="check"><input type="checkbox" id="f-keep"> 이 워크스페이스의 기본 폴더로 정하기</label></section>` : ''}
      ${isDir && ws ? `<section>${folderField('dir')}</section>` : ''}
      ${isDir ? '' : `<section id="f-agent">
        <h2><label for="f-kind">에이전트</label></h2>
        ${isNew ? '<p class="form-note">새 폴더에서 Claude 를 처음 띄우면 폴더 신뢰 질문이 나옵니다. 에이전트 화면에 나오는 버튼으로 답하세요.</p>' : ''}
        <select class="field" id="f-kind"></select>
        <h2><label for="f-args">추가 옵션 (선택)</label></h2>
        <input class="field" id="f-args" placeholder="예: --model sonnet" autocomplete="off" autocapitalize="off" spellcheck="false">
        <h2><label for="f-name">에이전트 이름 (선택)</label></h2>
        <input class="field" id="f-name" placeholder="비우면 폴더·워크스페이스 이름" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="f-name-hint">
        <p class="hint" id="f-name-hint" aria-live="polite"></p>
      </section>`}
      <div class="row end">${isDir && ws && ws.defaultCwd ? '<button type="button" class="btn secondary" id="f-clear">기본 폴더 지우기</button>' : ''}<button type="submit" class="btn" id="f-submit"${keyAttrs(null, submitName, Keymap.label(Keymap.deviceKey('Ctrl+Enter')))} disabled>${submitName}</button></div>
    </form>`;
  const withAgent = document.getElementById('f-with');
  if (withAgent)
    withAgent.onchange = () => {
      document.getElementById('f-agent').hidden = !withAgent.checked;
      syncSubmit();
    };
  const fname = document.getElementById('f-name');
  if (fname) fname.oninput = () => {
    const hint = agentNameHint(fname.value);
    document.getElementById('f-name-hint').textContent = hint;
    fname.setAttribute('aria-invalid', String(Boolean(hint)));
    syncSubmit();
  };
  const form = document.getElementById('f-form');
  form.onsubmit = submitForm;
  // Ctrl+리턴 (⌘+리턴) from any field, a <select> too, as in the message box (keymap.js LOCAL).
  form.onkeydown = (e) => {
    if (Keys.enterAction(e, 'newline') !== 'send') return;
    e.preventDefault();
    if (!document.getElementById('f-submit').disabled) form.requestSubmit();
  };
  const pick = document.getElementById('f-host');
  if (pick) pick.onchange = () => fillForm(pick.value);
  if (folder) {
    const cwd = document.getElementById('f-cwd');
    cwd.oninput = () => showPicked();
    document.getElementById('f-browse').onclick = () => browseDirs(view.formHost || host);
    // The folder Ctrl+N would use (app.js startFolderFor), still changeable; for this start only
    // unless 기본 폴더로 is ticked. The 기본 폴더 form: the one set now.
    if (ws) cwd.value = isDir ? ws.defaultCwd || '' : startFolderFor(host, ws.workspace_id);
  }
  const clear = document.getElementById('f-clear');
  if (clear) clear.onclick = () => saveDir(host, '');
  if (isNew) {
    // Opened from the keyboard (+'s key, Tab and Enter on +): the focus into the form, not
    // left on the page behind the list's many stops.
    if (lastInput === 'key') (document.getElementById('f-host') || document.getElementById('f-browse')).focus({ preventScroll: true });
  }
  if (isNew || ws || term) fillForm(host);
  // Opened from a keyboard (Ctrl+N): straight into the form, its first field.
  if (!isNew && !isDir && keyboardLikely()) document.getElementById('f-kind').focus({ preventScroll: true });
  if (isDir && ws && lastInput === 'key') document.getElementById('f-browse').focus({ preventScroll: true });
}

// The folder field: a new workspace's (first: where its first tab opens, then its 기본 폴더), a new
// tab's (tab), or a workspace's 기본 폴더 (dir).
const FOLDER_NOTES = {
  first: '첫 탭이 열릴 폴더 · 이 워크스페이스의 기본 폴더가 됩니다',
  tab: '새 탭이 열릴 폴더 (Ctrl+N 이 쓸 폴더로 채워 둡니다)',
  dir: 'Ctrl+N·새 셸 열기가 이 워크스페이스에 새 탭을 여는 폴더. 에이전트·셸을 열어 둔 채 누르면 그 폴더가 먼저입니다.',
};
function folderField(kind) {
  return `
        <h2>${kind === 'dir' ? '기본 폴더' : '폴더'}</h2>
        <p class="form-note">${FOLDER_NOTES[kind]}</p>
        <div class="picked" id="f-picked" aria-live="polite"></div>
        <div class="dir-rows" id="f-recent"></div>
        <button type="button" class="btn secondary wide" id="f-browse">폴더 찾아보기</button>
        <details class="manual" id="f-manual">
          <summary>경로 직접 입력</summary>
          <input class="field" id="f-cwd" list="f-cwds" aria-label="폴더 경로" autocomplete="off" autocapitalize="off" spellcheck="false">
          <datalist id="f-cwds"></datalist>
        </details>`;
}

// Where 에이전트 시작's ‹ / ✕ goes: the page it was opened over (the agent or shell beside it,
// Ctrl+N), else the workspace or shell it starts in.
function formBack(fallback) {
  const p = history.state && history.state.prev;
  return p && !/(^|\/)(new|start|dir)(\/|$)/.test(normHash(p)) ? p : fallback;
}

// ---- folder choice: recent rows, a browser sheet, or a typed path

let browseAt = { host: null, path: null }; // where the browser was left, per form host
const RECENT_SHOWN = 5;

function pickCwd(p) {
  const cwd = document.getElementById('f-cwd');
  if (!cwd) return;
  cwd.value = p;
  showPicked();
}

function showPicked() {
  const p = (document.getElementById('f-cwd')?.value || '').trim();
  const box = document.getElementById('f-picked');
  if (!box) return;
  box.classList.toggle('on', Boolean(p));
  // 만들기 pressed without one (folderMissing): the box says what to do, in red, until one is chosen.
  if (p) box.classList.remove('missing');
  // A new tab may go without one: herdr then opens it in the folder of the workspace's active tab.
  const ask = view.mode === 'ws' ? '고르지 않으면 herdr 에서 그 워크스페이스의 활성 탭 폴더에 열립니다' : view.mode === 'dir' ? '기본 폴더가 없습니다 — 새 탭은 보던 에이전트·셸의 폴더, 없으면 herdr 가 정한 곳에 열립니다' : box.classList.contains('missing') ? '폴더를 고르세요 — 최근 폴더를 누르거나 「폴더 찾아보기」로 고릅니다' : '아래에서 폴더를 고르세요';
  box.innerHTML = p ? `<span class="k">선택됨</span><b>${esc(basename(p))}</b><span class="p">${esc(p)}</span>` : `<span class="k">${ask}</span>`;
  const label = document.getElementById('f-label');
  if (label) label.placeholder = `비우면 ${p ? basename(p) : '폴더 이름'}`;
  document.querySelectorAll('#f-recent .dir-row').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cwd === p)));
}

// 만들기 without a folder: the folder box says so in red and the first way to choose one gets
// the focus, in view (the box is far above the button on a phone).
function folderMissing() {
  const box = document.getElementById('f-picked');
  if (!box) return;
  box.classList.add('missing');
  showPicked();
  box.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
  const first = document.querySelector('#f-recent .dir-row') || document.getElementById('f-browse');
  if (first) first.focus({ preventScroll: true });
}

// The folders a new tab / workspace on host may start in: the workspace's own agents' and shells'
// first, then the host's recent ones, without the ones taken out of 최근 폴더 (lib/hiddencwds; the
// host leaves them out of recentCwds already, but not the workspace's own).
const dirKey = (p, platform) => {
  const n = p.replace(/[\\/]+$/, '') || p;
  return platform === 'win32' ? n.replace(/\//g, '\\').toLowerCase() : n;
};
function recentFor(host, info) {
  const wsId = view.mode === 'ws' || view.mode === 'dir' ? view.target : null;
  const here = wsId ? [...(state.agents || []), ...(state.terminals || [])].filter((x) => (x.host || localId()) === host && x.workspace === wsId && x.cwd).map((x) => x.cwd) : [];
  const hidden = new Set((info.hiddenCwds || []).map((p) => dirKey(p, info.platform)));
  return [...new Set([...here.filter((p) => !hidden.has(dirKey(p, info.platform))), ...info.recentCwds])];
}

let recentAll = false; // 「N개 더 보기」 pressed in this form
function renderRecent(list, all = false) {
  const box = document.getElementById('f-recent');
  if (!box) return;
  recentAll = all;
  const rows = all ? list : list.slice(0, RECENT_SHOWN);
  box.innerHTML = rows.length
    ? `<div class="dir-cap">최근 폴더</div>${rows
        .map(
          (c) =>
            `<div class="dir-line"><button type="button" class="dir-row" data-cwd="${esc(c)}"><b>${esc(basename(c))}</b><span>${esc(c)}</span></button><button type="button" class="dir-x" data-cwd="${esc(c)}" aria-label="${esc(basename(c))} 최근 폴더에서 빼기" title="최근 폴더에서 빼기">${ICON.x}</button></div>`
        )
        .join('')}${list.length > rows.length ? `<button type="button" class="dir-more" id="f-more">${list.length - rows.length}개 더 보기</button>` : ''}`
    : '';
  box.querySelectorAll('.dir-row').forEach((b) => (b.onclick = () => pickCwd(b.dataset.cwd)));
  box.querySelectorAll('.dir-x').forEach((b, i) => (b.onclick = () => hideRecent(b.dataset.cwd, i)));
  const more = document.getElementById('f-more');
  if (more) more.onclick = () => renderRecent(list, true);
  showPicked();
}

// The form's 최근 폴더 drawn again from the host's info (after a hide or its 되돌리기).
function redrawRecent(host, focusAt = -1) {
  const info = hostCache.get(host);
  if (view.name !== 'form' || view.formHost !== host || !info || !document.getElementById('f-recent')) return;
  const list = recentFor(host, info);
  document.getElementById('f-cwds').innerHTML = list.map((c) => `<option value="${esc(c)}">`).join('');
  renderRecent(list, recentAll);
  if (focusAt < 0) return;
  // The keyboard stays where it was: the ✕ now in that place, the one above, or 폴더 찾아보기.
  const xs = document.querySelectorAll('#f-recent .dir-x');
  const next = xs[Math.min(focusAt, xs.length - 1)] || document.getElementById('f-browse');
  if (next) next.focus({ preventScroll: true });
}

// The ✕: the folder hidden from 최근 폴더 on its host, for every device; a toast to undo. The
// 선택됨 box keeps it if it was chosen (it still works, as when typed or browsed to).
async function hideRecent(cwd, at) {
  const host = view.formHost || curHost();
  const call = async (what) => {
    const r = await api(hp(`/recent/${what}`, host), { method: 'POST', body: JSON.stringify({ cwd }) });
    const info = hostCache.get(host);
    if (info) hostCache.set(host, { ...info, recentCwds: r.recentCwds, hiddenCwds: r.hiddenCwds });
    return r;
  };
  try {
    await call('hide');
  } catch (err) {
    return toastErr(`최근 폴더에서 빼지 못했습니다: ${errText(err)}`);
  }
  const hadFocus = document.activeElement && document.activeElement.classList.contains('dir-x');
  redrawRecent(host, hadFocus ? at : -1);
  toast(`${basename(cwd)} 를 최근 폴더에서 뺐습니다`, {
    ms: 8000,
    action: {
      label: '되돌리기',
      run: () =>
        call('show').then(
          () => redrawRecent(host),
          (err) => toastErr(`되돌리지 못했습니다: ${errText(err)}`)
        ),
    },
  });
}

// A tall sheet over the form: breadcrumb, shortcuts, subfolders, and a sticky footer.
async function browseDirs(host) {
  let info;
  try {
    info = await hostInfo(host);
  } catch (err) {
    return toast(`불러오지 못했습니다: ${errText(err)}`);
  }
  if (browseAt.host !== host) browseAt = { host, path: null };
  const start = (document.getElementById('f-cwd')?.value || '').trim();
  const el = document.createElement('div');
  el.className = 'sheet-back';
  el.innerHTML = `<div class="sheet browser" role="dialog" aria-modal="true" aria-label="폴더 찾아보기">
      <div class="browser-head">
        <h2>폴더 찾아보기${multi() ? `<span class="sub">${esc(hostLabel(host))}</span>` : ''}</h2>
        <button type="button" class="icon-btn" data-close aria-label="닫기"${keyAttrs('back', '닫기')}>${ICON.x}</button>
      </div>
      <div class="chips places">${(info.places || []).map((p) => `<button type="button" class="chip" data-go="${esc(p.path)}" title="${esc(p.path)}">${esc(p.name)}</button>`).join('')}</div>
      <nav class="crumbs" aria-label="현재 위치"></nav>
      <div class="dir-list" role="list"></div>
      <div class="browser-foot">
        <button type="button" class="btn secondary" data-mkdir>새 폴더</button>
        <button type="button" class="btn" data-pick>이 폴더 선택</button>
      </div>
    </div>`;
  const $ = (q) => el.querySelector(q);
  let cur = null; // the last listing shown
  let layer = null;
  const close = () => closeLayer(layer);
  el.onclick = (e) => {
    if (e.target === el) close();
  };
  $('[data-close]').onclick = close;

  async function open(p) {
    const list = $('.dir-list');
    list.setAttribute('aria-busy', 'true');
    let r;
    try {
      r = await api(hp(`/dirs${p == null ? '' : `?path=${encodeURIComponent(p)}`}`, host));
    } catch (err) {
      list.removeAttribute('aria-busy');
      // A remembered folder that has since gone away: start over at home.
      if (p != null && ['cwd_not_found', 'cwd_not_directory'].includes(err.code) && cur == null) return open(null);
      return toast(`열지 못했습니다: ${errText(err)}`);
    }
    if (!el.isConnected || layer.closed) return;
    cur = r;
    if (!r.drives) browseAt.path = r.path;
    const crumbs = r.drives ? [] : r.crumbs;
    $('.crumbs').innerHTML = [
      ...(info.platform === 'win32' ? [`<button type="button" class="crumb" data-go="::drives" ${r.drives ? 'aria-current="page"' : ''}>드라이브</button>`] : []),
      ...crumbs.map((c, i) => `<button type="button" class="crumb" data-go="${esc(c.path)}" ${i === crumbs.length - 1 ? 'aria-current="page"' : ''}>${esc(c.name)}</button>`),
    ].join('<span class="crumb-sep" aria-hidden="true">›</span>');
    const up = r.parent ? `<button type="button" class="dir-item up" data-go="${esc(r.parent)}" role="listitem"><span class="ico">↑</span><span class="nm">상위</span></button>` : '';
    const items = r.dirs
      .map((d) => {
        const full = r.drives ? d : joinPath(r.path, d, r.sep);
        return `<button type="button" class="dir-item" data-go="${esc(full)}" role="listitem"><span class="ico">${r.drives ? '◼' : '▸'}</span><span class="nm">${esc(r.drives ? d.replace(/\\$/, '') : d)}</span></button>`;
      })
      .join('');
    const note = r.denied ? '이 폴더를 읽을 권한이 없습니다.' : !r.dirs.length ? (r.drives ? '드라이브가 없습니다.' : '하위 폴더가 없습니다.') : r.truncated ? `처음 ${r.dirs.length}개만 보입니다.` : '';
    list.innerHTML = up + items + (note ? `<p class="dir-note">${esc(note)}</p>` : '');
    list.scrollTop = 0;
    list.removeAttribute('aria-busy');
    el.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => open(b.dataset.go)));
    const pickBtn = $('[data-pick]');
    pickBtn.disabled = Boolean(r.drives);
    $('[data-mkdir]').disabled = Boolean(r.drives) || Boolean(r.denied);
    pickBtn.innerHTML = r.drives ? '이 폴더 선택' : `이 폴더 선택<span class="sub">${esc(basename(r.path) || r.path)}</span>`;
  }

  $('[data-pick]').onclick = () => {
    if (!cur || cur.drives) return;
    pickCwd(cur.path);
    close();
  };
  $('[data-mkdir]').onclick = async () => {
    if (!cur || cur.drives) return;
    let name = '';
    let error = '';
    for (;;) {
      name = await sheet({ title: '새 폴더', text: `${cur.path} 안에 만들고 바로 선택합니다.`, error, input: { value: name, placeholder: '폴더 이름' }, ok: '만들기' });
      if (name == null) return;
      name = name.trim();
      try {
        const r = await api(hp('/dirs', host), { method: 'POST', body: JSON.stringify({ parent: cur.path, name }) });
        toast('폴더를 만들었습니다');
        pickCwd(r.path);
        browseAt.path = r.path;
        close();
        return;
      } catch (err) {
        error = errText(err);
      }
    }
  };

  layer = openLayer(el, { focus: '[data-close]' });
  open(browseAt.path || start || null);
}

const joinPath = (dir, name, sep) => (dir.endsWith(sep) ? dir + name : dir + sep + name);

// Allowed kinds and folder suggestions come from the chosen host.
async function fillForm(host) {
  view.formHost = host;
  view.formReady = false;
  syncSubmit();
  let info;
  try {
    info = await hostInfo(host);
  } catch (err) {
    return toast(`불러오지 못했습니다: ${errText(err)}`);
  }
  if (view.name !== 'form' || view.formHost !== host) return;
  const kind = document.getElementById('f-kind');
  if (kind) {
    const prev = kind.value;
    kind.innerHTML = info.kinds.map((k) => `<option value="${esc(k)}">${esc(kindLabel(k))}</option>`).join('');
    if (info.kinds.includes(prev)) kind.value = prev;
  }
  const cwd = document.getElementById('f-cwd');
  if (cwd) {
    // Another host's folder means nothing here: a host change starts the choice over.
    if (cwd.dataset.host && cwd.dataset.host !== host) cwd.value = '';
    cwd.dataset.host = host;
    if (browseAt.host !== host) browseAt = { host, path: null };
    cwd.placeholder = info.platform === 'win32' ? 'C:\\Users\\…\\project' : `${info.home || '/home/…'}/project`;
    // A new tab: the folders its workspace's agents and shells are in first, then the host's recent ones.
    const wsId = view.mode === 'ws' || view.mode === 'dir' ? view.target : null;
    const recent = recentFor(host, info);
    document.getElementById('f-cwds').innerHTML = recent.map((c) => `<option value="${esc(c)}">`).join('');
    // One recent folder: that is very likely the one, chosen already (still changeable).
    if (!cwd.value && !wsId && recent.length === 1) cwd.value = recent[0];
    renderRecent(recent);
  }
  view.formReady = true;
  syncSubmit();
}

// The agent kinds by their names (the value sent stays the id).
const KIND_NAMES = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini' };
const kindLabel = (k) => KIND_NAMES[k] || k;

// 시작 / 만들기 is off while the host's info is loading and while the agent's name can't be
// used (its hint says why, under the field), so a tap never ends in a toast.
function syncSubmit() {
  const btn = document.getElementById('f-submit');
  if (!btn) return;
  const withAgent = document.getElementById('f-with');
  const name = document.getElementById('f-name');
  const bad = (!withAgent || withAgent.checked) && name && Boolean(agentNameHint(name.value.trim()));
  btn.disabled = !view.formReady || bad;
}

// The 기본 폴더 form's 저장 (cwd '' clears it), then back to the workspace.
async function saveDir(host, cwd) {
  const r = await act(hp(`/workspaces/${encodeURIComponent(view.target)}/dir`, host), { cwd }, cwd ? '기본 폴더를 정했습니다' : '기본 폴더를 지웠습니다', '기본 폴더를 정하지 못했습니다');
  if (r) location.hash = formBack(link(host, `/ws/${encodeURIComponent(view.target)}`));
  return r;
}

async function submitForm(e) {
  e.preventDefault();
  const val = (id) => (document.getElementById(id)?.value || '').trim();
  if (view.mode === 'dir') {
    const btn = document.getElementById('f-submit');
    btn.disabled = true;
    await saveDir(view.formHost || curHost(), val('f-cwd'));
    return syncSubmit();
  }
  const agent = { kind: val('f-kind'), args: val('f-args').split(/\s+/).filter(Boolean), name: val('f-name') };
  const host = view.formHost || curHost();
  const btn = document.getElementById('f-submit');
  if (agentNameHint(agent.name)) {
    document.getElementById('f-name').focus();
    return toastErr(agentNameHint(agent.name));
  }
  btn.disabled = true;
  let r = null;
  let started = true;
  if (view.mode === 'new') {
    if (!val('f-cwd')) {
      syncSubmit();
      return folderMissing();
    }
    const withAgent = document.getElementById('f-with').checked;
    r = await act(hp('/workspaces', host), { cwd: val('f-cwd'), label: val('f-label'), agent: withAgent ? agent : null }, null, '워크스페이스를 만들지 못했습니다');
    if (r) {
      if (r.agentError) toast(`워크스페이스는 만들었지만 에이전트를 시작하지 못했습니다: ${r.agentError}`);
      started = Boolean(r.agent);
      hostCache.delete(host); // recent folders changed
    }
  } else if (view.mode === 'ws') {
    // The folder is for this start only (Ctrl+N goes on choosing by what is open), unless it is
    // made the workspace's 기본 폴더 too.
    const cwd = val('f-cwd');
    if (cwd && document.getElementById('f-keep')?.checked) await act(hp(`/workspaces/${encodeURIComponent(view.target)}/dir`, host), { cwd }, null, '기본 폴더를 정하지 못했습니다');
    r = await act(hp(`/workspaces/${encodeURIComponent(view.target)}/agents`, host), cwd ? { ...agent, cwd } : agent, null, '에이전트를 시작하지 못했습니다');
    if (r && cwd) hostCache.delete(host); // a folder taken out of 최근 폴더 is back in it
  }
  else r = await act(hp(`/panes/${encodeURIComponent(view.target)}/agent`, host), agent, null, '에이전트를 시작하지 못했습니다');
  syncSubmit();
  if (!r) return;
  // What Ctrl+N starts next on this device, and an agent started here (quick.js).
  if (started) {
    Quick.remember(agent);
    Quick.started(rowKey(host, r.pane || view.target));
  }
  const pane = encodeURIComponent(r.pane || view.target);
  location.hash = link(host, started ? `/agent/${pane}` : `/term/${pane}`);
}
