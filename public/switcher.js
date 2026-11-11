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
// 명령 (Ctrl+Shift+P, ⌘⇧P, F1; or > typed first, as in VS Code): the same palette lists commands
// instead, what can be done from here (palette.js names and matches them): every keymap action
// that can run where you are, with its keys, and the ⋯ menu's other items of what is open. Enter
// runs one as its key or menu item would (one that can't be undone still asks). Deleting the >
// goes back to the agents and shells.

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
    rows.push({ href, kind: 'agent', x: a, name: a.name || a.title || a.pane, title: a.name ? a.title : '', ws: a.workspaceLabel, host: a.hostLabel || hostLabel(a.host), status: shownStatus(a), unread: isUnread(a), recent: rank(href), here: href === now });
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
  done: { blocked: [0, T('답 필요')], done: [1, T('완료')], working: [2, T('작업 중')], idle: [3, T('쉬는 중')], term: [4, T('셸')] },
  working: { blocked: [0, T('답 필요')], working: [1, T('작업 중')], done: [2, T('완료')], idle: [3, T('쉬는 중')], term: [4, T('셸')] },
  recent: { blocked: [0, T('답 필요')], done: [1, T('최근')], working: [1, T('최근')], idle: [1, T('최근')], term: [1, T('최근')] },
};
const switcherKind = (r) => (r.status === 'blocked' ? 'blocked' : r.kind === 'term' ? 'term' : r.status === 'working' || r.status === 'sub' ? 'working' : r.unread || r.status === 'done' ? 'done' : 'idle');
const switcherPlace = (r) => (SWITCH_ORDERS[Prefs.get('paletteOrder')] || SWITCH_ORDERS.done)[switcherKind(r)];
const switcherOrder = (r) => switcherPlace(r)[0];
// The heading a row goes under with nothing typed.
const switcherGroup = (r) => (r.here ? T('지금 보는 중') : switcherPlace(r)[1]);

function switcherFilter(rows, query) {
  const words = fold(query).split(' ').filter(Boolean);
  const open = switcherOrder;
  if (!words.length) return rows.sort((p, q) => Number(p.here) - Number(q.here) || open(p) - open(q) || p.recent - q.recent);
  const out = [];
  for (const r of rows) {
    const name = fold(r.name);
    const hay = `${name} ${fold(r.title)} ${fold(r.ws)} ${fold(r.host)} ${r.kind === 'term' ? fold(T('셸')) : ''}`;
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
  const where = [r.here ? T('지금 보는 중') : '', r.ws, multi() ? r.host : ''].filter(Boolean).map(esc);
  if (where.length) meta.insertAdjacentHTML('beforeend', (meta.childNodes.length ? '<span class="sep"> · </span>' : '') + where.join('<span class="sep"> · </span>'));
  const cls = front.className.replace(/\bsw-front\b/, '').trim();
  return `<div class="qs-row ${cls}${r.here ? ' here' : ''}" role="option" id="qs-${i}" data-i="${i}" aria-selected="${i === qs.sel}">${front.innerHTML}</div>`;
}

// The mode follows what is typed: > first is 명령. The field's words and the list's name with it.
function switcherMode() {
  const cmd = Palette.parseQuery(qs.input.value).commands;
  if (cmd === qs.cmd) return cmd;
  qs.cmd = cmd;
  qs.sel = 0;
  qs.input.placeholder = cmd ? T('명령 이름 (예: 끝내기, 설정, 줄바꿈)') : PLACEHOLDER;
  qs.input.setAttribute('aria-label', cmd ? T('명령 검색') : T('빠른 이동 검색'));
  qs.list.setAttribute('aria-label', cmd ? T('명령') : T('에이전트·셸'));
  qs.el.querySelector('.qs').classList.toggle('commands', cmd);
  const keys = qs.el.querySelector('.qs-keys');
  if (keys) keys.innerHTML = switcherKeys();
  return cmd;
}

function renderSwitcher() {
  if (!switcherOpen()) return;
  if (switcherMode()) return renderCommands();
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
    : `<p class="qs-none">${state.agents.length || (state.terminals || []).length ? T('맞는 에이전트·셸이 없습니다') : T('아직 에이전트·셸이 없습니다')}</p>`;
  fillTimes(qs.list); // list.js: 「방금」, 「4분」
  moveSwitcher(0);
}

// ---- 명령
// What is open, for its ⋯ items and the commands that act on it: { kind, x } or null.
function openThing() {
  if (view.name === 'agent' && currentAgent()) return { kind: 'agent', x: currentAgent() };
  if (view.name === 'term' && currentTerminal()) return { kind: 'term', x: currentTerminal() };
  if (view.name === 'ws') {
    const w = (state.workspaces || []).find((x) => same(x, curHost(), view.id, 'workspace_id'));
    if (w) return { kind: 'ws', x: w };
  }
  return null;
}
// Whether an action can do something here, as its key would (a key that would do nothing has no
// command); an action not listed always can (a new one shows up as a command by itself).
const visible = (id) => {
  const el = document.getElementById(id);
  return Boolean(el && !el.hidden && !el.disabled && el.offsetParent);
};
const COMMAND_CAN = {
  leaveView: () => view.name !== 'list' && (view.name === 'settings' || Boolean($app.querySelector('a[data-back]'))),
  focusInput: () => visible('d-input') || visible('t-input'),
  menu: (o) => Boolean(o),
  lastView: () => Boolean(view.name === 'agent' || view.name === 'term' ? visits.prev : visits.cur),
  nextBlocked: () => state.agents.some(needsAnswer),
  prevBlocked: () => state.agents.some(needsAnswer),
  jumpEnd: (o) => Boolean(o && o.kind !== 'ws'),
  jumpTop: (o) => Boolean(o && o.kind !== 'ws'),
  stop: (o) => Boolean(o && o.kind === 'agent' && o.x.status === 'working'),
  // An offline host's ghost (o.x.stale): only to look at (actions.js ghostOff).
  wrap: () => Boolean(scr),
  terminal: (o) => Boolean(o && o.kind === 'agent' && !o.x.stale),
  usage: (o) => Boolean(o && o.kind === 'agent' && usageOf(o.x)),
  termFontUp: (o) => Boolean(scr || (o && o.kind === 'term')),
  termFontDown: (o) => Boolean(scr || (o && o.kind === 'term')),
  // In a workspace's own view 워크스페이스 닫기 is the one (끝내기 there closes it too).
  closeView: (o) => Boolean(o && o.kind !== 'ws' && !o.x.stale),
  closeWorkspace: () => Boolean(workspaceHere() && !workspaceHere().stale), // app.js
  mode: (o) => Boolean(o && o.kind === 'agent' && !o.x.stale && visible('d-mode')),
  prevHost: () => multi() && listShown(),
  nextHost: () => multi() && listShown(),
  prevRow: () => split,
  nextRow: () => split,
  toggleSide: () => split,
  nextPane: () => split,
  prevPane: () => split,
};
// A command's name where it is, when its words depend on what is open.
function commandNameHere(action, o) {
  if (action === 'closeView' && o) return o.kind === 'agent' ? T('에이전트 끝내기') : T('셸 끝내기');
  if (action === 'wrap' && scr) return Prefs.get(scr.kind === 'term' ? 'wrap.term' : 'wrap.agent') ? T('줄바꿈 끄기') : T('줄바꿈 켜기');
  if (action === 'toggleSide') return sideOff() ? T('사이드바 펴기') : T('사이드바 접기');
  if (action === 'settings') return view.name === 'settings' ? T('설정 닫기') : T('설정 열기');
  return '';
}
// What a command is about, on its small line: the agent, shell or workspace it acts on.
function commandSub(action, o) {
  if (action === 'closeView' && o) return o.kind === 'agent' ? o.x.name || o.x.title || o.x.pane : termTitle(o.x); // as its sheet names it
  if (action === 'closeWorkspace') {
    const w = workspaceHere();
    return w ? w.label : '';
  }
  return '';
}
// Run as the key would; two keep their own way: 중단 asks (its key is pressed twice), and 모드
// needs no caret in the message box.
const COMMAND_RUN = {
  stop: () => confirmStop(currentAgent()), // agent.js
  mode: () => pickMode(), // the picker: from 명령 there is no message box to step in
};
const runAction = (action) => (COMMAND_RUN[action] ? COMMAND_RUN[action]() : KEY_ACTIONS[action]({ action, key: '' }, null));

// Every command that can run here: what is open's ⋯ items first (those its own key doesn't cover),
// then the keymap's actions in the table's order.
function switcherCommands() {
  const o = openThing();
  const ctx = hintCtx();
  const cmds = [];
  if (o) {
    const items = o.kind === 'ws' ? wsMenuItems(o.x, { here: true }) : paneMenuItems(o.kind, o.x, { here: true });
    const on = { name: rowLabel(o.kind, o.x) };
    const group = o.kind === 'agent' ? T('이 에이전트: {name}', on) : o.kind === 'term' ? T('이 셸: {name}', on) : T('이 워크스페이스: {name}', on);
    for (const it of items) {
      if (!Array.isArray(it) || it[4] || it[5] || it[0] === 'close') continue; // an action's own command says it, with its key; it[5]: can't now (a ghost)
      const [k, name, , note] = it;
      const run = () => (o.kind === 'ws' ? wsAction(o.x, k) : paneAction(o.kind, o.x, k, { here: true }));
      cmds.push({ id: `menu:${k}`, name, sub: note || '', group, keys: '', hay: `${name} ${note || ''} ${group}`, run });
    }
  }
  const acts = Palette.actionCommands(Keymap.ACTIONS, {
    can: (a) => !COMMAND_CAN[a] || COMMAND_CAN[a](o),
    name: (a) => commandNameHere(a, o),
    sub: (a) => commandSub(a, o),
    hint: (a) => Keymap.hint(a, ctx),
  });
  for (const c of acts) cmds.push({ ...c, run: () => runAction(c.action) });
  return cmds;
}

function commandRowHtml(c, i) {
  return `<div class="qs-row qs-cmd" role="option" id="qs-${i}" data-i="${i}" aria-selected="${i === qs.sel}">
      <span class="qs-cmd-main"><span class="qs-cmd-name">${esc(c.name)}</span>${c.sub ? `<span class="qs-cmd-sub">${esc(c.sub)}</span>` : ''}</span>
      ${c.keys && keyboardLikely() ? `<kbd class="qs-cmd-key">${esc(c.keys)}</kbd>` : ''}
    </div>`;
}

function renderCommands() {
  const sel = qs.items[qs.sel];
  const { query } = Palette.parseQuery(qs.input.value);
  qs.items = Palette.filter(switcherCommands(), query);
  const keep = sel ? qs.items.findIndex((c) => c.id === sel.id) : -1;
  qs.sel = keep >= 0 && !qs.typed ? keep : 0;
  qs.typed = false;
  // Headings by group with nothing typed; typed, the best fit first and no headings.
  const heads = !query;
  let last = null;
  qs.list.innerHTML = qs.items.length
    ? qs.items
        .map((c, i) => {
          const head = heads && c.group !== last ? `<div class="qs-head" role="presentation">${esc(c.group)}</div>` : '';
          last = c.group;
          return head + commandRowHtml(c, i);
        })
        .join('')
    : `<p class="qs-none">${T('맞는 명령이 없습니다')}</p>`;
  moveSwitcher(0);
}

// Run it once the palette is gone (its history entry back off, the focus back where it was), so
// what it opens (a sheet, a page) lands on the page, not under the palette.
function runCommand(c) {
  if (!c) return;
  qs.run = c.run;
  closeLayer(qs.layer);
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
  const cmd = qs && qs.cmd;
  const keys = {
    pick: `${kbd('↑')}${kbd('↓')}${jk.length ? ` ${jk.map(kbd).join('')}` : ''}`,
    enter: kbd(T('리턴')),
    other: cmd ? '' : ` · ${T('{key} 명령', { key: kbd('>') })}`,
    back: back.map(kbd).join(''),
  };
  return cmd ? T('{pick} 고르기 · {enter} 하기{other} · {back} 닫기', keys) : T('{pick} 고르기 · {enter} 열기{other} · {back} 닫기', keys);
}
const PLACEHOLDER = T('에이전트·셸 이름, 워크스페이스, 호스트 (> 명령)');

// Ctrl+P / Alt+P; commands: Ctrl+Shift+P / F1, straight into 명령 (the field starts with >).
// Again while it is open: closed; the other one's key turns it to the other mode. Under another
// sheet: taken, nothing opens (the browser would print).
function toggleSwitcher({ commands = false } = {}) {
  if (switcherOpen()) {
    if (commands === Boolean(qs.cmd)) closeLayer(qs.layer);
    else {
      qs.input.value = commands ? '>' : '';
      qs.typed = true;
      renderSwitcher();
      qs.input.setSelectionRange(qs.input.value.length, qs.input.value.length);
    }
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
  el.innerHTML = `<div class="qs${touch ? ' by-touch' : ''}" role="dialog" aria-modal="true" aria-label="${T('빠른 이동')}">
      <div class="qs-top">
        <input class="field search-field qs-field" type="text" placeholder="${PLACEHOLDER}" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go"
          role="combobox" aria-expanded="true" aria-controls="qs-list" aria-autocomplete="list" aria-label="${T('빠른 이동 검색')}">
        ${byKey ? '' : `<button type="button" class="qs-cancel" data-cancel>${T('취소')}</button>`}
      </div>
      <div class="qs-list" id="qs-list" role="listbox" aria-label="${T('에이전트·셸')}"></div>
      ${keyboardLikely() ? `<p class="qs-keys" aria-hidden="true">${switcherKeys()}</p>` : ''}
    </div>`;
  const input = el.querySelector('input');
  const list = el.querySelector('.qs-list');
  qs = { el, input, list, items: [], sel: 0, typed: false, layer: null, cmd: null, run: null };
  if (commands) input.value = '>';
  el.onclick = (e) => {
    if (e.target === el || e.target.closest('[data-cancel]')) closeLayer(qs.layer);
  };
  list.onclick = (e) => {
    const row = e.target.closest('.qs-row');
    if (!row) return;
    const it = qs.items[Number(row.dataset.i)];
    if (qs.cmd) runCommand(it);
    else openSwitched(it);
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
      if (qs.cmd) runCommand(qs.items[qs.sel]);
      else openSwitched(qs.items[qs.sel]);
    } else if (Keymap.keysFor('switcher').some((k) => Keymap.matches(e, k))) {
      // In the shell view the keymap leaves Ctrl+P alone; here it closes (or turns 명령 back to
      // 빠른 이동), never prints.
      e.preventDefault();
      e.stopPropagation();
      toggleSwitcher();
    }
  };
  // A command runs once the palette has closed (runCommand).
  const mine = qs;
  qs.layer = openLayer(el, { focus: input, onClose: () => mine.run && mine.run() });
  if (commands) input.setSelectionRange(1, 1);
  renderSwitcher();
  return true;
}
