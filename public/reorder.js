'use strict';
// 순서 바꾸기: the order of the workspace cards and of the rows in them (the list), and of the
// hosts (설정 → 연결). The hub keeps it for every device (lib/order.js, /api/order); the list sorts
// by it (order.js). In the mode each card and row has a grip and ▲ ▼ in place of its ⋯ and time:
// drag the grip (a mouse or a finger: the grip alone takes the touch, so the list still scrolls
// and nothing else moves), press ▲ ▼, or ↑ ↓ with the focus on the grip. Rows don't open, long
// presses and the host swipe are off; 완료 or Esc ends it. A card moves among its host's cards,
// a row among its card's agents (or shells).

const reorder = { on: false, drag: null, pending: false };

function setReorder(on) {
  if (reorder.on === on) return;
  reorder.on = on;
  document.documentElement.classList.toggle('reordering', on);
  if (on && !split && view.name !== 'list') location.hash = homeHash();
  else if (listShown()) render();
}
const toggleReorder = () => (setReorder(!reorder.on), true);

// The grip and ▲ ▼ of one thing. first/last: it can't go further that way.
function reorderCtl(name, { first, last }) {
  const n = esc(name);
  return `<span class="ro-ctl">
    <button type="button" class="icon-btn ro-step" data-dir="-1" aria-label="${n} 위로"${first ? ' disabled' : ''}>${ICON.up}</button>
    <button type="button" class="icon-btn ro-step" data-dir="1" aria-label="${n} 아래로"${last ? ' disabled' : ''}>${ICON.down}</button>
    <button type="button" class="icon-btn ro-grip" aria-label="${n} 옮기기 (끌거나 ↑ ↓ 키)">${ICON.grip}</button>
  </span>`;
}

// What a control in the list moves: { scope, id, ids } — scope 'ws' (a host's cards) or 'pane'
// (a card's agents or shells), ids the list it moves in, as shown.
function listTarget(el) {
  const row = el.closest('[data-kind]');
  if (!row) return null;
  const { kind, id } = row.dataset;
  const host = row.dataset.host || localId();
  const { list } = listModel();
  if (kind === 'ws') {
    const ids = list.filter((s) => (s.w.host || localId()) === host).map((s) => s.w.workspace_id);
    return { scope: 'ws', host, id, ids };
  }
  const card = list.find((s) => [...s.agents, ...s.terms].some((x) => same(x, host, id)));
  if (!card) return null;
  const mine = kind === 'agent' ? card.agents : card.terms;
  return { scope: 'pane', host, ws: card.w.workspace_id, kind, id, ids: mine.map((x) => x.pane), card };
}

// The new list kept: on screen at once (state.order), then on the hub; put back if it refuses.
async function saveListOrder(t, ids) {
  const was = state.order || { workspaces: {}, panes: {} };
  let body;
  if (t.scope === 'ws') {
    state.order = { ...was, workspaces: { ...was.workspaces, [t.host]: ids } };
    body = ['/order/workspaces', { host: t.host, ids }];
  } else {
    const all = t.kind === 'agent' ? [...ids, ...t.card.terms.map((x) => x.pane)] : [...t.card.agents.map((x) => x.pane), ...ids];
    const panes = { ...was.panes, [t.host]: { ...((was.panes || {})[t.host] || {}), [t.ws]: all } };
    state.order = { ...was, panes };
    body = ['/order/panes', { host: t.host, workspace: t.ws, ids: all }];
  }
  if (listShown()) render();
  try {
    await api(body[0], { method: 'POST', body: JSON.stringify(body[1]) });
  } catch (err) {
    state.order = was;
    if (listShown()) render();
    toastErr(`순서를 저장하지 못했습니다: ${errText(err)}`);
  }
}

// 설정 → 연결: the hosts. The hub sends them sorted; here they move at once and the state follows.
async function saveHostOrder(ids) {
  const was = state.hosts;
  state.hosts = Order.sortBy(was, ids, (h) => h.id);
  renderConn();
  if (listShown()) render(); // split: the list beside it (a phone's list waits for its tab)
  try {
    await api('/order/hosts', { method: 'POST', body: JSON.stringify({ ids }) });
  } catch (err) {
    state.hosts = was;
    renderConn();
    if (listShown()) render();
    toastErr(`순서를 저장하지 못했습니다: ${errText(err)}`);
  }
}
function hostTarget(el) {
  const li = el.closest('[data-order-host]');
  return li ? { id: li.dataset.orderHost, ids: hosts().map((h) => h.id) } : null;
}

// One move (▲ ▼, a key, a drop), then the focus back on that thing's same control.
function reorderMove(el, dir, to) {
  const host = el.closest('#s-conn');
  const t = host ? hostTarget(el) : listTarget(el);
  if (!t) return false;
  const ids = to == null ? Order.move(t.ids, t.id, dir) : Order.moveTo(t.ids, t.id, to);
  if (!ids) return false;
  const which = el.classList.contains('ro-grip') ? '.ro-grip' : `.ro-step[data-dir="${el.dataset.dir}"]`;
  const row = !host && el.closest('[data-kind]');
  const keyOf = host ? `[data-order-host="${CSS.escape(t.id)}"]` : `[data-kind="${row.dataset.kind}"][data-id="${CSS.escape(t.id)}"][data-host="${CSS.escape(row.dataset.host)}"]`;
  if (host) saveHostOrder(ids);
  else saveListOrder(t, ids);
  const again = document.querySelector(`${keyOf} ${which}`);
  if (again && !again.disabled) again.focus({ preventScroll: true });
  else if (again) again.closest('.ro-ctl').querySelector('.ro-grip').focus({ preventScroll: true });
  return true;
}

document.addEventListener('click', (e) => {
  const step = e.target.closest && e.target.closest('.ro-step');
  if (step) {
    e.preventDefault();
    e.stopPropagation();
    return void reorderMove(step, Number(step.dataset.dir));
  }
  if (e.target.closest && e.target.closest('.ro-done')) setReorder(false);
}, true);

// ↑ ↓ on a grip: one step (keymap.js LOCAL 「순서 바꾸기」).
document.addEventListener('keydown', (e) => {
  const grip = e.target.closest && e.target.closest('.ro-grip');
  if (!grip || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
  e.preventDefault();
  e.stopPropagation();
  reorderMove(grip, e.key === 'ArrowUp' ? -1 : 1);
}, true);

// ---- dragging a grip: the thing follows the pointer, the others make room; dropped, it is moved
// to where it lies. The things it moves among: the same scope's, measured once at the start.
function dragPeers(item) {
  if (item.matches('[data-order-host]')) return [...item.parentElement.querySelectorAll(':scope > [data-order-host]')];
  if (item.matches('section.ws')) {
    const host = item.querySelector('.ws-head').dataset.host;
    return [...item.parentElement.querySelectorAll(':scope > section.ws')].filter((s) => s.querySelector('.ws-head').dataset.host === host);
  }
  return [...item.parentElement.querySelectorAll(`:scope > [data-kind="${item.dataset.kind}"]`)];
}

document.addEventListener('pointerdown', (e) => {
  const grip = e.target.closest && e.target.closest('.ro-grip');
  if (!grip || e.button !== 0 || reorder.drag) return;
  const item = grip.closest('[data-order-host]') || (grip.closest('.ws-head') ? grip.closest('section.ws') : grip.closest('[data-kind]'));
  if (!item) return;
  const peers = dragPeers(item);
  const from = peers.indexOf(item);
  if (from < 0 || peers.length < 2) return;
  e.preventDefault();
  grip.setPointerCapture(e.pointerId);
  const rects = peers.map((p) => p.getBoundingClientRect());
  const g = { grip, item, peers, rects, from, to: from, y0: e.clientY, id: e.pointerId };
  reorder.drag = g;
  item.classList.add('ro-dragging');
});
document.addEventListener('pointermove', (e) => {
  const g = reorder.drag;
  if (!g || e.pointerId !== g.id) return;
  const dy = e.clientY - g.y0;
  const h = g.rects[g.from].height;
  const mid = g.rects[g.from].top + h / 2 + dy;
  // Where its middle is now: past the middle of a neighbour, it takes that place.
  let to = g.from;
  for (let i = 0; i < g.peers.length; i++) {
    const r = g.rects[i];
    const m = r.top + r.height / 2;
    if (i < g.from && mid < m) to = Math.min(to, i);
    if (i > g.from && mid > m) to = Math.max(to, i);
  }
  g.to = to;
  g.item.style.transform = `translateY(${dy}px)`;
  g.peers.forEach((p, i) => {
    if (i === g.from) return;
    const shift = i > g.from && i <= to ? -h : i < g.from && i >= to ? h : 0;
    p.style.transform = shift ? `translateY(${shift}px)` : '';
  });
});
function dragEnd(e) {
  const g = reorder.drag;
  if (!g || e.pointerId !== g.id) return;
  reorder.drag = null;
  for (const p of g.peers) p.style.transform = '';
  g.item.classList.remove('ro-dragging');
  const moved = e.type === 'pointerup' && g.to !== g.from && reorderMove(g.grip, 0, g.to);
  if (!moved && reorder.pending) {
    reorder.pending = false;
    if (listShown()) render();
  }
  reorder.pending = false;
}
document.addEventListener('pointerup', dragEnd);
document.addEventListener('pointercancel', dragEnd);
