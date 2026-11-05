'use strict';
// The 단축키 page (#/keys): a cheat sheet first, the editing on demand.
// Tabs per screen (어디서나 · 대화 · 셸 · 목록, keymap.js TABS / tabsOf): each lists the actions that
// work there, one row per action, its short name and this device's key (⌘ on the Mac), the others
// folded as 「+2」. The keys handled inside a field (LOCAL) close the tab they belong to. Only 셸 says
// which keys the Hub takes from the shell. The search (or ⌨ 키로 찾기, the key itself) looks in every
// tab and says each row's tabs.
// 바꾸기 turns on the editing in place: × takes a key off, + records the next key pressed (Esc or
// 취소 cancels), 기본값 puts an action back, 모두 기본값으로 all of them, and on the 셸 tab each key's
// 「셸 화면에서도」 switch (the Hub takes that key in the shell view, or leaves it to the shell;
// keymap.js setShell). Changed rows have a dot; 「바꾼 키만」 shows only them.
// Split it opens on the right like 설정; on the phone it is a page of its own. ✕ (Esc) closes it.

// rec: the action whose key is being recorded, or 'search'. tab: the tab shown. edit: 바꾸기 on.
// only: 바꾼 키만. open: the rows whose folded keys are shown.
// info: the one row whose long label is open in the cheat sheet (a tap on the row; a touch screen
// has no tooltip to show it).
const kp = { q: '', rec: null, tab: 'any', edit: false, only: false, open: new Set(), info: null };

// Where ✕ goes: what was open before (the agent it was opened over, or 설정), else 설정 (phone) or
// the list (split).
function keysBack() {
  const p = history.state && history.state.prev;
  return p && normHash(p) !== '/keys' ? p : split ? '#/' : '#/settings';
}

// ?: the page, or back from it.
function toggleKeys() {
  if (view.name === 'keys') return goBack(keysBack());
  history.pushState(null, '', '#/keys');
  route();
}

// The tab the page opens on: the screen it was opened from.
const KEYS_TAB_FROM = { term: 'shell', agent: 'chat', list: 'list' };

// from: the route it was opened from (app.js); the page drawn again (from itself) keeps its state.
function renderKeys({ focus = false, from = null } = {}) {
  if (!from || from.name !== 'keys') {
    Object.assign(kp, { q: '', tab: KEYS_TAB_FROM[from && from.name] || 'any', edit: false, only: false, info: null });
    kp.open.clear();
  }
  const root = detailRoot();
  let main = root.querySelector(':scope > main.keys-page');
  if (!main) {
    const tabs = Keymap.TABS.map(
      (t) => `<button type="button" role="tab" id="k-tab-${t.id}" data-tab="${t.id}" aria-controls="k-list">${esc(t.name)}</button>`,
    ).join('');
    root.innerHTML = `
      <header class="bar">
        ${split ? '' : backLink(keysBack(), '뒤로')}
        <h1 id="k-title">단축키</h1>
        <button type="button" class="toggle k-edit" id="k-edit" aria-pressed="false">바꾸기</button>
        ${split ? `<a class="icon-btn close-detail" href="${keysBack()}" data-back aria-label="닫기"${keyAttrs('back', '닫기')}>${ICON.x}</a>` : ''}
      </header>
      <main class="panel settings keys-page" tabindex="-1" aria-labelledby="k-title">
        <div class="k-search">
          <input type="search" id="k-q" class="search-field" placeholder="동작이나 키 이름으로 찾기" aria-label="단축키 찾기" autocomplete="off" enterkeyhint="search">
          <button type="button" class="toggle" id="k-rec" aria-pressed="false" title="키를 눌러 그 키를 쓰는 동작 찾기">⌨ 키로 찾기</button>
        </div>
        <p class="k-heard" id="k-heard" role="status" hidden></p>
        <div class="seg k-tabs" role="tablist" aria-label="화면">${tabs}</div>
        <div id="k-list" role="tabpanel" tabindex="-1"></div>
      </main>`;
    main = root.querySelector(':scope > main.keys-page');
    bindKeysPage(main);
  }
  main.querySelector('#k-q').value = kp.q;
  const back = root.querySelector(':scope > .bar [data-back]');
  if (back) back.setAttribute('href', keysBack());
  drawKeysList();
  if (focus) {
    // A keyboard is there to search with; a phone's would cover the page.
    if (keyboardLikely()) main.querySelector('#k-q').focus({ preventScroll: true });
    else main.focus({ preventScroll: true });
  }
}

const tabName = (id) => (Keymap.TABS.find((t) => t.id === id) || {}).name || '';

function drawKeysList() {
  const box = document.getElementById('k-list');
  if (!box) return;
  const q = kp.q.trim();
  const edit = kp.edit;
  const kbd = (k) => `<kbd>${esc(Keymap.label(k))}</kbd>`;
  const rows = new Map(Keymap.actionRows().map((r) => [r.action, r]));
  const changedAny = Object.keys(keyOverrides).length > 0;
  if (!changedAny) kp.only = false;
  const keep = (r) => !kp.only || r.changed;

  // One action's row. tab: the tab it is drawn on (its keys read there: the shell view's on 셸);
  // tabs: the tabs to name (search results).
  // The cheat sheet's name: a button that opens the long label under it (one row at a time), when
  // the label says more than the name. The row's tooltip says it too, for a mouse.
  const nameOf = (id, name, label, dot = '') => {
    if (edit || !label || label === name) return { name: `<span class="k-name">${esc(name)}${dot}</span>`, label: '' };
    const open = kp.info === id;
    return {
      name: `<button type="button" class="k-name k-info" data-info="${esc(id)}" aria-expanded="${open}">${esc(name)}${dot}</button>`,
      // The name is just above: the label without it again in front (「대화창 닫기: …」).
      label: open ? `<span class="k-label">${esc(label.startsWith(`${name}: `) ? label.slice(name.length + 2) : label)}</span>` : '',
    };
  };
  const row = (r, tab, tabs = null) => {
    const rec = kp.rec === r.action;
    const onShell = tab === 'shell';
    const dot = r.changed ? '<span class="k-dot" title="이 기기에서 바꾼 키" aria-label="바꿈"></span>' : '';
    const tabsLine = tabs ? `<span class="k-in">${esc(tabs.map(tabName).join(' · '))}</span>` : '';
    if (!edit) {
      // The cheat sheet: the name, the key that works here, the rest folded.
      const ks = Keymap.keysIn(r.action, Keymap.tabCtx(tab));
      const first = Keymap.primaryKey(r.action, Keymap.tabCtx(tab));
      const rest = ks.filter((k) => k !== first);
      let keys;
      if (r.fixed) keys = ks.length > 2 ? `<kbd>${esc(Keymap.label(ks[0]))}–${esc(Keymap.label(ks[ks.length - 1]))}</kbd>` : ks.map(kbd).join('');
      else if (!first) keys = `<span class="k-none">${r.action === 'leaveView' && !Keymap.env.app ? '설치한 앱에서' : '키 없음'}</span>`;
      else {
        const open = kp.open.has(r.action);
        const twice = Keymap.ACTIONS[r.action].twice ? '<span class="k-twice">×2</span>' : '';
        keys = `${kbd(first)}${twice}${
          rest.length
            ? open
              ? rest.map(kbd).join('')
              : `<button type="button" class="k-more" data-more aria-expanded="false" title="${esc(rest.map(Keymap.label).join(' · '))}" aria-label="다른 키 ${rest.length}개: ${esc(rest.map(Keymap.label).join(', '))}">+${rest.length}</button>`
            : ''
        }`;
      }
      const n = nameOf(`a:${r.action}`, r.name, r.label, dot);
      return `<div class="k-row view${r.changed ? ' changed' : ''}" data-action="${esc(r.action)}" title="${esc(r.label)}">
          <div class="k-what">${n.name}${tabsLine}${n.label}</div>
          <div class="k-keys"${kp.open.has(r.action) ? ' tabindex="-1"' : ''}>${keys}</div>
        </div>`;
    }
    // Editing: every key of the action, its × (and on 셸 its switch), +, 기본값.
    let keys;
    if (r.fixed) keys = r.keys.length > 2 ? `<kbd>${esc(Keymap.label(r.keys[0]))}–${esc(Keymap.label(r.keys[r.keys.length - 1]))}</kbd>` : r.keys.map(kbd).join('');
    else
      keys = r.keys
        .map((k, i) => {
          const lock = r.action === 'back' && k === 'Escape'; // 뒤로 always has Esc
          const sh = r.shells[i];
          const name = Keymap.label(k);
          // Where the key goes in the shell view, in words that say the state: filled 「Hub」 (the
          // Hub takes it there too) or an outlined 「셸로」 (the shell gets it). Only on 셸.
          const shBtn =
            onShell && sh && sh.can
              ? `<button type="button" class="ksh" data-sh="${esc(k)}" role="switch" aria-checked="${sh.on}" aria-label="${esc(name)} 셸 화면에서도 Hub 가 씀" title="셸 화면에서: ${sh.on ? 'Hub 가 씀 (누르면 셸로 보냄)' : '셸로 감 (누르면 Hub 가 씀)'}">${sh.on ? 'Hub' : '셸로'}</button>`
              : '';
          // 뒤로's Esc can't be taken off: said so where the others have their ×.
          const end = lock ? '<span class="k-lock" title="뒤로는 늘 Esc 를 씁니다">고정</span>' : `<button type="button" class="kx" data-rm="${esc(k)}" aria-label="${esc(name)} 빼기" title="빼기">×</button>`;
          return `<span class="kchip">${kbd(k)}${shBtn}${end}</span>`;
        })
        .join('');
    const where = Keymap.whereText(r.action);
    const loses = r.fixed || !onShell ? [] : r.shells.filter((x) => x.loses).map((x) => `${Keymap.label(x.key)}: ${x.loses}`);
    const tools = r.fixed
      ? '<span class="k-fixed">바꿀 수 없음</span>'
      : `${rec ? `<span class="k-recnote" role="status">누를 키를 누르세요${keyboardLikely() ? ' · Esc 취소' : ''}</span><button type="button" class="k-reset k-cancel" data-cancel-rec>취소</button>` : '<button type="button" class="k-add" data-add aria-label="키 더하기" title="키 더하기">+</button>'}${
          r.changed ? '<button type="button" class="k-reset" data-reset title="이 동작을 기본 키로">기본값</button>' : ''
        }`;
    return `<div class="k-row${r.changed ? ' changed' : ''}${rec ? ' recording' : ''}" data-action="${esc(r.action)}">
        <div class="k-what"><span class="k-name">${esc(r.name)}${dot}</span>${tabsLine}<span class="k-label">${esc(r.label)}</span>${where ? `<span class="k-where">${esc(where)}</span>` : ''}${loses.map((t) => `<span class="k-loses">${esc(t)}</span>`).join('')}</div>
        <div class="k-keys">${keys || '<span class="k-none">키 없음</span>'}${tools}</div>
      </div>`;
  };
  const localRow = (x, tabs = null) => {
    const ks = x.keys || Keymap.localKeys(x);
    const tabsLine = tabs ? `<span class="k-in">${esc(tabs.map(tabName).join(' · '))}</span>` : '';
    // A row without a key is a note on how the screen takes keys: said in full.
    if (!ks.length) return `<div class="k-row local note"><div class="k-what"><span class="k-label">${esc(x.label)}</span>${tabsLine}</div></div>`;
    const n = nameOf(`l:${x.group}|${x.name}`, x.name, x.label);
    return `<div class="k-row local${edit ? '' : ' view'}"${edit ? '' : ` title="${esc(x.label)}"`}><div class="k-what">${n.name}${tabsLine}${edit ? `<span class="k-label">${esc(x.label)}</span>` : n.label}</div><div class="k-keys">${(edit || x.keys ? ks : ks.slice(0, 1)).map(kbd).join('')}</div></div>`;
  };
  const card = (title, inner, cls = '') => (inner ? `<section class="pgroup">${title ? `<h2>${esc(title)}</h2>` : ''}<div class="pcard${cls}">${inner}</div></section>` : '');
  const cols = edit ? '' : ' k-cols';

  let body = '';
  let note = '';
  if (q) {
    // Every tab: each row with the tabs it is on.
    const found = Keymap.search(q);
    const acts = found.filter((x) => x.action && keep(rows.get(x.action)));
    const locals = kp.only ? [] : found.filter((x) => x.local);
    body =
      card(`찾은 단축키 · 모든 화면`, acts.map((x) => row(rows.get(x.action), x.tabs.includes(kp.tab) ? kp.tab : x.tabs[0], x.tabs.length ? x.tabs : null)).join(''), cols) +
      card('입력 칸·창 안의 키', locals.map((x) => localRow(x.local, x.tabs)).join(''), cols);
    if (!acts.length && !locals.length) body = `<p class="k-empty">「${esc(q)}」에 맞는 단축키가 없습니다.</p>`;
  } else {
    const tab = kp.tab;
    const inTab = Object.keys(Keymap.ACTIONS).filter((a) => Keymap.tabsOf(a).includes(tab)).map((a) => rows.get(a)).filter(keep);
    if (tab === 'shell') {
      // The keys the Hub takes in the shell view; editing, also those the shell gets that could be the Hub's.
      const off = edit ? Object.keys(Keymap.ACTIONS).filter((a) => !inTab.some((r) => r.action === a) && Keymap.canShellAction(a) && rows.get(a).keys.length).map((a) => rows.get(a)).filter(keep) : [];
      note = edit
        ? '키마다 단추가 셸 화면에서 그 키가 가는 곳입니다: <span class="ksh-demo" aria-hidden="true">Hub</span>면 Hub 가 쓰고, <span class="ksh-demo off" aria-hidden="true">셸로</span>면 셸이 받습니다. 눌러서 바꿉니다.'
        : '셸 화면에서는 이 키만 Hub 가 쓰고, 나머지 키는 모두 셸로 갑니다.';
      body = card('셸 화면에서 Hub 가 쓰는 키', inTab.map((r) => row(r, tab)).join(''), cols) + card('셸로 가는 키 (켜면 Hub 가 씀)', off.map((r) => row(r, tab)).join(''));
    } else body = card('', inTab.map((r) => row(r, tab)).join(''), cols);
    if (kp.only && !body) body = `<p class="k-empty">이 화면에서 바꾼 키가 없습니다.</p>`;
    // The keys handled inside a field or a window of this screen, by where.
    if (!kp.only) {
      const groups = new Map();
      for (const x of Keymap.LOCAL.filter((y) => Keymap.localTab(y) === tab)) {
        if (!groups.has(x.group)) groups.set(x.group, []);
        groups.get(x.group).push(x);
      }
      // The cheat sheet says a thing once: rows of one name (메뉴's ↓ and Ctrl+J) as one, its keys together.
      const once = (xs) => {
        if (edit) return xs;
        const out = [];
        for (const x of xs) {
          const first = Keymap.localKeys(x).slice(0, 1);
          const same = x.key && out.find((y) => y.key && y.name === x.name);
          if (same) same.keys.push(...first);
          else out.push({ ...x, keys: first });
        }
        return out;
      };
      // A row without a key is a note on how the screen takes keys: said in full under the card.
      body += [...groups]
        .map(([g, xs]) => {
          const keyed = once(xs.filter((x) => x.key));
          const notes = xs.filter((x) => !x.key).map((x) => `<p class="pnote k-note">${esc(x.label)}</p>`).join('');
          return card(`${g} 안에서`, keyed.map((x) => localRow(x)).join(''), cols).replace(/<\/section>$/, `${notes}</section>`) || (notes ? `<section class="pgroup"><h2>${esc(g)} 안에서</h2>${notes}</section>` : '');
        })
        .join('');
    }
  }

  // Which keys this window gets: the installed app has the browser's tab and window keys.
  const w = Keymap.env.mac ? '⌘W·⌘N' : 'Ctrl+W·Ctrl+N';
  const winNote = Keymap.env.app
    ? `설치한 앱이라 브라우저의 탭·창 키(${w} 등)도 Hub 가 씁니다. 앱을 끝내는 키(${Keymap.env.mac ? '⌘Q' : 'Alt+F4'})는 쓸 수 없습니다.`
    : `브라우저 탭에서는 ${w} 같은 탭·창 키를 브라우저가 가져갑니다. 설치한 앱으로 열면 Hub 가 씁니다 (대화창 닫기 등).`;
  const head = edit
    ? `<p class="pnote k-note">${esc(winNote)} 바꾼 키는 이 기기에만 저장됩니다. 글자 키는 입력 칸 밖에서만 동작합니다.</p>`
    : '';
  const only = changedAny
    ? `<div class="k-filter"><button type="button" class="toggle" data-only aria-pressed="${kp.only}">바꾼 키만</button></div>`
    : '';
  const html = `${head}${only}${note ? `<p class="pnote k-note">${note}</p>` : ''}${body}
    ${edit && changedAny ? '<section class="pgroup"><div class="pcard"><button type="button" class="pref-link danger-text" data-reset-all><span>모든 단축키를 기본값으로</span></button></div></section>' : ''}`;
  // What 키로 찾기 heard stays after the key it heard, until something else is recorded or it's turned off.
  if (kp.rec !== 'search' && kp.rec) showHeard('');
  drawKeysChrome();
  if (box._html === html) return;
  box._html = html;
  box.innerHTML = html;
}

// The tabs, 바꾸기 and 키로 찾기 as the state says.
function drawKeysChrome() {
  const searching = Boolean(kp.q.trim());
  for (const b of document.querySelectorAll('.k-tabs [role="tab"]')) {
    const on = b.dataset.tab === kp.tab;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  }
  // Searching looks in every tab: the tab's mark steps back while it does.
  document.querySelector('.k-tabs')?.classList.toggle('searching', searching);
  const list = document.getElementById('k-list');
  if (list) {
    if (searching) list.setAttribute('aria-label', '찾은 단축키');
    else list.removeAttribute('aria-label');
    list.setAttribute('aria-labelledby', searching ? 'k-title' : `k-tab-${kp.tab}`);
  }
  const ed = document.getElementById('k-edit');
  if (ed) {
    ed.setAttribute('aria-pressed', String(kp.edit));
    ed.textContent = kp.edit ? '완료' : '바꾸기';
    ed.title = kp.edit ? '키 바꾸기 끝내기' : '키 바꾸기: 빼기·더하기·기본값, 셸 탭에서는 셸 화면에서도';
  }
  const recBtn = document.getElementById('k-rec');
  if (recBtn) {
    recBtn.setAttribute('aria-pressed', String(kp.rec === 'search'));
    recBtn.textContent = kp.rec === 'search' ? '키를 누르세요…' : '⌨ 키로 찾기';
  }
}

function setKeysTab(id, { focus = false } = {}) {
  kp.tab = id;
  // A tab picked while searching: the search gives way to it.
  if (kp.q) {
    kp.q = '';
    const q = document.getElementById('k-q');
    if (q) q.value = '';
  }
  drawKeysList();
  if (focus) document.getElementById(`k-tab-${id}`)?.focus({ preventScroll: true });
}

function bindKeysPage(main) {
  const root = main.parentElement;
  const q = main.querySelector('#k-q');
  q.oninput = () => {
    kp.q = q.value;
    drawKeysList();
  };
  main.querySelector('#k-rec').onclick = () => {
    kp.rec = kp.rec === 'search' ? null : 'search';
    showHeard(kp.rec ? '누를 키를 누르세요. 페이지가 받은 그대로 여기 보입니다 (아무것도 안 뜨면 기기가 먼저 가져간 키).' : '');
    drawKeysList();
  };
  root.querySelector('#k-edit').onclick = () => {
    kp.edit = !kp.edit;
    if (!kp.edit && kp.rec && kp.rec !== 'search') kp.rec = null;
    drawKeysList();
  };
  const tabs = main.querySelector('.k-tabs');
  tabs.onclick = (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) setKeysTab(t.dataset.tab);
  };
  // The tablist's own keys (ARIA): ←/→ to the next tab, Home/End to the ends.
  tabs.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const ids = Keymap.TABS.map((t) => t.id);
    const i = ids.indexOf(kp.tab);
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: ids.length - 1 }[e.key];
    if (to == null) return;
    e.preventDefault();
    e.stopPropagation();
    setKeysTab(ids[(to + ids.length) % ids.length], { focus: true });
  });
  main.onclick = (e) => {
    const t = e.target;
    if (t.closest('[data-reset-all]')) return saveKeys({}), toast('모든 단축키를 기본값으로 되돌렸습니다'), drawKeysList();
    if (t.closest('[data-only]')) return (kp.only = !kp.only), drawKeysList();
    // The cheat sheet: a tap anywhere on a row (but its +N) opens or closes its long label.
    const viewRow = !kp.edit && !t.closest('[data-more]') && t.closest('.k-row.view');
    const info = viewRow && viewRow.querySelector('[data-info]');
    if (info) {
      const id = info.dataset.info;
      const hadFocus = document.activeElement === info;
      kp.info = kp.info === id ? null : id;
      drawKeysList();
      if (hadFocus) [...document.querySelectorAll('[data-info]')].find((b) => b.dataset.info === id)?.focus({ preventScroll: true });
      return;
    }
    const row = t.closest('.k-row[data-action]');
    if (!row) return;
    const action = row.dataset.action;
    if (t.closest('[data-more]')) {
      kp.open.add(action);
      drawKeysList();
      // The focus on the row's keys, where the button was.
      document.querySelector(`.k-row[data-action="${CSS.escape(action)}"] .k-keys`)?.focus({ preventScroll: true });
      return;
    }
    if (t.closest('[data-cancel-rec]')) {
      kp.rec = null;
      return drawKeysList();
    }
    if (t.closest('[data-add]')) {
      kp.rec = action;
      return drawKeysList();
    }
    if (t.closest('[data-reset]')) return saveKeys(Keymap.reset(keyOverrides, action)), drawKeysList();
    const sh = t.closest('[data-sh]');
    if (sh) {
      try {
        saveKeys(Keymap.setShell(keyOverrides, action, sh.dataset.sh, sh.getAttribute('aria-checked') !== 'true'));
      } catch (err) {
        toastErr(err.message);
      }
      drawKeysList();
      // The list is drawn anew: the focus back on the same switch, for the keyboard.
      const again = [...document.querySelectorAll(`.k-row[data-action="${CSS.escape(action)}"] [data-sh]`)].find((b) => b.dataset.sh === sh.dataset.sh);
      if (again) again.focus({ preventScroll: true });
      return;
    }
    // Taken off at once, with a way back in the toast (the × sits right by 셸; a slip is easy).
    const rm = t.closest('[data-rm]');
    if (rm) {
      const before = JSON.parse(JSON.stringify(keyOverrides));
      try {
        saveKeys(Keymap.unassign(keyOverrides, action, rm.dataset.rm));
        toast(`${Keymap.label(rm.dataset.rm)} 를 뺐습니다`, { action: { label: '되돌리기', run: () => (saveKeys(before), drawKeysList()) }, ms: 8000 });
      } catch (err) {
        toastErr(err.message);
      }
      drawKeysList();
    }
  };
}

// 키로 찾기: what the page got for each key, raw, to tell a key the device keeps (nothing shows)
// from one that comes as something else (a cover's ` as Dead, Alt eaten by the IME …). The words in
// the page's type, the raw values (raw) in mono.
function showHeard(text, raw = '', after = '') {
  const el = document.getElementById('k-heard');
  if (!el) return;
  el.innerHTML = text ? `${esc(text)}${raw ? ` <code>${esc(raw)}</code>` : ''}${after ? ` ${esc(after)}` : ''}` : '';
  el.hidden = !text;
}
function showHeardKey(e, note = '') {
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.metaKey && 'Meta', e.shiftKey && 'Shift'].filter(Boolean).join('+') || '없음';
  const as = Keymap.keyOf(e);
  showHeard('받은 키:', `key="${e.key}" code="${e.code || ''}" 보조키=${mods}`, `${e.repeat ? '(반복) ' : ''}→ ${as ? Keymap.label(as) : '단축키로 쓸 수 없는 키'}${note}`);
}

// While recording, the next key is the page's alone: a new key for an action, or the key to
// search by. Esc cancels. Before every other listener (capture on window).
window.addEventListener(
  'keydown',
  (e) => {
    if (view.name !== 'keys' || !kp.rec) return;
    if (kp.rec === 'search') showHeardKey(e, e.isComposing || e.keyCode === 229 ? ' (한글 입력기가 조합 중)' : '');
    if (e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.key === 'Escape') {
      kp.rec = null;
      return drawKeysList();
    }
    const key = Keymap.keyOf(e);
    if (!key) return; // a modifier on its own: wait for the rest
    const action = kp.rec;
    kp.rec = null;
    if (action === 'search') {
      kp.q = Keymap.label(key);
      const q = document.getElementById('k-q');
      if (q) q.value = kp.q;
      return drawKeysList();
    }
    try {
      const r = Keymap.assign(keyOverrides, action, key);
      saveKeys(r.overrides);
      if (r.from) toast(`${Keymap.label(key)}: 「${Keymap.ACTIONS[r.from].name}」에서 옮겼습니다`);
    } catch (err) {
      toastErr(err.message);
    }
    drawKeysList();
  },
  true,
);
