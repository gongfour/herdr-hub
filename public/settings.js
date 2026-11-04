'use strict';
// 설정: 알림 (push.js), the settings of prefs.js's table (입력, 화면), 키보드, 연결, 정보 and 이 기기.
// The page is built once and then patched: a state push redraws only the 연결 block, the push
// lookups only the 알림 block, and a control only its own state, so the keyboard focus stays put.

// ------------------------------------------------------------ settings

// Split: where closing 설정 goes, the agent, shell or workspace it was opened over (goBack then
// steps back in history to it), else the list.
function settingsBack() {
  const p = history.state && history.state.prev;
  return p && !['/', '/settings'].includes(normHash(p)) ? p : '#/';
}

// The build this page was served with (the server writes it into index.html), or null.
const pageBuild = () => {
  const m = document.querySelector('meta[name="herdr-hub-build"]');
  return m ? Update.parseBuild(m.content) : null;
};
// A phone or a tablet without its keyboard: no 단축키 to show. Split always has room for it.
const touchOnly = () => !split && matchMedia('(hover: none) and (pointer: coarse)').matches;

// One row of prefs.js's table.
function prefHtml(p) {
  const id = p.key.replace(/\W/g, '-');
  if (p.type === 'bool') {
    // A switch with a line under it (hint: a string) says what it does, as a choice's does.
    const hint = Prefs.hintOf(p, true);
    return `<label class="switch pref" data-pref="${esc(p.key)}"><span>${esc(p.label)}</span><input type="checkbox" role="switch"${hint ? ` aria-describedby="ph-${id}"` : ''}></label>${hint ? `<p class="pref-hint" id="ph-${id}">${esc(hint)}</p>` : ''}`;
  }
  const radios = Object.entries(p.options)
    .map(([v, label]) => `<button type="button" role="radio" data-v="${esc(v)}" aria-checked="false" tabindex="-1">${esc(label)}</button>`)
    .join('');
  return `<div class="pref pref-choice" data-pref="${esc(p.key)}">
      <div class="pref-line"><span class="pref-label" id="pl-${id}">${esc(p.label)}</span>
        <div class="seg" role="radiogroup" aria-labelledby="pl-${id}" aria-describedby="ph-${id}">${radios}</div></div>
      <p class="pref-hint" id="ph-${id}"></p>
    </div>`;
}

function settingsHtml() {
  const groups = Prefs.GROUPS.map((g) => {
    const rows = Prefs.PREFS.filter((p) => p.group === g.id);
    return `<section class="pgroup" aria-labelledby="g-${g.id}">
        <h2 id="g-${g.id}">${esc(g.label)}</h2>
        <div class="pcard">${rows.map(prefHtml).join('')}</div>
        ${g.note ? `<p class="pnote">${esc(g.note)}</p>` : ''}
      </section>`;
  }).join('');
  // Split, 설정 is a detail on the right: ✕ (Esc) closes it back to what was open there.
  return `
    <header class="bar">
      <h1 id="s-title">설정</h1>
      ${split ? `<a class="icon-btn close-detail" href="${settingsBack()}" data-back aria-label="닫기"${keyAttrs('back', '닫기')}>${ICON.x}</a>` : ''}
    </header>
    <main class="panel settings" tabindex="-1" aria-labelledby="s-title">
      <section class="pgroup" aria-labelledby="g-push">
        <h2 id="g-push">알림</h2>
        <div class="pcard" id="s-push"></div>
      </section>
      ${groups}
      <section class="pgroup" id="s-kbd" aria-labelledby="g-kbd">
        <h2 id="g-kbd">키보드</h2>
        <div class="pcard"><button type="button" class="pref-link" id="s-keys"><span>단축키 보기·바꾸기</span><span class="pl-end"><kbd></kbd><span aria-hidden="true">›</span></span></button></div>
      </section>
      <section class="pgroup" aria-labelledby="g-conn">
        <h2 id="g-conn">연결</h2>
        <div class="pcard"><ul class="conn-list" id="s-conn"></ul></div>
      </section>
      <section class="pgroup" aria-labelledby="g-info">
        <h2 id="g-info">정보</h2>
        <div class="pcard">
          <div class="pref-ver"><button type="button" class="pref-info ver-line" id="s-ver"><span class="ver-k">버전</span><span class="ver-v"></span></button><button type="button" class="btn secondary" id="s-reload">새로고침</button></div>
        </div>
      </section>
      <section class="pgroup" aria-labelledby="g-dev">
        <h2 id="g-dev">이 기기</h2>
        <div class="pcard">
          <p class="pref-info">이 화면의 설정과 보관한 대화, 안 보낸 글은 이 기기에만 있습니다. 호스트 목록은 허브에 있어 어느 기기에서나 같습니다.</p>
          <button type="button" class="pref-link danger-text" id="s-clear"><span>이 기기 저장 데이터 지우기</span><span class="pl-end" aria-hidden="true">›</span></button>
        </div>
      </section>
    </main>`;
}

// focus: move the focus into the page itself (split: 설정 opens on the right, so a keyboard user
// lands in it rather than in the list): no ring, as nothing there is pressed; the arrows and
// PgUp/PgDn scroll it, and Tab goes on to the first control. Not a field: no soft keyboard.
function renderSettings({ focus = false } = {}) {
  if (!split) showTab('settings'); // the kept page, if there is one
  const root = split ? detailRoot() : listRoot();
  let main = root.querySelector(':scope > main.settings');
  if (!main || main._split !== split) {
    for (const el of [...root.children]) if (!el.classList.contains('tabbar')) el.remove();
    root.insertAdjacentHTML('afterbegin', settingsHtml());
    main = root.querySelector(':scope > main.settings');
    main._split = split;
    bindSettings(main);
  }
  const close = root.querySelector(':scope > .bar .close-detail');
  if (close) close.setAttribute('href', settingsBack());
  syncPrefs(main);
  main.querySelector('#s-kbd').hidden = touchOnly();
  const helpKey = Keymap.hint('help');
  main.querySelector('#s-keys kbd').textContent = helpKey;
  main.querySelector('#s-keys kbd').hidden = !helpKey;
  renderPushBlock();
  renderConn();
  loadHostAdmin();
  renderVersionInfo();
  // Come from a link to one part (list.js connLink: 설정 → 연결): that part at the top.
  if (settingsAt) {
    const h = main.querySelector(`#${settingsAt}`);
    settingsAt = null;
    if (h) requestAnimationFrame(() => h.scrollIntoView({ block: 'start' }));
  }
  if (!split) mountTabBar('settings');
  if (focus) main.focus({ preventScroll: true });
}

// Every control as Prefs has it: the checked radio (the one Tab stop of its group), its hint.
function syncPrefs(main) {
  for (const el of main.querySelectorAll('[data-pref]')) {
    const p = Prefs.row(el.dataset.pref);
    const v = Prefs.get(p.key);
    if (p.type === 'bool') {
      el.querySelector('input').checked = v;
      continue;
    }
    for (const b of el.querySelectorAll('[role=radio]')) {
      const on = b.dataset.v === v;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    const hint = Prefs.hintOf(p, v);
    const h = el.querySelector('.pref-hint');
    h.textContent = hint;
    h.hidden = !hint;
  }
}

function bindSettings(main) {
  const pick = (b) => {
    const el = b.closest('[data-pref]');
    setPref(el.dataset.pref, b.dataset.v);
    syncPrefs(main);
  };
  main.addEventListener('click', (e) => {
    const b = e.target.closest('[role=radio]');
    if (b) pick(b);
  });
  main.addEventListener('change', (e) => {
    const el = e.target.closest('[data-pref]');
    if (el && e.target.type === 'checkbox') setPref(el.dataset.pref, e.target.checked);
  });
  // A radiogroup's own keys (as any radiogroup): the arrows move the choice and the focus along,
  // round from either end; Home/End to the first and last. Not shortcuts: keymap.js binds no
  // plain arrows, and a key taken here is marked so app.js's handler leaves it.
  main.addEventListener('keydown', (e) => {
    const b = e.target.closest && e.target.closest('[role=radio]');
    if (!b || e.altKey || e.ctrlKey || e.metaKey) return;
    const all = [...b.parentElement.querySelectorAll('[role=radio]')];
    const i = all.indexOf(b);
    const to = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: all.length - 1 }[e.key];
    if (to == null) return;
    e.preventDefault();
    const next = all[(to + all.length) % all.length];
    pick(next);
    next.focus();
  });
  main.querySelector('#s-keys').onclick = () => {
    history.pushState(null, '', '#/keys');
    route();
  };
  main.querySelector('#s-clear').onclick = clearDeviceData;
  bindConn(main);
  main.querySelector('#s-reload').onclick = () => reloadToNew(); // app.js
  main.querySelector('#s-ver').onclick = copyBuildSha;
  main.querySelector('#s-push').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 's-enable') enablePush();
    else if (b.id === 's-test') testPush();
    else if (b.id === 's-disable') disablePush();
  };
}

// 알림: one status line with its buttons, and a line on what to do when there is something.
function renderPushBlock() {
  const box = document.getElementById('s-push');
  if (!box) return;
  const v = PushView.pushView(pushEnv(renderPushBlock));
  const btn = { enable: '<button type="button" class="btn" id="s-enable">알림 켜기</button>', test: '<button type="button" class="btn secondary" id="s-test">시험 알림</button>', disable: '<button type="button" class="btn secondary" id="s-disable">알림 끄기</button>' };
  const html = `<div class="push-row">
      <p class="push-status ${v.tone}"><span class="pdot" aria-hidden="true"></span>${esc(v.status)}</p>
      ${v.actions.length ? `<div class="row push-acts">${v.actions.map((a) => btn[a]).join('')}</div>` : ''}
    </div>
    ${v.lines.map((l) => `<p class="pref-hint">${esc(l)}</p>`).join('')}`;
  if (box._html === html) return;
  box._html = html;
  box.innerHTML = html;
}

// 연결: each host, its herdr and how many agents; the only part a state push changes. On a hub
// (GET /api/hosts says manageable) each peer has ⋯ (이름·주소 바꾸기, 연결 시험, 빼기) and a
// 「호스트 추가」 row follows; on a peer the block is read-only and says where hosts are managed.
let hostAdmin = null; // GET /api/hosts: { manageable, self, peers: [{ id, url, label }] }, or null
let hostAdminAt = 0;
async function loadHostAdmin(force = false) {
  if (!force && Date.now() - hostAdminAt < 30000) return;
  hostAdminAt = Date.now();
  try {
    hostAdmin = await api('/hosts');
  } catch {
    hostAdmin = hostAdmin || null; // an older server: no management, nothing said
  }
  renderConn();
}
const adminPeer = (id) => (hostAdmin && hostAdmin.peers.find((p) => p.id === id)) || null;
function renderConn() {
  const box = document.getElementById('s-conn');
  if (!box) return;
  const list = hosts().length ? hosts() : [{ id: localId(), label: state.host, online: true, herdr: state.herdr, local: true }];
  const manage = Boolean(hostAdmin && hostAdmin.manageable);
  // Peers in the list that the state doesn't carry yet (added a moment ago).
  const extra = manage ? hostAdmin.peers.filter((p) => !list.some((x) => x.id === p.id)).map((p) => ({ id: p.id, label: p.label || p.id, online: false, herdr: 'connecting', connecting: true })) : [];
  const lines = [...list, ...extra]
    .map((x) => {
      const n = state.agents.filter((a) => (a.host || localId()) === x.id).length;
      const bad = !x.online || x.herdr !== 'up';
      const status = x.connecting ? '연결 중' : !x.online ? `오프라인${x.since ? ` · ${esc(clock(x.since))}부터` : ''}` : `herdr ${x.herdr === 'up' ? '연결됨' : esc(x.herdr)} · 에이전트 ${n}개`;
      const api = apiMismatch(x);
      const warn = api ? `<span class="cl-warn">${esc(api)} — 배포가 필요합니다</span>` : '';
      const p = !x.local && manage ? adminPeer(x.id) : null;
      const where = p ? p.url.replace(/^https:\/\//, '') : x.local ? location.host : '';
      const url = where ? `<span class="cl-url">${esc(where)}</span>` : '';
      const more = p ? `<button type="button" class="icon-btn cl-more" data-host="${esc(x.id)}" aria-label="${esc(x.label)} 메뉴" title="${esc(x.label)} 메뉴">${ICON.more}</button>` : '';
      return `<li><span class="hdot${bad ? ' off' : ''}" aria-hidden="true"></span><span class="cl-main"><span class="cl-head"><b>${esc(x.label)}</b>${x.local && multi() ? `<span class="tag">${pushInfo && pushInfo.disabled ? '이 주소' : '허브'}</span>` : ''}<span class="cl-st">${status}</span></span>${url}${warn}</span>${more}</li>`;
    })
    .join('');
  const add = manage ? `<li class="cl-add"><button type="button" class="pref-link" id="s-host-add"><span>호스트 추가</span><span class="pl-end" aria-hidden="true">+</span></button></li>` : '';
  const ro = hostAdmin && !hostAdmin.manageable ? '<li class="cl-note">호스트는 허브에서 관리합니다. 허브의 설정 → 연결에서 추가·변경하세요.</li>' : '';
  const html = lines + add + ro;
  if (box._html === html) return;
  // Redrawn in place: a focused ⋯ (or 호스트 추가) keeps the focus.
  const f = document.activeElement && box.contains(document.activeElement) ? document.activeElement.dataset.host || document.activeElement.id : null;
  box._html = html;
  box.innerHTML = html;
  if (f) {
    const again = box.querySelector(`[data-host="${CSS.escape(f)}"]`) || (f === 's-host-add' ? box.querySelector('#s-host-add') : null);
    if (again) again.focus({ preventScroll: true });
  }
}
function bindConn(main) {
  main.querySelector('#s-conn').addEventListener('click', (e) => {
    const more = e.target.closest('.cl-more');
    if (more) return hostMenu(more.dataset.host);
    if (e.target.closest('#s-host-add')) addHostSheet();
  });
}

// After a change: the list again, now.
async function hostChanged(r) {
  if (r && r.peers) hostAdmin = { ...hostAdmin, ...r };
  hostAdminAt = Date.now();
  renderConn();
}
const hostIds = () => [localId(), ...hosts().map((h) => h.id), ...((hostAdmin && hostAdmin.peers) || []).map((p) => p.id)].filter(Boolean);
async function testHost(url) {
  return api('/hosts/test', { method: 'POST', body: JSON.stringify({ url }) });
}
// 연결 시험 from ⋯: the result in a sheet with one button.
async function showTest(label, url) {
  let text;
  try {
    const t = Conn.testText(await testHost(url));
    text = t.text;
  } catch (err) {
    text = errText(err);
  }
  await sheet({ title: `연결 시험 — ${label}`, text: `${text} (${url.replace(/^https:\/\//, '')})`, ok: '닫기', cancel: null });
}
async function hostMenu(id) {
  const p = adminPeer(id);
  if (!p) return;
  const label = hostLabel(id) || p.label || id;
  const k = await menu(label, [['rename', '이름 바꾸기'], ['url', '주소 바꾸기', false, p.url], ['test', '연결 시험'], '-', ['remove', '빼기', true]], { sub: p.url });
  if (k === 'rename') {
    const r = await askLoop({ title: '이름 바꾸기', text: '비우면 그 호스트가 스스로 쓰는 이름으로 돌아갑니다.', input: { value: p.label || label, placeholder: id }, ok: '바꾸기' }, (v) =>
      api(`/hosts/${encodeURIComponent(id)}/rename`, { method: 'POST', body: JSON.stringify({ label: v }) })
    );
    if (r && r !== true) hostChanged(r);
  } else if (k === 'url') {
    const r = await askLoop({ title: '주소 바꾸기', text: `${label} 를 따라갈 주소입니다. 바꾸면 곧바로 새 주소로 다시 붙습니다.`, input: { value: p.url, placeholder: 'https://server.example.ts.net:8443' }, ok: '바꾸기' }, (v) =>
      api(`/hosts/${encodeURIComponent(id)}/url`, { method: 'POST', body: JSON.stringify({ url: v }) })
    );
    if (r && r !== true) {
      hostChanged(r);
      const np = adminPeer(id);
      if (np) showTest(label, np.url);
    }
  } else if (k === 'test') showTest(label, p.url);
  else if (k === 'remove') {
    const ok = await sheet({ title: `${label} 빼기`, text: `${p.url} 를 이 허브의 호스트에서 뺍니다. 그 컴퓨터의 Herdr Hub 와 에이전트는 그대로이고, 다시 추가할 수 있습니다.`, ok: '빼기', danger: true });
    if (!ok) return;
    try {
      hostChanged(await api(`/hosts/${encodeURIComponent(id)}/remove`, { method: 'POST', body: '{}' }));
      toast(`${label} 를 뺐습니다`);
    } catch (err) {
      toastErr(errText(err));
    }
  }
}

// 호스트 추가: 이름·주소, 「연결 시험」, then 「추가」. 추가 tests first when the address hasn't been;
// a failed test turns it into 「그래도 추가」 (a peer asleep now can still be added).
function addHostSheet() {
  const el = document.createElement('div');
  el.className = 'sheet-back';
  el.innerHTML = `<form class="sheet host-form" role="dialog" aria-modal="true" aria-labelledby="ha-t" tabindex="-1" novalidate>
      <h2 id="ha-t">호스트 추가</h2>
      <p>다른 컴퓨터에서 도는 Herdr Hub 를 이 허브에 더합니다. 그 컴퓨터의 Tailscale 주소를 적으세요.</p>
      <label class="hf"><span>이름</span><input class="field" name="label" placeholder="server" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="40"></label>
      <label class="hf"><span>주소</span><input class="field" name="url" type="url" inputmode="url" placeholder="https://server.example.ts.net:8443" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="ha-r"></label>
      <p class="ha-result" id="ha-r" role="status" aria-live="polite"></p>
      <div class="row end">
        <button type="button" class="btn secondary" data-cancel>취소</button>
        <button type="button" class="btn secondary" data-test>연결 시험</button>
        <button type="submit" class="btn" data-add>추가</button>
      </div>
    </form>`;
  const form = el.querySelector('form');
  const name = form.elements.label;
  const addr = form.elements.url;
  const out = el.querySelector('.ha-result');
  const addBtn = el.querySelector('[data-add]');
  const testBtn = el.querySelector('[data-test]');
  let tested = null; // { url, ok }
  let busy = false;
  const say = (text, tone = '') => {
    out.textContent = text;
    out.className = `ha-result ${tone}`;
  };
  const sync = () => {
    const same = tested && tested.url === addr.value.trim();
    addBtn.textContent = same && !tested.ok ? '그래도 추가' : '추가';
    addBtn.disabled = testBtn.disabled = busy || !addr.value.trim();
  };
  addr.oninput = () => {
    if (tested && tested.url !== addr.value.trim()) say('');
    sync();
  };
  const runTest = async () => {
    const url = addr.value.trim();
    busy = true;
    sync();
    say('시험하는 중…', 'wait');
    try {
      const r = await testHost(url);
      const t = Conn.testText(r);
      tested = { url, ok: t.ok, id: r.id || null };
      // Already followed under another entry: said, and 추가 becomes 그래도 추가.
      const dup = t.ok && r.id && hosts().some((h) => h.id === r.id);
      if (dup) tested.ok = false;
      say(dup ? `${t.text} 이미 목록에 있는 호스트(${r.id})입니다.` : t.text, dup ? 'warn' : t.tone);
    } catch (err) {
      tested = { url, ok: false };
      say(errText(err), 'bad');
    }
    busy = false;
    sync();
    return tested.ok;
  };
  let layer = null;
  el.onclick = (e) => {
    if (e.target === el) closeLayer(layer);
  };
  el.querySelector('[data-cancel]').onclick = () => closeLayer(layer);
  testBtn.onclick = runTest;
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const url = addr.value.trim();
    if (!(tested && tested.url === url) && !(await runTest())) return; // the result is shown; 그래도 추가 next
    const label = name.value.trim();
    busy = true;
    sync();
    try {
      const r = await api('/hosts', { method: 'POST', body: JSON.stringify({ id: Conn.idFor(label, url, hostIds(), tested && tested.url === url ? tested.id : ''), url, label }) });
      closeLayer(layer);
      hostChanged(r);
      toast(`${label || (r.peer && r.peer.id) || '호스트'} 를 더했습니다`);
    } catch (err) {
      busy = false;
      sync();
      say(errText(err), 'bad');
    }
  };
  sync();
  layer = openLayer(el, { focus: name });
}
// 정보: this page's build and, when the server serves another one, that (app.js checks it).
// A click copies the full commit hash.
function renderVersionInfo() {
  const el = document.getElementById('s-ver');
  if (!el) return;
  const mine = Update.buildLabel(myBuild);
  const text = !mine ? '알 수 없음' : hasNew() ? `${mine} · 새 버전 ${Update.shortLabel(serverBuild)} 있음` : mine;
  const v = el.querySelector('.ver-v');
  if (v.textContent !== text) v.textContent = text;
  el.classList.toggle('ver-new', hasNew());
  const copy = Boolean(myBuild && myBuild.sha);
  el.title = copy ? `${myBuild.sha} — 눌러서 복사` : '';
  el.setAttribute('aria-label', copy ? `버전 ${text}. 누르면 커밋 해시를 복사합니다` : `버전 ${text}`);
  el.classList.toggle('ver-copy', copy);
  // A new build waiting: the button says so and stands out; else a quiet 새로고침.
  const r = document.getElementById('s-reload');
  if (r) {
    r.textContent = hasNew() ? '새 버전 받기' : '새로고침';
    r.classList.toggle('secondary', !hasNew());
  }
}
async function copyBuildSha() {
  if (!myBuild || !myBuild.sha) return;
  try {
    await navigator.clipboard.writeText(myBuild.sha);
    toast(`커밋 ${myBuild.commit} 복사함`);
  } catch {}
}

// What this device keeps besides the settings: kept chats, unsent text, read marks, the swipe
// hint. Cleared behind a confirm, then the page loads again so nothing in memory writes them back.
// Settings and push stay as they are.
async function clearDeviceData() {
  const ok = await sheet({ title: '이 기기 저장 데이터 지우기', text: '보관한 대화, 안 보낸 글, 읽음 표시를 이 기기에서 지우고 앱을 다시 엽니다. 설정과 알림은 그대로입니다.', ok: '지우기', danger: true });
  if (!ok) return;
  try {
    for (const k of [STORE_KEY, DRAFTS_KEY, SEEN_KEY, HINT_KEY]) localStorage.removeItem(k);
  } catch {}
  location.reload();
}
