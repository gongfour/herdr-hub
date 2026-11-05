'use strict';
// 빠른 이동 (Ctrl+P; Alt+P, also in the shell, keymap.js): a small palette over the page. Type to
// find an agent or a shell on any host by its name, workspace or host; ↑↓ (Ctrl+J/K) move, Enter opens it as
// a tap on its row would (split: on the right, with the caret in its field, as Alt+↑/↓ does).
// Esc / Ctrl+[ close it like any layer. With nothing typed, in the order 설정 → 빠른 이동의 순서
// picks (switcherPlace: by default 답 필요 · 완료 · 작업 중 · 쉬는 중 · 셸), each group by when it
// was last opened here, under a small heading where the order changes; the
// one open now last, dimmed (Enter on the first row never opens it again). Typed: the name's match
// first, then that same order. Each row is the list's own (list.js agentRow / termRow: its icon,
// title, name and time, status and unread dot), with where it is under it; split, the palette sits
// over the right column, where what it opens will be, so the list stays in view beside it.

// Opened here lately (agent and shell addresses, newest first), on this device.
const RECENT_KEY = 'herdr-hub.recent';
const RECENT_MAX = 20;
let memRecent = null;
function recentList() {
  if (!memRecent) {
    try {
      memRecent = JSON.parse(localStorage.getItem(RECENT_KEY)) || [];
    } catch {
      memRecent = [];
    }
    if (!Array.isArray(memRecent)) memRecent = [];
  }
  return memRecent;
}
// route() calls this for an opened agent or shell.
function noteRecent(href) {
  const list = [href, ...recentList().filter((h) => h !== href)].slice(0, RECENT_MAX);
  memRecent = list;
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* this page only */
  }
}

let qs = null; // the open switcher: { layer, el, input, list, items, sel }
const switcherOpen = () => Boolean(qs && !qs.layer.closed);

// Every agent and shell of every host, with what is matched and how it sorts.
function switcherRows() {
  const recent = recentList();
  const now = isDetail() ? location.hash : '';
  const rank = (href) => {
    const i = recent.indexOf(href);
    return i < 0 ? RECENT_MAX : i;
  };
  const rows = [];
  for (const a of state.agents || []) {
    const href = link(a.host, `/agent/${encodeURIComponent(a.pane)}`);
    rows.push({ href, kind: 'agent', x: a, name: a.name || a.title || a.pane, title: a.name ? a.title : '', ws: a.workspaceLabel, host: a.hostLabel || hostLabel(a.host), status: a.status, unread: isUnread(a), recent: rank(href), here: href === now });
  }
  for (const t of state.terminals || []) {
    const href = link(t.host, `/term/${encodeURIComponent(t.pane)}`);
    rows.push({ href, kind: 'term', x: t, name: termTitle(t), title: '', ws: t.workspaceLabel, host: t.hostLabel || hostLabel(t.host), status: 'term', unread: false, recent: rank(href), here: href === now });
  }
  return rows;
}

// Lower case, one space: Korean is matched as typed (each word of the query a substring).
const fold = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// What wants you first, as 설정 → 빠른 이동의 순서 says (prefs.js paletteOrder): 답 필요 always
// leads; then 완료 (finished, or a result not yet read) and 작업 중 in the chosen order, 쉬는 중,
// shells last — or, 「최근 연 순」, everything after 답 필요 by recency alone.
const SWITCH_ORDERS = {
  done: { blocked: [0, '답 필요'], done: [1, '완료'], working: [2, '작업 중'], idle: [3, '쉬는 중'], term: [4, '셸'] },
  working: { blocked: [0, '답 필요'], working: [1, '작업 중'], done: [2, '완료'], idle: [3, '쉬는 중'], term: [4, '셸'] },
  recent: { blocked: [0, '답 필요'], done: [1, '최근'], working: [1, '최근'], idle: [1, '최근'], term: [1, '최근'] },
};
const switcherKind = (r) => (r.status === 'blocked' ? 'blocked' : r.kind === 'term' ? 'term' : r.unread || r.status === 'done' ? 'done' : r.status === 'working' ? 'working' : 'idle');
const switcherPlace = (r) => (SWITCH_ORDERS[Prefs.get('paletteOrder')] || SWITCH_ORDERS.done)[switcherKind(r)];
const switcherOrder = (r) => switcherPlace(r)[0];
// The heading a row goes under with nothing typed.
const switcherGroup = (r) => (r.here ? '지금 보는 중' : switcherPlace(r)[1]);

function switcherFilter(rows, query) {
  const words = fold(query).split(' ').filter(Boolean);
  const open = switcherOrder;
  if (!words.length) return rows.sort((p, q) => Number(p.here) - Number(q.here) || open(p) - open(q) || p.recent - q.recent);
  const out = [];
  for (const r of rows) {
    const name = fold(r.name);
    const hay = `${name} ${fold(r.title)} ${fold(r.ws)} ${fold(r.host)} ${r.kind === 'term' ? '셸' : ''}`;
    if (!words.every((w) => hay.includes(w))) continue;
    // A name that starts with the first word first, then a name that has it, then the rest.
    r.score = name.startsWith(words[0]) ? 0 : name.includes(words[0]) ? 1 : 2;
    out.push(r);
  }
  return out.sort((p, q) => p.score - q.score || open(p) - open(q) || p.recent - q.recent);
}

// A row as the list draws it (list.js), its front only (no ⋯), with where it is (workspace, the host
// when there are several) on its small line, and 「지금 보는 중」 for the one open now.
function switcherRowHtml(r, i) {
  const t = document.createElement('template');
  t.innerHTML = (r.kind === 'term' ? termRow(r.x) : agentRow(r.x)).trim();
  const front = t.content.querySelector('.sw-front');
  const main = front.querySelector('.pane-main');
  let meta = main.querySelector('.pane-meta');
  if (!meta) {
    meta = document.createElement('span');
    meta.className = 'pane-meta';
    main.appendChild(meta);
  }
  const where = [r.here ? '지금 보는 중' : '', r.ws, multi() ? r.host : ''].filter(Boolean).map(esc);
  if (where.length) meta.insertAdjacentHTML('beforeend', (meta.childNodes.length ? '<span class="sep"> · </span>' : '') + where.join('<span class="sep"> · </span>'));
  const cls = front.className.replace(/\bsw-front\b/, '').trim();
  return `<div class="qs-row ${cls}${r.here ? ' here' : ''}" role="option" id="qs-${i}" data-i="${i}" aria-selected="${i === qs.sel}">${front.innerHTML}</div>`;
}

function renderSwitcher() {
  if (!switcherOpen()) return;
  const sel = qs.items[qs.sel];
  qs.items = switcherFilter(switcherRows(), qs.input.value);
  // The same row stays chosen while the list changes under it (a status came in).
  const keep = sel ? qs.items.findIndex((r) => r.href === sel.href) : -1;
  qs.sel = keep >= 0 && !qs.typed ? keep : 0;
  qs.typed = false;
  // Headings where the order changes, with nothing typed and more than one group to tell apart.
  const typed = Boolean(fold(qs.input.value));
  const heads = !typed && new Set(qs.items.map(switcherGroup)).size > 1;
  let last = null;
  qs.list.innerHTML = qs.items.length
    ? qs.items
        .map((r, i) => {
          const g = switcherGroup(r);
          const head = heads && g !== last ? `<div class="qs-head" role="presentation">${esc(g)}</div>` : '';
          last = g;
          return head + switcherRowHtml(r, i);
        })
        .join('')
    : `<p class="qs-none">${state.agents.length || (state.terminals || []).length ? '맞는 에이전트·셸이 없습니다' : '아직 에이전트·셸이 없습니다'}</p>`;
  fillTimes(qs.list); // list.js: 「방금」, 「4분」
  moveSwitcher(0);
}

function moveSwitcher(d) {
  if (!qs.items.length) return qs.input.removeAttribute('aria-activedescendant');
  qs.sel = (qs.sel + d + qs.items.length) % qs.items.length;
  for (const el of qs.list.querySelectorAll('.qs-row')) el.setAttribute('aria-selected', String(Number(el.dataset.i) === qs.sel));
  const el = document.getElementById(`qs-${qs.sel}`);
  qs.input.setAttribute('aria-activedescendant', el.id);
  el.scrollIntoView({ block: 'nearest' });
}

// Open it as its row would; in the split layout the caret goes into its field (stepFocus).
// Another page takes the palette's history entry (core.js), so Back from it goes where it would
// have before the palette opened, and no entry is left over.
function openSwitched(r) {
  const layer = qs.layer;
  const other = r && location.hash !== r.href;
  const own = other && !hist.pending && BackStack.depthOf(history.state) === layer.depth;
  closeLayer(layer, undefined, own ? 'replace' : undefined);
  if (!r) return;
  if (split) stepFocus = true;
  if (!other) {
    stepFocus = false;
    if (split) refocusInput(document.getElementById('d-input') || document.getElementById('t-input'));
  } else if (own) {
    history.replaceState({ prev: lastHash }, '', r.href);
    route();
  } else afterHist(() => (location.hash = r.href));
}

// The key line under the list, from the table (changed keys, 뒤로's Ctrl+[ for a keyboard cover).
function switcherKeys() {
  const kbd = (k) => `<kbd>${esc(k)}</kbd>`;
  const jk = [Keymap.keysFor('scrollDown')[0], Keymap.keysFor('scrollUp')[0]].filter(Boolean).map(Keymap.label);
  const back = Keymap.hint('back').split(' · ');
  return `${kbd('↑')}${kbd('↓')}${jk.length ? ` ${jk.map(kbd).join('')}` : ''} 고르기 · ${kbd('리턴')} 열기 · ${back.map(kbd).join('')} 닫기`;
}

// Ctrl+P / Alt+P. Again while it is open: closed. Under another sheet: taken, nothing opens
// (the browser would print).
function toggleSwitcher() {
  if (switcherOpen()) {
    closeLayer(qs.layer);
    return true;
  }
  if (topLayer()) return true;
  const el = document.createElement('div');
  el.className = 'sheet-back qs-back';
  // With fingers: no key help (a phone has no ↑↓ or Esc), a 취소 beside the field (the keyboard
  // leaves little dimmed page to tap, and iOS has no Back), and no row looks picked before
  // anything is typed (by-touch; once typed, the picked row is what 이동 opens).
  const touch = !keyboardLikely() && lastInput === 'pointer';
  // 취소 only when a finger opened it (a key has Esc and Ctrl+[), as a menu's.
  const byKey = lastInput === 'key';
  el.innerHTML = `<div class="qs${touch ? ' by-touch' : ''}" role="dialog" aria-modal="true" aria-label="빠른 이동">
      <div class="qs-top">
        <input class="field search-field qs-field" type="text" placeholder="에이전트·셸 이름, 작업공간, 호스트" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go"
          role="combobox" aria-expanded="true" aria-controls="qs-list" aria-autocomplete="list" aria-label="빠른 이동 검색">
        ${byKey ? '' : '<button type="button" class="qs-cancel" data-cancel>취소</button>'}
      </div>
      <div class="qs-list" id="qs-list" role="listbox" aria-label="에이전트·셸"></div>
      ${keyboardLikely() ? `<p class="qs-keys" aria-hidden="true">${switcherKeys()}</p>` : ''}
    </div>`;
  const input = el.querySelector('input');
  const list = el.querySelector('.qs-list');
  qs = { el, input, list, items: [], sel: 0, typed: false, layer: null };
  el.onclick = (e) => {
    if (e.target === el || e.target.closest('[data-cancel]')) closeLayer(qs.layer);
  };
  list.onclick = (e) => {
    const row = e.target.closest('.qs-row');
    if (row) openSwitched(qs.items[Number(row.dataset.i)]);
  };
  // Every keystroke, a syllable still being composed included (IME), filters at once.
  input.oninput = () => {
    qs.typed = true;
    renderSwitcher();
  };
  // Keys of this field alone (keymap.js LOCAL). Enter waits for the IME to finish a syllable.
  input.onkeydown = (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    // Ctrl+J/K as ↓/↑ (vim's j and k; by e.code, so with the keyboard set to Korean too).
    // ↑↓, and the keys scrolling has (Ctrl+J/K unless this device changed them).
    const has = (action) => Keymap.keysFor(action).some((k) => Keymap.matches(e, k));
    const down = e.key === 'ArrowDown' || has('scrollDown');
    if (down || e.key === 'ArrowUp' || has('scrollUp')) {
      e.preventDefault();
      qs.el.querySelector('.qs').classList.remove('by-touch');
      moveSwitcher(down ? 1 : -1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      openSwitched(qs.items[qs.sel]);
    } else if (Keymap.keysFor('switcher').some((k) => Keymap.matches(e, k))) {
      // In the shell view the keymap leaves Ctrl+P alone; here it closes, never prints.
      e.preventDefault();
      closeLayer(qs.layer);
    }
  };
  qs.layer = openLayer(el, { focus: input });
  renderSwitcher();
  return true;
}
