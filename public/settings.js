'use strict';
// 설정: 알림 (push.js), the settings of prefs.js's table (입력, 화면), 키보드, and 연결 · 정보.
// The page is built once and then patched: a state push redraws only the 연결 block, the push
// lookups only the 알림 block, and a control only its own state, so the keyboard focus stays put.

// ------------------------------------------------------------ settings

// Split: where closing 설정 goes, the agent, shell or workspace it was opened over (goBack then
// steps back in history to it), else the list.
function settingsBack() {
  const p = history.state && history.state.prev;
  return p && !['/', '/settings'].includes(normHash(p)) ? p : '#/';
}

// This page's asset version (index.html's ?v=), to tell whether a device has the new app.
const appVersion = () => {
  const s = document.querySelector('script[src*="/app.js"]');
  const m = s && /[?&]v=(\d+)/.exec(s.getAttribute('src'));
  return m ? m[1] : '';
};
// A phone or a tablet without its keyboard: no 단축키 to show. Split always has room for it.
const touchOnly = () => !split && matchMedia('(hover: none) and (pointer: coarse)').matches;

// One row of prefs.js's table.
function prefHtml(p) {
  const id = p.key.replace(/\W/g, '-');
  if (p.type === 'bool') return `<label class="switch pref" data-pref="${esc(p.key)}"><span>${esc(p.label)}</span><input type="checkbox" role="switch"></label>`;
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
  const v = appVersion();
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
        <h2 id="g-conn">연결 · 정보</h2>
        <div class="pcard">
          <ul class="conn-list" id="s-conn"></ul>
          <p class="pref-info">${v ? `버전 v${esc(v)} · ` : ''}${esc(location.host)}<br>설정은 모두 이 기기에만 저장됩니다.</p>
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
  main.querySelector('#s-keys').onclick = openKeySheet;
  main.querySelector('#s-clear').onclick = clearDeviceData;
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

// 연결: each host, its herdr and how many agents; the only part a state push changes.
function renderConn() {
  const box = document.getElementById('s-conn');
  if (!box) return;
  const list = hosts().length ? hosts() : [{ id: localId(), label: state.host, online: true, herdr: state.herdr, local: true }];
  const html = list
    .map((x) => {
      const n = state.agents.filter((a) => (a.host || localId()) === x.id).length;
      const bad = !x.online || x.herdr !== 'up';
      const status = !x.online ? `오프라인${x.since ? ` · ${esc(clock(x.since))}부터` : ''}` : `herdr ${x.herdr === 'up' ? '연결됨' : esc(x.herdr)} · 에이전트 ${n}개`;
      return `<li><span class="hdot${bad ? ' off' : ''}" aria-hidden="true"></span><b>${esc(x.label)}</b>${x.local && multi() ? `<span class="tag">${pushInfo && pushInfo.disabled ? '이 주소' : '허브'}</span>` : ''}<span class="cl-st">${status}</span></li>`;
    })
    .join('');
  if (box._html === html) return;
  box._html = html;
  box.innerHTML = html;
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
