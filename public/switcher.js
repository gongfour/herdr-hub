'use strict';
// 빠른 이동 (Ctrl+P; Alt+P, also in the shell, keymap.js): a small palette over the page. Type to
// find an agent or a shell on any host by its name, workspace or host; ↑↓ (Ctrl+J/K) move, Enter opens it as
// a tap on its row would (split: on the right, with the caret in its field, as Alt+↑/↓ does).
// Esc / Ctrl+[ close it like any layer. With nothing typed: 답 필요 first, then the recently opened.

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
  const rank = (href) => {
    const i = recent.indexOf(href);
    return i < 0 ? RECENT_MAX : i;
  };
  const rows = [];
  for (const a of state.agents || []) {
    const href = link(a.host, `/agent/${encodeURIComponent(a.pane)}`);
    rows.push({ href, kind: 'agent', x: a, name: a.name || a.title || a.pane, title: a.name ? a.title : '', ws: a.workspaceLabel, host: a.hostLabel || hostLabel(a.host), status: a.status, unread: isUnread(a), recent: rank(href) });
  }
  for (const t of state.terminals || []) {
    const href = link(t.host, `/term/${encodeURIComponent(t.pane)}`);
    rows.push({ href, kind: 'term', x: t, name: termTitle(t), title: '', ws: t.workspaceLabel, host: t.hostLabel || hostLabel(t.host), status: 'term', unread: false, recent: rank(href) });
  }
  return rows;
}

// Lower case, one space: Korean is matched as typed (each word of the query a substring).
const fold = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

function switcherFilter(rows, query) {
  const words = fold(query).split(' ').filter(Boolean);
  const open = (r) => (r.status === 'blocked' ? 0 : r.unread ? 1 : r.status === 'working' ? 2 : 3);
  const blocked = (r) => (r.status === 'blocked' ? 0 : 1);
  if (!words.length) return rows.sort((p, q) => blocked(p) - blocked(q) || p.recent - q.recent || open(p) - open(q));
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

function switcherBadge(r) {
  if (r.status === 'blocked') return '<span class="badge blocked">답 필요</span>';
  if (r.status === 'working') return '<span class="badge working">작업 중</span>';
  if (r.unread) return '<span class="badge done">새 결과</span>';
  if (r.kind === 'term') return '<span class="pane-kind">셸</span>';
  return '';
}

function renderSwitcher() {
  if (!switcherOpen()) return;
  const sel = qs.items[qs.sel];
  qs.items = switcherFilter(switcherRows(), qs.input.value);
  // The same row stays chosen while the list changes under it (a status came in).
  const keep = sel ? qs.items.findIndex((r) => r.href === sel.href) : -1;
  qs.sel = keep >= 0 && !qs.typed ? keep : 0;
  qs.typed = false;
  const where = (r) => [r.ws, multi() ? r.host : ''].filter(Boolean).map(esc).join(' · ');
  qs.list.innerHTML = qs.items.length
    ? qs.items
        .map(
          (r, i) => `<div class="qs-row${r.unread ? ' unread' : ''}" role="option" id="qs-${i}" data-i="${i}" aria-selected="${i === qs.sel}">
            <span class="pane-ic" aria-hidden="true">${r.kind === 'term' ? ICON.term : agentIcon(r.x)}</span>
            <span class="qs-main"><span class="qs-name">${esc(r.name)}${r.title ? `<span class="qs-title"> · ${esc(r.title)}</span>` : ''}</span><span class="qs-where">${where(r)}</span></span>
            ${switcherBadge(r)}
          </div>`,
        )
        .join('')
    : `<p class="qs-none">${state.agents.length || (state.terminals || []).length ? '맞는 에이전트·셸이 없습니다' : '아직 에이전트·셸이 없습니다'}</p>`;
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
  el.innerHTML = `<div class="qs${touch ? ' by-touch' : ''}" role="dialog" aria-modal="true" aria-label="빠른 이동">
      <div class="qs-top">
        <input class="field qs-field" type="text" placeholder="에이전트·셸 이름, 작업공간, 호스트" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go"
          role="combobox" aria-expanded="true" aria-controls="qs-list" aria-autocomplete="list" aria-label="빠른 이동 검색">
        <button type="button" class="qs-cancel" data-cancel>취소</button>
      </div>
      <div class="qs-list" id="qs-list" role="listbox" aria-label="에이전트·셸"></div>
      ${keyboardLikely() ? '<p class="qs-keys" aria-hidden="true"><kbd>↑</kbd><kbd>↓</kbd> 고르기 · <kbd>리턴</kbd> 열기 · <kbd>Esc</kbd> 닫기</p>' : ''}
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
