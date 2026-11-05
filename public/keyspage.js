'use strict';
// The 단축키 page (#/keys), as VS Code's Keyboard Shortcuts editor: every action of keymap.js
// with its keys, where they work and whether this device changed them, a search over names and
// keys (or by pressing the key itself), and the editing in place: × takes a key off, + records
// the next key pressed (Esc or 취소 cancels), a key's 셸 switches 「셸 화면에서도」 (the Hub takes that
// key in the shell view, or leaves it to the shell; keymap.js setShell), 기본값 puts an action
// back, 모두 기본값으로 all of them.
// Split it opens on the right like 설정; on the phone it is a page of its own. ✕ (Esc) closes it.

const kp = { q: '', rec: null }; // rec: the action whose key is being recorded, or 'search'

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

function renderKeys({ focus = false } = {}) {
  const root = detailRoot();
  let main = root.querySelector(':scope > main.keys-page');
  if (!main) {
    root.innerHTML = `
      <header class="bar">
        ${split ? '' : backLink(keysBack(), '뒤로')}
        <h1 id="k-title">단축키</h1>
        ${split ? `<a class="icon-btn close-detail" href="${keysBack()}" data-back aria-label="닫기"${keyAttrs('back', '닫기')}>${ICON.x}</a>` : ''}
      </header>
      <main class="panel settings keys-page" tabindex="-1" aria-labelledby="k-title">
        <div class="k-search">
          <input type="search" id="k-q" class="search-field" placeholder="동작이나 키 이름으로 찾기" aria-label="단축키 찾기" autocomplete="off" enterkeyhint="search">
          <button type="button" class="toggle" id="k-rec" aria-pressed="false" title="키를 눌러 그 키를 쓰는 동작 찾기">⌨ 키로 찾기</button>
        </div>
        <p class="k-heard" id="k-heard" role="status" hidden></p>
        <div id="k-list"></div>
      </main>`;
    main = root.querySelector(':scope > main.keys-page');
    bindKeysPage(main);
  }
  const back = root.querySelector(':scope > .bar [data-back]');
  if (back) back.setAttribute('href', keysBack());
  drawKeysList();
  if (focus) {
    // A keyboard is there to search with; a phone's would cover the page.
    if (keyboardLikely()) main.querySelector('#k-q').focus({ preventScroll: true });
    else main.focus({ preventScroll: true });
  }
}

// The rows that match the search: a word of the name, or a key ("ctrl+k", "alt+↓").
const keyText = (k) => Keymap.label(k).toLowerCase();
function keysMatch(r, q) {
  if (!q) return true;
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = `${r.label} ${r.keys.map(keyText).join(' ')}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

function drawKeysList() {
  const box = document.getElementById('k-list');
  if (!box) return;
  const q = kp.q.trim();
  const kbd = (k) => `<kbd>${esc(Keymap.label(k))}</kbd>`;
  const groups = new Map();
  for (const r of Keymap.actionRows()) {
    if (!keysMatch(r, q)) continue;
    if (!groups.has(r.group)) groups.set(r.group, []);
    groups.get(r.group).push(r);
  }
  const row = (r) => {
    const rec = kp.rec === r.action;
    let keys;
    if (r.fixed) keys = r.keys.length > 2 ? `<kbd>${esc(Keymap.label(r.keys[0]))}–${esc(Keymap.label(r.keys[r.keys.length - 1]))}</kbd>` : r.keys.map(kbd).join('');
    else
      keys = r.keys
        .map((k, i) => {
          const keep = r.action === 'back' && k === 'Escape'; // 뒤로 always has Esc
          const sh = r.shells[i];
          const name = Keymap.label(k);
          // Where the key goes in the shell view, in words that say the state: filled 「Hub」 (the
          // Hub takes it there too) or an outlined 「셸로」 (the shell gets it).
          const shBtn = sh && sh.can
            ? `<button type="button" class="ksh" data-sh="${esc(k)}" role="switch" aria-checked="${sh.on}" aria-label="${esc(name)} 셸 화면에서도 Hub 가 씀" title="셸 화면에서: ${sh.on ? 'Hub 가 씀 (누르면 셸로 보냄)' : '셸로 감 (누르면 Hub 가 씀)'}"><span class="ksh-where">셸 화면</span>${sh.on ? 'Hub' : '셸로'}</button>`
            : '';
          // 뒤로's Esc can't be taken off: said so where the others have their ×.
          const end = keep ? '<span class="k-lock" title="뒤로는 늘 Esc 를 씁니다">고정</span>' : `<button type="button" class="kx" data-rm="${esc(k)}" aria-label="${esc(name)} 빼기" title="빼기">×</button>`;
          return `<span class="kchip">${kbd(k)}${shBtn}${end}</span>`;
        })
        .join('');
    const where = Keymap.whereText(r.action);
    const loses = r.fixed ? [] : r.shells.filter((x) => x.loses).map((x) => `${Keymap.label(x.key)}: ${x.loses}`);
    const tools = r.fixed
      ? '<span class="k-fixed">바꿀 수 없음</span>'
      : `${rec ? `<span class="k-recnote" role="status">누를 키를 누르세요${keyboardLikely() ? ' · Esc 취소' : ''}</span><button type="button" class="k-reset k-cancel" data-cancel-rec>취소</button>` : '<button type="button" class="k-add" data-add aria-label="키 더하기" title="키 더하기">+</button>'}${
          r.changed ? '<button type="button" class="k-reset" data-reset title="이 동작을 기본 키로">기본값</button>' : ''
        }`;
    return `<div class="k-row${r.changed ? ' changed' : ''}${rec ? ' recording' : ''}" data-action="${esc(r.action)}">
        <div class="k-what"><span class="k-name">${esc(r.label)}</span>${r.changed ? '<span class="k-mark">바꿈</span>' : ''}${where ? `<span class="k-where">${esc(where)}</span>` : ''}${loses.map((t) => `<span class="k-loses">${esc(t)}</span>`).join('')}</div>
        <div class="k-keys">${keys || '<span class="k-none">키 없음</span>'}${tools}</div>
      </div>`;
  };
  const local = Keymap.LOCAL.filter((x) => keysMatch({ label: `${x.group} ${x.label}`, keys: Keymap.localKeys(x) }, q));
  const changed = Object.keys(keyOverrides).length > 0;
  const html = `
    <p class="pnote k-note">바꾼 키는 이 기기에만 저장됩니다. 글자 키는 입력 칸 밖에서만 동작합니다. 키 옆의 단추는 셸 화면에서 그 키가 가는 곳입니다: <span class="ksh-demo" aria-hidden="true">Hub</span>면 셸 화면에서도 Hub 가 쓰고, <span class="ksh-demo off" aria-hidden="true">셸로</span>면 셸이 받습니다. 눌러서 바꿉니다.</p>
    ${[...groups]
      .map(([g, rows]) => `<section class="pgroup"><h2>${esc(g)}</h2><div class="pcard">${rows.map(row).join('')}</div></section>`)
      .join('')}
    ${
      local.length
        ? `<section class="pgroup"><h2>입력 칸 안의 키</h2><div class="pcard">${local
            .map((x) => `<div class="k-row local"><div class="k-what"><span class="k-name">${esc(x.label)}</span><span class="k-where">${esc(x.group)}</span></div><div class="k-keys">${Keymap.localKeys(x).map(kbd).join('')}</div></div>`)
            .join('')}</div></section>`
        : ''
    }
    ${!groups.size && !local.length ? `<p class="k-empty">「${esc(q)}」에 맞는 단축키가 없습니다.</p>` : ''}
    ${changed ? '<section class="pgroup"><div class="pcard"><button type="button" class="pref-link danger-text" data-reset-all><span>모든 단축키를 기본값으로</span></button></div></section>' : ''}`;
  // What 키로 찾기 heard stays after the key it heard, until something else is recorded or it's turned off.
  if (kp.rec !== 'search' && kp.rec) showHeard('');
  if (box._html === html) return;
  box._html = html;
  box.innerHTML = html;
  const recBtn = document.getElementById('k-rec');
  if (recBtn) {
    recBtn.setAttribute('aria-pressed', String(kp.rec === 'search'));
    recBtn.textContent = kp.rec === 'search' ? '키를 누르세요…' : '⌨ 키로 찾기';
  }
}

function bindKeysPage(main) {
  const q = main.querySelector('#k-q');
  q.value = kp.q;
  q.oninput = () => {
    kp.q = q.value;
    drawKeysList();
  };
  main.querySelector('#k-rec').onclick = () => {
    kp.rec = kp.rec === 'search' ? null : 'search';
    showHeard(kp.rec ? '누를 키를 누르세요. 페이지가 받은 그대로 여기 보입니다 (아무것도 안 뜨면 기기가 먼저 가져간 키).' : '');
    drawKeysList();
  };
  main.onclick = (e) => {
    const t = e.target;
    if (t.closest('[data-reset-all]')) return saveKeys({}), toast('모든 단축키를 기본값으로 되돌렸습니다'), drawKeysList();
    const row = t.closest('.k-row[data-action]');
    if (!row) return;
    const action = row.dataset.action;
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
      if (r.from) toast(`${Keymap.label(key)}: 「${Keymap.ACTIONS[r.from].label}」에서 옮겼습니다`);
    } catch (err) {
      toastErr(err.message);
    }
    drawKeysList();
  },
  true,
);
